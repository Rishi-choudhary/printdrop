'use strict';

/**
 * WhatsApp flow unit tests — Node built-in test runner (node:test, Node 18+).
 * Run: node --test src/tests/whatsapp-flow.test.js
 *
 * These tests exercise the pure logic layers (payload parsing, message builders,
 * template routing, shop pagination) without needing a real database or Gupshup
 * account. They also double as a spec for what the WhatsApp bot must do.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ─── Stub config so services can be required without real env vars ────────────
process.env.DATABASE_URL = 'postgresql://test';
process.env.WHATSAPP_API_KEY = 'test_key';
process.env.GUPSHUP_SOURCE_NUMBER = '919999999999';
process.env.GUPSHUP_APP_NAME = 'PrintDropTest';
process.env.GUPSHUP_TEMPLATE_TOKEN_ISSUED = 'printdrop_token_issued';
process.env.GUPSHUP_TEMPLATE_READY_FOR_PICKUP = 'printdrop_ready_for_pickup';
process.env.NODE_ENV = 'test';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Webhook payload parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('parseWebhookPayload — Gupshup format', () => {
  const { parseWebhookPayload } = require('../bot/whatsapp');

  test('text message', () => {
    const result = parseWebhookPayload({
      type: 'message',
      payload: { type: 'text', source: '919876543210', payload: { text: 'hello' }, id: 'msg1' },
    });
    assert.equal(result.type, 'text');
    assert.equal(result.text, 'hello');
    assert.equal(result.phone, '+919876543210');
  });

  test('document (PDF)', () => {
    const result = parseWebhookPayload({
      type: 'message',
      payload: {
        type: 'document',
        source: '919876543210',
        payload: { url: 'https://cdn.gupshup.io/file.pdf', contentType: 'application/pdf', filename: 'report.pdf' },
        id: 'msg2',
      },
    });
    assert.equal(result.type, 'document');
    assert.equal(result.fileUrl, 'https://cdn.gupshup.io/file.pdf');
    assert.equal(result.fileName, 'report.pdf');
  });

  test('image message', () => {
    const result = parseWebhookPayload({
      type: 'message',
      payload: {
        type: 'image',
        source: '919876543210',
        payload: { url: 'https://cdn.gupshup.io/img.jpg', contentType: 'image/jpeg' },
        id: 'msg3',
      },
    });
    assert.equal(result.type, 'image');
    assert.ok(result.fileName.endsWith('.jpg'));
  });

  test('quick_reply button click', () => {
    const result = parseWebhookPayload({
      type: 'message',
      payload: {
        type: 'quick_reply',
        source: '919876543210',
        payload: { title: 'All Pages', postbackText: 'pages_all' },
        id: 'msg4',
      },
    });
    assert.equal(result.type, 'callback');
    assert.equal(result.callback, 'pages_all');
    assert.equal(result.text, 'All Pages');
  });

  test('list_reply button click', () => {
    const result = parseWebhookPayload({
      type: 'message',
      payload: {
        type: 'list_reply',
        source: '919876543210',
        payload: { title: 'Shop 1', postbackText: 'shop_abc123' },
        id: 'msg5',
      },
    });
    assert.equal(result.type, 'callback');
    assert.equal(result.callback, 'shop_abc123');
  });

  test('delivery receipt (message-event) returns null silently', () => {
    const result = parseWebhookPayload({ type: 'message-event', payload: {} });
    assert.equal(result, null);
  });

  test('user-event returns null silently', () => {
    const result = parseWebhookPayload({ type: 'user-event', payload: {} });
    assert.equal(result, null);
  });

  test('audio message returns unsupported type', () => {
    const result = parseWebhookPayload({
      type: 'message',
      payload: {
        type: 'audio',
        source: '919876543210',
        payload: { url: 'https://cdn.gupshup.io/audio.ogg' },
        id: 'msg6',
      },
    });
    assert.equal(result.type, 'unsupported');
    assert.equal(result.subtype, 'audio');
  });

  test('location message returns unsupported type', () => {
    const result = parseWebhookPayload({
      type: 'message',
      payload: {
        type: 'location',
        source: '919876543210',
        payload: { latitude: 12.9, longitude: 77.6 },
        id: 'msg7',
      },
    });
    assert.equal(result.type, 'unsupported');
    assert.equal(result.subtype, 'location');
  });

  test('phone normalized — leading + stripped and re-added', () => {
    const result = parseWebhookPayload({
      type: 'message',
      payload: { type: 'text', source: '+919876543210', payload: { text: 'hi' }, id: 'msg8' },
    });
    assert.equal(result.phone, '+919876543210');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Message builders
// ─────────────────────────────────────────────────────────────────────────────

describe('message builders', () => {
  const M = require('../bot/messages');

  test('fileReceivedMessage includes page count and buttons', () => {
    const msg = M.fileReceivedMessage(10, 'report.pdf');
    assert.ok(msg.text.includes('10 pages'));
    assert.equal(msg.buttons.length, 2);
    assert.ok(msg.buttons.some((b) => b.callback_data === 'pages_all'));
    assert.ok(msg.buttons.some((b) => b.callback_data === 'pages_custom'));
  });

  test('copiesMessage has 5 options including Other', () => {
    const msg = M.copiesMessage();
    assert.equal(msg.buttons.length, 5);
    assert.ok(msg.buttons.some((b) => b.callback_data === 'copies_other'));
  });

  test('shopListMessage — <= 9 shops uses direct buttons', () => {
    const shops = makeShops(5);
    const msg = M.shopListMessage(shops);
    assert.equal(msg.buttons.length, 5);
    assert.ok(msg.buttons.every((b) => b.callback_data.startsWith('shop_')));
  });

  test('shopListMessage — > 9 shops uses paginated form', () => {
    const shops = makeShops(15);
    const msg = M.shopListMessage(shops);
    // First page: 9 shops + 1 "More shops" button = 10 total
    assert.equal(msg.buttons.length, 10);
    assert.ok(msg.buttons[9].callback_data === 'shop_page_1');
  });

  test('shopListPagedMessage — second page correct', () => {
    const shops = makeShops(15);
    const msg = M.shopListPagedMessage(shops, 1);
    // Second page: 6 remaining shops, no More button
    assert.equal(msg.buttons.length, 6);
    assert.ok(!msg.buttons.some((b) => b.callback_data?.startsWith('shop_page_')));
  });

  test('shopListPagedMessage — text shows page n of total', () => {
    const shops = makeShops(20);
    const msg = M.shopListPagedMessage(shops, 1);
    assert.ok(msg.text.includes('page 2 of 3'));
  });

  test('tokenMessage contains token formatted to 3 digits', () => {
    const msg = M.tokenMessage(7, 'QuickPrint', 10);
    assert.ok(msg.text.includes('#007'));
    assert.ok(msg.text.includes('QuickPrint'));
  });

  test('statusUpdateMessage for ready', () => {
    const msg = M.statusUpdateMessage('ready', 42);
    assert.ok(msg.text.includes('#042'));
    assert.ok(msg.text.includes('ready for pickup'));
  });

  test('errorMessage unsupported_type', () => {
    const msg = M.errorMessage('unsupported_type');
    assert.ok(msg.text.length > 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Outbound message formatting (notification helpers)
// Stub fetch inside each test so describe-level setup/teardown timing
// (which is synchronous) doesn't affect the fetch used at test run time.
// ─────────────────────────────────────────────────────────────────────────────

describe('sendWhatsAppMessage — button routing', () => {
  const notification = require('../services/notification');

  function withFetchSpy(fn) {
    return async () => {
      let captured = null;
      const original = global.fetch;
      global.fetch = async (url, opts) => {
        const params = new URLSearchParams(opts.body);
        captured = { url, message: JSON.parse(params.get('message') || '{}'), destination: params.get('destination') };
        return { ok: true, status: 200 };
      };
      try {
        await fn(() => captured);
      } finally {
        global.fetch = original;
      }
    };
  }

  test('no buttons → plain text message', withFetchSpy(async (get) => {
    await notification.sendWhatsAppMessage('+919876543210', 'Hello!', []);
    assert.equal(get().message.type, 'text');
    assert.equal(get().message.text, 'Hello!');
  }));

  test('2 callback buttons → quick_reply', withFetchSpy(async (get) => {
    await notification.sendWhatsAppMessage('+919876543210', 'Choose:', [
      { text: 'B&W', callback_data: 'color_bw' },
      { text: 'Color', callback_data: 'color_color' },
    ]);
    assert.equal(get().message.type, 'quick_reply');
    assert.equal(get().message.options.length, 2);
  }));

  test('4 callback buttons → list message', withFetchSpy(async (get) => {
    await notification.sendWhatsAppMessage('+919876543210', 'Choose copies:', [
      { text: '1', callback_data: 'copies_1' },
      { text: '2', callback_data: 'copies_2' },
      { text: '3', callback_data: 'copies_3' },
      { text: '5', callback_data: 'copies_5' },
    ]);
    assert.equal(get().message.type, 'list');
    assert.equal(get().message.items[0].options.length, 4);
  }));

  test('URL button is inlined into text body, not interactive', withFetchSpy(async (get) => {
    await notification.sendWhatsAppMessage('+919876543210', 'Pay here:', [
      { text: 'Pay Now', url: 'https://rzp.io/l/abc' },
      { text: 'I Paid', callback_data: 'check_payment' },
    ]);
    const msg = get().message;
    const bodyText = msg.content?.text || msg.text || '';
    assert.ok(bodyText.includes('https://rzp.io/l/abc'), `Expected URL in body text, got: ${JSON.stringify(msg)}`);
  }));

  test('phone normalized — + stripped for API destination', withFetchSpy(async (get) => {
    await notification.sendWhatsAppMessage('+919876543210', 'Hi');
    assert.equal(get().destination, '919876543210');
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Template message config selection
// ─────────────────────────────────────────────────────────────────────────────

describe('sendWhatsAppTemplateMessage — template ID routing', () => {
  const notification = require('../services/notification');

  function withFetchSpy(fn) {
    return async () => {
      let capturedUrl = null;
      let capturedBody = null;
      const original = global.fetch;
      global.fetch = async (url, opts) => {
        capturedUrl = url;
        capturedBody = new URLSearchParams(opts.body);
        return { ok: true, status: 200 };
      };
      try {
        await fn(() => ({ url: capturedUrl, body: capturedBody }));
      } finally {
        global.fetch = original;
      }
    };
  }

  test('uses template endpoint when templateId is set', withFetchSpy(async (get) => {
    await notification.sendWhatsAppTemplateMessage(
      '+919876543210',
      'printdrop_token_issued',
      ['042', 'QuickPrint'],
      'fallback',
    );
    assert.ok(get().url.includes('/template/msg'), `Expected template URL, got: ${get().url}`);
    const tmpl = JSON.parse(get().body.get('template') || '{}');
    assert.equal(tmpl.id, 'printdrop_token_issued');
    assert.deepEqual(tmpl.params, ['042', 'QuickPrint']);
  }));

  test('falls back to regular msg endpoint when templateId is empty', withFetchSpy(async (get) => {
    await notification.sendWhatsAppTemplateMessage(
      '+919876543210',
      '',
      ['042', 'QuickPrint'],
      'Your order is confirmed!',
    );
    assert.ok(get().url.includes('/wa/api/v1/msg'), `Expected freeform URL, got: ${get().url}`);
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Webhook health tracking
// ─────────────────────────────────────────────────────────────────────────────

describe('getWebhookHealth', () => {
  // Access the exported health getter without starting a real server
  const webhookRoutes = require('../routes/webhooks');
  const getHealth = webhookRoutes.getWebhookHealth;

  test('initially stale (no webhook received)', () => {
    const health = getHealth();
    assert.equal(health.lastWhatsAppWebhook, null);
    assert.equal(health.whatsAppWebhookStale, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. File extension validation
// ─────────────────────────────────────────────────────────────────────────────

describe('file extension validation', () => {
  const fileService = require('../services/file');

  test('PDF allowed', () => {
    const result = fileService.validateFile('report.pdf', 1024);
    assert.equal(result.valid, true);
  });

  test('JPG allowed', () => {
    const result = fileService.validateFile('photo.jpg', 1024);
    assert.equal(result.valid, true);
  });

  test('DOCX allowed', () => {
    const result = fileService.validateFile('resume.docx', 1024);
    assert.equal(result.valid, true);
  });

  test('EXE rejected', () => {
    const result = fileService.validateFile('malware.exe', 1024);
    assert.equal(result.valid, false);
    assert.equal(result.error, 'unsupported_type');
  });

  test('ZIP rejected', () => {
    const result = fileService.validateFile('archive.zip', 1024);
    assert.equal(result.valid, false);
    assert.equal(result.error, 'unsupported_type');
  });

  test('file too large rejected', () => {
    const maxBytes = 51 * 1024 * 1024; // 51 MB
    const result = fileService.validateFile('report.pdf', maxBytes);
    assert.equal(result.valid, false);
    assert.equal(result.error, 'file_too_large');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeShops(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `shop_${i + 1}`,
    name: `Shop ${i + 1}`,
    address: `Address ${i + 1}`,
    opensAt: '09:00',
    closesAt: '21:00',
  }));
}
