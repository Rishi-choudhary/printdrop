/**
 * PrintDrop Desktop Agent — Core Polling Loop
 *
 * Responsibilities:
 *   - Heartbeat every 30s (reports live printers to backend)
 *   - Poll for queued jobs every pollIntervalMs (default 4s)
 *   - Download, prepare, and print each job
 *   - Update job status: queued → printing → ready | cancelled
 *   - Idempotency via processedJobs (persisted across restarts)
 *   - Startup recovery: re-queue any jobs stuck in 'printing'
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { printFile, getAvailablePrinters } = require('./printer');
const { prepareForPrinting, generateCoverPage, prependCoverPage } = require('./pdf-utils');
const { downloadFile } = require('./downloader');
const { wrapImageAsPdf } = require('./image-to-pdf');
const processedJobs = require('./processed-jobs');
const logger = require('./logger');

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

// In-memory job list for the dashboard (newest first, capped at 50)
const _recentJobs = [];
let _printedToday = 0;
let _failedToday = 0;
let _statsDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD for daily reset
let _connected = false;
let _lastPollAt = null;
let _lastHeartbeatAt = null;

// ── Public API ────────────────────────────────────────────────────────────────

async function start(config, callbacks) {
  _config = config;
  _callbacks = callbacks;

  logger.info(`Agent starting — shop: ${config.shopName || config.shopId}`);
  logger.info(`B&W printer: ${config.bwPrinterSystemName || 'none'}`);
  logger.info(`Color printer: ${config.colorPrinterSystemName || 'none (fallback to B&W)'}`);

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
    recentJobs: _recentJobs.slice(0, 20),
    stats: {
      printedToday: _printedToday,
      inQueue: _inFlight.size,
      failedToday: _failedToday,
    },
  };
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

async function sendHeartbeat() {
  try {
    const osPrinters = await getAvailablePrinters().catch(() => []);
    await apiFetch('/api/printers/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        printers: osPrinters.map((name) => ({ systemName: name, isOnline: true })),
      }),
    });
    _connected = true;
    _lastHeartbeatAt = new Date().toISOString();
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

  // Reset daily counters at midnight
  const today = new Date().toISOString().slice(0, 10);
  if (_statsDate !== today) {
    _statsDate = today;
    _printedToday = 0;
    _failedToday = 0;
    logger.info('Daily stats reset');
  }

  try {
    const data = await apiFetch('/api/jobs?status=queued');
    const jobs = Array.isArray(data) ? data : (data.jobs || []);
    _connected = true;
    _lastPollAt = new Date().toISOString();

    const newJobs = jobs.filter((j) => !_inFlight.has(j.id) && !processedJobs.has(j.id));

    if (newJobs.length > 0) {
      logger.info(`${newJobs.length} new job(s) found`);
      _callbacks.onJobNew?.(newJobs[0]);
    }

    for (const job of newJobs) {
      _inFlight.add(job.id);
      // Fire-and-forget: two printers can print in parallel
      processJob(job).catch((err) => {
        logger.error(`Unexpected error on job ${job.id}: ${err.message}`);
        _inFlight.delete(job.id);
        _callbacks.onJobError?.(job);
      });
    }
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
    _callbacks.onHeartbeat?.(); // reuse to refresh dashboard timestamp
  }
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
        processedJobs.add(job.id); // don't retry this session
        _inFlight.delete(job.id);
        _failedToday++;
        _pushRecentJob(job, 'cancelled', printerName);
        _callbacks.onJobError?.(job);
        return;
      }
      await sleep(2 ** attempt * 1000); // 2s, 4s, 8s
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
  try {
    const claimResult = await apiFetch(`/api/jobs/${job.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ printerName }),
    });
    if (!claimResult.claimed) {
      logger.info(`[${token}] Job already claimed by another agent — skipping`);
      _unlink(filePath);
      _inFlight.delete(job.id);
      return;
    }
    _pushRecentJob(job, 'printing', printerName);
  } catch (err) {
    if (err.message?.includes('409')) {
      logger.info(`[${token}] Job already claimed by another agent — skipping`);
      _unlink(filePath);
      _inFlight.delete(job.id);
      return;
    }
    logger.warn(`[${token}] Could not claim job: ${err.message}`);
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

  // ── Step 5: Prepend cover page if enabled ─────────────────────────────────
  if (_config.coverPage) {
    try {
      const coverPath = await generateCoverPage(job, printerName);
      const mergedPath = await prependCoverPage(coverPath, printPath);
      if (isTmp) _unlink(printPath);
      _unlink(coverPath);
      printPath = mergedPath;
      isTmp = true;
    } catch (err) {
      logger.warn(`[${token}] Cover page failed: ${err.message}`);
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
      await apiFetch(`/api/jobs/${job.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ready', printerName }),
      });
      logger.info(`[${token}] Done — ready for pickup`);
      _printedToday++;
      _pushRecentJob(job, 'ready', printerName);
      _callbacks.onJobDone?.(job);
    } catch (err) {
      logger.warn(`[${token}] Could not set 'ready': ${err.message}`);
    }
  } else {
    try {
      await apiFetch(`/api/jobs/${job.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      logger.error(`[${token}] All print attempts failed — cancelled`);
      _failedToday++;
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
    const data = await apiFetch('/api/jobs?status=printing');
    const jobs = Array.isArray(data) ? data : (data.jobs || []);

    if (jobs.length === 0) return;
    logger.info(`Recovering ${jobs.length} job(s) stuck in 'printing'...`);

    for (const job of jobs) {
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
  // Fallback: always use bw printer (even for color jobs if no color printer set)
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
  // Remove existing entry for same job (status update)
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
    processedAt: new Date().toISOString(),
  });

  // Cap at 50 entries
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

module.exports = { start, stop, hasInFlight, getState };
