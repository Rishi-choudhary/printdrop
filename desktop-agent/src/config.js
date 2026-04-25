const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  version: 2,
  agentKey: '',
  apiUrl: 'https://api.printdrop.app',
  shopId: null,
  shopName: null,
  bwPrinterSystemName: null,
  bwPrinterDisplayName: null,
  colorPrinterSystemName: null,
  colorPrinterDisplayName: null,
  bwPaperSize: 'A4',
  bwDuplex: 'simplex',
  colorPaperSize: 'A4',
  colorDuplex: 'simplex',
  coverPage: true,
  // tokenStampPosition: 'none' | 'front-top-right' | 'back-first-right' | 'back-first-left' | 'back-last-right' | 'back-last-left'
  tokenStampPosition: 'back-last-right',
  autoPrint: false,
  soundEnabled: true,
  notificationsEnabled: true,
  autoStart: true,
  queueHistoryDays: 30,
  pollIntervalMs: 4000,
  setupComplete: false,
};

let _config = null;

function getFilePath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  if (_config) return _config;
  try {
    const raw = fs.readFileSync(getFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    _config = { ...DEFAULTS, ...parsed };
    if ((parsed.version || 1) < 2 &&
        _config.coverPage !== false &&
        _config.tokenStampPosition === 'front-top-right') {
      _config.tokenStampPosition = 'back-last-right';
    }
    _config.version = DEFAULTS.version;
  } catch {
    _config = { ...DEFAULTS };
  }
  return _config;
}

function save(updates = {}) {
  _config = { ...load(), ...updates };
  const fp = getFilePath();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(_config, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, fp);
  try { fs.chmodSync(fp, 0o600); } catch {}
  return _config;
}

function get(key) {
  return load()[key];
}

module.exports = { load, save, get };
