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

// ── Prevent multiple instances ────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Local modules (require after single-instance check) ───────────────────────
const config = require('./src/config');
const agent = require('./src/agent');
const { playSound } = require('./src/sounds');

// ── Paths ─────────────────────────────────────────────────────────────────────
const ICONS = {
  idle:   path.join(__dirname, 'assets', 'icons', 'tray-idle.png'),
  active: path.join(__dirname, 'assets', 'icons', 'tray-active.png'),
  app:    path.join(__dirname, 'assets', 'icons', 'icon.png'),
};
const PRELOAD = path.join(__dirname, 'preload.js');

// ── Windows & Tray ────────────────────────────────────────────────────────────
let tray = null;
let setupWin = null;
let dashboardWin = null;
let agentStarted = false;

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // macOS: don't show in Dock
  if (process.platform === 'darwin') app.dock?.hide();

  const cfg = config.load();

  initTray();
  registerIpcHandlers();

  if (!cfg.setupComplete || !cfg.agentKey) {
    openSetupWindow();
  } else {
    startAgent(cfg);
  }
});

// Keep app alive when all windows close (lives in tray)
app.on('window-all-closed', (e) => {
  // Do nothing — the app stays running in the system tray
});

app.on('second-instance', () => {
  // If user launches the app again, show the dashboard
  showDashboard();
});

// ── Tray ──────────────────────────────────────────────────────────────────────

function initTray() {
  const icon = nativeImage.createFromPath(ICONS.idle);
  tray = new Tray(icon);
  tray.setToolTip('PrintDrop Agent');

  rebuildTrayMenu();

  tray.on('click', () => toggleDashboard());
  tray.on('double-click', () => toggleDashboard()); // macOS
}

function rebuildTrayMenu() {
  const cfg = config.load();
  const menu = Menu.buildFromTemplate([
    { label: 'PrintDrop Agent', enabled: false },
    { type: 'separator' },
    { label: 'Open Dashboard', click: showDashboard },
    {
      label: 'Open Log File',
      click: () => shell.openPath(path.join(app.getPath('userData'), 'logs', 'agent.log')),
    },
    { type: 'separator' },
    {
      label: 'Run at Startup',
      type: 'checkbox',
      checked: cfg.autoStart || false,
      click: (menuItem) => setAutoStart(menuItem.checked),
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      click: openSetupWindow,
    },
    { type: 'separator' },
    { label: 'Quit PrintDrop', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function setTrayIcon(state) {
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(nativeImage.createFromPath(ICONS[state] || ICONS.idle));
  tray.setToolTip(
    state === 'active' ? 'PrintDrop — Printing…' : 'PrintDrop Agent',
  );
}

// ── Setup window ──────────────────────────────────────────────────────────────

function openSetupWindow() {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.focus();
    return;
  }

  setupWin = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    title: 'PrintDrop Agent Setup',
    icon: ICONS.app,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupWin.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWin.on('closed', () => { setupWin = null; });

  // Remove default menu bar
  setupWin.setMenuBarVisibility(false);
}

// ── Dashboard window ──────────────────────────────────────────────────────────

function createDashboardWindow() {
  dashboardWin = new BrowserWindow({
    width: 380,
    height: 500,
    resizable: false,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    icon: ICONS.app,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dashboardWin.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));
  dashboardWin.on('blur', () => dashboardWin?.hide());
  dashboardWin.on('closed', () => { dashboardWin = null; });
}

function showDashboard() {
  if (!dashboardWin || dashboardWin.isDestroyed()) createDashboardWindow();

  // Position above tray icon
  const bounds = tray?.getBounds();
  if (bounds) {
    const winBounds = dashboardWin.getBounds();
    const x = Math.round(bounds.x + bounds.width / 2 - winBounds.width / 2);
    const y = process.platform === 'darwin'
      ? bounds.y + bounds.height + 4          // macOS: menu bar at top
      : bounds.y - winBounds.height - 4;      // Windows: taskbar at bottom
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
  dashboardWin.webContents.send('dashboard:update', agent.getState());
}

// ── Agent startup ─────────────────────────────────────────────────────────────

function startAgent(cfg) {
  if (agentStarted) return;
  agentStarted = true;

  agent.start(cfg, {
    onJobNew: (job) => {
      if (cfg.soundEnabled) playSound('new-job');
      notify(`New Print Job #${String(job.token).padStart(3, '0')}`,
        `${job.fileName} — ${job.pageCount} pages, ${job.color ? 'Color' : 'B&W'}`);
      setTrayIcon('active');
      broadcastDashboard();
    },
    onJobDone: (job) => {
      if (cfg.soundEnabled) playSound('job-done');
      const printer = job.color
        ? cfg.colorPrinterDisplayName || cfg.colorPrinterSystemName
        : cfg.bwPrinterDisplayName || cfg.bwPrinterSystemName;
      notify(`Ready for Pickup — Token #${String(job.token).padStart(3, '0')}`,
        `${job.fileName} printed on ${printer}`);
      if (!agent.hasInFlight()) setTrayIcon('idle');
      broadcastDashboard();
    },
    onJobError: (job) => {
      if (cfg.soundEnabled) playSound('job-error');
      notify('Print Error', `Job #${String(job.token).padStart(3, '0')} could not be printed`);
      if (!agent.hasInFlight()) setTrayIcon('idle');
      broadcastDashboard();
    },
    onHeartbeat: () => {
      broadcastDashboard();
    },
    onAuthFail: () => {
      setTrayIcon('idle');
      tray?.setToolTip('PrintDrop — Auth Error: check agent key');
      broadcastDashboard();
    },
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: ICONS.app, silent: true }).show();
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
        return { ok: false, error: `Invalid agent key (${res.status})` };
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
      return { printers };
    } catch (err) {
      return { printers: [], error: err.message };
    }
  });

  ipcMain.handle('wizard:save-config', async (_e, cfg) => {
    config.save({ ...cfg, setupComplete: true });

    // Enable/disable auto-start as requested
    if (cfg.autoStart !== undefined) {
      await setAutoStart(cfg.autoStart).catch(() => {});
    }

    rebuildTrayMenu();

    // Start the agent with the new config
    if (!agentStarted) {
      startAgent(config.load());
    }

    // Close setup window
    if (setupWin && !setupWin.isDestroyed()) setupWin.close();

    notify('PrintDrop Ready', `Connected to ${cfg.shopName || 'your shop'} and listening for jobs`);
    return { ok: true };
  });

  // ── Dashboard ──────────────────────────────────────────────────────────

  ipcMain.handle('dashboard:get-state', () => {
    return agent.getState();
  });

  // ── App actions ────────────────────────────────────────────────────────

  ipcMain.handle('app:open-log', () => {
    const logPath = path.join(app.getPath('userData'), 'logs', 'agent.log');
    shell.openPath(logPath);
  });

  ipcMain.handle('app:open-setup', () => {
    openSetupWindow();
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  ipcMain.handle('app:toggle-autostart', async (_e, { enabled }) => {
    await setAutoStart(enabled);
    return { ok: true };
  });

  ipcMain.handle('config:get', () => {
    const cfg = config.load();
    // Mask the agent key for display
    return { ...cfg, agentKey: cfg.agentKey ? '●'.repeat(16) : '' };
  });
}
