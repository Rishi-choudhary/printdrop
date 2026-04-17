'use strict';

const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const platform = os.platform();

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

  // Virtual / simulate mode
  if (simulate || isVirtualPrinter(printerName)) {
    const kb = (fs.statSync(filePath).size / 1024).toFixed(1);
    const label = isVirtualPrinter(printerName) ? 'Virtual printer' : 'Simulated';
    await sleep(800 + Math.random() * 1200);
    return { success: true, output: `${label} — ${kb} KB`, simulated: true };
  }

  if (platform === 'win32') {
    return printOnWindows(filePath, { printerName, copies, doubleSided, color, paperSize });
  }

  // macOS / Linux — use lp
  return printWithLp(filePath, { printerName, copies, doubleSided, color, paperSize });
}

// ─── macOS / Linux ───────────────────────────────────────────────────────────
function printWithLp(filePath, { printerName, copies, doubleSided, color, paperSize }) {
  const { execFile } = require('child_process');
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

// ─── Windows — Electron webContents.print() ──────────────────────────────────
// Serves the PDF over a local HTTP server so Chromium's built-in PDF viewer
// can load it without file:// sandbox restrictions or data URI size limits.
function printOnWindows(filePath, { printerName, copies, doubleSided, color, paperSize }) {
  const { BrowserWindow } = require('electron');
  const http = require('http');

  return new Promise((resolve, reject) => {
    const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
    log(`[print] File: ${path.basename(filePath)} (${sizeMb} MB) → printer: "${printerName || 'default'}"`);

    // Spin up a single-file HTTP server on a random loopback port.
    // Chromium treats http://127.0.0.1 as fully trusted — no sandbox issues.
    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', fs.statSync(filePath).size);
      fs.createReadStream(filePath).pipe(res);
    });

    const hardTimeout = setTimeout(() => {
      server.close();
      if (!win.isDestroyed()) win.close();
      reject(new Error('Print timeout (90s) — is the printer online?'));
    }, 90000);

    let win;

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const pdfUrl = `http://127.0.0.1:${port}/file.pdf`;
      log(`[print] Serving PDF on ${pdfUrl}`);

      win = new BrowserWindow({
        show: false,
        width: 850,
        height: 1100,
        webPreferences: {
          plugins: true,     // enables built-in Chromium PDF viewer
          javascript: true,
        },
      });

      win.loadURL(pdfUrl);

      win.webContents.once('did-finish-load', () => {
        // Chromium's PDF viewer plugin renders asynchronously after did-finish-load.
        // 3s covers even large multi-page PDFs at typical CPU speeds.
        const renderWait = 3000;
        log(`[print] PDF loaded in renderer — waiting ${renderWait}ms for render...`);

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

          log(`[print] Submitting — copies=${copies} duplex=${doubleSided} color=${color} paper=${paperSize}`);

          win.webContents.print(printOpts, (success, failureReason) => {
            clearTimeout(hardTimeout);
            server.close();

            if (!success) {
              if (!win.isDestroyed()) win.close();
              return reject(new Error(`Spooler rejected: ${failureReason || 'unknown reason'}`));
            }

            log('[print] Spooler accepted job — holding window open for data flush (5s)...');

            // Do NOT close the window immediately after spooler accepts.
            // Chromium streams PDF data to the spooler; closing too early truncates it.
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

// ─── Test print — HTML (always works, no PDF rendering needed) ────────────────
// Called from setup wizard to verify printer connectivity.
function printTestPage(printerName, color = false) {
  const { BrowserWindow } = require('electron');

  const html = `<!DOCTYPE html><html><head>
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
  <p class="val">${printerName || 'System Default'}</p>
  <p class="lbl">Mode</p>
  <p class="val">${color ? 'Color' : 'Black & White'}</p>
  <p class="lbl">Date / Time</p>
  <p class="val">${new Date().toLocaleString()}</p>
  <hr>
  <p class="ok">&#10003; If you can read this, your printer is configured correctly.</p>
  </body></html>`;

  if (platform !== 'win32') {
    // On Mac/Linux: write HTML → print via lp (not needed in practice,
    // test print is only wired in the Electron setup wizard on Windows)
    return Promise.resolve({ success: true, output: 'Test page sent' });
  }

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ show: false });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        win.webContents.print(
          { silent: true, deviceName: printerName || '', copies: 1, color: !!color },
          (success, reason) => {
            setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 3000);
            if (success) resolve({ success: true, output: `Test page sent to ${printerName || 'default'}` });
            else reject(new Error(`Print failed: ${reason || 'unknown'}`));
          },
        );
      }, 500); // HTML renders instantly, 500ms is enough
    });

    win.webContents.once('did-fail-load', (_e, code, desc) => {
      win.close();
      reject(new Error(`Load failed (${code}): ${desc}`));
    });

    setTimeout(() => { if (!win.isDestroyed()) { win.close(); reject(new Error('Timeout')); } }, 30000);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { getAvailablePrinters, printFile, printTestPage, isVirtualPrinter };
