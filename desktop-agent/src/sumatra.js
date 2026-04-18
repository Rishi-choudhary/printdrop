'use strict';

/**
 * SumatraPDF resolver.
 *
 * Finds (and, if missing, downloads) SumatraPDF.exe so silent printing on
 * Windows works out of the box with zero manual setup. Resolved path is
 * cached in memory.
 *
 * Lookup order:
 *   1. Bundled with the packaged app (process.resourcesPath/SumatraPDF.exe)
 *   2. Dev checkout           (desktop-agent/resources/win/SumatraPDF.exe)
 *   3. User data dir          (auto-downloaded on first use)
 *   4. Common install paths   (Program Files / Program Files (x86))
 *   5. Auto-download to user data dir
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');
const logger = require('./logger');

const SUMATRA_URL =
  'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.exe';
const SUMATRA_URL_FALLBACK =
  'https://github.com/sumatrapdfreader/sumatrapdf/releases/download/3.5.2/SumatraPDF-3.5.2-64.exe';

let _cached = null;
let _downloading = null;

function candidates() {
  const list = [];
  // 1. Packaged resources
  if (process.resourcesPath) {
    list.push(path.join(process.resourcesPath, 'SumatraPDF.exe'));
  }
  // 2. Dev checkout
  list.push(path.join(__dirname, '..', 'resources', 'win', 'SumatraPDF.exe'));
  // 3. User data dir (where we auto-download)
  try {
    list.push(path.join(app.getPath('userData'), 'bin', 'SumatraPDF.exe'));
  } catch {
    /* app may not be ready in some test paths */
  }
  // 4. Common install locations
  list.push('C:\\Program Files\\SumatraPDF\\SumatraPDF.exe');
  list.push('C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe');
  return list;
}

function findExisting() {
  for (const p of candidates()) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).size > 1_000_000) {
        return p;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function downloadTo(destPath, url) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${destPath}.part`;
    const file = fs.createWriteStream(tmpPath);

    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        file.close();
        try { fs.unlinkSync(tmpPath); } catch {}
        downloadTo(destPath, res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(tmpPath); } catch {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close((err) => {
          if (err) return reject(err);
          try {
            const size = fs.statSync(tmpPath).size;
            if (size < 1_000_000) {
              fs.unlinkSync(tmpPath);
              return reject(new Error(`Downloaded file too small (${size} bytes)`));
            }
            fs.renameSync(tmpPath, destPath);
            resolve(destPath);
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(err);
    });
    req.setTimeout(120_000, () => {
      req.destroy(new Error('Download timeout (120s)'));
    });
  });
}

async function ensureSumatra() {
  if (process.platform !== 'win32') return null;
  if (_cached) return _cached;

  const existing = findExisting();
  if (existing) {
    _cached = existing;
    logger.info(`[sumatra] using ${existing}`);
    return existing;
  }

  if (_downloading) return _downloading;

  const destPath = path.join(app.getPath('userData'), 'bin', 'SumatraPDF.exe');
  logger.info(`[sumatra] not found — downloading to ${destPath}`);

  _downloading = (async () => {
    try {
      await downloadTo(destPath, SUMATRA_URL);
    } catch (err) {
      logger.warn(`[sumatra] primary download failed: ${err.message} — trying GitHub mirror`);
      await downloadTo(destPath, SUMATRA_URL_FALLBACK);
    }
    _cached = destPath;
    logger.info(`[sumatra] downloaded OK (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`);
    return destPath;
  })()
    .catch((err) => {
      logger.error(`[sumatra] download failed: ${err.message}`);
      _downloading = null;
      return null;
    });

  return _downloading;
}

module.exports = { ensureSumatra, findExisting };
