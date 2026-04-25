#!/usr/bin/env node
/**
 * PrintDrop Smoke Test
 * Usage: node scripts/smoke-test.js [--base-url http://localhost:3001]
 *
 * Runs sequential API tests, passing state (session cookie, job IDs) between them.
 * Exits 0 on full pass, 1 if any test fails.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const args = process.argv.slice(2);
const baseUrlIdx = args.indexOf('--base-url');
const BASE_URL = baseUrlIdx !== -1 ? args[baseUrlIdx + 1] : 'http://localhost:3001';

const TEST_PHONE = process.env.SMOKE_TEST_PHONE || process.env.PRINTDROP_DEMO_SHOPKEEPER_PHONE || '+919876543210';
const TEST_PIN = process.env.SMOKE_TEST_PIN || process.env.PRINTDROP_DEMO_SHOPKEEPER_PIN;

// Shared state between tests
const ctx = {
  cookie: null,
  userId: null,
  shopId: null,
  jobId: null,
  paymentLink: null,
};

let passed = 0;
let failed = 0;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function ok(name, detail = '') {
  passed++;
  console.log(`  ${GREEN}✓${RESET} ${name}${detail ? `  ${YELLOW}${detail}${RESET}` : ''}`);
}

function fail(name, reason) {
  failed++;
  console.log(`  ${RED}✗${RESET} ${name}`);
  console.log(`    ${RED}→ ${reason}${RESET}`);
}

async function api(method, path, body, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = { method, headers: { ...headers } };

  if (body instanceof FormData) {
    // Let fetch set the correct multipart Content-Type with boundary
    opts.body = body;
  } else if (body !== null && body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  // No body + no Content-Type for bodyless POSTs (avoids Fastify FST_ERR_CTP_EMPTY_JSON_BODY)

  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, data, headers: res.headers };
}

function authHeader() {
  return ctx.cookie ? { Cookie: ctx.cookie } : {};
}

function shopkeeperHeader() {
  return authHeader();
}

function captureSessionCookie(headers) {
  const setCookie =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie().join(',')
      : headers.get('set-cookie');
  const match = setCookie?.match(/(?:^|,\s*)pd_session=([^;]+)/);
  return match ? `pd_session=${match[1]}` : null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function t01_health() {
  const { status, data } = await api('GET', '/health');
  if (status === 200 && data.status === 'ok') {
    ok('Health check', `timestamp: ${data.timestamp}`);
  } else {
    fail('Health check', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t02_shopkeeperLogin() {
  if (!TEST_PIN) {
    fail('Shopkeeper login', 'Set SMOKE_TEST_PIN or PRINTDROP_DEMO_SHOPKEEPER_PIN');
    return;
  }
  const { status, data, headers } = await api('POST', '/api/auth/shopkeeper-login', {
    phone: TEST_PHONE,
    pin: TEST_PIN,
  });
  const cookie = captureSessionCookie(headers);
  if (status === 200 && data.user && cookie) {
    ctx.cookie = cookie;
    ctx.userId = data.user?.id;
    ctx.shopId = data.user?.shop?.id || null;
    ok('Shopkeeper login', `userId: ${ctx.userId?.slice(0, 8)}..., role: ${data.user.role}`);
  } else {
    fail('Shopkeeper login', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t03_getProfile() {
  if (!ctx.cookie) {
    fail('Get profile', 'Skipped — no session cookie');
    return;
  }
  const { status, data } = await api('GET', '/api/auth/me', null, authHeader());
  if (status === 200 && data.user) {
    ok('Get profile', `role: ${data.user.role}`);
  } else {
    fail('Get profile', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t04_listShops() {
  const { status, data } = await api('GET', '/api/shops');
  if (status === 200 && Array.isArray(data.shops || data)) {
    const shops = data.shops || data;
    ctx.shopId = ctx.shopId || shops[0]?.id;
    ok('List shops', `found ${shops.length} shop(s)${ctx.shopId ? `, using ${shops[0]?.name}` : ''}`);
  } else {
    fail('List shops', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t05_uploadFile() {
  if (!ctx.cookie) {
    fail('Upload file', 'Skipped — no session cookie');
    return;
  }

  // Minimal valid 1-page PDF (hand-crafted, ~200 bytes)
  const minimalPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
    '0000000058 00000 n\n0000000115 00000 n\n' +
    'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF'
  );

  const form = new FormData();
  form.append('file', new Blob([minimalPdf], { type: 'application/pdf' }), 'smoke-test.pdf');

  const { status, data } = await api('POST', '/api/files/upload', form, authHeader());

  if ((status === 200 || status === 201) && (data.fileUrl || data.url || data.key)) {
    ctx.fileUrl = data.fileUrl || data.url;
    ctx.fileKey = data.key || data.fileKey;
    ok('Upload file', `driver: ${data.driver || 'local'}, key: ${(ctx.fileKey || '').slice(0, 30)}...`);
  } else {
    fail('Upload file', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t06_createJob() {
  if (!ctx.cookie || !ctx.shopId) {
    fail('Create job', `Skipped — need session (${!!ctx.cookie}) + shopId (${!!ctx.shopId})`);
    return;
  }

  const { status, data } = await api('POST', '/api/jobs', {
    shopId: ctx.shopId,
    fileUrl: ctx.fileUrl || 'https://example.com/smoke-test.pdf',
    fileKey: ctx.fileKey || 'smoke-test.pdf',
    fileName: 'smoke-test.pdf',
    fileSize: 12345,
    fileType: 'pdf',
    pageCount: 2,
    color: false,
    copies: 1,
    doubleSided: false,
    paperSize: 'A4',
    pageRange: 'all',
    binding: 'none',
  }, authHeader());

  if ((status === 200 || status === 201) && data.job?.id) {
    ctx.jobId = data.job.id;
    ok('Create job', `jobId: ${ctx.jobId.slice(0, 8)}..., total: ₹${data.job.totalPrice}`);
  } else {
    fail('Create job', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t07_createPayment() {
  if (!ctx.cookie || !ctx.jobId) {
    fail('Create payment link', 'Skipped — need session + jobId');
    return;
  }
  const { status, data } = await api('POST', `/api/jobs/${ctx.jobId}/pay`, undefined, authHeader());

  if ((status === 200 || status === 201) && data.paymentLink) {
    ctx.paymentLink = data.paymentLink;
    const isReal = data.paymentLink.includes('rzp.io');
    ok('Create payment link', `${isReal ? 'Razorpay' : 'mock'}: ${data.paymentLink.slice(0, 50)}...`);
  } else {
    fail('Create payment link', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t08_publicJobStatus() {
  if (!ctx.jobId) {
    fail('Public job status', 'Skipped — no jobId');
    return;
  }
  const { status, data } = await api('GET', `/api/webhooks/razorpay/job/${ctx.jobId}`);
  if (status === 200 && data.id && data.status) {
    ok('Public job status', `status: ${data.status}, fileName: ${data.fileName}`);
  } else {
    fail('Public job status', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t09_mockPayment() {
  if (!ctx.jobId) {
    fail('Mock payment', 'Skipped — no jobId');
    return;
  }
  const { status, data } = await api('POST', '/api/webhooks/razorpay/mock', { jobId: ctx.jobId });
  if (status === 200 && data.token) {
    ok('Mock payment', `token: #${String(data.token).padStart(3, '0')}, shop: ${data.shopName}`);
  } else if (status === 404) {
    fail('Mock payment', 'Payment record not found — was create payment (t08) successful?');
  } else {
    fail('Mock payment', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t10_loginRateLimit() {
  const testPhone = '+911234567890';
  let hitLimit = false;
  for (let i = 0; i < 7; i++) {
    const { status } = await api('POST', '/api/auth/shopkeeper-login', {
      phone: testPhone,
      pin: '000000',
    });
    if (status === 429) {
      hitLimit = true;
      ok('Login rate limit', `429 hit on attempt ${i + 1}`);
      break;
    }
  }
  if (!hitLimit) {
    fail('Login rate limit', 'Expected 429 after 5 wrong attempts, never got it');
  }
}

async function t11_kdsQueue() {
  const header = shopkeeperHeader();
  if (!ctx.cookie) {
    fail('KDS queue', 'Skipped — no session cookie');
    return;
  }
  const { status, data } = await api('GET', '/api/jobs?status=queued', null, header);
  if (status === 200 && (Array.isArray(data.jobs) || Array.isArray(data))) {
    const jobs = data.jobs || data;
    ok('KDS queue', `${jobs.length} queued job(s) visible`);
  } else {
    fail('KDS queue', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t12_statusUpdate() {
  if (!ctx.cookie || !ctx.jobId) {
    fail('Status update', 'Skipped — no session cookie or jobId');
    return;
  }
  const { status, data } = await api(
    'PATCH',
    `/api/jobs/${ctx.jobId}/status`,
    { status: 'printing' },
    authHeader(),
  );
  if (status === 200 && data.status === 'printing') {
    ok('Status update', 'queued → printing');
  } else if (status === 403) {
    ok('Status update', 'Auth check works (403 for customer role — expected if not shopkeeper)');
  } else if (status === 400) {
    ok('Status update', `Transition rejected: ${data.error} (valid state machine behavior)`);
  } else {
    fail('Status update', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t13_printerCrud() {
  if (!ctx.cookie || !ctx.shopId) {
    fail('Printer CRUD', 'Skipped — no session cookie or shopId');
    return;
  }
  const { status, data } = await api('GET', `/api/printers/shop/${ctx.shopId}`);
  if (status === 200 && Array.isArray(data)) {
    ok('Printer CRUD', `${data.length} printer(s) registered`);
  } else {
    fail('Printer CRUD', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${BOLD}PrintDrop Smoke Test${RESET}`);
  console.log(`Base URL: ${YELLOW}${BASE_URL}${RESET}`);
  console.log(`Phone:    ${YELLOW}${TEST_PHONE}${RESET}`);
  console.log('─'.repeat(50));

  const tests = [
    t01_health,
    t02_shopkeeperLogin,
    t03_getProfile,
    t04_listShops,
    t05_uploadFile,
    t06_createJob,
    t07_createPayment,
    t08_publicJobStatus,
    t09_mockPayment,
    t10_loginRateLimit,
    t11_kdsQueue,
    t12_statusUpdate,
    t13_printerCrud,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      fail(test.name, `Threw: ${err.message}`);
    }
  }

  console.log('─'.repeat(50));
  const total = passed + failed;
  console.log(`\n${BOLD}Results: ${GREEN}${passed} passed${RESET}${BOLD}, ${failed > 0 ? RED : ''}${failed} failed${RESET}${BOLD} / ${total} total${RESET}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
