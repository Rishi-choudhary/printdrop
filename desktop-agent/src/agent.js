/**
 * PrintDrop Desktop Agent — Core Polling Loop
 *
 * Responsibilities:
 *   - Heartbeat every 30s (reports live printers to backend)
 *   - On startup: fetch shop info (autoPrint, shopName) from /api/agent/me
 *   - Poll for jobs every pollIntervalMs using /api/agent/jobs
 *   - Auto mode:   automatically claim + print queued jobs
 *   - Manual mode: surface queued jobs to UI; print only when shopkeeper clicks
 *   - Pickup mode: mark ready jobs as picked_up via UI
 *   - Update job status: queued → printing → ready | cancelled → picked_up
 *   - Idempotency via processedJobs (persisted across restarts)
 *   - Startup recovery: re-queue any jobs stuck in 'printing'
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { printFile, getAvailablePrinters } = require('./printer');
const { prepareForPrinting, stampTokenOnFirstPage, addTokenBackPage } = require('./pdf-utils');
const { downloadFile } = require('./downloader');
const { wrapImageAsPdf } = require('./image-to-pdf');
const processedJobs = require('./processed-jobs');
const { ensureSumatra } = require('./sumatra');
const logger = require('./logger');
const configStore = require('./config');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const MAX_RETRIES = 3;
const HEARTBEAT_INTERVAL_MS = 30_000;

// ── Module state ─────────────────────────────────────────────────────────────

let _config = null;
let _callbacks = {};
let _pollTimer = null;
let _heartbeatTimer = null;
let _isPolling = false;
const _inFlight = new Set(); // job IDs currently being processed

// Full server queue (queued + printing + ready + today's done)
let _serverQueue = [];

// Whether auto-print mode is active (sourced from backend shop.autoPrint)
let _autoPrint = false;

// In-memory job list for the dashboard (newest first, capped at 50)
const _recentJobs = [];
let _printedToday = 0;
let _failedToday = 0;
let _statsDate = new Date().toISOString().slice(0, 10);
let _connected = false;
let _lastPollAt = null;
let _lastHeartbeatAt = null;

// ── Public API ────────────────────────────────────────────────────────────────

async function start(config, callbacks) {
  _config = config;
  _callbacks = callbacks;
  _autoPrint = config.autoPrint || false;

  logger.info(`Agent starting — shop: ${config.shopName || config.shopId}`);
  logger.info(`B&W printer: ${config.bwPrinterSystemName || 'none'}`);
  logger.info(`Color printer: ${config.colorPrinterSystemName || 'none (fallback to B&W)'}`);
  logger.info(`Mode: ${_autoPrint ? 'Auto-Print' : 'Manual'}`);

  if (os.platform() === 'win32') {
    ensureSumatra().catch((err) => logger.warn(`SumatraPDF prewarm failed: ${err.message}`));
  }

  // Fetch shop identity + settings from server, persist shopId/shopName/autoPrint
  await fetchShopInfo();

  // Recover any jobs stuck in 'printing' from a previous run
  await recoverStuckJobs();

  // Immediate first run
  await sendHeartbeat();
  await pollQueue();

  // Intervals
  _heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  _pollTimer = setInterval(pollQueue, _config.pollIntervalMs || 4000);
}

function stop() {
  clearInterval(_pollTimer);
  clearInterval(_heartbeatTimer);
  _pollTimer = null;
  _heartbeatTimer = null;
  logger.info('Agent stopped.');
}

function hasInFlight() {
  return _inFlight.size > 0;
}

function getState() {
  return {
    connected: _connected,
    shopName: _config?.shopName || '',
    autoPrint: _autoPrint,
    lastPollAt: _lastPollAt,
    lastHeartbeatAt: _lastHeartbeatAt,
    printers: [
      _config?.bwPrinterSystemName
        ? { systemName: _config.bwPrinterSystemName, displayName: _config.bwPrinterDisplayName || _config.bwPrinterSystemName, isOnline: true, role: 'bw' }
        : null,
      _config?.colorPrinterSystemName
        ? { systemName: _config.colorPrinterSystemName, displayName: _config.colorPrinterDisplayName || _config.colorPrinterSystemName, isOnline: true, role: 'color' }
        : null,
    ].filter(Boolean),
    serverQueue: _serverQueue,
    recentJobs: _recentJobs.slice(0, 20),
    stats: {
      printedToday: _printedToday,
      inQueue: _inFlight.size,
      failedToday: _failedToday,
      queued: _serverQueue.filter((j) => j.status === 'queued').length,
      printing: _serverQueue.filter((j) => j.status === 'printing').length,
      ready: _serverQueue.filter((j) => j.status === 'ready').length,
    },
  };
}

// ── Shop info fetch ───────────────────────────────────────────────────────────

async function fetchShopInfo() {
  try {
    const data = await apiFetch('/api/agent/me');
    if (data.shopId) {
      _config.shopId = data.shopId;
      _config.shopName = data.shopName;
      _autoPrint = data.autoPrint || false;
      _config.autoPrint = _autoPrint;
      // Persist to disk so restarts remember shopId, shopName, and mode
      configStore.save({ shopId: data.shopId, shopName: data.shopName, autoPrint: _autoPrint });
      logger.info(`Shop: ${data.shopName} (${data.shopId}) — autoPrint: ${_autoPrint}`);
    }
  } catch (err) {
    logger.warn(`Could not fetch shop info: ${err.message}`);
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

async function sendHeartbeat() {
  try {
    const osPrinters = await getAvailablePrinters().catch(() => []);
    const pkgVersion = (() => { try { return require('../../package.json').version; } catch { return undefined; } })();
    const data = await apiFetch('/api/printers/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        printers: osPrinters.map((name) => ({ systemName: name, displayName: name, isOnline: true })),
        agentVersion: pkgVersion,
      }),
    });
    _connected = true;
    _lastHeartbeatAt = new Date().toISOString();
    if (data?.shopName && data.shopName !== _config.shopName) {
      _config.shopName = data.shopName;
      configStore.save({ shopName: data.shopName });
    }
    _callbacks.onHeartbeat?.();
    logger.debug('Heartbeat OK');
  } catch (err) {
    if (isAuthError(err)) {
      _connected = false;
      logger.error('Heartbeat: authentication failed — check agent key');
      _callbacks.onAuthFail?.();
      stop();
    } else {
      logger.warn(`Heartbeat failed: ${err.message}`);
    }
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function pollQueue() {
  if (_isPolling) return;
  _isPolling = true;

  const today = new Date().toISOString().slice(0, 10);
  if (_statsDate !== today) {
    _statsDate = today;
    _printedToday = 0;
    _failedToday = 0;
    logger.info('Daily stats reset');
  }

  try {
    const data = await apiFetch('/api/agent/jobs');
    const jobs = Array.isArray(data) ? data : (data.jobs || []);
    _connected = true;
    _lastPollAt = new Date().toISOString();

    // Update the full server queue for dashboard display
    _serverQueue = jobs;

    const queuedJobs = jobs.filter((j) => j.status === 'queued');
    const newJobs = queuedJobs.filter((j) => !_inFlight.has(j.id) && !processedJobs.has(j.id));

    if (newJobs.length > 0 && _autoPrint) {
      logger.info(`${newJobs.length} new queued job(s) — auto-print mode`);
      _callbacks.onJobNew?.(newJobs[0]);
    } else if (newJobs.length > 0) {
      logger.info(`${newJobs.length} new queued job(s) — manual mode, waiting for shopkeeper`);
      _callbacks.onJobNew?.(newJobs[0]);
    }

    if (_autoPrint) {
      for (const job of newJobs) {
        _inFlight.add(job.id);
        processJob(job).catch((err) => {
          logger.error(`Unexpected error on job ${job.id}: ${err.message}`);
          _inFlight.delete(job.id);
          _callbacks.onJobError?.(job);
        });
      }
    }
    // In manual mode: new jobs are surfaced in _serverQueue for dashboard display.
    // The shopkeeper must click Print in the dashboard to trigger manualPrint().
  } catch (err) {
    if (isAuthError(err)) {
      logger.error('Poll: authentication failed — stopping agent');
      _connected = false;
      _callbacks.onAuthFail?.();
      stop();
    } else {
      logger.warn(`Poll failed: ${err.message}`);
    }
  } finally {
    _isPolling = false;
    _callbacks.onHeartbeat?.();
  }
}

// ── Manual print (shopkeeper clicks Print in dashboard) ───────────────────────

async function manualPrint(jobId) {
  const job = _serverQueue.find((j) => j.id === jobId);
  if (!job) throw new Error('Job not found in queue');
  if (job.status !== 'queued') throw new Error(`Job is ${job.status}, not queued`);
  if (_inFlight.has(jobId)) throw new Error('Job is already being processed');

  _inFlight.add(jobId);
  try {
    await processJob(job);
  } catch (err) {
    _inFlight.delete(jobId);
    throw err;
  }
}

// ── Pickup (shopkeeper clicks Picked Up in dashboard) ────────────────────────

async function markPickedUp(jobId) {
  const job = _serverQueue.find((j) => j.id === jobId);
  if (!job) throw new Error('Job not found in queue');
  if (job.status !== 'ready') throw new Error(`Job is ${job.status}, not ready`);

  await apiFetch(`/api/agent/jobs/${jobId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'picked_up' }),
  });

  // Update local queue optimistically
  const idx = _serverQueue.findIndex((j) => j.id === jobId);
  if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'picked_up' };
  _pushRecentJob(job, 'picked_up', job.printerName);
  _callbacks.onHeartbeat?.();
  logger.info(`[#${String(job.token).padStart(3, '0')}] Marked as picked up`);
}

// ── Cancel (shopkeeper clicks Cancel in dashboard) ───────────────────────────

async function cancelJob(jobId) {
  const job = _serverQueue.find((j) => j.id === jobId);
  if (!job) throw new Error('Job not found in queue');
  if (!['queued', 'printing'].includes(job.status)) throw new Error(`Cannot cancel job in ${job.status} status`);

  await apiFetch(`/api/agent/jobs/${jobId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled' }),
  });

  _inFlight.delete(jobId);
  const idx = _serverQueue.findIndex((j) => j.id === jobId);
  if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'cancelled' };
  _pushRecentJob(job, 'cancelled', job.printerName);
  _callbacks.onHeartbeat?.();
  logger.info(`[#${String(job.token).padStart(3, '0')}] Cancelled by shopkeeper`);
}

// ── Set mode (shopkeeper toggles Auto/Manual in dashboard) ───────────────────

async function setMode(autoPrint) {
  _autoPrint = autoPrint;
  _config.autoPrint = autoPrint;
  configStore.save({ autoPrint });

  // Sync to backend so other devices see the change
  try {
    if (_config.shopId) {
      const apiUrl = `${_config.apiUrl}/api/shops/${_config.shopId}`;
      await fetch(apiUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${_config.agentKey}`,
        },
        body: JSON.stringify({ autoPrint }),
      });
    }
  } catch (err) {
    logger.warn(`Could not sync autoPrint to server: ${err.message}`);
  }

  logger.info(`Mode changed to: ${autoPrint ? 'Auto-Print' : 'Manual'}`);
  _callbacks.onHeartbeat?.();
}

// ── Job processing ────────────────────────────────────────────────────────────

async function processJob(job) {
  const token = `#${String(job.token).padStart(3, '0')}`;
  const printerName = selectPrinter(job);
  logger.info(`[${token}] ${job.fileName} → ${printerName || '(no printer configured)'}`);

  // ── Step 1: Download (retry with exponential backoff) ─────────────────────
  let filePath;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      filePath = await downloadFile(job.fileUrl, job.fileName, {
        agentKey: _config.agentKey,
        apiUrl: _config.apiUrl,
        fileKey: job.fileKey,
      });
      break;
    } catch (err) {
      logger.warn(`[${token}] Download attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt === MAX_RETRIES) {
        logger.error(`[${token}] Download failed after ${MAX_RETRIES} attempts — skipping`);
        processedJobs.add(job.id);
        _inFlight.delete(job.id);
        _failedToday++;
        _pushRecentJob(job, 'cancelled', printerName);
        _callbacks.onJobError?.(job);
        return;
      }
      await sleep(2 ** attempt * 1000);
    }
  }

  // ── Step 2: Convert image to PDF if needed ────────────────────────────────
  let convertedPath = null;
  const ext = path.extname(job.fileName || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      convertedPath = await wrapImageAsPdf(filePath);
      filePath = convertedPath;
    } catch (err) {
      logger.warn(`[${token}] Image→PDF conversion failed: ${err.message}`);
    }
  }

  // ── Step 3: Claim job atomically (prevents duplicate prints) ──────────────
  if (job.status === 'printing') {
    logger.info(`[${token}] Resuming previously claimed job`);
    _pushRecentJob(job, 'printing', printerName);
  } else {
    try {
      const claimResult = await apiFetch(`/api/agent/jobs/${job.id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ printerName }),
      });
      if (!claimResult.claimed) {
        logger.info(`[${token}] Job already claimed by another agent — skipping`);
        _unlink(filePath);
        _inFlight.delete(job.id);
        return;
      }
      // Update local queue
      const idx = _serverQueue.findIndex((j) => j.id === job.id);
      if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'printing' };
      _pushRecentJob(job, 'printing', printerName);
      _callbacks.onHeartbeat?.();
    } catch (err) {
      if (err.message?.includes('409')) {
        logger.info(`[${token}] Job already claimed by another agent — skipping`);
        _unlink(filePath);
        _inFlight.delete(job.id);
        return;
      }
      logger.warn(`[${token}] Could not claim job: ${err.message}`);
    }
  }

  // ── Step 4: Extract page range if specified ───────────────────────────────
  let printPath = filePath;
  let isTmp = false;
  if (job.pageRange && job.pageRange !== 'all') {
    try {
      const result = await prepareForPrinting(filePath, job.pageRange, job.pageCount);
      printPath = result.printPath;
      isTmp = result.isTmp || false;
    } catch (err) {
      logger.warn(`[${token}] Page extraction failed, printing full doc: ${err.message}`);
    }
  }

  // ── Step 5: Stamp token based on configured position ─────────────────────
  const stampPos = _config.tokenStampPosition ||
    (_config.coverPage ? 'front-top-right' : 'none');
  if (stampPos && stampPos !== 'none') {
    try {
      let stampedPath;
      if (stampPos === 'front-top-right') {
        stampedPath = await stampTokenOnFirstPage(printPath, job.token);
      } else {
        const position = stampPos.startsWith('back-first') ? 'back-first' : 'back-last';
        const corner   = stampPos.endsWith('left') ? 'bottom-left' : 'bottom-right';
        stampedPath = await addTokenBackPage(printPath, job.token, { position, corner });
      }
      if (isTmp) _unlink(printPath);
      printPath = stampedPath;
      isTmp = true;
    } catch (err) {
      logger.warn(`[${token}] Token stamp failed: ${err.message}`);
    }
  }

  // ── Step 6: Print (retry with exponential backoff) ────────────────────────
  const simulate = process.env.NODE_ENV === 'development' && process.env.SIMULATE !== 'false';
  let printSuccess = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await printFile(printPath, {
        printerName,
        copies: job.copies || 1,
        doubleSided: job.doubleSided || false,
        color: job.color || false,
        paperSize: job.paperSize || 'A4',
        simulate,
      });
      printSuccess = true;
      break;
    } catch (err) {
      logger.warn(`[${token}] Print attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) await sleep(2 ** attempt * 1000);
    }
  }

  // ── Step 7: Cleanup temp files ────────────────────────────────────────────
  if (isTmp) _unlink(printPath);
  if (convertedPath && convertedPath !== filePath) _unlink(convertedPath);
  _unlink(filePath);

  // ── Step 8: Update final status ───────────────────────────────────────────
  if (printSuccess) {
    try {
      await apiFetch(`/api/agent/jobs/${job.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ready', printerName }),
      });
      logger.info(`[${token}] Done — ready for pickup`);
      _printedToday++;
      const idx = _serverQueue.findIndex((j) => j.id === job.id);
      if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'ready' };
      _pushRecentJob(job, 'ready', printerName);
      _callbacks.onJobDone?.(job);
    } catch (err) {
      logger.warn(`[${token}] Could not set 'ready': ${err.message}`);
    }
  } else {
    try {
      await apiFetch(`/api/agent/jobs/${job.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      logger.error(`[${token}] All print attempts failed — cancelled`);
      _failedToday++;
      const idx = _serverQueue.findIndex((j) => j.id === job.id);
      if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'cancelled' };
      _pushRecentJob(job, 'cancelled', printerName);
      _callbacks.onJobError?.(job);
    } catch (err) {
      logger.warn(`[${token}] Could not set 'cancelled': ${err.message}`);
    }
  }

  processedJobs.add(job.id);
  _inFlight.delete(job.id);
}

// ── Startup recovery ──────────────────────────────────────────────────────────

async function recoverStuckJobs() {
  try {
    const data = await apiFetch('/api/agent/jobs');
    const jobs = Array.isArray(data) ? data : (data.jobs || []);
    const stuck = jobs.filter((j) => j.status === 'printing');

    if (stuck.length === 0) return;
    logger.info(`Recovering ${stuck.length} job(s) stuck in 'printing'...`);

    for (const job of stuck) {
      if (!_inFlight.has(job.id) && !processedJobs.has(job.id)) {
        _inFlight.add(job.id);
        processJob(job).catch((err) => {
          logger.error(`Recovery error on job ${job.id}: ${err.message}`);
          _inFlight.delete(job.id);
        });
      }
    }
  } catch (err) {
    logger.warn(`Startup recovery failed: ${err.message}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function selectPrinter(job) {
  if (job.color && _config.colorPrinterSystemName) {
    return _config.colorPrinterSystemName;
  }
  return _config.bwPrinterSystemName || _config.colorPrinterSystemName || '';
}

function isAuthError(err) {
  return err?.message?.includes('401') || err?.message?.includes('403');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _unlink(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

function _pushRecentJob(job, status, printerName) {
  const idx = _recentJobs.findIndex((j) => j.id === job.id);
  if (idx !== -1) _recentJobs.splice(idx, 1);

  _recentJobs.unshift({
    id: job.id,
    token: job.token,
    fileName: job.fileName,
    status,
    printerName: printerName || '',
    color: job.color,
    copies: job.copies,
    pageCount: job.pageCount,
    doubleSided: job.doubleSided,
    paperSize: job.paperSize,
    processedAt: new Date().toISOString(),
  });

  if (_recentJobs.length > 50) _recentJobs.length = 50;
}

async function apiFetch(urlPath, options = {}) {
  const url = `${_config.apiUrl}${urlPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_config.agentKey}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

module.exports = { start, stop, hasInFlight, getState, manualPrint, markPickedUp, cancelJob, setMode };
