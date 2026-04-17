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
const PRELOAD = path.join(__dirname, 'preload.js');

// Generate placeholder tray icons if real ones don't exist
function getIcon(name) {
  const iconPath = path.join(__dirname, 'assets', 'icons', name);
  if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath);

  // Create a simple 16×16 (tray) or 64×64 (app) placeholder icon in memory
  const isTray = name.startsWith('tray');
  const size = isTray ? 16 : 64;
  const isActive = name.includes('active');

  // 1-pixel RGBA buffer → resize
  const canvas = nativeImage.createEmpty();

  // Use Electron's built-in to create a colored square
  const buf = Buffer.alloc(size * size * 4);
  const r = isActive ? 34 : 128;
  const g = isActive ? 197 : 128;
  const b = isActive ? 94 : 128;
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

const ICONS = {
  get idle()   { return getIcon('tray-idle.png'); },
  get active() { return getIcon('tray-active.png'); },
  get app()    { return getIcon('icon.png'); },
};

// ── Windows & Tray ────────────────────────────────────────────────────────────
let tray = null;
let setupWin = null;
let dashboardWin = null;
let agentStarted = false;
let dashboardPinned = false;

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
  tray = new Tray(ICONS.idle);
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
  tray.setImage(ICONS[state] || ICONS.idle);
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

  // Open DevTools in dev mode to debug issues
  if (process.env.NODE_ENV === 'development') {
    setupWin.webContents.openDevTools({ mode: 'detach' });
  }

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
  dashboardWin.on('blur', () => { if (!dashboardPinned) dashboardWin?.hide(); });
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
    console.log('[wizard:validate-key] Called with apiUrl:', apiUrl, 'keyLength:', agentKey?.length);
    try {
      const url = `${apiUrl}/api/printers/heartbeat`;
      console.log('[wizard:validate-key] POSTing to', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentKey}`,
        },
        body: JSON.stringify({ printers: [] }),
      });
      console.log('[wizard:validate-key] Response status:', res.status);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.log('[wizard:validate-key] Error body:', body);
        return { ok: false, error: `Invalid agent key (${res.status})` };
      }
      const data = await res.json();
      console.log('[wizard:validate-key] Success:', JSON.stringify(data));
      return { ok: true, shopId: data.shopId, shopName: data.shopName || '' };
    } catch (err) {
      console.error('[wizard:validate-key] Error:', err.message);
      return { ok: false, error: `Connection failed: ${err.message}` };
    }
  });

  ipcMain.handle('wizard:detect-printers', async () => {
    const { getAvailablePrinters } = require('./src/printer');
    try {
      const printers = await getAvailablePrinters();
      // In dev mode with no real printers, add virtual ones for testing
      if (printers.length === 0 && process.env.NODE_ENV === 'development') {
        printers.push('Virtual_BW_Printer (Dev)', 'Virtual_Color_Printer (Dev)');
      }
      return { printers };
    } catch (err) {
      return { printers: [], error: err.message };
    }
  });

  ipcMain.handle('wizard:test-print', async (_e, { agentKey: key, apiUrl }) => {
    try {
      // Get shopId from heartbeat
      const hbRes = await fetch(`${apiUrl}/api/printers/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ printers: [] }),
      });
      if (!hbRes.ok) return { ok: false, error: `Auth failed (${hbRes.status})` };
      const hbData = await hbRes.json();
      const shopId = hbData.shopId;
      if (!shopId) return { ok: false, error: 'Could not determine shop ID' };

      // Create test print job
      const tpRes = await fetch(`${apiUrl}/api/shops/${shopId}/test-print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({}),
      });
      if (!tpRes.ok) {
        const body = await tpRes.text().catch(() => '');
        return { ok: false, error: `Failed to create test job: ${body}` };
      }
      const tpData = await tpRes.json();
      return { ok: true, jobId: tpData.job?.id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('wizard:check-job', async (_e, { jobId, agentKey: key, apiUrl }) => {
    try {
      const res = await fetch(`${apiUrl}/api/jobs/${jobId}`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return { status: 'unknown' };
      const job = await res.json();
      return { status: job.status };
    } catch {
      return { status: 'unknown' };
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

  ipcMain.handle('dashboard:toggle-pin', () => {
    dashboardPinned = !dashboardPinned;
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      dashboardWin.setAlwaysOnTop(dashboardPinned);
    }
    return { pinned: dashboardPinned };
  });

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
