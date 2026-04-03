const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');

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
      console.log(`    [SIMULATED] File: ${filePath} (${(fileSize / 1024).toFixed(1)} KB)`);
      console.log(`    [SIMULATED] Copies:${copies} Sides:${doubleSided ? 'double' : 'single'} Color:${color} Paper:${paperSize}`);
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

/**
 * Build lp arguments for Linux/macOS.
 */
function buildLpArgs({ printerName, copies, doubleSided, color, paperSize }) {
  const args = [];
  if (printerName) args.push(`-d "${printerName}"`);
  if (copies > 1) args.push(`-n ${copies}`);

  // Duplex
  if (doubleSided) {
    args.push('-o sides=two-sided-long-edge');
  } else {
    args.push('-o sides=one-sided');
  }

  // Color model
  if (!color) args.push('-o ColorModel=Gray');

  // Paper size (A4, A3, Letter, Legal)
  const mediaMap = { A4: 'A4', A3: 'A3', Letter: 'Letter', Legal: 'Legal' };
  const media = mediaMap[paperSize] || 'A4';
  args.push(`-o media=${media}`);

  // Fit to page
  args.push('-o fit-to-page');

  return args;
}

/**
 * Build print command for Windows.
 * Prefers SumatraPDF (free, CLI-friendly) over the PowerShell fallback.
 */
async function buildWindowsCommand(filePath, { printerName, copies, doubleSided, color, paperSize }) {
  // Check if SumatraPDF is available (best option for print settings on Windows)
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

  // Fallback: PowerShell via default PDF association (copies/settings ignored — last resort)
  console.warn('    WARNING: SumatraPDF not found. Printing via system default (copies/color/sides may be ignored).');
  console.warn('    Install SumatraPDF for proper print settings: https://www.sumatrapdfreader.org/');
  const printer = printerName ? `-PrinterName "${printerName}"` : '';
  return {
    cmd: `powershell -Command "Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden ${printer}"`,
    method: 'PowerShell-fallback',
  };
}

function findSumatraPDF() {
  return new Promise((resolve) => {
    const candidates = [
      'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
      'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
      'SumatraPDF.exe', // in PATH
    ];

    let checked = 0;
    for (const p of candidates) {
      exec(`"${p}" -version 2>nul`, (err) => {
        if (!err) return resolve(p);
        checked++;
        if (checked === candidates.length) resolve(null);
      });
    }
  });
}

module.exports = { getAvailablePrinters, printFile };
