const fs = require('fs');
const path = require('path');
const { printFile, getAvailablePrinters } = require('./printer');
const { prepareForPrinting, generateCoverPage, prependCoverPage } = require('./pdf-utils');

// ─── Config ──────────────────────────────────────────────────────────────────
const API_URL      = process.env.API_URL    || 'http://localhost:3001';
const AGENT_KEY    = process.env.AGENT_KEY  || '';
const POLL_MS      = parseInt(process.env.POLL_INTERVAL || '5000', 10);
const HEARTBEAT_MS = 30000;
// Legacy single-printer fallback
const PRINTER_ENV  = process.env.PRINTER_NAME || '';
const SHOP_ID_ENV  = process.env.SHOP_ID || '';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '..', 'downloads');
const SIMULATE     = process.env.SIMULATE === 'true' || process.env.SIMULATE === '1';
const AUTO_READY   = process.env.AUTO_READY !== 'false';
const COVER_PAGE   = process.env.COVER_PAGE === 'true' || process.env.COVER_PAGE === '1';
const MAX_RETRIES  = 3;

if (!AGENT_KEY) {
  console.error('\n  ERROR: AGENT_KEY is required.');
  console.error('  Get it from: Dashboard → Settings → Print Agent\n');
  process.exit(1);
}

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ─── State ────────────────────────────────────────────────────────────────────
const inFlight     = new Set();       // job IDs currently being processed
const printerBusy  = new Map();       // systemName → boolean
let routingConfig  = [];              // ShopPrinter[] from backend
let resolvedShopId = SHOP_ID_ENV;     // discovered via heartbeat
let isPolling      = false;

// ─── API helpers ─────────────────────────────────────────────────────────────
async function apiFetch(urlPath, options = {}) {
  const res = await fetch(`${API_URL}${urlPath}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AGENT_KEY}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

async function updateJobStatus(jobId, status, extra = {}) {
  return apiFetch(`/api/jobs/${jobId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...extra }),
  });
}

async function refreshPresignedUrl(fileKey) {
  const res = await apiFetch(`/api/files/presign?key=${encodeURIComponent(fileKey)}`);
  return res.url;
}

async function downloadFile(fileUrl, fileName, fileKey) {
  const filePath = path.join(DOWNLOAD_DIR, `${Date.now()}_${path.basename(fileName)}`);

  async function tryFetch(url) {
    const headers = {};
    if (url.startsWith(API_URL)) headers.Authorization = `Bearer ${AGENT_KEY}`;
    return fetch(url, { headers });
  }

  let res = await tryFetch(fileUrl);

  if ((res.status === 403 || res.status === 401) && fileKey) {
    console.log(`  [agent] URL expired (${res.status}), refreshing presigned URL...`);
    try {
      const freshUrl = await refreshPresignedUrl(fileKey);
      res = await tryFetch(freshUrl);
    } catch (err) {
      throw new Error(`URL refresh failed: ${err.message}`);
    }
  }

  if (!res.ok) throw new Error(`Download failed: ${res.status} ${fileUrl}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ─── Printer routing ──────────────────────────────────────────────────────────
function selectPrinter(job) {
  // If no routing config, fall back to env var single-printer mode
  if (!routingConfig || routingConfig.length === 0) {
    if (PRINTER_ENV) {
      return { id: null, systemName: PRINTER_ENV, name: PRINTER_ENV, isDefault: true };
    }
    return { id: null, systemName: '', name: 'system default', isDefault: true };
  }

  const available = routingConfig.filter(
    (p) => p.isOnline && !printerBusy.get(p.systemName)
  );

  if (available.length === 0) return null; // all printers busy

  // A3 jobs: must use A3 printer
  if (job.paperSize === 'A3') {
    const a3 = available.find((p) => p.supportsA3);
    if (a3) return a3;
    // fall through to default if no A3 printer available
  }

  // Color + duplex: find printer supporting both
  if (job.color && job.doubleSided) {
    const both = available.find((p) => p.supportsColor && p.supportsDuplex);
    if (both) return both;
  }

  // Color only
  if (job.color) {
    const colorOnly = available.find((p) => p.supportsColor && !p.supportsDuplex);
    if (colorOnly) return colorOnly;
    const anyColor = available.find((p) => p.supportsColor);
    if (anyColor) return anyColor;
  }

  // Duplex only
  if (job.doubleSided) {
    const duplex = available.find((p) => p.supportsDuplex);
    if (duplex) return duplex;
  }

  // Default printer
  const def = available.find((p) => p.isDefault);
  if (def) return def;

  return available[0];
}

// ─── Heartbeat — report OS printers to backend ───────────────────────────────
async function sendHeartbeat() {
  try {
    let osPrinters = [];
    try {
      osPrinters = await getAvailablePrinters();
    } catch {
      // getAvailablePrinters is best-effort
    }

    const discovered = osPrinters.map((name) => ({ systemName: name, isOnline: true }));

    const body = { printers: discovered };
    if (resolvedShopId) body.shopId = resolvedShopId;

    const data = await apiFetch('/api/printers/heartbeat', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    // Update shop ID from response if not already set
    if (data.shopId && !resolvedShopId) {
      resolvedShopId = data.shopId;
      console.log(`  [agent] Shop ID discovered: ${resolvedShopId}`);
    }

    // Update routing config
    if (Array.isArray(data.printers)) {
      routingConfig = data.printers;
    }
  } catch (err) {
    // Non-fatal — agent can still run with env var fallback
    if (process.env.DEBUG) {
      console.warn(`  [agent] Heartbeat failed: ${err.message}`);
    }
  }
}

// ─── Fetch initial routing config ────────────────────────────────────────────
async function fetchRoutingConfig() {
  if (!resolvedShopId) return;
  try {
    const data = await apiFetch(`/api/printers/routing/${resolvedShopId}`);
    if (Array.isArray(data.printers)) {
      routingConfig = data.printers;
      if (routingConfig.length > 0) {
        console.log(`  Printers: ${routingConfig.map((p) => `${p.name} (${p.systemName})`).join(', ')}`);
      }
    }
  } catch {
    // Will fall back to PRINTER_NAME env var
  }
}

// ─── Job processing ───────────────────────────────────────────────────────────
async function processJob(job, printer, { isRecovery = false } = {}) {
  const token = `#${String(job.token).padStart(3, '0')}`;
  const printerLabel = printer?.name || printer?.systemName || PRINTER_ENV || 'default';
  const log = (msg) => console.log(`  [${token}][${printerLabel}] ${msg}`);

  log(`${job.fileName} | ${job.pageCount}pg | ${job.color ? 'Color' : 'B&W'} | ${job.copies}x | ${job.paperSize}`);
  if (job.pageRange && job.pageRange !== 'all') log(`Pages: ${job.pageRange}`);

  // Mark printer busy
  if (printer?.systemName) printerBusy.set(printer.systemName, true);

  try {
    // ── Step 1: Download ──
    log('Downloading...');
    let filePath;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        filePath = await downloadFile(job.fileUrl, job.fileName, job.fileKey);
        const kb = (fs.statSync(filePath).size / 1024).toFixed(1);
        log(`Downloaded (${kb} KB)`);
        break;
      } catch (err) {
        log(`Download attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt === MAX_RETRIES) {
          log('All download attempts failed. Skipping job.');
          inFlight.delete(job.id);
          return;
        }
        await sleep(2000 * attempt);
      }
    }

    // ── Step 2: Mark as printing ──
    if (!isRecovery) {
      try {
        await updateJobStatus(job.id, 'printing', {
          printerId: printer?.id || undefined,
          printerName: printerLabel,
        });
        log('Status → printing');
      } catch (err) {
        log(`WARNING: Could not update status: ${err.message}`);
      }
    }

    // ── Step 3: Extract page range if needed ──
    let printPath = filePath;
    let isTmpFile = false;

    if (job.pageRange && job.pageRange !== 'all') {
      try {
        const result = await prepareForPrinting(filePath, job.pageRange, job.pageCount);
        printPath = result.printPath;
        isTmpFile = result.isTmp;
      } catch (err) {
        log(`Page extraction failed: ${err.message}. Printing full document instead.`);
      }
    }

    // ── Step 3b: Prepend cover page if enabled ──
    let coverPath = null;
    if (COVER_PAGE) {
      try {
        coverPath = await generateCoverPage(job, printerLabel);
        const mergedPath = await prependCoverPage(coverPath, printPath);
        if (isTmpFile) {
          try { fs.unlinkSync(printPath); } catch {}
        }
        printPath = mergedPath;
        isTmpFile = true;
        log('Cover page prepended');
      } catch (err) {
        log(`Cover page generation failed: ${err.message}. Printing without cover.`);
        if (coverPath) { try { fs.unlinkSync(coverPath); } catch {} }
        coverPath = null;
      }
    }

    // ── Step 4: Send to printer ──
    const printerSystemName = printer?.systemName || PRINTER_ENV;
    let printSuccess = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        log(`${SIMULATE ? 'Simulating' : 'Printing'} (attempt ${attempt}/${MAX_RETRIES})...`);
        const result = await printFile(printPath, {
          printerName: printerSystemName,
          copies: job.copies,
          doubleSided: job.doubleSided,
          color: job.color,
          paperSize: job.paperSize || 'A4',
          simulate: SIMULATE,
        });
        log(result.output?.trim() || 'Print command sent');
        printSuccess = true;
        break;
      } catch (err) {
        log(`Print attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) await sleep(3000 * attempt);
      }
    }

    // ── Step 5: Cleanup ──
    if (coverPath) { try { fs.unlinkSync(coverPath); } catch {} }
    if (isTmpFile) { try { fs.unlinkSync(printPath); } catch {} }
    try { fs.unlinkSync(filePath); } catch {}

    // ── Step 6: Update final status ──
    if (!printSuccess) {
      log('All print attempts failed. Marking as cancelled.');
      try { await updateJobStatus(job.id, 'cancelled'); } catch {}
      return;
    }

    if (AUTO_READY) {
      try {
        await updateJobStatus(job.id, 'ready');
        log(`Done — token ${token} is ready for pickup.`);
      } catch (err) {
        log(`WARNING: Could not mark ready: ${err.message}`);
      }
    } else {
      log('Printed. Mark ready manually from the dashboard when verified.');
    }
  } finally {
    inFlight.delete(job.id);
    if (printer?.systemName) printerBusy.set(printer.systemName, false);
  }
}

// ─── Startup recovery ─────────────────────────────────────────────────────────
async function recoverStuckJobs() {
  try {
    const data = await apiFetch('/api/jobs?status=printing');
    const stuck = Array.isArray(data) ? data : (data.jobs || []);
    if (stuck.length === 0) return;

    console.log(`\n  [RECOVERY] Found ${stuck.length} job(s) stuck in 'printing' from a previous run.`);
    console.log('  [RECOVERY] Re-attempting...\n');

    for (const job of stuck) {
      inFlight.add(job.id);
      // Use the previously assigned printer if available in routing config
      let printer = null;
      if (job.printerName && routingConfig.length > 0) {
        printer = routingConfig.find((p) => p.name === job.printerName || p.systemName === job.printerName) || null;
      }
      if (!printer) printer = selectPrinter(job);

      try {
        await processJob(job, printer, { isRecovery: true });
      } catch (err) {
        console.error(`  [RECOVERY] Job ${job.id} failed: ${err.message}`);
        inFlight.delete(job.id);
        if (printer?.systemName) printerBusy.set(printer.systemName, false);
      }
    }
  } catch (err) {
    console.warn(`  [RECOVERY] Could not check stuck jobs: ${err.message}`);
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function pollQueue() {
  if (isPolling) return;
  isPolling = true;

  try {
    const data = await apiFetch('/api/jobs?status=queued');
    const allQueued = Array.isArray(data) ? data : (data.jobs || []);

    const newJobs = allQueued.filter((j) => !inFlight.has(j.id));
    if (newJobs.length === 0) return;

    const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
    console.log(`\n[${time}] ${newJobs.length} new job(s) in queue`);

    // Multi-printer: dispatch jobs in parallel, one per available printer
    for (const job of newJobs) {
      const printer = selectPrinter(job);

      if (printer === null) {
        // All printers are busy — this job will be picked up next poll
        continue;
      }

      inFlight.add(job.id);

      // Fire and forget — don't await, so multiple printers work in parallel
      processJob(job, printer).catch((err) => {
        console.error(`  Job ${job.id} unexpected error: ${err.message}`);
        inFlight.delete(job.id);
        if (printer?.systemName) printerBusy.set(printer.systemName, false);
      });
    }
  } catch (err) {
    if (err.message?.includes('401') || err.message?.includes('403')) {
      console.error('\n  Authentication failed. Check your AGENT_KEY in the dashboard.');
      process.exit(1);
    }
    // Silently retry on transient network errors
  } finally {
    isPolling = false;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║      PrintDrop Print Agent  v3.0         ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Server:  ${API_URL}`);
  console.log(`  Poll:    every ${POLL_MS / 1000}s`);
  console.log(`  Mode:    ${SIMULATE ? 'SIMULATE (no real printing)' : 'LIVE'}`);
  console.log(`  Ready:   auto-mark ready after print = ${AUTO_READY}`);
  console.log(`  Cover:   cover page = ${COVER_PAGE}`);

  // Send initial heartbeat to discover shop ID and routing config
  await sendHeartbeat();

  // If we still don't have routing config, try fetching it directly
  if (routingConfig.length === 0 && resolvedShopId) {
    await fetchRoutingConfig();
  }

  if (routingConfig.length > 0) {
    const onlinePrinters = routingConfig.filter((p) => p.isOnline);
    console.log(`  Printers: ${routingConfig.length} configured, ${onlinePrinters.length} online`);
    for (const p of routingConfig) {
      const caps = [
        p.supportsColor ? 'Color' : 'B&W',
        p.supportsDuplex ? 'Duplex' : null,
        p.supportsA3 ? 'A3' : null,
        p.isDefault ? 'Default' : null,
      ].filter(Boolean).join(', ');
      const status = p.isOnline ? 'ONLINE' : 'OFFLINE';
      console.log(`    ${status}  ${p.name} → ${p.systemName}  [${caps}]`);
    }
  } else if (PRINTER_ENV) {
    console.log(`  Printer: ${PRINTER_ENV} (env var fallback)`);
  } else {
    try {
      const printers = await getAvailablePrinters();
      console.log(`  Printer: system default (detected: ${printers.slice(0, 3).join(', ') || 'none'})`);
    } catch {
      console.log('  Printer: system default');
    }
  }

  // Recover any jobs stuck in 'printing' from a previous crash
  await recoverStuckJobs();

  console.log('\n  Waiting for jobs...\n');

  // Periodic heartbeat
  setInterval(sendHeartbeat, HEARTBEAT_MS);

  // Poll loop
  await pollQueue();
  setInterval(pollQueue, POLL_MS);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
