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

  testPrint: (agentKey, apiUrl) =>
    ipcRenderer.invoke('wizard:test-print', { agentKey, apiUrl }),

  checkJob: (jobId, agentKey, apiUrl) =>
    ipcRenderer.invoke('wizard:check-job', { jobId, agentKey, apiUrl }),

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

  // ── App actions ───────────────────────────────────────────────────────────

  openLog: () =>
    ipcRenderer.invoke('app:open-log'),

  openSetup: () =>
    ipcRenderer.invoke('app:open-setup'),

  quit: () =>
    ipcRenderer.invoke('app:quit'),

  toggleAutoStart: (enabled) =>
    ipcRenderer.invoke('app:toggle-autostart', { enabled }),

  getConfig: () =>
    ipcRenderer.invoke('config:get'),
});
