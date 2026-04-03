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

async function sendWhatsAppMessage(phone, text, buttons) {
  const apiUrl = config.whatsapp.apiUrl;
  const apiKey = config.whatsapp.apiKey;

  if (!apiUrl || !apiKey) {
    console.warn('WhatsApp API not configured, cannot send message');
    return;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { body: text },
  };

  // If buttons, send as interactive message
  if (buttons && buttons.length > 0) {
    payload.type = 'interactive';
    payload.interactive = {
      type: 'button',
      body: { text },
      action: {
        buttons: buttons.slice(0, 3).map((btn, i) => ({
          type: 'reply',
          reply: { id: btn.callback_data, title: btn.text.substring(0, 20) },
        })),
      },
    };
    delete payload.text;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error('WhatsApp API error:', await response.text());
  }

  return response;
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
