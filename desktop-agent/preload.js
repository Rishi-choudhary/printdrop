'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes a safe `window.printdrop` API to renderer pages.
 * No direct Node.js access is given to the renderer.
 */
contextBridge.exposeInMainWorld('printdrop', {
  // ── Setup wizard ──────────────────────────────────────────────────────────

  validateKey: (agentKey, apiUrl) =>
    ipcRenderer.invoke('wizard:validate-key', { agentKey, apiUrl }),

  detectPrinters: () =>
    ipcRenderer.invoke('wizard:detect-printers'),

  saveConfig: (cfg) =>
    ipcRenderer.invoke('wizard:save-config', cfg),

  testPrint: (printerName, color) =>
    ipcRenderer.invoke('wizard:test-print', { printerName, color }),

  // ── Dashboard ─────────────────────────────────────────────────────────────

  getState: () =>
    ipcRenderer.invoke('dashboard:get-state'),

  onUpdate: (cb) => {
    ipcRenderer.on('dashboard:update', (_event, state) => cb(state));
  },

  onAgentError: (cb) => {
    ipcRenderer.on('agent:error', (_event, data) => cb(data));
  },

  togglePin: () =>
    ipcRenderer.invoke('dashboard:toggle-pin'),

  // ── Settings ──────────────────────────────────────────────────────────────

  getConfig: () =>
    ipcRenderer.invoke('settings:get-config'),

  updateConfig: (updates) =>
    ipcRenderer.invoke('settings:update-config', updates),

  getSystemInfo: () =>
    ipcRenderer.invoke('settings:get-system-info'),

  resetAgent: () =>
    ipcRenderer.invoke('settings:reset-agent'),

  // ── Updater ───────────────────────────────────────────────────────────────

  checkForUpdates: () =>
    ipcRenderer.invoke('updater:check'),

  installUpdate: () =>
    ipcRenderer.invoke('updater:install'),

  getUpdaterState: () =>
    ipcRenderer.invoke('updater:get-state'),

  // ── App actions ───────────────────────────────────────────────────────────

  openLog: () =>
    ipcRenderer.invoke('app:open-log'),

  openConfigFolder: () =>
    ipcRenderer.invoke('app:open-config-folder'),

  openSetup: () =>
    ipcRenderer.invoke('app:open-setup'),

  openSettings: () =>
    ipcRenderer.invoke('app:open-settings'),

  openExternal: (url) =>
    ipcRenderer.invoke('app:open-external', { url }),

  quit: () =>
    ipcRenderer.invoke('app:quit'),

  toggleAutoStart: (enabled) =>
    ipcRenderer.invoke('app:toggle-autostart', { enabled }),
});
