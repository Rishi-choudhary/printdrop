const config = require('../config');
const prisma = require('../services/prisma');
const fileService = require('../services/file');
const conversationService = require('../services/conversation');
const { sendWhatsAppMessage } = require('../services/notification');
const messages = require('./messages');

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
 * Parse incoming WhatsApp webhook payload.
 * Supports both WATI and Gupshup formats, plus Meta Cloud API.
 */
function parseWebhookPayload(payload) {
  // Meta Cloud API / WATI format
  if (payload.entry) {
    const entry = payload.entry[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages?.[0]) return null;

    const msg = value.messages[0];
    const phone = msg.from;

    if (msg.type === 'text') {
      return { phone, type: 'text', text: msg.text.body };
    }

    if (msg.type === 'document') {
      return {
        phone,
        type: 'document',
        fileUrl: msg.document.link || msg.document.url,
        fileName: msg.document.filename || 'document.pdf',
        fileId: msg.document.id,
        mimeType: msg.document.mime_type,
      };
    }

    if (msg.type === 'image') {
      return {
        phone,
        type: 'image',
        fileUrl: msg.image.link || msg.image.url,
        fileName: `image_${Date.now()}.jpg`,
        fileId: msg.image.id,
        mimeType: msg.image.mime_type,
      };
    }

    if (msg.type === 'interactive') {
      const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
      return {
        phone,
        type: 'callback',
        callback: reply?.id,
        text: reply?.title,
      };
    }

    return { phone, type: 'unknown' };
  }

  // Gupshup format
  if (payload.type === 'message' || payload.payload) {
    const msg = payload.payload || payload;
    const phone = msg.source || msg.sender?.phone;

    if (msg.type === 'text') {
      return { phone, type: 'text', text: msg.payload?.text || msg.text };
    }

    if (msg.type === 'file' || msg.type === 'document') {
      return {
        phone,
        type: 'document',
        fileUrl: msg.payload?.url || msg.url,
        fileName: msg.payload?.caption || 'document.pdf',
      };
    }

    if (msg.type === 'image') {
      return {
        phone,
        type: 'image',
        fileUrl: msg.payload?.url || msg.url,
        fileName: `image_${Date.now()}.jpg`,
      };
    }

    if (msg.type === 'button_reply' || msg.type === 'quick_reply') {
      return {
        phone,
        type: 'callback',
        callback: msg.payload?.id || msg.postbackText,
        text: msg.payload?.title || msg.text,
      };
    }

    return { phone, type: 'unknown' };
  }

  return null;
}

async function handleWebhook(payload) {
  const parsed = parseWebhookPayload(payload);
  if (!parsed || !parsed.phone) {
    console.warn('Could not parse WhatsApp webhook payload');
    return;
  }

  const { phone } = parsed;
  const user = await getOrCreateUser(phone);
  const conv = await conversationService.getOrCreateConversation('whatsapp', phone, user.id);

  let result;

  if (parsed.type === 'document' || parsed.type === 'image') {
    // Download and process file
    let saved;
    try {
      if (parsed.fileUrl) {
        saved = await fileService.downloadFile(parsed.fileUrl, {
          Authorization: `Bearer ${config.whatsapp.apiKey}`,
        });
      } else {
        // For Meta Cloud API, need to fetch media URL first
        const mediaUrl = `${config.whatsapp.apiUrl}/${parsed.fileId}`;
        const mediaResp = await fetch(mediaUrl, {
          headers: { Authorization: `Bearer ${config.whatsapp.apiKey}` },
        });
        const mediaData = await mediaResp.json();
        saved = await fileService.downloadFile(mediaData.url, {
          Authorization: `Bearer ${config.whatsapp.apiKey}`,
        });
      }
    } catch (err) {
      console.error('WhatsApp file download error:', err);
      return sendResponse(phone, messages.errorMessage('server_error'));
    }

    const pageCount = await fileService.getPageCount(
      saved.filePath,
      fileService.getFileExtension(parsed.fileName)
    );

    result = await conversationService.handleMessage(conv, 'file', {
      fileUrl: saved.fileUrl,
      fileName: parsed.fileName,
      pageCount,
    });
  } else if (parsed.type === 'callback') {
    result = await conversationService.handleMessage(conv, 'callback', {
      callback: parsed.callback,
    });
  } else if (parsed.type === 'text') {
    const text = parsed.text.trim();

    // Check for commands
    if (text.startsWith('/') || ['cancel', 'help', 'status', 'start'].includes(text.toLowerCase())) {
      const cmd = text.startsWith('/') ? text.split(' ')[0].toLowerCase() : `/${text.toLowerCase()}`;
      result = await conversationService.handleMessage(conv, 'command', { command: cmd });
    } else {
      result = await conversationService.handleMessage(conv, 'text', { text });
    }
  } else {
    return; // Ignore unknown message types
  }

  if (result?.response) {
    return sendResponse(phone, result.response);
  }
}

function verifyWebhookSignature(body, signature) {
  if (!config.whatsapp.webhookSecret) return true;
  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', config.whatsapp.webhookSecret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  return expected === signature;
}

module.exports = { handleWebhook, verifyWebhookSignature };
