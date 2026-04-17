'use strict';

// ── Initialise ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Load initial state
  const state = await window.printdrop.getState();
  renderState(state);

  // Subscribe to live updates from the main process
  window.printdrop.onUpdate((state) => renderState(state));

  // Error banner
  window.printdrop.onAgentError(({ message }) => {
    console.error('Agent error:', message);
  });

  // Wire up buttons (no inline onclick — CSP blocks them)
  document.getElementById('settingsBtn').addEventListener('click', () => window.printdrop.openSetup());
  document.getElementById('closeBtn').addEventListener('click', () => window.close());
  document.getElementById('openLogBtn').addEventListener('click', () => window.printdrop.openLog());
  document.getElementById('footerSettingsBtn').addEventListener('click', () => window.printdrop.openSetup());
  document.getElementById('quitBtn').addEventListener('click', () => window.printdrop.quit());

  // Pin toggle
  const pinBtn = document.getElementById('pinBtn');
  pinBtn.addEventListener('click', async () => {
    const result = await window.printdrop.togglePin();
    pinBtn.textContent = result.pinned ? '📍' : '📌';
    pinBtn.title = result.pinned ? 'Unpin window' : 'Pin window';
  });
});

function closeWindow() {
  // The window hides on blur automatically; this is just an extra close button
  window.close();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderState(state) {
  if (!state) return;

  // Connection status
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot' + (state.connected ? ' connected' : '');

  const shopName = document.getElementById('shopName');
  shopName.textContent = state.shopName || 'PrintDrop Agent';

  const lastPoll = document.getElementById('lastPoll');
  lastPoll.textContent = state.lastPollAt ? `${timeSince(state.lastPollAt)} ago` : '—';

  // Stats
  document.getElementById('statPrinted').textContent = state.stats?.printedToday ?? 0;
  document.getElementById('statQueue').textContent = state.stats?.inQueue ?? 0;
  document.getElementById('statFailed').textContent = state.stats?.failedToday ?? 0;

  // Jobs list
  const jobList = document.getElementById('jobList');
  const jobs = state.recentJobs || [];

  if (jobs.length === 0) {
    jobList.innerHTML = '<div class="empty-msg">No jobs yet. Waiting for print jobs…</div>';
  } else {
    jobList.innerHTML = jobs.map((job) => {
      const token = `#${String(job.token).padStart(3, '0')}`;
      const mode = `${job.color ? 'Color' : 'B&W'} · ${job.copies}× · ${job.pageCount}pg`;
      const printer = job.printerName || '';
      return `
        <div class="job-row">
          <div class="job-dot ${escHtml(job.status)}"></div>
          <div class="job-info">
            <div class="job-name">${token} ${escHtml(job.fileName)}</div>
            <div class="job-meta">${escHtml(mode)}${printer ? ' · ' + escHtml(printer) : ''}</div>
          </div>
          <div class="job-status ${escHtml(job.status)}">${statusLabel(job.status)}</div>
        </div>
      `;
    }).join('');
  }

  // Printers
  const printerSection = document.getElementById('printerSection');
  const printers = state.printers || [];
  if (printers.length === 0) {
    printerSection.innerHTML = '';
  } else {
    printerSection.innerHTML = `
      <div class="section-title" style="padding:6px 0 4px">Printers</div>
      ${printers.map((p) => `
        <div class="printer-row">
          <span class="printer-dot${p.isOnline ? '' : ' offline'}"></span>
          <span>${escHtml(p.displayName || p.systemName)}</span>
          <span style="margin-left:auto;font-size:10px;color:${p.isOnline ? '#22c55e' : '#ef4444'}">${p.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
      `).join('')}
    `;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusLabel(status) {
  const map = {
    queued: 'QUEUED',
    printing: 'PRINTING',
    ready: 'READY',
    cancelled: 'FAILED',
  };
  return map[status] || status.toUpperCase();
}

function timeSince(isoString) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Refresh the "time since" counters every 10 seconds
setInterval(async () => {
  const state = await window.printdrop.getState();
  const lastPoll = document.getElementById('lastPoll');
  if (state?.lastPollAt) {
    lastPoll.textContent = `${timeSince(state.lastPollAt)} ago`;
  }
}, 10_000);
