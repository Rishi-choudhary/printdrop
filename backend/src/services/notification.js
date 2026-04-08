const config = require('../config');
const prisma = require('./prisma');

let telegramBot = null;

function setTelegramBot(bot) {
  telegramBot = bot;
}

function getTelegramBot() {
  return telegramBot;
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

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        apikey: apiKey,
      },
      body: params.toString(),
    });

    if (!response.ok) {
      console.error('Gupshup API error:', response.status, await response.text());
    }

    return response;
  } catch (err) {
    console.error('Gupshup send error:', err.message);
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
  sendTelegramMessage,
  sendWhatsAppMessage,
  setTelegramBot,
  getTelegramBot,
};
