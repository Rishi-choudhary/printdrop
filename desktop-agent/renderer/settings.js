'use strict';

let _config = null;
let _detectedPrinters = [];

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Tab navigation
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    });
  });

  // Load initial config + printers
  _config = await window.printdrop.getConfig();
  _detectedPrinters = (await window.printdrop.detectPrinters()).printers || [];
  populatePrinters();
  applyConfig();
  loadSystemInfo();

  // Wire up all save buttons + actions
  wireConnection();
  wirePrinters();
  wirePreferences();
  wireAdvanced();
  wireAbout();
  wireHistory();

  // Reveal-key toggle
  document.getElementById('revealKey').addEventListener('click', () => {
    const input = document.getElementById('agentKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

// ── Load ───────────────────────────────────────────────────────────────────

function applyConfig() {
  if (!_config) return;

  // Connection — auto-correct old localhost configs to the live server
  const rawUrl = _config.apiUrl || '';
  const correctedUrl = (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1'))
    ? 'https://printdrop.app'
    : rawUrl || 'https://printdrop.app';
  document.getElementById('apiUrl').value = correctedUrl;
  document.getElementById('agentKey').value = _config.agentKey || '';

  // Sidebar shop info
  document.getElementById('shopChipName').textContent = _config.shopName || 'Not connected';
  document.getElementById('shopChipStatus').textContent = _config.shopId ? `ID: ${_config.shopId.slice(0, 8)}…` : 'No shop linked';
  document.getElementById('connDot').className = 'shop-chip-dot' + (_config.agentKey ? ' connected' : '');

  // Printers
  const bw = document.getElementById('bwPrinter');
  const col = document.getElementById('colorPrinter');
  if (_config.bwPrinterSystemName) bw.value = _config.bwPrinterSystemName;
  if (_config.colorPrinterSystemName) col.value = _config.colorPrinterSystemName;
  document.getElementById('bwPaperSize').value = _config.bwPaperSize || 'A4';
  document.getElementById('bwDuplex').value = _config.bwDuplex || 'simplex';
  document.getElementById('colorPaperSize').value = _config.colorPaperSize || 'A4';
  document.getElementById('colorDuplex').value = _config.colorDuplex || 'simplex';

  // Preferences — token stamp position (with backwards compat for old coverPage bool)
  const savedPos = _config.tokenStampPosition ||
    (_config.coverPage ? 'front-top-right' : 'none');
  document.getElementById('tokenStampPosition').value = savedPos;
  document.getElementById('prefSounds').checked = _config.soundEnabled !== false;
  document.getElementById('prefAutoStart').checked = _config.autoStart !== false;
  document.getElementById('prefNotifications').checked = _config.notificationsEnabled !== false;

  // Advanced
  document.getElementById('pollInterval').value = Math.round((_config.pollIntervalMs || 4000) / 1000);
  document.getElementById('simulateMode').checked = !!_config.simulateMode;
}

function populatePrinters() {
  const bwSel  = document.getElementById('bwPrinter');
  const colSel = document.getElementById('colorPrinter');
  const detectedEl = document.getElementById('printerListDetected');

  if (_detectedPrinters.length === 0) {
    bwSel.innerHTML  = '<option value="">No printers detected — click Rescan</option>';
    colSel.innerHTML = '<option value="">— No color printer —</option>';
    detectedEl.innerHTML = '<div class="field-hint" style="padding:4px 0; color:var(--warning);">No printers found. Make sure a printer is installed and click Rescan.</div>';
    return;
  }

  const opts = _detectedPrinters
    .map((p) => `<option value="${escAttr(p)}">${escHtml(p)}</option>`)
    .join('');

  bwSel.innerHTML  = opts;
  colSel.innerHTML = `<option value="">— No color printer —</option>${opts}`;

  detectedEl.innerHTML = _detectedPrinters.map((p) => `
    <div style="display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--border);">
      <span style="width:7px;height:7px;border-radius:50%;background:#22c55e;flex-shrink:0;"></span>
      <span style="font-size:12px; color:var(--text-1); flex:1;">${escHtml(p)}</span>
    </div>
  `).join('');
}

async function loadSystemInfo() {
  try {
    const info = await window.printdrop.getSystemInfo();
    document.getElementById('appVersion').textContent = `v${info.version || '1.0.0'}`;
    document.getElementById('infoPlatform').textContent = `${info.platform || '—'} · ${info.arch || ''}`;
    document.getElementById('infoConfigPath').textContent = info.configPath || '—';
    document.getElementById('infoLogPath').textContent = info.logPath || '—';
    renderUpdateStatus(info.updater, info.packaged);
  } catch {}
}

function renderUpdateStatus(u, packaged) {
  const el = document.getElementById('infoUpdateStatus');
  const btn = document.getElementById('checkUpdatesBtn');
  if (!el) return;

  if (!packaged) {
    el.textContent = 'Dev build — updates disabled';
    if (btn) btn.disabled = true;
    return;
  }
  const s = u?.status || 'idle';
  const labels = {
    idle:        'Up to date',
    checking:    'Checking…',
    none:        'Up to date',
    available:   `Downloading v${u?.version || ''}…`,
    downloading: `Downloading… ${u?.progress || 0}%`,
    ready:       `Ready to install v${u?.version || ''}`,
    error:       `Error: ${u?.error || 'check failed'}`,
  };
  el.textContent = labels[s] || 'Unknown';
  if (!btn) return;
  if (s === 'ready') {
    btn.textContent = 'Restart & install';
    btn.disabled = false;
  } else if (s === 'checking' || s === 'downloading') {
    btn.disabled = true;
  } else {
    btn.textContent = 'Check for updates';
    btn.disabled = false;
  }
}

// ── Wire: Connection ───────────────────────────────────────────────────────

function wireConnection() {
  const banner = document.getElementById('connBanner');

  document.getElementById('testConnBtn').addEventListener('click', async () => {
    const agentKey = document.getElementById('agentKey').value.trim();
    const apiUrl   = document.getElementById('apiUrl').value.trim().replace(/\/$/, '');
    if (!agentKey || !apiUrl) return showBanner(banner, 'error', 'Please fill in both fields.');

    showBanner(banner, 'info', 'Testing connection…');
    const result = await window.printdrop.validateKey(agentKey, apiUrl);
    if (!result.ok) return showBanner(banner, 'error', result.error || 'Could not connect.');
    showBanner(banner, 'success', `✓ Connected to ${result.shopName || result.shopId}`);
  });

  document.getElementById('saveConnBtn').addEventListener('click', async () => {
    const agentKey = document.getElementById('agentKey').value.trim();
    const apiUrl   = document.getElementById('apiUrl').value.trim().replace(/\/$/, '');
    if (!agentKey || !apiUrl) return showBanner(banner, 'error', 'Please fill in both fields.');

    showBanner(banner, 'info', 'Validating and saving…');
    const result = await window.printdrop.validateKey(agentKey, apiUrl);
    if (!result.ok) return showBanner(banner, 'error', result.error || 'Could not connect.');

    await window.printdrop.updateConfig({
      agentKey, apiUrl,
      shopId: result.shopId,
      shopName: result.shopName,
    });
    _config = await window.printdrop.getConfig();
    applyConfig();
    showBanner(banner, 'success', '✓ Saved. The agent will restart with the new connection.');
  });
}

// ── Wire: Printers ─────────────────────────────────────────────────────────

function wirePrinters() {
  const banner = document.getElementById('printersBanner');

  document.getElementById('refreshPrintersBtn').addEventListener('click', async () => {
    showBanner(banner, 'info', 'Rescanning printers…');
    _detectedPrinters = (await window.printdrop.detectPrinters()).printers || [];
    populatePrinters();
    applyConfig();
    showBanner(banner, 'success', `✓ Found ${_detectedPrinters.length} printer(s).`);
  });

  document.getElementById('bwTestBtn').addEventListener('click', async () => {
    const printer = document.getElementById('bwPrinter').value;
    if (!printer) return showBanner(banner, 'error', 'Select a B&W printer first.');
    showBanner(banner, 'info', `Sending test to ${printer}…`);
    const r = await window.printdrop.testPrint(printer, false);
    if (r.ok) showBanner(banner, 'success', '✓ Test page sent.');
    else     showBanner(banner, 'error', r.error || 'Test print failed.');
  });

  document.getElementById('colorTestBtn').addEventListener('click', async () => {
    const printer = document.getElementById('colorPrinter').value;
    if (!printer) return showBanner(banner, 'error', 'Select a color printer first.');
    showBanner(banner, 'info', `Sending test to ${printer}…`);
    const r = await window.printdrop.testPrint(printer, true);
    if (r.ok) showBanner(banner, 'success', '✓ Test page sent.');
    else     showBanner(banner, 'error', r.error || 'Test print failed.');
  });

  document.getElementById('savePrintersBtn').addEventListener('click', async () => {
    const bw = document.getElementById('bwPrinter').value;
    const col = document.getElementById('colorPrinter').value;

    if (!bw) return showBanner(banner, 'error', 'Please select a B&W printer.');

    await window.printdrop.updateConfig({
      bwPrinterSystemName: bw,
      bwPrinterDisplayName: bw,
      colorPrinterSystemName: col || null,
      colorPrinterDisplayName: col || null,
      bwPaperSize: document.getElementById('bwPaperSize').value,
      bwDuplex: document.getElementById('bwDuplex').value,
      colorPaperSize: document.getElementById('colorPaperSize').value,
      colorDuplex: document.getElementById('colorDuplex').value,
    });
    showBanner(banner, 'success', '✓ Printer settings saved.');
  });
}

// ── Wire: Preferences ──────────────────────────────────────────────────────

function wirePreferences() {
  const banner = document.getElementById('prefsBanner');

  document.getElementById('savePrefsBtn').addEventListener('click', async () => {
    const stampPos = document.getElementById('tokenStampPosition').value;
    await window.printdrop.updateConfig({
      tokenStampPosition:   stampPos,
      // Keep coverPage in sync for backwards compat with older agent builds
      coverPage:            stampPos !== 'none',
      soundEnabled:         document.getElementById('prefSounds').checked,
      autoStart:            document.getElementById('prefAutoStart').checked,
      notificationsEnabled: document.getElementById('prefNotifications').checked,
    });
    showBanner(banner, 'success', '✓ Preferences saved.');
  });
}

// ── Wire: History ──────────────────────────────────────────────────────────

let _historyJobs = [];

async function loadHistory() {
  const result = await window.printdrop.getHistory().catch(() => ({ jobs: [] }));
  _historyJobs = result.jobs || [];
  renderHistoryTable(_historyJobs);
}

function renderHistoryTable(jobs) {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  const search = (document.getElementById('historySearch')?.value || '').toLowerCase().trim();
  const filtered = jobs.filter((j) => {
    if (!search) return true;
    return `${j.token} ${j.fileName} ${j.printerName || ''}`.toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:24px; text-align:center; color:var(--text-3);">No jobs found</td></tr>`;
    return;
  }

  const statusColors = {
    ready:     { bg: '#dcfce7', color: '#166534' },
    printing:  { bg: '#fef9c3', color: '#854d0e' },
    queued:    { bg: '#dbeafe', color: '#1e40af' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
  };

  tbody.innerHTML = filtered.map((j) => {
    const sc = statusColors[j.status] || { bg: '#f3f4f6', color: '#374151' };
    const time = j.processedAt ? new Date(j.processedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
    return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px 12px; font-weight:700; font-family:monospace;">#${String(j.token).padStart(3,'0')}</td>
        <td style="padding:8px 12px; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escAttr(j.fileName)}">${escHtml(j.fileName)}</td>
        <td style="padding:8px 12px;">${j.pageCount || '—'}</td>
        <td style="padding:8px 12px;">${j.color ? 'Color' : 'B&W'}${j.copies > 1 ? ` ×${j.copies}` : ''}</td>
        <td style="padding:8px 12px; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(j.printerName || '—')}</td>
        <td style="padding:8px 12px;">
          <span style="padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; background:${sc.bg}; color:${sc.color};">
            ${j.status.toUpperCase()}
          </span>
        </td>
        <td style="padding:8px 12px; color:var(--text-3);">${time}</td>
      </tr>
    `;
  }).join('');
}

function wireHistory() {
  document.getElementById('refreshHistoryBtn')?.addEventListener('click', loadHistory);
  document.getElementById('historySearch')?.addEventListener('input', () => {
    renderHistoryTable(_historyJobs);
  });
  // Load when the history tab is first activated
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'history') loadHistory();
    });
  });
}

// ── Wire: Advanced ─────────────────────────────────────────────────────────

function wireAdvanced() {
  document.getElementById('saveAdvancedBtn').addEventListener('click', async () => {
    const pollS = parseInt(document.getElementById('pollInterval').value, 10) || 4;
    await window.printdrop.updateConfig({
      pollIntervalMs: Math.max(1000, pollS * 1000),
      simulateMode: document.getElementById('simulateMode').checked,
    });
    alert('Saved. Restart the agent for poll interval changes to take effect.');
  });

  document.getElementById('openLogsBtn').addEventListener('click', () => window.printdrop.openLog());
  document.getElementById('openConfigBtn').addEventListener('click', () => window.printdrop.openConfigFolder());

  document.getElementById('copyDiagBtn').addEventListener('click', async () => {
    const info = await window.printdrop.getSystemInfo();
    const cfg = await window.printdrop.getConfig();
    const diag = `PrintDrop Diagnostics
---
Version:     v${info.version}
Platform:    ${info.platform} ${info.arch}
Shop:        ${cfg.shopName || 'Not connected'} (${cfg.shopId || '—'})
API URL:     ${cfg.apiUrl}
B&W Printer: ${cfg.bwPrinterSystemName || '—'}
Color Printer: ${cfg.colorPrinterSystemName || '—'}
Config Path: ${info.configPath}
Log Path:    ${info.logPath}
`;
    navigator.clipboard.writeText(diag);
    alert('Diagnostics copied to clipboard.');
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('This will clear all agent settings and re-open setup. Continue?')) return;
    await window.printdrop.resetAgent();
  });
}

// ── Wire: About ────────────────────────────────────────────────────────────

function wireAbout() {
  document.getElementById('linkWebsite').addEventListener('click',   () => window.printdrop.openExternal('https://printdrop.app'));
  document.getElementById('linkHelp').addEventListener('click',      () => window.printdrop.openExternal('https://printdrop.app/help'));
  document.getElementById('linkChangelog').addEventListener('click', () => window.printdrop.openExternal('https://printdrop.app/changelog'));

  document.getElementById('checkUpdatesBtn').addEventListener('click', async () => {
    const state = await window.printdrop.getUpdaterState();
    if (state?.status === 'ready') {
      await window.printdrop.installUpdate();
      return;
    }
    const next = await window.printdrop.checkForUpdates();
    const info = await window.printdrop.getSystemInfo();
    renderUpdateStatus(next || info.updater, info.packaged);
  });

  // Poll updater state every 3s while About tab is visible so the UI reflects
  // background downloads initiated by the hourly auto-check.
  setInterval(async () => {
    const aboutActive = document.querySelector('.tab[data-tab="about"]')?.classList.contains('active');
    if (!aboutActive) return;
    const info = await window.printdrop.getSystemInfo().catch(() => null);
    if (info) renderUpdateStatus(info.updater, info.packaged);
  }, 3000);
}

// ── Utilities ──────────────────────────────────────────────────────────────

function showBanner(el, type, msg) {
  if (!el) return;
  el.className = `banner ${type} show`;
  el.textContent = msg;
}
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
