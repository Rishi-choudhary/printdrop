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
 *   - Rich local state via jobState (crash-safe phase tracking)
 *   - Startup recovery: uncertain crash jobs marked needs_review (NOT auto-reprinted)
 *   - Pending sync queue: ready/picked_up synced when network returns
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
const jobState = require('./job-state');
const pendingSync = require('./pending-sync');
const { ensureSumatra } = require('./sumatra');
const logger = require('./logger');
const configStore = require('./config');
const { normalizeApiUrl, toBoolean } = require('./security');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const MAX_RETRIES = 3;
const HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_QUEUE_HISTORY_DAYS = 30;

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
  _config = { ...config, apiUrl: normalizeApiUrl(config.apiUrl) };
  _callbacks = callbacks;
  _autoPrint = toBoolean(config.autoPrint);

  logger.info(`Agent starting — shop: ${config.shopName || config.shopId}`);
  logger.info(`B&W printer: ${config.bwPrinterSystemName || 'none'}`);
  logger.info(`Color printer: ${config.colorPrinterSystemName || 'none (fallback to B&W)'}`);
  logger.info(`Mode: ${_autoPrint ? 'Auto-Print' : 'Manual'}`);

  if (os.platform() === 'win32') {
    ensureSumatra().catch((err) => logger.warn(`SumatraPDF prewarm failed: ${err.message}`));
  }

  // Fetch shop identity + settings from server, persist shopId/shopName/autoPrint
  await fetchShopInfo();

  // Recover any jobs stuck in 'printing' from a previous run (safely — no auto-reprint)
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
  const pendingItems = pendingSync.getAll();
  const pendingSyncByJob = {};
  for (const e of pendingItems) {
    pendingSyncByJob[`${e.jobId}:${e.action}`] = true;
  }

  const annotatedQueue = _serverQueue.map((job) => {
    const local = jobState.get(job.id);
    const overlay = {};

    if (local?.localStatus === 'needs_review') {
      overlay._localStatus = 'needs_review';
      overlay._localError = local.lastError || 'App restarted while this job was printing. Review before retrying.';
    } else if (local?.localStatus === 'print_done' && !local.readySyncedAt) {
      overlay._localStatus = 'sync_pending_ready';
    } else if (pendingSyncByJob[`${job.id}:ready`]) {
      overlay._localStatus = 'sync_pending_ready';
    }

    if (pendingSyncByJob[`${job.id}:picked_up`]) {
      overlay._localStatus = 'sync_pending_pickup';
    }

    return Object.keys(overlay).length > 0 ? { ...job, ...overlay } : job;
  });

  return {
    connected: _connected,
    shopName: _config?.shopName || '',
    autoPrint: _autoPrint,
    lastPollAt: _lastPollAt,
    lastHeartbeatAt: _lastHeartbeatAt,
    pendingSyncCount: pendingItems.length,
    printers: [
      _config?.bwPrinterSystemName
        ? { systemName: _config.bwPrinterSystemName, displayName: _config.bwPrinterDisplayName || _config.bwPrinterSystemName, isOnline: true, role: 'bw' }
        : null,
      _config?.colorPrinterSystemName
        ? { systemName: _config.colorPrinterSystemName, displayName: _config.colorPrinterDisplayName || _config.colorPrinterSystemName, isOnline: true, role: 'color' }
        : null,
    ].filter(Boolean),
    serverQueue: annotatedQueue,
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
    const data = await apiFetch(agentJobsPath());
    const jobs = Array.isArray(data) ? data : (data.jobs || []);
    _connected = true;
    _lastPollAt = new Date().toISOString();

    // Update the full server queue for dashboard display
    _serverQueue = jobs;

    // Drain any pending sync actions now that we have connectivity
    await drainPendingSync();

    const queuedJobs = jobs.filter((j) => j.status === 'queued');
    const newJobs = queuedJobs.filter((j) => !_inFlight.has(j.id) && !processedJobs.has(j.id) && !jobState.isTerminal(j.id));

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
  } catch (err) {
    if (isAuthError(err)) {
      logger.error('Poll: authentication failed — stopping agent');
      _connected = false;
      _callbacks.onAuthFail?.();
      stop();
    } else {
      _connected = false;
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

// ── Force-retry a needs_review job (shopkeeper confirms retry) ────────────────

async function forceRetryPrint(jobId) {
  const job = _serverQueue.find((j) => j.id === jobId);
  if (!job) throw new Error('Job not found in queue');
  if (job.status !== 'printing') throw new Error(`Job is ${job.status}, not in printing state (needs review)`);
  if (_inFlight.has(jobId)) throw new Error('Job is already being processed');

  logger.info(`[#${String(job.token).padStart(3, '0')}] Shopkeeper confirmed force-retry of needs_review job`);

  // Clear the needs_review local state so processJob runs fresh
  const local = jobState.get(jobId) || {};
  jobState.upsert(jobId, {
    localStatus: null,
    claimedAt: null,
    printStartedAt: null,
    printCompletedAt: null,
    readySyncedAt: null,
    lastError: null,
    localPrintAttemptId: null,
    retryCount: (local.retryCount || 0) + 1,
  });

  // Remove from processedJobs so processJob can run this job again
  processedJobs.remove(jobId);

  _inFlight.add(jobId);
  processJob(job).catch((err) => {
    logger.error(`Force-retry error on job ${jobId}: ${err.message}`);
    _inFlight.delete(jobId);
    _callbacks.onJobError?.(job);
  });
}

// ── Retry a backend-cancelled job (calls /retry endpoint) ────────────────────

async function retryJob(jobId) {
  const job = _serverQueue.find((j) => j.id === jobId);
  if (!job) throw new Error('Job not found in queue');
  if (job.status !== 'cancelled') throw new Error(`Job is ${job.status}, not cancelled`);

  await apiFetch(jobApiPath(jobId, 'retry'), { method: 'POST' });

  // Clear local state for this job so it processes fresh on next poll
  const local = jobState.get(jobId) || {};
  jobState.upsert(jobId, {
    localStatus: null,
    claimedAt: null,
    printStartedAt: null,
    printCompletedAt: null,
    readySyncedAt: null,
    lastError: null,
    localPrintAttemptId: null,
    retryCount: (local.retryCount || 0) + 1,
  });
  processedJobs.remove(jobId);

  // Optimistically update local queue so UI reflects the change immediately
  const idx = _serverQueue.findIndex((j) => j.id === jobId);
  if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'queued' };

  _callbacks.onHeartbeat?.();
  logger.info(`[#${String(job.token).padStart(3, '0')}] Retried — now queued`);
}

// ── Pickup (shopkeeper clicks Picked Up in dashboard) ────────────────────────

async function markPickedUp(jobId) {
  const job = _serverQueue.find((j) => j.id === jobId);
  if (!job) throw new Error('Job not found in queue');
  if (job.status !== 'ready') throw new Error(`Job is ${job.status}, not ready`);

  try {
    await apiFetch(jobApiPath(jobId, 'status'), {
      method: 'PATCH',
      body: JSON.stringify({ status: 'picked_up' }),
    });

    const idx = _serverQueue.findIndex((j) => j.id === jobId);
    if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'picked_up' };
    jobState.upsert(jobId, { localStatus: 'picked_up_synced', pickedUpSyncedAt: new Date().toISOString() });
    _pushRecentJob(job, 'picked_up', job.printerName);
    _callbacks.onHeartbeat?.();
    logger.info(`[#${String(job.token).padStart(3, '0')}] Marked as picked up`);
  } catch (err) {
    // Offline — queue for later sync
    logger.warn(`[#${String(job.token).padStart(3, '0')}] Could not sync picked_up — queuing: ${err.message}`);
    pendingSync.enqueue(jobId, 'picked_up');
    jobState.upsert(jobId, { localStatus: 'picked_up_pending' });

    // Optimistically update so UI shows the action was taken
    const idx = _serverQueue.findIndex((j) => j.id === jobId);
    if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], _localStatus: 'sync_pending_pickup' };
    _pushRecentJob(job, 'picked_up', job.printerName);
    _callbacks.onHeartbeat?.();
    logger.info(`[#${String(job.token).padStart(3, '0')}] Picked-up queued for sync`);
  }
}

// ── Cancel (shopkeeper clicks Cancel in dashboard) ───────────────────────────

async function cancelJob(jobId) {
  const job = _serverQueue.find((j) => j.id === jobId);
  if (!job) throw new Error('Job not found in queue');
  if (!['queued', 'printing'].includes(job.status)) throw new Error(`Cannot cancel job in ${job.status} status`);

  await apiFetch(jobApiPath(jobId, 'status'), {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled' }),
  });

  _inFlight.delete(jobId);
  const idx = _serverQueue.findIndex((j) => j.id === jobId);
  if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'cancelled' };
  jobState.upsert(jobId, { localStatus: 'cancelled' });
  _pushRecentJob(job, 'cancelled', job.printerName);
  _callbacks.onHeartbeat?.();
  logger.info(`[#${String(job.token).padStart(3, '0')}] Cancelled by shopkeeper`);
}

// ── Set mode (shopkeeper toggles Auto/Manual in dashboard) ───────────────────

async function setMode(autoPrint) {
  _autoPrint = toBoolean(autoPrint);
  _config.autoPrint = _autoPrint;
  configStore.save({ autoPrint: _autoPrint });

  try {
    if (_config.shopId) {
      const apiUrl = `${_config.apiUrl}/api/shops/${encodeURIComponent(_config.shopId)}`;
      const res = await fetch(apiUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${_config.agentKey}`,
        },
        body: JSON.stringify({ autoPrint: _autoPrint }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
    }
  } catch (err) {
    logger.warn(`Could not sync autoPrint to server: ${err.message}`);
  }

  logger.info(`Mode changed to: ${_autoPrint ? 'Auto-Print' : 'Manual'}`);
  _callbacks.onHeartbeat?.();
}

// ── Job processing ────────────────────────────────────────────────────────────

async function processJob(job) {
  const token = `#${String(job.token).padStart(3, '0')}`;
  const printerName = selectPrinter(job);
  logger.info(`[${token}] Starting — ${job.fileName} → ${printerName || '(no printer configured)'}`);

  // ── Guard: already fully completed? ──────────────────────────────────────
  const existingState = jobState.get(job.id);
  if (existingState?.localStatus === 'ready_synced' || existingState?.localStatus === 'picked_up_synced') {
    logger.info(`[${token}] Already completed locally (${existingState.localStatus}) — skipping`);
    _inFlight.delete(job.id);
    return;
  }

  // ── Guard: print completed but status sync failed — only sync, don't reprint ─
  if (existingState?.localStatus === 'print_done' && existingState.printCompletedAt) {
    logger.info(`[${token}] Print already completed locally — only syncing ready status`);
    await _syncReady(job, existingState.printerName || printerName);
    processedJobs.add(job.id);
    _inFlight.delete(job.id);
    return;
  }

  // ── Step 1: Initialize local state for this attempt ───────────────────────
  const attemptId = jobState.newAttemptId();
  jobState.upsert(job.id, {
    token: job.token,
    fileName: job.fileName,
    backendStatus: job.status,
    localStatus: 'downloading',
    localPrintAttemptId: attemptId,
    lastError: null,
  });

  // ── Step 2: Download (retry with exponential backoff) ─────────────────────
  let filePath;
  let originalPath;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      filePath = await downloadFile(job.fileUrl, job.fileName, {
        agentKey: _config.agentKey,
        apiUrl: _config.apiUrl,
        fileKey: job.fileKey,
      });
      originalPath = filePath;
      logger.info(`[${token}] Download OK`);
      break;
    } catch (err) {
      const errMsg = `Download attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`;
      logger.warn(`[${token}] ${errMsg}`);
      if (attempt === MAX_RETRIES) {
        const finalErr = `Download failed after ${MAX_RETRIES} attempts: ${err.message}`;
        logger.error(`[${token}] ${finalErr} — marking failed`);
        jobState.upsert(job.id, { localStatus: 'failed', lastError: finalErr });
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

  // ── Step 3: Convert image to PDF if needed ────────────────────────────────
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

  // ── Step 4: Claim job atomically (prevents duplicate prints across agents) ──
  if (job.status === 'printing') {
    logger.info(`[${token}] Resuming previously claimed job`);
    _pushRecentJob(job, 'printing', printerName);
  } else {
    try {
      const claimResult = await apiFetch(jobApiPath(job.id, 'claim'), {
        method: 'POST',
        body: JSON.stringify({ printerName }),
      });
      if (!claimResult.claimed) {
        logger.info(`[${token}] Job already claimed by another agent — skipping`);
        _unlink(filePath);
        _inFlight.delete(job.id);
        return;
      }
      const idx = _serverQueue.findIndex((j) => j.id === job.id);
      if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'printing' };
      _pushRecentJob(job, 'printing', printerName);
      _callbacks.onHeartbeat?.();
      logger.info(`[${token}] Claimed — status: printing`);
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

  // ── Step 5: Update local state — about to start printing ─────────────────
  jobState.upsert(job.id, {
    localStatus: 'printing',
    claimedAt: new Date().toISOString(),
    printStartedAt: new Date().toISOString(),
    printerName,
  });

  // ── Step 6: Extract page range if specified ───────────────────────────────
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

  // ── Step 7: Stamp token based on configured position ─────────────────────
  const stampPos = _config.tokenStampPosition ||
    (_config.coverPage ? 'back-last-right' : 'none');
  let forceDuplexForBackStamp = false;
  if (stampPos && stampPos !== 'none') {
    try {
      let stampedPath;
      if (stampPos === 'front-top-right') {
        stampedPath = await stampTokenOnFirstPage(printPath, job.token);
      } else {
        const position = stampPos.startsWith('back-first') ? 'back-first' : 'back-last';
        const corner = stampPos.endsWith('left') ? 'bottom-left' : 'bottom-right';
        const preserveSingleSided = !job.doubleSided;
        stampedPath = await addTokenBackPage(printPath, job.token, { position, corner, preserveSingleSided });
        forceDuplexForBackStamp = preserveSingleSided;
        if (preserveSingleSided) {
          logger.info(`[${token}] Back-side token enabled — preserving single-sided document with blank backs`);
        }
      }
      if (isTmp) _unlink(printPath);
      printPath = stampedPath;
      isTmp = true;
    } catch (err) {
      logger.warn(`[${token}] Token stamp failed: ${err.message}`);
    }
  }

  // ── Step 8: Print (retry with exponential backoff) ────────────────────────
  const simulate = !!_config.simulateMode ||
    (process.env.NODE_ENV === 'development' && process.env.SIMULATE !== 'false');
  let printSuccess = false;
  let printError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await printFile(printPath, {
        printerName,
        copies: job.copies || 1,
        doubleSided: !!job.doubleSided || forceDuplexForBackStamp,
        color: job.color || false,
        paperSize: job.paperSize || 'A4',
        simulate,
      });
      printSuccess = true;
      logger.info(`[${token}] Print OK (attempt ${attempt})`);
      break;
    } catch (err) {
      printError = err.message;
      logger.warn(`[${token}] Print attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) await sleep(2 ** attempt * 1000);
    }
  }

  // ── Step 9: Cleanup temp files ────────────────────────────────────────────
  if (isTmp) _unlink(printPath);
  if (convertedPath && convertedPath !== printPath) _unlink(convertedPath);
  if (originalPath && originalPath !== filePath) _unlink(originalPath);
  _unlink(filePath);

  // ── Step 10: Update final status ──────────────────────────────────────────
  if (printSuccess) {
    // Mark print as completed locally — this is crash-safe
    jobState.upsert(job.id, {
      localStatus: 'print_done',
      printCompletedAt: new Date().toISOString(),
    });
    _printedToday++;
    await _syncReady(job, printerName);
  } else {
    const errMsg = `All ${MAX_RETRIES} print attempts failed: ${printError}`;
    jobState.upsert(job.id, { localStatus: 'failed', lastError: errMsg });
    logger.error(`[${token}] ${errMsg}`);
    _failedToday++;

    try {
      await apiFetch(jobApiPath(job.id, 'status'), {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
    } catch (err) {
      logger.warn(`[${token}] Could not set 'cancelled': ${err.message}`);
    }

    const idx = _serverQueue.findIndex((j) => j.id === job.id);
    if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'cancelled' };
    _pushRecentJob(job, 'cancelled', printerName);
    _callbacks.onJobError?.(job);
  }

  processedJobs.add(job.id);
  _inFlight.delete(job.id);
}

// ── Sync ready status to backend ──────────────────────────────────────────────
// Called after a successful print. On network failure, queues for later sync.

async function _syncReady(job, printerName) {
  const token = `#${String(job.token).padStart(3, '0')}`;
  try {
    await apiFetch(jobApiPath(job.id, 'status'), {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ready', printerName }),
    });
    logger.info(`[${token}] Ready — waiting for pickup`);
    const idx = _serverQueue.findIndex((j) => j.id === job.id);
    if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'ready' };
    jobState.upsert(job.id, { localStatus: 'ready_synced', readySyncedAt: new Date().toISOString() });
    _pushRecentJob(job, 'ready', printerName);
    _callbacks.onJobDone?.(job);
  } catch (err) {
    logger.warn(`[${token}] Could not set 'ready' — queuing for sync: ${err.message}`);
    pendingSync.enqueue(job.id, 'ready', { printerName });
    // Show sync-pending in the local queue so the shopkeeper sees it
    const idx = _serverQueue.findIndex((j) => j.id === job.id);
    if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], _localStatus: 'sync_pending_ready' };
    _callbacks.onHeartbeat?.();
  }
}

// ── Drain pending sync queue ──────────────────────────────────────────────────
// Called on every successful poll cycle. No-op if queue is empty.

async function drainPendingSync() {
  const queue = pendingSync.getAll();
  if (queue.length === 0) return;

  logger.info(`Draining ${queue.length} pending sync action(s)...`);

  for (const entry of queue) {
    const { jobId, action, printerName } = entry;
    const tokenStr = (() => {
      const job = _serverQueue.find((j) => j.id === jobId);
      return job ? `#${String(job.token).padStart(3, '0')}` : jobId.slice(-6);
    })();

    try {
      if (action === 'ready') {
        await apiFetch(jobApiPath(jobId, 'status'), {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ready', printerName }),
        });
        pendingSync.remove(jobId, 'ready');
        jobState.upsert(jobId, { localStatus: 'ready_synced', readySyncedAt: new Date().toISOString() });
        processedJobs.add(jobId);
        const idx = _serverQueue.findIndex((j) => j.id === jobId);
        if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'ready', _localStatus: undefined };
        logger.info(`[${tokenStr}] Pending sync flushed: ready`);
      } else if (action === 'picked_up') {
        await apiFetch(jobApiPath(jobId, 'status'), {
          method: 'PATCH',
          body: JSON.stringify({ status: 'picked_up' }),
        });
        pendingSync.remove(jobId, 'picked_up');
        jobState.upsert(jobId, { localStatus: 'picked_up_synced', pickedUpSyncedAt: new Date().toISOString() });
        const idx = _serverQueue.findIndex((j) => j.id === jobId);
        if (idx !== -1) _serverQueue[idx] = { ..._serverQueue[idx], status: 'picked_up', _localStatus: undefined };
        logger.info(`[${tokenStr}] Pending sync flushed: picked_up`);
      }
    } catch (err) {
      pendingSync.incrementAttempts(jobId, action);
      logger.warn(`[${tokenStr}] Pending sync failed (${action}): ${err.message}`);
      // Don't break the loop — try remaining items
    }
  }
}

// ── Startup recovery ──────────────────────────────────────────────────────────
// Jobs stuck in 'printing' after a crash are NOT auto-reprinted.
// Instead we check local state to determine the safest recovery path.

async function recoverStuckJobs() {
  try {
    const data = await apiFetch(agentJobsPath());
    const jobs = Array.isArray(data) ? data : (data.jobs || []);
    const stuck = jobs.filter((j) => j.status === 'printing');

    if (stuck.length === 0) return;
    logger.info(`Recovering ${stuck.length} job(s) stuck in 'printing'...`);

    for (const job of stuck) {
      if (_inFlight.has(job.id)) continue;

      const local = jobState.get(job.id);

      // Case 1: Print completed locally — only the status sync failed.
      //         Safe to retry status sync (not a reprint).
      if (local?.localStatus === 'print_done' && local.printCompletedAt) {
        logger.info(`[#${String(job.token).padStart(3, '0')}] Print done locally — syncing ready status`);
        _inFlight.add(job.id);
        _syncReady(job, local.printerName || selectPrinter(job))
          .then(() => { processedJobs.add(job.id); })
          .catch((err) => logger.warn(`Recovery sync failed: ${err.message}`))
          .finally(() => _inFlight.delete(job.id));
        continue;
      }

      // Case 2: Uncertain state — print may or may not have completed.
      //         Require manual shopkeeper confirmation before retrying.
      if (!processedJobs.has(job.id)) {
        const reason = local
          ? `Crash during ${local.localStatus || 'processing'}. Print outcome unknown.`
          : 'App restarted while job was printing. Print outcome unknown.';
        logger.warn(`[#${String(job.token).padStart(3, '0')}] Uncertain state — needs_review: ${reason}`);
        jobState.upsert(job.id, {
          token: job.token,
          fileName: job.fileName,
          backendStatus: 'printing',
          localStatus: 'needs_review',
          lastError: reason,
        });
        // Add to processedJobs so the normal auto-print loop skips this job.
        // forceRetryPrint() will remove it when the shopkeeper confirms.
        processedJobs.add(job.id);
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

function jobApiPath(jobId, action) {
  return `/api/agent/jobs/${encodeURIComponent(String(jobId))}/${action}`;
}

function agentJobsPath() {
  const rawDays = Number.parseInt(_config?.queueHistoryDays, 10);
  const days = Number.isFinite(rawDays)
    ? Math.min(Math.max(rawDays, 1), 365)
    : DEFAULT_QUEUE_HISTORY_DAYS;
  return `/api/agent/jobs?historyDays=${days}`;
}

async function apiFetch(urlPath, options = {}) {
  const safePath = String(urlPath || '');
  if (!safePath.startsWith('/api/')) throw new Error('Invalid API path');
  const url = new URL(safePath, _config.apiUrl).toString();
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
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = {
  start, stop, hasInFlight, getState,
  manualPrint, markPickedUp, cancelJob, setMode,
  forceRetryPrint, retryJob,
};
