const { exec, execFile } = require('child_process');
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
      // PowerShell is more reliable than wmic (deprecated on Win11)
      const ps =
        'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"';
      exec(ps, { timeout: 10000 }, (err, stdout) => {
        if (err) {
          // fallback to wmic
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
function printFile(filePath, options = {}) {
  const {
    printerName,
    copies = 1,
    doubleSided = false,
    color = false,
    paperSize = 'A4',
    simulate = false,
  } = options;

  return new Promise(async (resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    if (simulate || isVirtualPrinter(printerName)) {
      const kb = (fs.statSync(filePath).size / 1024).toFixed(1);
      const label = isVirtualPrinter(printerName) ? 'Virtual printer' : 'Simulated';
      const delay = 600 + Math.random() * 1400;
      setTimeout(
        () => resolve({ success: true, output: `${label} — ${kb} KB in ${(delay / 1000).toFixed(1)}s`, simulated: true }),
        delay,
      );
      return;
    }

    if (platform === 'win32') {
      try {
        resolve(await printOnWindows(filePath, { printerName, copies, doubleSided, color, paperSize }));
      } catch (err) {
        reject(err);
      }
    } else {
      const args = buildLpArgs({ printerName, copies, doubleSided, color, paperSize });
      args.push('--', filePath);
      execFile('lp', args, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`lp failed: ${err.message}\n${stderr}`));
        resolve({ success: true, output: stdout.trim() });
      });
    }
  });
}

// ─── macOS/Linux lp args ────────────────────────────────────────────────────
function buildLpArgs({ printerName, copies, doubleSided, color, paperSize }) {
  const args = [];
  if (printerName) args.push('-d', printerName);
  if (copies > 1) args.push('-n', String(copies));
  args.push('-o', doubleSided ? 'sides=two-sided-long-edge' : 'sides=one-sided');
  if (!color) args.push('-o', 'ColorModel=Gray');
  const mediaMap = { A4: 'A4', A3: 'A3', Letter: 'Letter', Legal: 'Legal' };
  args.push('-o', `media=${mediaMap[paperSize] || 'A4'}`);
  args.push('-o', 'fit-to-page');
  return args;
}

// ─── Windows: Electron webContents.print() — no external tools needed ───────
function printOnWindows(filePath, opts) {
  const { printerName, copies, doubleSided, color, paperSize } = opts;

  // Use Electron's built-in PDF printing (Chromium engine — reliable, no deps)
  try {
    const { BrowserWindow } = require('electron');
    return printViaElectron(filePath, { printerName, copies, doubleSided, color, paperSize });
  } catch {
    // Not running in Electron (e.g. CLI mode) — fall back to SumatraPDF / shell
    return printViaShellFallback(filePath, { printerName, copies, doubleSided, color, paperSize });
  }
}

function printViaElectron(filePath, { printerName, copies, doubleSided, color, paperSize }) {
  const { BrowserWindow } = require('electron');

  return new Promise((resolve, reject) => {
    // Hidden window to load and print the PDF
    const win = new BrowserWindow({
      show: false,
      webPreferences: { plugins: true },
    });

    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
    log(`[print] Loading PDF: ${fileUrl}`);

    win.loadURL(fileUrl);

    win.webContents.once('did-finish-load', () => {
      // Small delay so Chromium PDF renderer finishes rendering
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

        log(`[print] Sending to printer: ${printerName || 'default'}, copies=${copies}, duplex=${doubleSided}, color=${color}`);

        win.webContents.print(printOpts, (success, failureReason) => {
          win.close();
          if (success) {
            resolve({ success: true, output: `Printed to ${printerName || 'system default'}` });
          } else {
            reject(new Error(`Print failed: ${failureReason || 'unknown reason'}`));
          }
        });
      }, 800);
    });

    win.webContents.once('did-fail-load', (_e, code, desc) => {
      win.close();
      reject(new Error(`Failed to load PDF (${code}): ${desc}`));
    });

    // Safety timeout
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.close();
        reject(new Error('Print timeout after 60s'));
      }
    }, 60000);
  });
}

// ─── Shell fallback (CLI / non-Electron context) ─────────────────────────────
async function printViaShellFallback(filePath, { printerName, copies, doubleSided, color, paperSize }) {
  const sumatraPath = await findSumatraPDF();

  if (sumatraPath) {
    const printerArg = printerName ? `-print-to "${printerName}"` : '-print-to-default';
    const settings = [`${copies}x`, doubleSided ? 'duplexlong' : 'simplex', !color ? 'monochrome' : 'color', paperSize || 'A4'].join(',');
    const cmd = `"${sumatraPath}" ${printerArg} -print-settings "${settings}" -silent "${filePath}"`;
    log(`[print] SumatraPDF: ${cmd}`);
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`SumatraPDF failed: ${err.message}${stderr ? '\n' + stderr : ''}`));
        resolve({ success: true, output: stdout || `Sent via SumatraPDF to ${printerName || 'default'}` });
      });
    });
  }

  return Promise.reject(
    new Error(
      'No PDF printer found. Install SumatraPDF: https://www.sumatrapdfreader.org/\n' +
      'Or run this agent as an Electron app (not CLI) for built-in printing.',
    ),
  );
}

// ─── SumatraPDF discovery (for CLI fallback only) ───────────────────────────
async function findSumatraPDF() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'SumatraPDF.exe'));
  candidates.push(path.join(__dirname, '..', 'resources', 'win', 'SumatraPDF.exe'));
  candidates.push('C:\\Program Files\\SumatraPDF\\SumatraPDF.exe');
  candidates.push('C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe');

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return new Promise((resolve) => {
    exec('where SumatraPDF.exe', { timeout: 3000 }, (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        resolve(stdout.trim().split(/\r?\n/)[0].trim() || null);
      } else {
        resolve(null);
      }
    });
  });
}

module.exports = { getAvailablePrinters, printFile, isVirtualPrinter };
