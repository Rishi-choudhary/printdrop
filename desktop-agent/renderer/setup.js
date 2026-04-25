'use strict';

const TOTAL_STEPS = 5;
let currentStep = 1;

const wizardData = {
  agentKey: '',
  apiUrl: '',
  shopId: '',
  shopName: '',
  detectedPrinters: [],
  bwPrinterSystemName: '',
  bwPrinterDisplayName: '',
  colorPrinterSystemName: null,
  colorPrinterDisplayName: null,
  bwPaperSize: 'A4',
  bwDuplex: 'simplex',
  colorPaperSize: 'A4',
  colorDuplex: 'simplex',
};

// ── Navigation ─────────────────────────────────────────────────────────────

function showStep(n) {
  document.querySelectorAll('.step').forEach((el, idx) => {
    el.classList.toggle('hidden', idx + 1 !== n);
    if (idx + 1 === n) {
      el.classList.remove('fade-in');
      requestAnimationFrame(() => el.classList.add('fade-in'));
    }
  });
  document.getElementById('stepHint').textContent = `Step ${n} of ${TOTAL_STEPS}`;
  document.getElementById('backBtn').style.visibility = n === 1 ? 'hidden' : 'visible';
  updateStepper(n);
  updateNextButton(n);
}

function updateStepper(n) {
  document.querySelectorAll('.stepper-item').forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
}

function updateNextButton(step) {
  const labels = {
    1: 'Validate & Connect',
    2: 'Continue',
    3: 'Continue',
    4: 'Continue',
    5: 'Finish',
  };
  document.getElementById('nextLabel').textContent = labels[step] || 'Next';
}

function goBack() {
  if (currentStep > 1) {
    currentStep--;
    showStep(currentStep);
  }
}

async function goNext() {
  if (currentStep === 1) await handleStep1();
  else if (currentStep === 2) handleStep2();
  else if (currentStep === 3) handleStep3();
  else if (currentStep === 4) handleStep4();
  else if (currentStep === 5) await handleStep5();
}

// ── Step 1 ─────────────────────────────────────────────────────────────────

async function handleStep1() {
  const agentKey = document.getElementById('agentKey').value.trim();
  const apiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '');
  const banner = document.getElementById('banner1');

  hideBanner(banner);

  if (!agentKey) return showBanner(banner, 'error', 'Please enter your agent key.');
  if (!apiUrl)   return showBanner(banner, 'error', 'Please enter the server URL.');

  const btn = document.getElementById('nextBtn');
  const labelEl = document.getElementById('nextLabel');
  btn.disabled = true;
  labelEl.textContent = 'Connecting…';

  const result = await window.printdrop.validateKey(agentKey, apiUrl);

  btn.disabled = false;
  updateNextButton(1);

  if (!result.ok) {
    return showBanner(banner, 'error', result.error || 'Could not connect. Check your agent key.');
  }

  wizardData.agentKey = agentKey;
  wizardData.apiUrl = apiUrl;
  wizardData.shopId = result.shopId;
  wizardData.shopName = result.shopName;

  currentStep = 2;
  showStep(2);
  detectPrinters();
}

// ── Step 2 ─────────────────────────────────────────────────────────────────

async function detectPrinters() {
  const list = document.getElementById('printerList');
  const warn = document.getElementById('noPrintersWarning');
  hideBanner(warn);

  list.innerHTML = `
    <div class="detecting-card">
      <span class="spinner lg"></span>
      <div>Scanning for printers…</div>
    </div>
  `;

  const shopEl = document.getElementById('shopConnected');
  shopEl.textContent = wizardData.shopName
    ? `Connected to ${wizardData.shopName}. Looking for local printers…`
    : 'Scanning this computer for available printers…';

  const result = await window.printdrop.detectPrinters();
  wizardData.detectedPrinters = result.printers || [];

  if (wizardData.detectedPrinters.length === 0) {
    list.innerHTML = `
      <div class="detecting-card" style="color: var(--danger);">
        No printers detected on this computer.
      </div>
    `;
    showBanner(warn, 'error');
  } else {
    list.innerHTML = wizardData.detectedPrinters.map((p) => `
      <div class="printer-chip">
        <div class="printer-chip-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
        </div>
        <div class="printer-chip-body">
          <div class="printer-chip-name">${escHtml(p)}</div>
          <div class="printer-chip-status">Ready</div>
        </div>
      </div>
    `).join('');
  }

  populatePrinterDropdowns();
}

function handleStep2() {
  if (wizardData.detectedPrinters.length === 0) {
    detectPrinters();
    return;
  }
  currentStep = 3;
  showStep(3);
}

// ── Step 3 ─────────────────────────────────────────────────────────────────

function populatePrinterDropdowns() {
  const bwSel = document.getElementById('bwPrinter');
  const colSel = document.getElementById('colorPrinter');
  const testSel = document.getElementById('testPrinter');
  const opts = wizardData.detectedPrinters
    .map((p) => `<option value="${escAttr(p)}">${escHtml(p)}</option>`)
    .join('');

  bwSel.innerHTML = opts;
  colSel.innerHTML = `<option value="">— No color printer —</option>${opts}`;
  if (testSel) testSel.innerHTML = opts;
}

function handleStep3() {
  const bwVal = document.getElementById('bwPrinter').value;
  const colVal = document.getElementById('colorPrinter').value;

  if (!bwVal) {
    const banner = ensureBanner('bwBanner', 'step3');
    showBanner(banner, 'error', 'Please select a B&W printer before continuing.');
    return;
  }

  wizardData.bwPrinterSystemName = bwVal;
  wizardData.bwPrinterDisplayName = bwVal;
  wizardData.colorPrinterSystemName = colVal || null;
  wizardData.colorPrinterDisplayName = colVal || null;
  wizardData.bwPaperSize = document.getElementById('bwPaperSize').value;
  wizardData.bwDuplex = document.getElementById('bwDuplex').value;
  wizardData.colorPaperSize = document.getElementById('colorPaperSize').value;
  wizardData.colorDuplex = document.getElementById('colorDuplex').value;

  buildSummary();
  currentStep = 4;
  showStep(4);
}

function buildSummary() {
  const card = document.getElementById('summaryCard');
  card.innerHTML = `
    <div class="summary-row"><span>Shop</span><span>${escHtml(wizardData.shopName || wizardData.shopId || '—')}</span></div>
    <div class="summary-row"><span>B&amp;W printer</span><span>${escHtml(wizardData.bwPrinterDisplayName)}</span></div>
    <div class="summary-row"><span>Color printer</span><span>${escHtml(wizardData.colorPrinterDisplayName || 'Falls back to B&W')}</span></div>
    <div class="summary-row"><span>Default paper</span><span>${escHtml(wizardData.bwPaperSize)}</span></div>
  `;
}

// ── Step 4 ─────────────────────────────────────────────────────────────────

function handleStep4() {
  // Pre-select default for test
  const testPrinter = document.getElementById('testPrinter');
  if (testPrinter) testPrinter.value = wizardData.bwPrinterSystemName;
  currentStep = 5;
  showStep(5);
}

// ── Step 5 ─────────────────────────────────────────────────────────────────

async function handleStep5() {
  const btn = document.getElementById('nextBtn');
  const labelEl = document.getElementById('nextLabel');
  btn.disabled = true;
  labelEl.textContent = 'Saving…';

  const result = await window.printdrop.saveConfig({
    agentKey: wizardData.agentKey,
    apiUrl: wizardData.apiUrl,
    shopId: wizardData.shopId,
    shopName: wizardData.shopName,
    bwPrinterSystemName: wizardData.bwPrinterSystemName,
    bwPrinterDisplayName: wizardData.bwPrinterDisplayName,
    colorPrinterSystemName: wizardData.colorPrinterSystemName,
    colorPrinterDisplayName: wizardData.colorPrinterDisplayName,
    bwPaperSize: wizardData.bwPaperSize,
    bwDuplex: wizardData.bwDuplex,
    colorPaperSize: wizardData.colorPaperSize,
    colorDuplex: wizardData.colorDuplex,
    coverPage: document.getElementById('prefCoverPage').checked,
    tokenStampPosition: document.getElementById('prefCoverPage').checked ? 'back-last-right' : 'none',
    soundEnabled: document.getElementById('prefSounds').checked,
    autoStart: document.getElementById('prefAutoStart').checked,
    notificationsEnabled: document.getElementById('prefNotifications').checked,
  });

  if (!result.ok) {
    btn.disabled = false;
    updateNextButton(5);
    alert('Setup failed. Please try again.');
  }
  // Main process closes the window on success.
}

function setupTestPrint() {
  const testBtn = document.getElementById('testPrintBtn');
  const statusEl = document.getElementById('testPrintStatus');
  if (testBtn.dataset.wired) return;
  testBtn.dataset.wired = '1';

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Printing…';
    hideBanner(statusEl);
    statusEl.textContent = 'Sending test page to printer…';
    statusEl.className = 'banner info show';

    const chosen = document.getElementById('testPrinter').value || wizardData.bwPrinterSystemName;
    const isColorTest = !!wizardData.colorPrinterSystemName && chosen === wizardData.colorPrinterSystemName;
    const result = await window.printdrop.testPrint(chosen, isColorTest);

    if (!result.ok) {
      showBanner(statusEl, 'error', result.error || 'Print failed. Check printer connection.');
      testBtn.disabled = false;
      testBtn.textContent = 'Retry test print';
      return;
    }

    showBanner(statusEl, 'success', '✓ Test page sent. Check your printer for output.');
    testBtn.textContent = 'Print again';
    testBtn.disabled = false;
  });
}

// ── DOM ready ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  showStep(1);

  document.getElementById('nextBtn').addEventListener('click', goNext);
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.getElementById('refreshPrintersBtn').addEventListener('click', detectPrinters);

  // Password reveal toggle
  document.getElementById('revealKey').addEventListener('click', () => {
    const input = document.getElementById('agentKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Advanced toggles
  document.querySelectorAll('.advanced-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const isOpen = !target.classList.contains('hidden');
      target.classList.toggle('hidden', isOpen);
      btn.classList.toggle('open', !isOpen);
    });
  });

  // Stepper clickable (only to already-completed steps)
  document.querySelectorAll('.stepper-item').forEach((el) => {
    el.addEventListener('click', () => {
      const s = parseInt(el.dataset.step, 10);
      if (s < currentStep) { currentStep = s; showStep(s); }
    });
  });

  // Press Enter to advance on step 1
  document.getElementById('agentKey').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goNext();
  });

  setupTestPrint();
});

// ── Utilities ──────────────────────────────────────────────────────────────

function showBanner(el, type, msg) {
  if (!el) return;
  el.className = `banner ${type} show`;
  if (msg) el.textContent = msg;
}
function hideBanner(el) { if (el) el.className = 'banner'; }

function ensureBanner(id, parentId) {
  let b = document.getElementById(id);
  if (!b) {
    b = document.createElement('div');
    b.id = id;
    b.className = 'banner';
    b.style.marginBottom = '14px';
    const parent = document.getElementById(parentId);
    parent.insertBefore(b, parent.children[1] || null);
  }
  return b;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
