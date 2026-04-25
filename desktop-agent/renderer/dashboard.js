'use strict';

let _state = null;
let _filter = 'all';
let _search = '';
let _theme = localStorage.getItem('pd-theme') || 'dark';
let _actionInProgress = null; // job ID currently being acted on

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

  // Mode toggle
  document.getElementById('modeBtn').addEventListener('click', async () => {
    const nextMode = !(_state?.autoPrint || false);
    const btn = document.getElementById('modeBtn');
    btn.disabled = true;
    const result = await window.printdrop.setMode(nextMode);
    btn.disabled = false;
    if (result.ok && _state) {
      _state.autoPrint = nextMode;
      renderModeBtn(nextMode);
    }
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

  // Connection + status
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot' + (state.connected ? ' connected' : ' error');

  document.getElementById('shopName').textContent = state.shopName || 'PrintDrop Agent';
  const shopStatus = document.getElementById('shopStatus');
  const modeLabel = state.autoPrint ? 'Auto-Print' : 'Manual';
  shopStatus.textContent = state.connected
    ? (state.lastPollAt ? `Connected · ${modeLabel}` : 'Connected')
    : 'Offline — check connection';

  renderModeBtn(state.autoPrint);

  // Banners
  const offlineBanner = document.getElementById('offlineBanner');
  offlineBanner.hidden = state.connected;

  const syncBanner = document.getElementById('syncBanner');
  const syncCount = state.pendingSyncCount || 0;
  syncBanner.hidden = syncCount === 0;
  if (syncCount > 0) {
    document.getElementById('syncBannerText').textContent =
      `${syncCount} action${syncCount !== 1 ? 's' : ''} pending sync — will retry automatically`;
  }

  // Stats — use serverQueue counts when available
  const stats = state.stats || {};
  document.getElementById('statPrinted').textContent = stats.printedToday ?? 0;
  document.getElementById('statQueue').textContent =
    (stats.queued ?? 0) + (stats.printing ?? 0);
  document.getElementById('statFailed').textContent = stats.failedToday ?? 0;

  const lastPoll = document.getElementById('lastPoll');
  lastPoll.textContent = state.lastPollAt
    ? `Last check ${timeSince(state.lastPollAt)} ago`
    : 'Waiting…';

  renderJobList();
  renderPrinters();
}

function renderModeBtn(autoPrint) {
  const btn = document.getElementById('modeBtn');
  const label = document.getElementById('modeBtnLabel');
  if (!btn || !label) return;
  label.textContent = autoPrint ? 'Auto' : 'Manual';
  btn.classList.toggle('mode-auto', autoPrint);
}

function renderJobList() {
  const jobList = document.getElementById('jobList');

  // Merge serverQueue (live jobs) with recentJobs (completed/local) for display.
  const serverQueue = _state?.serverQueue || [];
  const serverIds = new Set(serverQueue.map((j) => j.id));
  const recentOnly = (_state?.recentJobs || []).filter((j) => !serverIds.has(j.id));
  const allJobs = [...serverQueue, ...recentOnly];

  const jobs = allJobs.filter(passesFilter);

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

  const autoPrint = _state?.autoPrint || false;

  jobList.innerHTML = jobs.map((job) => {
    const token = String(job.token).padStart(3, '0');
    const isActing = _actionInProgress === job.id;
    const effectiveStatus = job._localStatus || job.status;

    const specs = [
      job.pageCount ? `${job.pageCount} pg` : null,
      job.copies > 1 ? `${job.copies}×` : null,
      job.color ? 'Color' : 'B&W',
      job.doubleSided ? '2-sided' : null,
      job.paperSize && job.paperSize !== 'A4' ? job.paperSize : null,
      job.printerName || null,
    ].filter(Boolean);

    // Customer info (name or phone if available)
    const customer = job.user?.name || job.user?.phone || null;
    if (customer) specs.push(`· ${customer}`);

    const meta = specs.map((p, i) => i === 0
      ? `<span>${escHtml(p)}</span>`
      : `<span class="sep">·</span><span>${escHtml(p)}</span>`
    ).join('');

    const errorHtml = job._localError
      ? `<div class="job-error">${escHtml(job._localError)}</div>`
      : '';

    const actions = buildActionButtons(job, autoPrint, isActing, effectiveStatus);

    return `
      <div class="job-row ${isActing ? 'job-acting' : ''}" data-id="${escHtml(job.id)}">
        <div class="job-token">#${escHtml(token)}</div>
        <div class="job-body">
          <div class="job-name">${escHtml(job.fileName || '')}</div>
          <div class="job-meta">${meta}</div>
          ${errorHtml}
          ${actions}
        </div>
        <div class="job-badge ${escHtml(effectiveStatus)}">${statusLabel(effectiveStatus)}</div>
      </div>
    `;
  }).join('');

  // Wire up action button clicks
  jobList.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const jobId = btn.closest('[data-id]')?.dataset.id;
      if (jobId) handleJobAction(action, jobId);
    });
  });
}

function buildActionButtons(job, autoPrint, isActing, effectiveStatus) {
  if (isActing) {
    return `<div class="job-actions"><span class="job-acting-label">Processing…</span></div>`;
  }

  const btns = [];

  if (effectiveStatus === 'needs_review') {
    btns.push(`<button class="job-btn job-btn-review" data-action="force-retry" title="Confirm and retry print">Retry Print</button>`);
    btns.push(`<button class="job-btn job-btn-cancel" data-action="cancel" title="Cancel this job">Cancel</button>`);
    return `<div class="job-actions">${btns.join('')}</div>`;
  }

  if (effectiveStatus === 'sync_pending_ready') {
    return `<div class="job-actions"><span class="job-auto-label">Syncing ready status…</span></div>`;
  }

  if (effectiveStatus === 'sync_pending_pickup') {
    return `<div class="job-actions"><span class="job-auto-label">Syncing pickup…</span></div>`;
  }

  if (job.status === 'queued') {
    if (!autoPrint) {
      btns.push(`<button class="job-btn job-btn-print" data-action="print" title="Print this job">Print</button>`);
    } else {
      btns.push(`<span class="job-auto-label">Auto-printing…</span>`);
    }
    btns.push(`<button class="job-btn job-btn-cancel" data-action="cancel" title="Cancel">✕</button>`);
  }

  if (job.status === 'printing') {
    btns.push(`<span class="job-auto-label">Printing…</span>`);
    btns.push(`<button class="job-btn job-btn-cancel" data-action="cancel" title="Cancel">✕</button>`);
  }

  if (job.status === 'ready') {
    btns.push(`<button class="job-btn job-btn-pickup" data-action="pickup" title="Mark as picked up">Picked Up</button>`);
  }

  if (job.status === 'cancelled') {
    btns.push(`<button class="job-btn job-btn-retry" data-action="retry" title="Retry this job">Retry</button>`);
    return `<div class="job-actions">${btns.join('')}</div>`;
  }

  if (btns.length === 0) return '';
  return `<div class="job-actions">${btns.join('')}</div>`;
}

async function handleJobAction(action, jobId) {
  if (_actionInProgress) return;

  // Needs-review force retry requires confirmation
  if (action === 'force-retry') {
    const job = (_state?.serverQueue || []).find((j) => j.id === jobId);
    const tokenStr = job ? `#${String(job.token).padStart(3, '0')}` : jobId.slice(-6);
    const confirmed = confirm(
      `Retry printing ${tokenStr}?\n\n` +
      `This job was in an uncertain state when the app last closed. ` +
      `Only retry if you are sure this job was NOT already printed — ` +
      `retrying a job that already printed will cause a duplicate print.\n\n` +
      `Click OK to retry, Cancel to abort.`
    );
    if (!confirmed) return;
  }

  if (action === 'retry') {
    const job = (_state?.serverQueue || []).find((j) => j.id === jobId);
    const tokenStr = job ? `#${String(job.token).padStart(3, '0')}` : jobId.slice(-6);
    const confirmed = confirm(`Retry printing ${tokenStr}? This will re-queue the job.`);
    if (!confirmed) return;
  }

  _actionInProgress = jobId;
  renderJobList();

  let result;
  try {
    if (action === 'print') {
      result = await window.printdrop.printJob(jobId);
    } else if (action === 'pickup') {
      result = await window.printdrop.pickupJob(jobId);
    } else if (action === 'cancel') {
      result = await window.printdrop.cancelJob(jobId);
    } else if (action === 'retry') {
      result = await window.printdrop.retryJob(jobId);
    } else if (action === 'force-retry') {
      result = await window.printdrop.forceRetryPrint(jobId);
    }
  } catch (err) {
    console.error('Action error:', err);
  } finally {
    _actionInProgress = null;
    renderJobList();
  }

  if (result && !result.ok) {
    console.error(`Action '${action}' failed: ${result.error}`);
  }
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
  const effectiveStatus = job._localStatus || job.status;

  if (_filter !== 'all') {
    if (_filter === 'needs_review') {
      if (effectiveStatus !== 'needs_review') return false;
    } else if (_filter === 'printing') {
      // Show printing + sync_pending (those are printing that succeeded locally)
      if (effectiveStatus !== 'printing' && !effectiveStatus?.startsWith('sync_pending')) return false;
    } else {
      if (effectiveStatus !== _filter) return false;
    }
  }

  if (!_search) return true;
  const customer = job.user?.name || job.user?.phone || '';
  const haystack = `${job.token} ${job.fileName || ''} ${job.printerName || ''} ${customer}`.toLowerCase();
  return haystack.includes(_search);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusLabel(status) {
  const map = {
    queued:               'QUEUED',
    printing:             'PRINTING',
    ready:                'READY',
    picked_up:            'PICKED UP',
    cancelled:            'FAILED',
    needs_review:         'NEEDS REVIEW',
    sync_pending_ready:   'SYNC PENDING',
    sync_pending_pickup:  'SYNC PENDING',
  };
  return map[status] || String(status).toUpperCase().replace(/_/g, ' ');
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

setInterval(() => {
  if (_state?.lastPollAt) {
    document.getElementById('lastPoll').textContent = `Last check ${timeSince(_state.lastPollAt)} ago`;
  }
}, 5000);
