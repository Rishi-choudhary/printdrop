'use strict';

let _state = null;
let _filter = 'all';
let _search = '';
let _theme = localStorage.getItem('pd-theme') || 'dark';

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(_theme);

  _state = await window.printdrop.getState();
  renderState(_state);

  window.printdrop.onUpdate((state) => {
    _state = state;
    renderState(state);
  });

  window.printdrop.onAgentError(({ message }) => console.error('Agent error:', message));

  // Buttons
  document.getElementById('closeBtn').addEventListener('click', () => window.close());
  document.getElementById('settingsBtn').addEventListener('click', () => window.printdrop.openSettings());
  document.getElementById('footerSettingsBtn').addEventListener('click', () => window.printdrop.openSettings());
  document.getElementById('openLogBtn').addEventListener('click', () => window.printdrop.openLog());
  document.getElementById('quitBtn').addEventListener('click', () => window.printdrop.quit());

  // Theme toggle
  document.getElementById('themeBtn').addEventListener('click', () => {
    _theme = _theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('pd-theme', _theme);
    applyTheme(_theme);
  });

  // Pin toggle
  const pinBtn = document.getElementById('pinBtn');
  pinBtn.addEventListener('click', async () => {
    const result = await window.printdrop.togglePin();
    pinBtn.classList.toggle('active', result.pinned);
    pinBtn.title = result.pinned ? 'Unpin window' : 'Pin window';
  });

  // Search
  document.getElementById('searchInput').addEventListener('input', (e) => {
    _search = e.target.value.toLowerCase().trim();
    renderJobList();
  });

  // Filter chips
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      _filter = chip.dataset.filter;
      renderJobList();
    });
  });
});

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderState(state) {
  if (!state) return;

  // Status
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot' + (state.connected ? ' connected' : ' error');

  document.getElementById('shopName').textContent = state.shopName || 'PrintDrop Agent';
  const shopStatus = document.getElementById('shopStatus');
  shopStatus.textContent = state.connected
    ? (state.lastPollAt ? `Connected · polling every ${Math.round((state.pollIntervalMs || 4000)/1000)}s` : 'Connected')
    : 'Offline — check connection';

  // Stats
  document.getElementById('statPrinted').textContent = state.stats?.printedToday ?? 0;
  document.getElementById('statQueue').textContent = state.stats?.inQueue ?? 0;
  document.getElementById('statFailed').textContent = state.stats?.failedToday ?? 0;

  // Last poll
  const lastPoll = document.getElementById('lastPoll');
  lastPoll.textContent = state.lastPollAt
    ? `Last check ${timeSince(state.lastPollAt)} ago`
    : 'Waiting…';

  renderJobList();
  renderPrinters();
}

function renderJobList() {
  const jobList = document.getElementById('jobList');
  const jobs = (_state?.recentJobs || []).filter(passesFilter);

  if (jobs.length === 0) {
    jobList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="6 9 6 2 18 2 18 9"/>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
          <rect x="6" y="14" width="12" height="8"/>
        </svg>
        <div class="empty-title">${_search || _filter !== 'all' ? 'No jobs match' : 'Waiting for print jobs'}</div>
        <div class="empty-sub">${_search || _filter !== 'all' ? 'Try a different filter' : 'Incoming jobs will appear here'}</div>
      </div>
    `;
    return;
  }

  jobList.innerHTML = jobs.map((job) => {
    const token = String(job.token).padStart(3, '0');
    const metaParts = [
      `${job.pageCount} pg`,
      job.copies > 1 ? `${job.copies}×` : null,
      job.color ? 'Color' : 'B&W',
      job.printerName || null,
    ].filter(Boolean);

    const meta = metaParts.map((p, i) => i === 0
      ? `<span>${escHtml(p)}</span>`
      : `<span class="sep">·</span><span>${escHtml(p)}</span>`
    ).join('');

    return `
      <div class="job-row">
        <div class="job-token">#${escHtml(token)}</div>
        <div class="job-body">
          <div class="job-name">${escHtml(job.fileName)}</div>
          <div class="job-meta">${meta}</div>
        </div>
        <div class="job-badge ${escHtml(job.status)}">${statusLabel(job.status)}</div>
      </div>
    `;
  }).join('');
}

function renderPrinters() {
  const section = document.getElementById('printerSection');
  const printers = _state?.printers || [];

  if (printers.length === 0) { section.innerHTML = ''; return; }

  section.innerHTML = printers.map((p) => `
    <div class="printer-row">
      <span class="printer-dot-mini${p.isOnline ? '' : ' offline'}"></span>
      <span class="printer-row-name">${escHtml(p.displayName || p.systemName)}</span>
      <span class="printer-role">${escHtml((p.role || '').toUpperCase())}</span>
    </div>
  `).join('');
}

function passesFilter(job) {
  if (_filter === 'all') {
    // search still applies
  } else if (_filter === 'printing') {
    if (job.status !== 'printing' && job.status !== 'queued') return false;
  } else if (_filter === 'ready') {
    if (job.status !== 'ready') return false;
  } else if (_filter === 'cancelled') {
    if (job.status !== 'cancelled') return false;
  }

  if (!_search) return true;
  const haystack = `${job.token} ${job.fileName} ${job.printerName || ''}`.toLowerCase();
  return haystack.includes(_search);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusLabel(status) {
  const map = {
    queued: 'QUEUED',
    printing: 'PRINTING',
    ready: 'READY',
    cancelled: 'FAILED',
  };
  return map[status] || String(status).toUpperCase();
}

function timeSince(iso) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Refresh the "last poll" time display every 5 seconds
setInterval(() => {
  if (_state?.lastPollAt) {
    document.getElementById('lastPoll').textContent = `Last check ${timeSince(_state.lastPollAt)} ago`;
  }
}, 5000);
