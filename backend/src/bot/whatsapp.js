const path = require('path');
const fs = require('fs');
const config = require('../config');
const prisma = require('../services/prisma');
const fileService = require('../services/file');
const storage = require('../services/storage');
const conversationService = require('../services/conversation');
const { sendWhatsAppMessage } = require('../services/notification');
const messages = require('./messages');

// Conversations inactive longer than this in a non-idle state are reset
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function sendResponse(phone, messageObj) {
  if (!messageObj || !messageObj.text) return;
  return sendWhatsAppMessage(phone, messageObj.text, messageObj.buttons);
}

async function getOrCreateUser(phone) {
  let user = await prisma.user.findUnique({ where: { phone } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        phone,
        name: 'WhatsApp User',
        referralCode: `REF${phone.slice(-6)}${Date.now().toString(36).slice(-4)}`.toUpperCase(),
      },
    });
  }

  return user;
}

/**
 * Normalize phone to E.164 format with leading +.
 * Gupshup delivers "919876543210"; Meta delivers "919876543210" or "+919876543210".
 * We always store with + so phones match across WhatsApp, Telegram, and dashboard auth.
 */
function normalizePhone(raw) {
  const cleaned = String(raw || '').replace(/^\+/, '').trim();
  return cleaned ? `+${cleaned}` : '';
}

/**
 * Parse incoming Gupshup webhook payload.
 * Also handles Meta Cloud API format as fallback.
 */
function parseWebhookPayload(payload) {
  // ── Gupshup format ──────────────────────────────────────────────────────────
  if (payload.type === 'message' && payload.payload) {
    const msg = payload.payload;
    const phone = normalizePhone(msg.source || msg.sender?.phone);
    if (!phone) return null;

    const inner = msg.payload || {};
    const messageId = msg.id || payload.payload?.id || payload.messageId;

    switch (msg.type) {
      case 'text':
        return { phone, messageId, type: 'text', text: inner.text || '' };

      case 'file':
      case 'document':
        return {
          phone,
          messageId,
          type: 'document',
          fileUrl: inner.url,
          fileName: inner.caption || path.basename(new URL(inner.url || 'http://x/doc.pdf').pathname) || 'document.pdf',
        };

      case 'image':
        return {
          phone,
          messageId,
          type: 'image',
          fileUrl: inner.url,
          fileName: inner.caption || `image_${Date.now()}.jpg`,
        };

      case 'quick_reply':
      case 'button_reply':
        return {
          phone,
          type: 'callback',
          callback: inner.postbackText || inner.id,
          text: inner.title || inner.text || '',
        };

      case 'list_reply':
        return {
          phone,
          type: 'callback',
          callback: inner.postbackText || inner.id,
          text: inner.title || '',
        };

      default:
        return { phone, type: 'unknown' };
    }
  }

  // ── Meta Cloud API format (fallback) ────────────────────────────────────────
  if (payload.entry) {
    const msg = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return null;

    const phone = normalizePhone(msg.from);

    switch (msg.type) {
      case 'text':
        return { phone, type: 'text', text: msg.text.body };

      case 'document':
        return {
          phone,
          type: 'document',
          fileUrl: msg.document.link || msg.document.url,
          fileName: msg.document.filename || 'document.pdf',
          fileId: msg.document.id,
          mimeType: msg.document.mime_type,
          metaFormat: true,
        };

      case 'image':
        return {
          phone,
          type: 'image',
          fileUrl: msg.image.link || msg.image.url,
          fileName: `image_${Date.now()}.jpg`,
          fileId: msg.image.id,
          metaFormat: true,
        };

      case 'interactive': {
        const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
        return {
          phone,
          type: 'callback',
          callback: reply?.id,
          text: reply?.title,
        };
      }

      default:
        return { phone, type: 'unknown' };
    }
  }

  return null;
}

/**
 * Resolve page count after a file is saved.
 * Works for both local-storage and R2.
 */
async function resolvePageCount(savedFile, fileName) {
  const ext = fileService.getFileExtension(fileName || '');

  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
    return 1;
  }

  try {
    if (ext === 'pdf') {
      // Try local path first (cheap)
      const localPath = path.join(config.upload.dir, path.basename(savedFile.key));
      if (fs.existsSync(localPath)) {
        return await fileService.getPageCount(localPath, 'pdf');
      }
      // Fall back to downloading from storage
      const buffer = await storage.download(savedFile.key);
      return await fileService.getPageCount(buffer, 'pdf');
    }

    if (['doc', 'docx', 'ppt', 'pptx'].includes(ext)) {
      const buffer = await storage.download(savedFile.key);
      return await fileService.getPageCountSmart(buffer, fileName);
    }
  } catch {
    // non-fatal — fall through to default
  }

  return 1;
}

async function handleWebhook(payload) {
  const parsed = parseWebhookPayload(payload);
  if (!parsed || !parsed.phone) {
    console.warn('Could not parse WhatsApp webhook payload');
    return;
  }

  // ── Feature flag: route to v2 bot (3-state, zero-OTP) if enabled ──────────
  const botV2 = require('./v2');
  if (botV2.isEnabled()) {
    return botV2.handleWebhook(parsed);
  }

  const { phone } = parsed;
  const user = await getOrCreateUser(phone);
  let conv = await conversationService.getOrCreateConversation('whatsapp', phone, user.id);

  // ── Session timeout: reset stale mid-flow conversations ──────────────────
  if (conv.state !== 'idle' && conv.state !== 'payment_pending') {
    const lastActivity = new Date(conv.updatedAt).getTime();
    if (Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
      await conversationService.resetConversation(conv.id);
      await sendResponse(phone, {
        text: 'Your session expired after 30 minutes of inactivity.\n\nNo worries — just send your file again to start a new order.',
      });
      conv = await conversationService.getOrCreateConversation('whatsapp', phone, user.id);
    }
  }

  let result;

  if (parsed.type === 'document' || parsed.type === 'image') {
    let saved;
    try {
      // Gupshup CDN URLs are public — no auth needed.
      // Meta Cloud API media requires a Bearer token.
      const headers = parsed.metaFormat
        ? { Authorization: `Bearer ${config.whatsapp.apiKey}` }
        : {};

      if (parsed.fileUrl) {
        saved = await fileService.downloadFile(parsed.fileUrl, headers);
      } else if (parsed.fileId) {
        // Meta media-ID → fetch URL first
        const mediaResp = await fetch(`${config.whatsapp.apiUrl}/${parsed.fileId}`, {
          headers: { Authorization: `Bearer ${config.whatsapp.apiKey}` },
        });
        const mediaData = await mediaResp.json();
        saved = await fileService.downloadFile(mediaData.url, {
          Authorization: `Bearer ${config.whatsapp.apiKey}`,
        });
      } else {
        throw new Error('No file URL or ID in payload');
      }
    } catch (err) {
      console.error('WhatsApp file download error:', err);
      return sendResponse(phone, messages.errorMessage('server_error'));
    }

    const pageCount = await resolvePageCount(saved, parsed.fileName);

    result = await conversationService.handleMessage(conv, 'file', {
      fileUrl: saved.fileUrl || saved.url,
      fileKey: saved.key || null,
      fileName: parsed.fileName,
      pageCount,
    });
  } else if (parsed.type === 'callback') {
    result = await conversationService.handleMessage(conv, 'callback', {
      callback: parsed.callback,
    });
  } else if (parsed.type === 'text') {
    const text = (parsed.text || '').trim();

    if (!text) return;

    // Map plain-text command words to slash-command equivalents
    const cmdWords = { cancel: '/cancel', help: '/help', status: '/status', start: '/start', history: '/history' };
    const normalized = text.toLowerCase();

    if (text.startsWith('/') || cmdWords[normalized]) {
      const cmd = text.startsWith('/') ? text.split(' ')[0].toLowerCase() : cmdWords[normalized];

      if (cmd === '/history') {
        const { jobs } = await require('../services/job').getJobsByUser(user.id, 5);
        return sendResponse(phone, messages.historyMessage(jobs));
      }

      result = await conversationService.handleMessage(conv, 'command', { command: cmd });
    } else {
      result = await conversationService.handleMessage(conv, 'text', { text });
    }
  } else {
    return; // Ignore unknown types (status updates, read receipts, etc.)
  }

  if (result?.response) {
    return sendResponse(phone, result.response);
  }
}

/**
 * Verify webhook origin.
 * Gupshup does not send HMAC signatures — rely on secret URL or IP whitelisting.
 * If WHATSAPP_WEBHOOK_SECRET is set, it is checked against x-gupshup-token header.
 */
function verifyWebhookSignature(body, signature) {
  if (!config.whatsapp.webhookSecret) return true; // No secret configured → allow all

  // Gupshup: token is passed as a plain header value, not an HMAC
  if (signature === config.whatsapp.webhookSecret) return true;

  // Meta Cloud API: standard HMAC-SHA256
  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', config.whatsapp.webhookSecret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  return `sha256=${expected}` === signature || expected === signature;
}

module.exports = { handleWebhook, verifyWebhookSignature, parseWebhookPayload, normalizePhone };
