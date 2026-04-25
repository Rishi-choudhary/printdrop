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
const crypto = require('crypto');
const { app } = require('electron');
const logger = require('./logger');

const SUMATRA_URL =
  'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.exe';
const SUMATRA_URL_FALLBACK =
  'https://github.com/sumatrapdfreader/sumatrapdf/releases/download/3.5.2/SumatraPDF-3.5.2-64.exe';
const SUMATRA_SHA256 =
  '290e4aa7ed64c728138711c011e89aab7aa48dbc1ae430371dc2be4100b92bf0';

let _cached = null;
let _downloading = null;

function candidates() {
  const list = [];
  // 1. Packaged resources
  if (process.resourcesPath) {
    list.push({ path: path.join(process.resourcesPath, 'SumatraPDF.exe'), verifyHash: true });
  }
  // 2. Dev checkout
  list.push({ path: path.join(__dirname, '..', 'resources', 'win', 'SumatraPDF.exe'), verifyHash: true });
  // 3. User data dir (where we auto-download)
  try {
    list.push({ path: path.join(app.getPath('userData'), 'bin', 'SumatraPDF.exe'), verifyHash: true });
  } catch {
    /* app may not be ready in some test paths */
  }
  // 4. Common install locations
  list.push({ path: 'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe', verifyHash: false });
  list.push({ path: 'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe', verifyHash: false });
  return list;
}

function findExisting() {
  for (const candidate of candidates()) {
    try {
      const p = candidate.path;
      if (p && fs.existsSync(p) && fs.statSync(p).size > 1_000_000) {
        if (candidate.verifyHash && sha256File(p) !== SUMATRA_SHA256) {
          logger.warn(`[sumatra] ignoring ${p}: SHA-256 mismatch`);
          continue;
        }
        return p;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
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
            const digest = sha256File(tmpPath);
            if (digest !== SUMATRA_SHA256) {
              fs.unlinkSync(tmpPath);
              return reject(new Error(`Downloaded file SHA-256 mismatch (${digest})`));
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
