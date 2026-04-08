const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const platform = os.platform();

function getAvailablePrinters() {
  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      exec('wmic printer get name', (err, stdout) => {
        if (err) return reject(err);
        const printers = stdout
          .split('\n')
          .slice(1)
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

function printFile(filePath, options = {}) {
  const {
    printerName,
    copies = 1,
    doubleSided = false,
    color = false,
    paperSize = 'A4',
    simulate = false,
  } = options;

  return new Promise((resolve, reject) => {
    if (simulate) {
      const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      const delay = 600 + Math.random() * 1400;
      setTimeout(() => {
        resolve({ success: true, output: `Simulated in ${(delay / 1000).toFixed(1)}s`, simulated: true });
      }, delay);
      return;
    }

    if (platform === 'win32') {
      buildWindowsCommand(filePath, { printerName, copies, doubleSided, color, paperSize })
        .then(({ cmd, method }) => {
          exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) return reject(new Error(`Print failed (${method}): ${err.message}`));
            resolve({ success: true, output: stdout || `Sent via ${method}` });
          });
        })
        .catch(reject);
    } else {
      const args = buildLpArgs({ printerName, copies, doubleSided, color, paperSize });
      const cmd = `lp ${args.join(' ')} "${filePath}"`;

      exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`lp failed: ${err.message}\n${stderr}`));
        resolve({ success: true, output: stdout.trim() });
      });
    }
  });
}

function buildLpArgs({ printerName, copies, doubleSided, color, paperSize }) {
  const args = [];
  if (printerName) args.push(`-d "${printerName}"`);
  if (copies > 1) args.push(`-n ${copies}`);

  if (doubleSided) {
    args.push('-o sides=two-sided-long-edge');
  } else {
    args.push('-o sides=one-sided');
  }

  if (!color) args.push('-o ColorModel=Gray');

  const mediaMap = { A4: 'A4', A3: 'A3', Letter: 'Letter', Legal: 'Legal' };
  args.push(`-o media=${mediaMap[paperSize] || 'A4'}`);
  args.push('-o fit-to-page');

  return args;
}

async function buildWindowsCommand(filePath, { printerName, copies, doubleSided, color, paperSize }) {
  const sumatraPath = await findSumatraPDF();

  if (sumatraPath) {
    const printer = printerName ? `-print-to "${printerName}"` : '-print-to-default';
    const settings = [
      `${copies}x`,
      doubleSided ? 'duplexlong' : 'simplex',
      !color ? 'monochrome' : 'color',
      paperSize || 'A4',
    ].join(',');
    return {
      cmd: `"${sumatraPath}" ${printer} -print-settings "${settings}" -silent "${filePath}"`,
      method: 'SumatraPDF',
    };
  }

  // Fallback: PowerShell (copies/color/sides not guaranteed)
  const printer = printerName ? `-PrinterName "${printerName}"` : '';
  return {
    cmd: `powershell -Command "Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden ${printer}"`,
    method: 'PowerShell-fallback',
  };
}

/**
 * Locate SumatraPDF — checks bundled Electron resource first, then system paths.
 */
function findSumatraPDF() {
  return new Promise((resolve) => {
    const candidates = [];

    // 1. Bundled with Electron installer (production): extraResources lands here
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'SumatraPDF.exe'));
    }

    // 2. Dev: relative to this file (resources/win/SumatraPDF.exe)
    candidates.push(path.join(__dirname, '..', 'resources', 'win', 'SumatraPDF.exe'));

    // 3. System-wide installs
    candidates.push('C:\\Program Files\\SumatraPDF\\SumatraPDF.exe');
    candidates.push('C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe');
    candidates.push('SumatraPDF.exe'); // in PATH

    // Use fs.existsSync for file candidates (faster than spawning a process)
    for (const p of candidates) {
      if (p === 'SumatraPDF.exe') {
        // PATH lookup — must exec to check
        exec(`"${p}" -version 2>nul`, (err) => {
          if (!err) resolve(p);
        });
      } else if (fs.existsSync(p)) {
        resolve(p);
        return;
      }
    }

    // Not found via existsSync — give PATH check 2s then give up
    setTimeout(() => resolve(null), 2000);
  });
}

module.exports = { getAvailablePrinters, printFile };
