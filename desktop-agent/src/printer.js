'use strict';

const { exec, execFile } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ensureSumatra } = require('./sumatra');

const platform = os.platform();
const TEST_PRINT_TIMEOUT_MS = platform === 'win32' ? 420_000 : 60_000;

function log(...args) {
  try { require('./logger').info(args.join(' ')); } catch { console.log(...args); }
}
function logWarn(...args) {
  try { require('./logger').warn(args.join(' ')); } catch { console.warn(...args); }
}

// ─── Printer discovery ──────────────────────────────────────────────────────
function getAvailablePrinters() {
  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      // PowerShell is more reliable than wmic (deprecated on Win 11)
      const ps = 'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"';
      exec(ps, { timeout: 10000 }, (err, stdout) => {
        if (err) {
          // Fallback to wmic for older Windows
          exec('wmic printer get name', { timeout: 10000 }, (err2, stdout2) => {
            if (err2) return reject(err2);
            resolve(stdout2.split('\n').slice(1).map((l) => l.trim()).filter(Boolean));
          });
          return;
        }
        resolve(stdout.split('\n').map((l) => l.trim()).filter(Boolean));
      });
    } else {
      exec('lpstat -a 2>/dev/null', (err, stdout) => {
        if (err || !stdout.trim()) return resolve([]);
        resolve(stdout.split('\n').map((l) => l.split(' ')[0]).filter(Boolean));
      });
    }
  });
}

function isVirtualPrinter(name) {
  return name && (name.includes('(Dev)') || name.startsWith('Virtual_'));
}

// ─── Print entry point ──────────────────────────────────────────────────────
async function printFile(filePath, options = {}) {
  const {
    printerName = '',
    copies = 1,
    doubleSided = false,
    color = false,
    paperSize = 'A4',
    simulate = false,
  } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileSize = fs.statSync(filePath).size;
  if (fileSize < 200) {
    // Sanity check — a valid PDF is at least a few hundred bytes.
    throw new Error(`PDF appears empty/corrupt (${fileSize} bytes): ${filePath}`);
  }

  // Virtual / simulate mode
  if (simulate || isVirtualPrinter(printerName)) {
    const kb = (fileSize / 1024).toFixed(1);
    const label = isVirtualPrinter(printerName) ? 'Virtual printer' : 'Simulated';
    await sleep(800 + Math.random() * 1200);
    return { success: true, output: `${label} — ${kb} KB`, simulated: true };
  }

  if (platform === 'win32') {
    // Primary: SumatraPDF (reliable, silent CLI print, correct settings).
    // Fallback: Chromium PDF viewer — only if Sumatra unavailable.
    const sumatraPath = await ensureSumatra().catch(() => null);
    if (sumatraPath) {
      return printWithSumatra(filePath, sumatraPath, { printerName, copies, doubleSided, color, paperSize });
    }
    logWarn('[print] SumatraPDF unavailable — falling back to Chromium PDF viewer (less reliable)');
    return printOnWindowsChromium(filePath, { printerName, copies, doubleSided, color, paperSize });
  }

  // macOS / Linux — use lp
  return printWithLp(filePath, { printerName, copies, doubleSided, color, paperSize });
}

// ─── Windows / SumatraPDF (primary) ──────────────────────────────────────────
function printWithSumatra(filePath, sumatraPath, { printerName, copies, doubleSided, color, paperSize }) {
  return new Promise((resolve, reject) => {
    const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
    log(`[print] Sumatra → "${printerName || 'default'}" · ${path.basename(filePath)} (${sizeMb} MB)`);

    const settings = [
      `${copies || 1}x`,
      doubleSided ? 'duplexlong' : 'simplex',
      color ? 'color' : 'monochrome',
      paperSize || 'A4',
      'fit',
    ].join(',');

    const args = [];
    if (printerName) {
      args.push('-print-to', printerName);
    } else {
      args.push('-print-to-default');
    }
    args.push('-print-settings', settings);
    args.push('-silent');
    args.push(filePath);

    log(`[print] Sumatra args: ${args.join(' ')}`);

    execFile(sumatraPath, args, { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`SumatraPDF failed: ${err.message}${stderr ? ` — ${stderr}` : ''}`));
      }
      // SumatraPDF exits 0 after handing the job to the spooler. No further
      // data-flush wait is needed — the file is read fully before submission.
      log('[print] Sumatra dispatched job to spooler');
      resolve({ success: true, output: `Printed via SumatraPDF to "${printerName || 'default printer'}"` });
    });
  });
}

// ─── macOS / Linux ───────────────────────────────────────────────────────────
function printWithLp(filePath, { printerName, copies, doubleSided, color, paperSize }) {
  const args = [];
  if (printerName) args.push('-d', printerName);
  if (copies > 1) args.push('-n', String(copies));
  args.push('-o', doubleSided ? 'sides=two-sided-long-edge' : 'sides=one-sided');
  if (!color) args.push('-o', 'ColorModel=Gray');
  const mediaMap = { A4: 'A4', A3: 'A3', Letter: 'Letter', Legal: 'Legal' };
  args.push('-o', `media=${mediaMap[paperSize] || 'A4'}`);
  args.push('-o', 'fit-to-page');
  args.push('--', filePath);

  return new Promise((resolve, reject) => {
    execFile('lp', args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`lp failed: ${err.message}\n${stderr}`));
      resolve({ success: true, output: stdout.trim() });
    });
  });
}

// ─── Windows — Electron webContents.print() (FALLBACK ONLY) ──────────────────
// Kept as a last resort when SumatraPDF cannot be downloaded (e.g. offline
// environment). Less reliable than Sumatra — some network printers spool a
// blank job because Chromium's PDF plugin renders asynchronously.
function printOnWindowsChromium(filePath, { printerName, copies, doubleSided, color, paperSize }) {
  const { BrowserWindow } = require('electron');
  const http = require('http');

  return new Promise((resolve, reject) => {
    const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
    log(`[print/chromium] File: ${path.basename(filePath)} (${sizeMb} MB) → printer: "${printerName || 'default'}"`);

    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', fs.statSync(filePath).size);
      fs.createReadStream(filePath).pipe(res);
    });

    const hardTimeout = setTimeout(() => {
      server.close();
      if (win && !win.isDestroyed()) win.close();
      reject(new Error('Print timeout (90s) — is the printer online?'));
    }, 90000);

    let win;

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const pdfUrl = `http://127.0.0.1:${port}/file.pdf`;
      log(`[print/chromium] Serving PDF on ${pdfUrl}`);

      win = new BrowserWindow({
        show: false,
        x: -9999,
        y: -9999,
        width: 850,
        height: 1100,
        webPreferences: { plugins: true, javascript: true },
      });

      win.loadURL(pdfUrl);

      win.webContents.once('did-finish-load', () => {
        win.setPosition(-9999, -9999);
        win.showInactive();
        const renderWait = 5000;
        log(`[print/chromium] PDF loaded — waiting ${renderWait}ms for render...`);
        setTimeout(() => {
          const printOpts = {
            silent: true,
            printBackground: false,
            deviceName: printerName || '',
            copies: copies || 1,
            duplex: doubleSided ? 'long' : 'simplex',
            color: !!color,
            margins: { marginType: 'default' },
            landscape: false,
            pageSize: paperSize || 'A4',
          };
          log(`[print/chromium] Submitting — copies=${copies} duplex=${doubleSided} color=${color} paper=${paperSize}`);
          win.webContents.print(printOpts, (success, failureReason) => {
            clearTimeout(hardTimeout);
            server.close();
            if (!success) {
              if (!win.isDestroyed()) win.close();
              return reject(new Error(`Spooler rejected: ${failureReason || 'unknown reason'}`));
            }
            log('[print/chromium] Spooler accepted — holding window open for data flush (5s)...');
            setTimeout(() => {
              if (!win.isDestroyed()) win.close();
              resolve({ success: true, output: `Printed to "${printerName || 'default printer'}"` });
            }, 5000);
          });
        }, renderWait);
      });

      win.webContents.once('did-fail-load', (_e, code, desc) => {
        clearTimeout(hardTimeout);
        server.close();
        if (!win.isDestroyed()) win.close();
        reject(new Error(`PDF load failed (${code}): ${desc}`));
      });
    });

    server.on('error', (err) => {
      clearTimeout(hardTimeout);
      reject(new Error(`HTTP server error: ${err.message}`));
    });
  });
}

// ─── Test print ───────────────────────────────────────────────────────────────
// Called from setup wizard/settings to verify local printer connectivity.
function buildTestPageHtml(printerName, color = false) {
  return `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #111; }
    h1   { color: #0a5dcc; font-size: 28px; margin-bottom: 8px; }
    hr   { border: none; border-top: 2px solid #ddd; margin: 20px 0; }
    .lbl { color: #555; font-size: 13px; }
    .val { font-size: 15px; font-weight: bold; }
    .ok  { color: #1a7a3c; font-size: 16px; margin-top: 24px; }
  </style></head><body>
  <h1>PrintDrop — Test Page</h1>
  <hr>
  <p class="lbl">Printer</p>
  <p class="val">${escapeHtml(printerName || 'System Default')}</p>
  <p class="lbl">Mode</p>
  <p class="val">${color ? 'Color' : 'Black & White'}</p>
  <p class="lbl">Date / Time</p>
  <p class="val">${new Date().toLocaleString()}</p>
  <hr>
  <p class="ok">&#10003; If you can read this, your printer is configured correctly.</p>
  </body></html>`;
}

function printTestPage(printerName, color = false) {
  const { BrowserWindow } = require('electron');
  const html = buildTestPageHtml(printerName, color);

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ show: false });
    let settled = false;
    let timeout = null;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 3000);
      if (err) reject(err);
      else resolve(result);
    };

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    win.webContents.once('did-finish-load', async () => {
      try {
        await sleep(500);

        const pdf = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { marginType: 'default' },
        });
        const tmpPath = path.join(os.tmpdir(), `printdrop_test_${Date.now()}.pdf`);
        fs.writeFileSync(tmpPath, pdf);

        try {
          const result = await printFile(tmpPath, {
            printerName,
            copies: 1,
            doubleSided: false,
            color: !!color,
            paperSize: 'A4',
          });
          finish(null, { success: true, output: result.output || `Test page sent to ${printerName || 'default'}` });
        } finally {
          try { fs.unlinkSync(tmpPath); } catch {}
        }
      } catch (err) {
        finish(err);
      }
    });

    win.webContents.once('did-fail-load', (_e, code, desc) => {
      finish(new Error(`Load failed (${code}): ${desc}`));
    });

    timeout = setTimeout(() => {
      finish(new Error('Timeout'));
    }, TEST_PRINT_TIMEOUT_MS);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { getAvailablePrinters, printFile, printTestPage, buildTestPageHtml, isVirtualPrinter };
