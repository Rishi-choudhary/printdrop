const { exec, execFile } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');

const platform = os.platform();

// SumatraPDF portable — small, silent, free, handles every PDF print setting.
// Auto-downloaded once to userData on first Windows print if not found elsewhere.
const SUMATRA_URL =
  'https://github.com/sumatrapdfreader/sumatrapdf/releases/download/3.5.2/SumatraPDF-3.5.2-64.exe';
const SUMATRA_SIZE_MIN = 5 * 1024 * 1024; // ≥5 MB = sanity check
let _sumatraCache = null;

// Lazy-require electron so this module also works outside Electron (e.g. CLI tests)
function getUserDataPath() {
  try {
    const { app } = require('electron');
    return app && app.getPath ? app.getPath('userData') : null;
  } catch {
    return null;
  }
}

function log(...args) {
  try {
    // eslint-disable-next-line global-require
    require('./logger').info(args.join(' '));
  } catch {
    console.log(...args);
  }
}

function logWarn(...args) {
  try {
    require('./logger').warn(args.join(' '));
  } catch {
    console.warn(...args);
  }
}

// ─── Printer discovery ──────────────────────────────────────────────────────
function getAvailablePrinters() {
  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      // PowerShell is far more reliable than wmic (deprecated on Win11)
      const ps =
        'powershell -NoProfile -Command "Get-Printer | Where-Object { $_.PrinterStatus -eq \'Normal\' -or $_.PrinterStatus -eq \'Idle\' -or $_.PrinterStatus -eq 0 } | ForEach-Object { $_.Name }"';
      exec(ps, { timeout: 10000 }, (err, stdout) => {
        if (err) {
          // Fallback to wmic
          exec('wmic printer get name', { timeout: 10000 }, (err2, stdout2) => {
            if (err2) return reject(err2);
            const printers = stdout2
              .split('\n')
              .slice(1)
              .map((l) => l.trim())
              .filter(Boolean);
            resolve(printers);
          });
          return;
        }
        const printers = stdout
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        resolve(printers);
      });
    } else {
      exec('lpstat -a 2>/dev/null', (err, stdout) => {
        if (err || !stdout.trim()) return resolve([]);
        const printers = stdout
          .split('\n')
          .map((l) => l.split(' ')[0])
          .filter(Boolean);
        resolve(printers);
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

    // Virtual/dev printer → simulate
    if (simulate || isVirtualPrinter(printerName)) {
      const fileSize = fs.statSync(filePath).size;
      const delay = 600 + Math.random() * 1400;
      const label = isVirtualPrinter(printerName) ? 'Virtual printer' : 'Simulated';
      setTimeout(() => {
        resolve({
          success: true,
          output: `${label} — ${(fileSize / 1024).toFixed(1)} KB sent in ${(delay / 1000).toFixed(1)}s`,
          simulated: true,
        });
      }, delay);
      return;
    }

    if (platform === 'win32') {
      try {
        const result = await printOnWindows(filePath, { printerName, copies, doubleSided, color, paperSize });
        resolve(result);
      } catch (err) {
        reject(err);
      }
    } else {
      const args = buildLpArgs({ printerName, copies, doubleSided, color, paperSize });
      args.push('--');
      args.push(filePath);
      execFile('lp', args, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`lp failed: ${err.message}\n${stderr}`));
        resolve({ success: true, output: stdout.trim() });
      });
    }
  });
}

// ─── macOS/Linux: lp args ───────────────────────────────────────────────────
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

// ─── Windows print path ─────────────────────────────────────────────────────
async function printOnWindows(filePath, opts) {
  const { printerName, copies, doubleSided, color, paperSize } = opts;

  // Try SumatraPDF first (best option — full print-setting support)
  let sumatra = await findSumatraPDF();
  if (!sumatra) {
    log('[print] SumatraPDF not found — attempting auto-download...');
    try {
      sumatra = await downloadSumatra();
      log(`[print] SumatraPDF downloaded to ${sumatra}`);
    } catch (err) {
      logWarn(`[print] SumatraPDF download failed: ${err.message}`);
    }
  }

  if (sumatra) {
    const printerArg = printerName ? `-print-to "${printerName}"` : '-print-to-default';
    const settings = [
      `${copies}x`,
      doubleSided ? 'duplexlong' : 'simplex',
      !color ? 'monochrome' : 'color',
      paperSize || 'A4',
    ].join(',');
    const cmd = `"${sumatra}" ${printerArg} -print-settings "${settings}" -silent "${filePath}"`;
    log(`[print] Running: ${cmd}`);
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
          return reject(
            new Error(`SumatraPDF print failed: ${err.message}${stderr ? '\n' + stderr : ''}`),
          );
        }
        resolve({ success: true, output: stdout || `Sent via SumatraPDF to ${printerName || 'default'}` });
      });
    });
  }

  // Fallback: raw print via Windows printing API (PowerShell).
  // Works on Windows 10/11; honours copies via loop; printer name via -Verb PrintTo.
  log('[print] Using PowerShell PrintTo fallback (limited settings)');
  return printViaPowerShell(filePath, printerName, copies);
}

function printViaPowerShell(filePath, printerName, copies) {
  // -Verb PrintTo takes the printer name as ArgumentList; works if a PDF handler
  // (Edge, Adobe, etc.) is associated with .pdf and supports PrintTo verb.
  const safePath = filePath.replace(/'/g, "''");
  const safePrinter = (printerName || '').replace(/'/g, "''");
  const verb = printerName ? 'PrintTo' : 'Print';
  const argList = printerName ? `-ArgumentList '${safePrinter}'` : '';

  const ps = `
$ErrorActionPreference='Stop';
for ($i=0; $i -lt ${copies}; $i++) {
  Start-Process -FilePath '${safePath}' -Verb ${verb} ${argList} -WindowStyle Hidden -Wait -ErrorAction Stop;
  Start-Sleep -Milliseconds 600;
}
Write-Output 'OK';
`.trim();

  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 90000 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(
            new Error(
              `PowerShell print failed: ${err.message}${stderr ? '\n' + stderr : ''}\n` +
                `Install SumatraPDF for reliable printing: https://www.sumatrapdfreader.org/`,
            ),
          );
        }
        resolve({ success: true, output: (stdout || '').trim() || 'Sent via PowerShell' });
      },
    );
  });
}

// ─── SumatraPDF discovery & download ────────────────────────────────────────
async function findSumatraPDF() {
  if (_sumatraCache && fs.existsSync(_sumatraCache)) return _sumatraCache;

  const userDataDir = getUserDataPath();
  const candidates = [];

  // 1. Auto-downloaded binary (in userData, writable, persists)
  if (userDataDir) candidates.push(path.join(userDataDir, 'SumatraPDF.exe'));

  // 2. Bundled with Electron installer (production)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'SumatraPDF.exe'));
  }

  // 3. Dev: repo-local
  candidates.push(path.join(__dirname, '..', 'resources', 'win', 'SumatraPDF.exe'));

  // 4. System-wide installs
  candidates.push('C:\\Program Files\\SumatraPDF\\SumatraPDF.exe');
  candidates.push('C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe');

  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size >= SUMATRA_SIZE_MIN) {
      _sumatraCache = p;
      return p;
    }
  }

  // 5. PATH lookup
  const pathHit = await new Promise((resolve) => {
    exec('where SumatraPDF.exe', { timeout: 3000 }, (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        const first = stdout.trim().split(/\r?\n/)[0].trim();
        if (first && fs.existsSync(first)) return resolve(first);
      }
      resolve(null);
    });
  });
  if (pathHit) {
    _sumatraCache = pathHit;
    return pathHit;
  }

  return null;
}

function downloadSumatra() {
  const userDataDir = getUserDataPath();
  if (!userDataDir) {
    return Promise.reject(new Error('No userData path available (not running under Electron?)'));
  }
  const dest = path.join(userDataDir, 'SumatraPDF.exe');
  return downloadBinary(SUMATRA_URL, dest).then(() => {
    if (!fs.existsSync(dest) || fs.statSync(dest).size < SUMATRA_SIZE_MIN) {
      throw new Error(`Downloaded file too small (expected ≥${SUMATRA_SIZE_MIN} bytes)`);
    }
    _sumatraCache = dest;
    return dest;
  });
}

function downloadBinary(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        return downloadBinary(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode} downloading SumatraPDF`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });
    req.on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
    req.on('timeout', () => {
      req.destroy();
      fs.unlink(dest, () => reject(new Error('Download timeout')));
    });
  });
}

module.exports = { getAvailablePrinters, printFile, isVirtualPrinter, findSumatraPDF, downloadSumatra };
