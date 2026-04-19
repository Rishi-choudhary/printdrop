'use strict';

/**
 * Auto-updater wrapper.
 *
 * Uses electron-updater against the GitHub releases configured in
 * electron-builder.yml. Silent by design — downloads in the background and
 * surfaces a tray notification + menu entry when an update is ready to install.
 *
 * When running `electron .` in dev (app is not packaged), this module no-ops.
 */

const { app, Notification, dialog } = require('electron');

let _autoUpdater = null;
let _state = {
  status: 'idle',        // idle | checking | available | downloading | ready | error | none
  version: null,
  progress: 0,
  error: null,
};
let _listeners = new Set();

function getState() {
  return { ..._state };
}

function onChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

function emit() {
  for (const cb of _listeners) {
    try { cb(getState()); } catch {}
  }
}

function setState(patch) {
  _state = { ..._state, ...patch };
  emit();
}

function init({ onReady } = {}) {
  if (!app.isPackaged) {
    // Updater is only meaningful on packaged builds.
    setState({ status: 'idle' });
    return;
  }

  try {
    _autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.warn('[updater] electron-updater not installed:', err.message);
    return;
  }

  _autoUpdater.autoDownload = true;
  _autoUpdater.autoInstallOnAppQuit = true;
  _autoUpdater.allowPrerelease = false;

  _autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }));
  _autoUpdater.on('update-not-available', (info) => setState({ status: 'none', version: info?.version || null }));
  _autoUpdater.on('update-available', (info) => {
    setState({ status: 'available', version: info?.version || null });
    notify('PrintDrop update available', `Downloading v${info?.version || ''} in the background…`);
  });
  _autoUpdater.on('download-progress', (p) => {
    setState({ status: 'downloading', progress: Math.round(p?.percent || 0) });
  });
  _autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'ready', version: info?.version || null, progress: 100 });
    notify('PrintDrop update ready', 'Restart the app to apply the latest version.');
    if (typeof onReady === 'function') onReady(info);
  });
  _autoUpdater.on('error', (err) => {
    setState({ status: 'error', error: err?.message || String(err) });
  });

  // Initial check after a short delay (let the agent start first), then hourly.
  setTimeout(() => checkForUpdates(), 30 * 1000);
  setInterval(() => checkForUpdates(), 60 * 60 * 1000);
}

function checkForUpdates() {
  if (!_autoUpdater) return Promise.resolve({ ok: false, reason: 'not-initialized' });
  try {
    return _autoUpdater.checkForUpdates()
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, reason: err?.message || String(err) }));
  } catch (err) {
    return Promise.resolve({ ok: false, reason: err?.message || String(err) });
  }
}

async function checkAndPromptInstall() {
  if (!_autoUpdater) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Updates',
      message: 'Update checking is only available in packaged builds.',
    });
    return;
  }
  if (_state.status === 'ready') return quitAndInstall();

  setState({ status: 'checking' });
  await checkForUpdates();
}

function quitAndInstall() {
  if (!_autoUpdater) return;
  try {
    _autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    console.error('[updater] quitAndInstall failed:', err.message);
  }
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: true }).show();
}

module.exports = {
  init,
  getState,
  onChange,
  checkForUpdates,
  checkAndPromptInstall,
  quitAndInstall,
};
