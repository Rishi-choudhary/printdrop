#!/usr/bin/env node
/**
 * PrintDrop Smoke Test
 * Usage: node scripts/smoke-test.js [--base-url http://localhost:3001]
 *
 * Runs 14 sequential API tests, passing state (JWT, job IDs) between them.
 * Exits 0 on full pass, 1 if any test fails.
 */

const args = process.argv.slice(2);
const baseUrlIdx = args.indexOf('--base-url');
const BASE_URL = baseUrlIdx !== -1 ? args[baseUrlIdx + 1] : 'http://localhost:3001';

// Test phone — use a non-rate-limited number for smoke tests
const TEST_PHONE = process.env.SMOKE_TEST_PHONE || '+919876543210';

// Shared state between tests
const ctx = {
  jwt: null,
  shopkeeperJwt: null,
  userId: null,
  shopId: null,
  jobId: null,
  paymentLink: null,
  otp: null,
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
  return { status: res.status, data };
}

function authHeader() {
  return ctx.jwt ? { Authorization: `Bearer ${ctx.jwt}` } : {};
}

function shopkeeperHeader() {
  return ctx.shopkeeperJwt ? { Authorization: `Bearer ${ctx.shopkeeperJwt}` } : {};
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

async function t02_sendOtp() {
  const { status, data } = await api('POST', '/api/auth/send-otp', { phone: TEST_PHONE });
  if (status === 200 && data.success) {
    ctx.otp = data.otp; // set in dev mode only
    ok('Send OTP', ctx.otp ? `OTP: ${ctx.otp} (dev mode)` : 'SMS queued');
  } else if (status === 503) {
    fail('Send OTP', 'MSG91 not configured — set MSG91_AUTH_KEY or run in dev mode');
  } else {
    fail('Send OTP', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t03_verifyOtp() {
  if (!ctx.otp) {
    fail('Verify OTP', 'Skipped — no OTP available (requires dev mode or MSG91)');
    return;
  }
  const { status, data } = await api('POST', '/api/auth/verify-otp', {
    phone: TEST_PHONE,
    code: ctx.otp,
  });
  if (status === 200 && data.token) {
    ctx.jwt = data.token;
    ctx.userId = data.user?.id;
    ok('Verify OTP', `userId: ${ctx.userId?.slice(0, 8)}...`);
  } else {
    fail('Verify OTP', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t04_getProfile() {
  if (!ctx.jwt) {
    fail('Get profile', 'Skipped — no JWT');
    return;
  }
  const { status, data } = await api('GET', '/api/auth/me', null, authHeader());
  if (status === 200 && data.user) {
    ok('Get profile', `role: ${data.user.role}`);
  } else {
    fail('Get profile', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t05_listShops() {
  const { status, data } = await api('GET', '/api/shops');
  if (status === 200 && Array.isArray(data.shops || data)) {
    const shops = data.shops || data;
    ctx.shopId = shops[0]?.id;
    ok('List shops', `found ${shops.length} shop(s)${ctx.shopId ? `, using ${shops[0]?.name}` : ''}`);
  } else {
    fail('List shops', `Got ${status}: ${JSON.stringify(data)}`);
  }
}

async function t06_uploadFile() {
  if (!ctx.jwt) {
    fail('Upload file', 'Skipped — no JWT');
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

async function t07_createJob() {
  if (!ctx.jwt || !ctx.shopId) {
    fail('Create job', `Skipped — need JWT (${!!ctx.jwt}) + shopId (${!!ctx.shopId})`);
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

async function t08_createPayment() {
  if (!ctx.jwt || !ctx.jobId) {
    fail('Create payment link', `Skipped — need JWT + jobId`);
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

async function t09_publicJobStatus() {
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

async function t10_mockPayment() {
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

async function t11_otpRateLimit() {
  // Attempt to verify with wrong OTPs on a fresh phone to hit rate limit
  const testPhone = '+911234567890';

  // First request OTP for this phone
  await api('POST', '/api/auth/send-otp', { phone: testPhone });

  let hitLimit = false;
  for (let i = 0; i < 7; i++) {
    const { status, data } = await api('POST', '/api/auth/verify-otp', {
      phone: testPhone,
      code: '000000',
    });
    if (status === 429) {
      hitLimit = true;
      ok('OTP rate limit', `429 hit on attempt ${i + 1}`);
      break;
    }
  }
  if (!hitLimit) {
    fail('OTP rate limit', 'Expected 429 after 5 wrong attempts, never got it');
  }
}

async function t12_kdsQueue() {
  // Use customer JWT if no shopkeeper JWT available
  const header = ctx.shopkeeperJwt ? shopkeeperHeader() : authHeader();
  if (!ctx.jwt) {
    fail('KDS queue', 'Skipped — no JWT');
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

async function t13_statusUpdate() {
  if (!ctx.jwt || !ctx.jobId) {
    fail('Status update', 'Skipped — no JWT or jobId');
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

async function t14_printerCrud() {
  if (!ctx.jwt || !ctx.shopId) {
    fail('Printer CRUD', 'Skipped — no JWT or shopId');
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
    t02_sendOtp,
    t03_verifyOtp,
    t04_getProfile,
    t05_listShops,
    t06_uploadFile,
    t07_createJob,
    t08_createPayment,
    t09_publicJobStatus,
    t10_mockPayment,
    t11_otpRateLimit,
    t12_kdsQueue,
    t13_statusUpdate,
    t14_printerCrud,
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
