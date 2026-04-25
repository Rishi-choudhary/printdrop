const config = require('../config');
const prisma = require('./prisma');

let telegramBot = null;

function setTelegramBot(bot) {
  telegramBot = bot;
}

function getTelegramBot() {
  return telegramBot;
}

/**
 * Exponential backoff sleep helper.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramMessage(chatId, text, buttons) {
  const bot = getTelegramBot();
  if (!bot) {
    console.warn('Telegram bot not initialized, cannot send message');
    return;
  }

  const opts = { parse_mode: 'Markdown' };
  if (buttons && buttons.length > 0) {
    // Group buttons in rows of 2
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2));
    }
    opts.reply_markup = { inline_keyboard: rows };
  }

  return bot.sendMessage(chatId, text, opts);
}

/**
 * Build a Gupshup quick_reply message (max 3 buttons, max 20 chars per title).
 */
function buildQuickReply(text, buttons) {
  return {
    type: 'quick_reply',
    content: { type: 'text', header: '', text, caption: '' },
    options: buttons.map((btn) => ({
      type: 'text',
      title: btn.text.substring(0, 20),
      description: '',
      postbackText: btn.callback_data,
    })),
  };
}

/**
 * Build a Gupshup list message (max 10 items) for menus with > 3 options.
 */
function buildListMessage(text, buttons) {
  return {
    type: 'list',
    title: 'Options',
    body: text,
    msgid: `list_${Date.now()}`,
    globalButtons: [{ type: 'text', title: 'View options' }],
    items: [
      {
        title: 'Choose one',
        subtitle: '',
        options: buttons.slice(0, 10).map((btn) => ({
          type: 'text',
          title: btn.text.substring(0, 24),
          description: '',
          postbackText: btn.callback_data,
        })),
      },
    ],
  };
}

/**
 * Parse structured error from Gupshup JSON response body.
 * Returns a loggable object with code, message, destination.
 */
function parseGupshupError(status, body, dest) {
  try {
    const parsed = JSON.parse(body);
    return {
      httpStatus: status,
      code: parsed.response?.status || parsed.status,
      message: parsed.response?.details || parsed.message || body.slice(0, 200),
      destination: `${dest.slice(0, 4)}****`,
    };
  } catch {
    return {
      httpStatus: status,
      message: body.slice(0, 200),
      destination: `${dest.slice(0, 4)}****`,
    };
  }
}

/**
 * Send a WhatsApp message via Gupshup API.
 *
 * Button rules (WhatsApp platform limits):
 *   - URL buttons  → inlined into text, not interactive
 *   - ≤ 3 callback → quick_reply
 *   - > 3 callback → list message
 */
async function sendWhatsAppMessage(phone, text, buttons) {
  const { apiUrl, apiKey, sourceNumber, appName } = config.whatsapp;

  if (!apiKey || !sourceNumber) {
    console.warn('Gupshup not configured (WHATSAPP_API_KEY / GUPSHUP_SOURCE_NUMBER missing)');
    return;
  }

  // Normalize phone: strip leading +
  const dest = String(phone).replace(/^\+/, '');

  let message;

  if (!buttons || buttons.length === 0) {
    message = { type: 'text', text };
  } else {
    const urlBtns = buttons.filter((b) => b.url);
    const cbBtns = buttons.filter((b) => b.callback_data);

    // Inline URL buttons into the message body
    let body = text;
    if (urlBtns.length > 0) {
      body += '\n\n' + urlBtns.map((b) => `*${b.text}:* ${b.url}`).join('\n');
    }

    if (cbBtns.length === 0) {
      message = { type: 'text', text: body };
    } else if (cbBtns.length <= 3) {
      message = buildQuickReply(body, cbBtns);
    } else {
      message = buildListMessage(body, cbBtns);
    }
  }

  const params = new URLSearchParams({
    channel: 'whatsapp',
    source: sourceNumber,
    destination: dest,
    'src.name': appName,
    message: JSON.stringify(message),
  });

  const MAX_RETRIES = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          apikey: apiKey,
        },
        body: params.toString(),
      });

      if (response.ok) return { ok: true, status: response.status };

      const errText = await response.text();

      // 4xx errors are permanent — do not retry
      if (response.status >= 400 && response.status < 500) {
        const errInfo = parseGupshupError(response.status, errText, dest);
        console.error('[gupshup] Permanent send error:', errInfo);
        return { ok: false, status: response.status, error: errText };
      }

      // 5xx — transient, retry
      lastErr = `HTTP ${response.status}: ${errText.slice(0, 100)}`;
      console.warn(`[gupshup] Transient error (attempt ${attempt}/${MAX_RETRIES}):`, lastErr);
    } catch (err) {
      lastErr = err.message;
      console.warn(`[gupshup] Network error (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
    }

    if (attempt < MAX_RETRIES) {
      await sleep(500 * Math.pow(2, attempt - 1)); // 500ms, 1000ms
    }
  }

  console.error(`[gupshup] Failed to send after ${MAX_RETRIES} attempts to ${dest.slice(0, 4)}****:`, lastErr);
  return { ok: false, error: lastErr };
}

/**
 * Send a Gupshup HSM/template message — for business-initiated messages outside
 * the 24-hour session window.
 *
 * Templates must be pre-approved in the Gupshup dashboard under Templates.
 * templateId is the template name/ID shown in the Gupshup dashboard.
 * params is an array of string values filling {{1}}, {{2}}, … placeholders in order.
 *
 * Falls back to sendWhatsAppMessage with fallbackText if templateId is not set
 * or if the template send fails.
 */
async function sendWhatsAppTemplateMessage(phone, templateId, params, fallbackText) {
  const { templateApiUrl, apiKey, sourceNumber, appName } = config.whatsapp;

  if (!apiKey || !sourceNumber) {
    console.warn('[gupshup] Not configured — cannot send template message');
    return;
  }

  if (!templateId) {
    // No template configured — fall back to regular freeform message
    if (fallbackText) return sendWhatsAppMessage(phone, fallbackText);
    return;
  }

  const dest = String(phone).replace(/^\+/, '');

  const templatePayload = {
    id: templateId,
    params: params || [],
  };

  const postParams = new URLSearchParams({
    channel: 'whatsapp',
    source: sourceNumber,
    destination: dest,
    'src.name': appName,
    template: JSON.stringify(templatePayload),
    message: JSON.stringify({ type: 'text', text: fallbackText || '' }),
  });

  const MAX_RETRIES = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(templateApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          apikey: apiKey,
        },
        body: postParams.toString(),
      });

      if (response.ok) return { ok: true, status: response.status };

      const errText = await response.text();

      if (response.status >= 400 && response.status < 500) {
        const errInfo = parseGupshupError(response.status, errText, dest);
        console.error('[gupshup] Template send permanent error:', errInfo);
        // 4xx on template → fall back to regular message
        if (fallbackText) return sendWhatsAppMessage(phone, fallbackText);
        return { ok: false, status: response.status, error: errText };
      }

      lastErr = `HTTP ${response.status}: ${errText.slice(0, 100)}`;
      console.warn(`[gupshup] Template transient error (attempt ${attempt}/${MAX_RETRIES}):`, lastErr);
    } catch (err) {
      lastErr = err.message;
      console.warn(`[gupshup] Template network error (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
    }

    if (attempt < MAX_RETRIES) {
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }

  console.error(`[gupshup] Template failed after ${MAX_RETRIES} attempts to ${dest.slice(0, 4)}****:`, lastErr);
  // Last resort fallback
  if (fallbackText) return sendWhatsAppMessage(phone, fallbackText);
  return { ok: false, error: lastErr };
}

/**
 * Send the payment-confirmed / token-issued notification to a user.
 * Uses an approved HSM template if GUPSHUP_TEMPLATE_TOKEN_ISSUED is configured,
 * so this is safe to send outside the 24-hour session window (e.g. from the
 * Razorpay webhook which fires asynchronously after the user's last message).
 */
async function notifyTokenIssued(userId, token, shopName) {
  const conversation = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });

  if (!conversation) {
    console.warn(`[notification] No conversation found for user ${userId} — cannot send token notification`);
    return;
  }

  const tokenStr = String(token).padStart(3, '0');
  const fallbackText =
    `Payment confirmed!\n\nYour token: *#${tokenStr}*\nShop: *${shopName}*\n\nShow this token number at the shop to pick up your print.`;

  if (conversation.platform === 'telegram') {
    return sendTelegramMessage(conversation.chatId, fallbackText);
  }

  if (conversation.platform === 'whatsapp') {
    const templateId = config.whatsapp.templates.tokenIssued;
    return sendWhatsAppTemplateMessage(
      conversation.chatId,
      templateId,
      [tokenStr, shopName],
      fallbackText,
    );
  }
}

/**
 * Send the "print is ready for pickup" notification to a user.
 * Uses an approved HSM template if GUPSHUP_TEMPLATE_READY_FOR_PICKUP is configured.
 */
async function notifyReadyForPickup(userId, token, shopName) {
  const conversation = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });

  if (!conversation) {
    console.warn(`[notification] No conversation found for user ${userId} — cannot send ready notification`);
    return;
  }

  const tokenStr = String(token).padStart(3, '0');
  const fallbackText =
    `Your print is ready! *#${tokenStr}*\nPick up at *${shopName}*`;

  if (conversation.platform === 'telegram') {
    return sendTelegramMessage(conversation.chatId, fallbackText);
  }

  if (conversation.platform === 'whatsapp') {
    const templateId = config.whatsapp.templates.readyForPickup;
    return sendWhatsAppTemplateMessage(
      conversation.chatId,
      templateId,
      [tokenStr, shopName],
      fallbackText,
    );
  }
}

async function notifyUser(userId, messageObj) {
  const conversation = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });

  if (!conversation) {
    console.warn(`No conversation found for user ${userId}`);
    return;
  }

  // Delete the pending payment message so it's replaced by the token message
  if (conversation.platform === 'telegram') {
    try {
      const ctx = JSON.parse(conversation.context || '{}');
      if (ctx.paymentMessageId) {
        const bot = getTelegramBot();
        if (bot) {
          await bot.deleteMessage(ctx.paymentChatId || conversation.chatId, ctx.paymentMessageId).catch(() => {});
          // Clear from context so it's not attempted again
          delete ctx.paymentMessageId;
          delete ctx.paymentChatId;
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { context: JSON.stringify(ctx) },
          });
        }
      }
    } catch (err) {
      console.error('Failed to delete payment message:', err);
    }
  }

  const { text, buttons } = messageObj;

  if (conversation.platform === 'telegram') {
    return sendTelegramMessage(conversation.chatId, text, buttons);
  } else if (conversation.platform === 'whatsapp') {
    return sendWhatsAppMessage(conversation.chatId, text, buttons);
  }
}

module.exports = {
  notifyUser,
  notifyTokenIssued,
  notifyReadyForPickup,
  sendTelegramMessage,
  sendWhatsAppMessage,
  sendWhatsAppTemplateMessage,
  setTelegramBot,
  getTelegramBot,
};
