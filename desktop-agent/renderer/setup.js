'use strict';

let currentStep = 1;
const TOTAL_STEPS = 5;

// State accumulated across steps
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
};

// ── Navigation ────────────────────────────────────────────────────────────────

function showStep(n) {
  document.querySelectorAll('.step').forEach((el) => el.classList.add('hidden'));
  document.getElementById(`step${n}`).classList.remove('hidden');
  document.getElementById('stepIndicator').textContent = `Step ${n} of ${TOTAL_STEPS}`;
  document.getElementById('backBtn').classList.toggle('hidden', n === 1);
  updateNextButton(n);
}

function updateNextButton(step) {
  const btn = document.getElementById('nextBtn');
  const labels = {
    1: 'Validate & Connect',
    2: 'Continue',
    3: 'Continue',
    4: 'Continue',
    5: 'Finish Setup',
  };
  btn.textContent = labels[step] || 'Next';
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
  else if (currentStep === 4) handleStep4Move();
  else if (currentStep === 5) await handleStep5();
}

// ── Step 1: Validate key ──────────────────────────────────────────────────────

async function handleStep1() {
  const agentKey = document.getElementById('agentKey').value.trim();
  const apiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '');
  const banner = document.getElementById('banner1');

  banner.className = 'banner';
  banner.textContent = '';

  if (!agentKey) {
    showBanner(banner, 'error', 'Please enter your agent key.');
    return;
  }
  if (!apiUrl) {
    showBanner(banner, 'error', 'Please enter the API server URL.');
    return;
  }

  const btn = document.getElementById('nextBtn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';

  const result = await window.printdrop.validateKey(agentKey, apiUrl);

  btn.disabled = false;
  updateNextButton(1);

  if (!result.ok) {
    showBanner(banner, 'error', result.error || 'Could not connect. Check your agent key and try again.');
    return;
  }

  wizardData.agentKey = agentKey;
  wizardData.apiUrl = apiUrl;
  wizardData.shopId = result.shopId;
  wizardData.shopName = result.shopName;

  currentStep = 2;
  showStep(2);
  detectPrinters();
}

// ── Step 2: Detect printers ───────────────────────────────────────────────────

async function detectPrinters() {
  const list = document.getElementById('printerList');
  const warn = document.getElementById('noPrintersWarning');
  warn.classList.add('hidden');

  list.innerHTML = '<div class="detecting-row"><span class="spinner"></span> Detecting printers…</div>';

  const shopEl = document.getElementById('shopConnected');
  shopEl.textContent = wizardData.shopName
    ? `Connected to ${wizardData.shopName}. Finding available printers…`
    : 'Finding available printers on this computer…';

  const result = await window.printdrop.detectPrinters();
  wizardData.detectedPrinters = result.printers || [];

  if (wizardData.detectedPrinters.length === 0) {
    list.innerHTML = '<div class="detecting-row" style="color:#dc2626">No printers detected.</div>';
    warn.classList.remove('hidden');
  } else {
    list.innerHTML = wizardData.detectedPrinters.map((p) =>
      `<div class="printer-item"><span class="printer-dot"></span>${escHtml(p)}</div>`,
    ).join('');
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

// ── Step 3: Assign printers ───────────────────────────────────────────────────

function populatePrinterDropdowns() {
  const bwSel = document.getElementById('bwPrinter');
  const colSel = document.getElementById('colorPrinter');
  const opts = wizardData.detectedPrinters
    .map((p) => `<option value="${escAttr(p)}">${escHtml(p)}</option>`)
    .join('');

  bwSel.innerHTML = opts;
  colSel.innerHTML = `<option value="">— None —</option>${opts}`;
}

function handleStep3() {
  const bwVal = document.getElementById('bwPrinter').value;
  const colVal = document.getElementById('colorPrinter').value;

  if (!bwVal) {
    alert('Please select a B&W printer before continuing.');
    return;
  }

  wizardData.bwPrinterSystemName = bwVal;
  wizardData.bwPrinterDisplayName = bwVal;
  wizardData.colorPrinterSystemName = colVal || null;
  wizardData.colorPrinterDisplayName = colVal || null;

  // Build summary for step 4
  const card = document.getElementById('summaryCard');
  card.innerHTML = `
    <div class="summary-row"><span>Shop</span><span><strong>${escHtml(wizardData.shopName || wizardData.shopId)}</strong></span></div>
    <div class="summary-row"><span>B&amp;W Printer</span><span>${escHtml(bwVal)}</span></div>
    <div class="summary-row"><span>Color Printer</span><span>${escHtml(colVal || 'None (uses B&W)')}</span></div>
  `;

  currentStep = 4;
  showStep(4);
}

// ── Step 4 → 5: Move to test print ───────────────────────────────────────────

function handleStep4Move() {
  currentStep = 5;
  showStep(5);
  setupTestPrint();
}

// ── Step 5: Test print + Save config ─────────────────────────────────────────

function setupTestPrint() {
  const testBtn = document.getElementById('testPrintBtn');
  const statusEl = document.getElementById('testPrintStatus');

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Printing…';
    statusEl.className = 'banner';
    statusEl.textContent = 'Sending test page to printer…';
    statusEl.classList.remove('hidden');

    // Direct local print — no backend job queue, works before agent polling starts
    const result = await window.printdrop.testPrint(
      wizardData.bwPrinterSystemName,
      false, // B&W test
    );

    if (!result.ok) {
      statusEl.className = 'banner error';
      statusEl.textContent = result.error || 'Print failed. Check printer connection and drivers.';
      testBtn.disabled = false;
      testBtn.textContent = '🖨️ Retry Test Print';
      return;
    }

    statusEl.className = 'banner success';
    statusEl.textContent = '✓ Test page sent! Check your printer for output.';
    testBtn.textContent = '🖨️ Print Again';
    testBtn.disabled = false;
  });
}

async function handleStep5() {
  const btn = document.getElementById('nextBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const result = await window.printdrop.saveConfig({
    agentKey: wizardData.agentKey,
    apiUrl: wizardData.apiUrl,
    shopId: wizardData.shopId,
    shopName: wizardData.shopName,
    bwPrinterSystemName: wizardData.bwPrinterSystemName,
    bwPrinterDisplayName: wizardData.bwPrinterDisplayName,
    colorPrinterSystemName: wizardData.colorPrinterSystemName,
    colorPrinterDisplayName: wizardData.colorPrinterDisplayName,
    coverPage: document.getElementById('prefCoverPage').checked,
    soundEnabled: document.getElementById('prefSounds').checked,
    autoStart: document.getElementById('prefAutoStart').checked,
  });

  if (!result.ok) {
    btn.disabled = false;
    updateNextButton(5);
    alert('Setup failed. Please try again.');
  }
  // Main process closes this window on success
}

// ── Refresh button for step 2 ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  showStep(1);

  document.getElementById('nextBtn').addEventListener('click', goNext);
  document.getElementById('backBtn').addEventListener('click', goBack);

  // Add a Refresh button to step 2
  const s2 = document.getElementById('step2');
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.style.marginTop = '16px';
  refreshBtn.textContent = '↻ Refresh Printer List';
  refreshBtn.addEventListener('click', detectPrinters);
  s2.appendChild(refreshBtn);
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function showBanner(el, type, msg) {
  el.className = `banner ${type}`;
  el.textContent = msg;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
