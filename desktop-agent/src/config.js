const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  version: 1,
  agentKey: '',
  apiUrl: 'https://printdrop.app',
  shopId: null,
  shopName: null,
  bwPrinterSystemName: null,
  bwPrinterDisplayName: null,
  colorPrinterSystemName: null,
  colorPrinterDisplayName: null,
  coverPage: true,
  soundEnabled: true,
  autoStart: true,
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
    _config = { ...DEFAULTS, ...JSON.parse(raw) };
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
  fs.writeFileSync(fp, JSON.stringify(_config, null, 2), 'utf8');
  return _config;
}

function get(key) {
  return load()[key];
}

module.exports = { load, save, get };
