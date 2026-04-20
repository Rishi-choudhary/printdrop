'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  Notification,
  shell,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Prevent multiple instances ────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Local modules (require after single-instance check) ───────────────────────
const config = require('./src/config');
const agent = require('./src/agent');
const updater = require('./src/updater');
const { playSound } = require('./src/sounds');

// ── Paths ─────────────────────────────────────────────────────────────────────
const PRELOAD = path.join(__dirname, 'preload.js');

// ── Icon generation ───────────────────────────────────────────────────────────
// Fall back to procedurally-drawn SVG icons when real asset files are missing.
// On macOS we render a monochrome template icon (auto-tinted to match the
// menu-bar theme); on Windows/Linux we render the full-color brand mark.

const IS_MAC = process.platform === 'darwin';

function renderTraySvg(state) {
  // Template icons on macOS must be black on transparent. The OS applies the
  // correct fill (white in dark menu bar, black in light).
  if (IS_MAC) {
    const badge = state === 'active'
      ? '<circle cx="14" cy="4" r="3" fill="#000"/>'
      : state === 'error'
      ? '<path d="M13 3l3 3M16 3l-3 3" stroke="#000" stroke-width="1.5" stroke-linecap="round"/>'
      : '';
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18">
        <path d="M4.5 7h9v2.5h-9z M5.5 9.5h7v4h-7z M6 5h6v2H6z"
              stroke="#000" stroke-width="1.1" stroke-linejoin="round" fill="none"/>
        ${badge}
      </svg>
    `.trim();
  }

  const bg = state === 'error' ? '#ef4444' : state === 'active' ? '#4f8ef7' : '#64748b';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">
      <rect width="32" height="32" rx="7" fill="${bg}"/>
      <path d="M10 11h12v5H10z M12 16h8v7h-8z M13 7h6v4h-6z"
            stroke="#fff" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
      ${state === 'active' ? '<circle cx="22" cy="22" r="4" fill="#22c55e" stroke="#fff" stroke-width="1.5"/>' : ''}
    </svg>
  `.trim();
}

function renderAppSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4f8ef7"/>
          <stop offset="1" stop-color="#2563eb"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#bg)"/>
      <g fill="#fff">
        <rect x="92" y="56" width="72" height="32" rx="4"/>
        <rect x="62" y="88" width="132" height="60" rx="8"/>
        <rect x="92" y="144" width="72" height="60" rx="4"/>
      </g>
      <rect x="108" y="160" width="40" height="5" rx="2" fill="#4f8ef7"/>
      <rect x="108" y="174" width="30" height="5" rx="2" fill="#93c5fd"/>
      <rect x="108" y="188" width="36" height="5" rx="2" fill="#93c5fd"/>
      <circle cx="178" cy="104" r="6" fill="#22c55e"/>
    </svg>
  `.trim();
}

function svgToImage(svg) {
  const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  return img;
}

function buildTrayImage(state) {
  // Prefer a real PNG if the operator has dropped one in place.
  const real = path.join(__dirname, 'assets', 'icons', `tray-${state}.png`);
  if (fs.existsSync(real)) {
    const img = nativeImage.createFromPath(real);
    if (IS_MAC) img.setTemplateImage(true);
    return img;
  }
  const img = svgToImage(renderTraySvg(state));
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

function buildAppImage() {
  const real = path.join(__dirname, 'assets', 'icons', 'icon.png');
  if (fs.existsSync(real)) return nativeImage.createFromPath(real);
  return svgToImage(renderAppSvg());
}

const ICONS = {
  get idle()   { return buildTrayImage('idle'); },
  get active() { return buildTrayImage('active'); },
  get error()  { return buildTrayImage('error'); },
  get app()    { return buildAppImage(); },
};

// ── Windows & Tray ────────────────────────────────────────────────────────────
let tray = null;
let setupWin = null;
let dashboardWin = null;
let settingsWin = null;
let agentStarted = false;
let dashboardPinned = false;

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide();

  const cfg = config.load();

  initTray();
  registerIpcHandlers();

  if (!cfg.setupComplete || !cfg.agentKey) {
    openSetupWindow();
  } else {
    startAgent(cfg);
  }

  updater.init({ onReady: () => rebuildTrayMenu() });
  updater.onChange(() => {
    rebuildTrayMenu();
    broadcastDashboard();
  });
});

app.on('window-all-closed', () => {
  // Stay alive in tray.
});

app.on('second-instance', () => {
  showDashboard();
});

// ── Tray ──────────────────────────────────────────────────────────────────────

function initTray() {
  tray = new Tray(ICONS.idle);
  tray.setToolTip('PrintDrop Agent');

  // Left-click → toggle the dashboard popup on all platforms.
  // On macOS, setContextMenu prevents the click event from firing, so we
  // never call setContextMenu there. Instead we pop the menu on right-click.
  tray.on('click',        () => toggleDashboard());
  tray.on('double-click', () => toggleDashboard());
  tray.on('right-click',  () => tray.popUpContextMenu(buildTrayMenu()));

  if (!IS_MAC) {
    // Windows / Linux: context menu also appears on the standard right-click
    // interaction via setContextMenu so users familiar with that pattern still
    // get the menu. popUpContextMenu above is the fallback / explicit path.
    tray.setContextMenu(buildTrayMenu());
  }
}

function rebuildTrayMenu() {
  if (!IS_MAC && tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu());
  }
}

function buildTrayMenu() {
  const cfg = config.load();
  const u = updater.getState();

  const updateEntry = (() => {
    if (u.status === 'ready') {
      return { label: `Restart to update to v${u.version}`, click: () => updater.quitAndInstall() };
    }
    if (u.status === 'downloading') {
      return { label: `Downloading update… ${u.progress}%`, enabled: false };
    }
    if (u.status === 'available') {
      return { label: `Update available (v${u.version})`, enabled: false };
    }
    return { label: 'Check for Updates…', click: () => updater.checkAndPromptInstall() };
  })();

  return Menu.buildFromTemplate([
    { label: `PrintDrop Agent v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Dashboard', click: showDashboard },
    { label: 'Settings…',     click: openSettingsWindow },
    { type: 'separator' },
    updateEntry,
    {
      label: 'Open Log File',
      click: () => shell.openPath(path.join(app.getPath('userData'), 'logs', 'agent.log')),
    },
    {
      label: 'Show Config Folder',
      click: () => shell.openPath(app.getPath('userData')),
    },
    { type: 'separator' },
    {
      label: 'Run at Startup',
      type: 'checkbox',
      checked: cfg.autoStart !== false,
      click: (menuItem) => setAutoStart(menuItem.checked),
    },
    { type: 'separator' },
    { label: 'Quit PrintDrop', click: () => app.quit() },
  ]);
}

function setTrayIcon(state) {
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(ICONS[state] || ICONS.idle);
  refreshTrayTooltip(state);
}

function refreshTrayTooltip(state) {
  if (!tray || tray.isDestroyed()) return;
  const s = agent.getState?.() || {};
  const queued = Array.isArray(s.jobs) ? s.jobs.filter((j) => j.status !== 'done' && j.status !== 'failed').length : 0;
  const tail = queued > 0 ? ` · ${queued} in queue` : '';
  const labels = {
    active: `PrintDrop — Printing…${tail}`,
    error:  'PrintDrop — Error: check agent key',
    idle:   `PrintDrop Agent${tail}`,
  };
  tray.setToolTip(labels[state] || labels.idle);
  // On macOS we can show the queue count as a text badge next to the icon.
  if (IS_MAC && tray.setTitle) {
    tray.setTitle(queued > 0 ? ` ${queued}` : '');
  }
}

// ── Setup window ──────────────────────────────────────────────────────────────

function openSetupWindow() {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.focus();
    return;
  }

  setupWin = new BrowserWindow({
    width: 860,
    height: 620,
    resizable: false,
    title: 'PrintDrop Setup',
    icon: ICONS.app,
    backgroundColor: '#f6f7fb',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupWin.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWin.once('ready-to-show', () => setupWin.show());
  setupWin.on('closed', () => { setupWin = null; });

  if (process.env.NODE_ENV === 'development') {
    setupWin.webContents.openDevTools({ mode: 'detach' });
  }

  setupWin.setMenuBarVisibility(false);
}

// ── Settings window ───────────────────────────────────────────────────────────

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 860,
    height: 620,
    title: 'PrintDrop Settings',
    resizable: true,
    minWidth: 720,
    minHeight: 520,
    icon: ICONS.app,
    backgroundColor: '#f6f7fb',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
  settingsWin.setMenuBarVisibility(false);
}

// ── Dashboard window ──────────────────────────────────────────────────────────

function createDashboardWindow() {
  dashboardWin = new BrowserWindow({
    width: 420,
    height: 580,
    resizable: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    icon: ICONS.app,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dashboardWin.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));
  dashboardWin.on('blur', () => {
    if (!dashboardPinned && dashboardWin && !dashboardWin.isDestroyed()) dashboardWin.hide();
  });
  dashboardWin.on('closed', () => { dashboardWin = null; });
}

function showDashboard() {
  if (!dashboardWin || dashboardWin.isDestroyed()) createDashboardWindow();

  const bounds = tray?.getBounds();
  if (bounds) {
    const winBounds = dashboardWin.getBounds();
    const x = Math.round(bounds.x + bounds.width / 2 - winBounds.width / 2);
    const y = process.platform === 'darwin'
      ? bounds.y + bounds.height + 4
      : bounds.y - winBounds.height - 4;
    dashboardWin.setPosition(x, Math.max(0, y));
  }

  dashboardWin.show();
  dashboardWin.focus();
}

function toggleDashboard() {
  if (dashboardWin && !dashboardWin.isDestroyed() && dashboardWin.isVisible()) {
    dashboardWin.hide();
  } else {
    showDashboard();
  }
}

function broadcastDashboard() {
  if (!dashboardWin || dashboardWin.isDestroyed()) return;
  const state = agent.getState();
  state.pollIntervalMs = config.load().pollIntervalMs;
  dashboardWin.webContents.send('dashboard:update', state);
}

// ── Agent startup ─────────────────────────────────────────────────────────────

function startAgent(cfg) {
  if (agentStarted) return;
  agentStarted = true;

  agent.start(cfg, {
    onJobNew: (job) => {
      if (cfg.soundEnabled) playSound('new-job');
      if (cfg.notificationsEnabled !== false) {
        notify(`New Print Job #${String(job.token).padStart(3, '0')}`,
          `${job.fileName} — ${job.pageCount} pages, ${job.color ? 'Color' : 'B&W'}`);
      }
      setTrayIcon('active');
      broadcastDashboard();
    },
    onJobDone: (job) => {
      if (cfg.soundEnabled) playSound('job-done');
      const printer = job.color
        ? cfg.colorPrinterDisplayName || cfg.colorPrinterSystemName
        : cfg.bwPrinterDisplayName || cfg.bwPrinterSystemName;
      if (cfg.notificationsEnabled !== false) {
        notify(`Ready for Pickup — Token #${String(job.token).padStart(3, '0')}`,
          `${job.fileName} printed on ${printer}`);
      }
      if (!agent.hasInFlight()) setTrayIcon('idle');
      broadcastDashboard();
    },
    onJobError: (job) => {
      if (cfg.soundEnabled) playSound('job-error');
      if (cfg.notificationsEnabled !== false) {
        notify('Print Error', `Job #${String(job.token).padStart(3, '0')} could not be printed`);
      }
      if (!agent.hasInFlight()) setTrayIcon('idle');
      broadcastDashboard();
    },
    onHeartbeat: () => {
      refreshTrayTooltip(agent.hasInFlight() ? 'active' : 'idle');
      broadcastDashboard();
    },
    onAuthFail: () => {
      setTrayIcon('error');
      tray?.setToolTip('PrintDrop — Auth Error: check agent key');
      broadcastDashboard();
    },
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const iconPath = path.join(__dirname, 'assets', 'icons', 'icon.png');
  const opts = { title, body, silent: true };
  if (fs.existsSync(iconPath)) opts.icon = iconPath;
  new Notification(opts).show();
}

// ── Auto-launch ───────────────────────────────────────────────────────────────

async function setAutoStart(enabled) {
  try {
    const AutoLaunch = require('auto-launch');
    const launcher = new AutoLaunch({ name: 'PrintDrop Agent', path: app.getPath('exe') });
    const isEnabled = await launcher.isEnabled();
    if (enabled && !isEnabled) await launcher.enable();
    if (!enabled && isEnabled) await launcher.disable();
    config.save({ autoStart: enabled });
    rebuildTrayMenu();
  } catch (err) {
    console.error('AutoLaunch toggle failed:', err.message);
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Wizard ──────────────────────────────────────────────────────────────

  ipcMain.handle('wizard:validate-key', async (_e, { agentKey, apiUrl }) => {
    try {
      const url = `${apiUrl}/api/printers/heartbeat`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentKey}`,
        },
        body: JSON.stringify({ printers: [] }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let msg = `Server returned ${res.status}`;
        if (res.status === 401) msg = 'Invalid agent key — check the key is correct and not expired.';
        else if (res.status === 403) msg = 'Agent key does not match this shop.';
        else if (res.status >= 500) msg = `Server error (${res.status}) — check backend logs. ${body.slice(0, 120)}`;
        return { ok: false, error: msg };
      }
      const data = await res.json();
      return { ok: true, shopId: data.shopId, shopName: data.shopName || '' };
    } catch (err) {
      return { ok: false, error: `Connection failed: ${err.message}` };
    }
  });

  ipcMain.handle('wizard:detect-printers', async () => {
    const { getAvailablePrinters } = require('./src/printer');
    try {
      const printers = await getAvailablePrinters();
      if (printers.length === 0 && process.env.NODE_ENV === 'development') {
        printers.push('Virtual_BW_Printer (Dev)', 'Virtual_Color_Printer (Dev)');
      }
      return { printers };
    } catch (err) {
      return { printers: [], error: err.message };
    }
  });

  ipcMain.handle('wizard:test-print', async (_e, { printerName, color }) => {
    try {
      const { printTestPage } = require('./src/printer');
      const result = await printTestPage(printerName, color);
      return { ok: true, output: result.output };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('wizard:save-config', async (_e, cfg) => {
    config.save({ ...cfg, setupComplete: true });

    if (cfg.autoStart !== undefined) {
      await setAutoStart(cfg.autoStart).catch(() => {});
    }

    rebuildTrayMenu();

    if (!agentStarted) startAgent(config.load());

    if (setupWin && !setupWin.isDestroyed()) setupWin.close();

    notify('PrintDrop Ready', `Connected to ${cfg.shopName || 'your shop'} and listening for jobs`);
    return { ok: true };
  });

  // ── Dashboard ──────────────────────────────────────────────────────────

  ipcMain.handle('dashboard:get-state', () => {
    const state = agent.getState();
    state.pollIntervalMs = config.load().pollIntervalMs;
    return state;
  });

  ipcMain.handle('dashboard:get-history', () => {
    const state = agent.getState();
    // Return all 50 recent jobs (not just the 20 sent to the live dashboard)
    return { jobs: state.recentJobs || [] };
  });

  ipcMain.handle('dashboard:toggle-pin', () => {
    dashboardPinned = !dashboardPinned;
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      dashboardWin.setAlwaysOnTop(dashboardPinned);
    }
    return { pinned: dashboardPinned };
  });

  // ── Settings ───────────────────────────────────────────────────────────

  ipcMain.handle('settings:get-config', () => {
    const cfg = config.load();
    // Send real key to settings (it's a local machine — user expects to see/edit it)
    return { ...cfg };
  });

  ipcMain.handle('settings:update-config', async (_e, updates) => {
    // If autoStart is being toggled, sync with OS
    if (Object.prototype.hasOwnProperty.call(updates, 'autoStart')) {
      await setAutoStart(updates.autoStart).catch(() => {});
    }
    config.save(updates);
    rebuildTrayMenu();
    broadcastDashboard();
    return { ok: true };
  });

  ipcMain.handle('settings:get-system-info', () => ({
    version: app.getVersion(),
    platform: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux',
    arch: process.arch,
    configPath: path.join(app.getPath('userData'), 'config.json'),
    logPath: path.join(app.getPath('userData'), 'logs', 'agent.log'),
    osRelease: os.release(),
    updater: updater.getState(),
    packaged: app.isPackaged,
  }));

  ipcMain.handle('updater:check', async () => {
    await updater.checkAndPromptInstall();
    return updater.getState();
  });

  ipcMain.handle('updater:install', () => {
    updater.quitAndInstall();
    return { ok: true };
  });

  ipcMain.handle('updater:get-state', () => updater.getState());

  ipcMain.handle('settings:reset-agent', async () => {
    try {
      // Stop the agent and wipe config
      try { agent.stop?.(); } catch {}
      agentStarted = false;

      const cfgPath = path.join(app.getPath('userData'), 'config.json');
      if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);

      // Close settings and reopen setup
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();

      // Force-reload in-memory config
      config.save({ setupComplete: false, agentKey: '' });
      openSetupWindow();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── App actions ────────────────────────────────────────────────────────

  ipcMain.handle('app:open-log', () => {
    const logPath = path.join(app.getPath('userData'), 'logs', 'agent.log');
    return shell.openPath(logPath);
  });

  ipcMain.handle('app:open-config-folder', () => {
    return shell.openPath(app.getPath('userData'));
  });

  ipcMain.handle('app:open-setup', () => openSetupWindow());
  ipcMain.handle('app:open-settings', () => openSettingsWindow());

  ipcMain.handle('app:open-external', (_e, { url }) => {
    // Only allow http/https
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    return shell.openExternal(url);
  });

  ipcMain.handle('app:quit', () => app.quit());

  ipcMain.handle('app:toggle-autostart', async (_e, { enabled }) => {
    await setAutoStart(enabled);
    return { ok: true };
  });
}
