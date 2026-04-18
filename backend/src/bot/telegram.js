const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const prisma = require('../services/prisma');
const fileService = require('../services/file');
const conversationService = require('../services/conversation');
const { setTelegramBot } = require('../services/notification');
const messages = require('./messages');

let bot = null;

// Dedup recently processed message/callback IDs to prevent re-processing during 409 conflicts
const _processedIds = new Set();
const MAX_PROCESSED_IDS = 1000;

function isDuplicate(id) {
  if (_processedIds.has(id)) return true;
  _processedIds.add(id);
  if (_processedIds.size > MAX_PROCESSED_IDS) {
    // Remove oldest entries (first 500)
    const arr = [..._processedIds];
    arr.slice(0, 500).forEach((v) => _processedIds.delete(v));
  }
  return false;
}

/**
 * Content-level dedup: Telegram sometimes re-delivers the same photo/document
 * with a NEW message_id (retries after 409 conflicts, client re-uploads, album
 * bursts). `file_unique_id` is stable per file content, so we block anything
 * sent by the same chat within a short window.
 */
const _fileDedupe = new Map(); // key -> timestamp (ms)
const FILE_DEDUPE_WINDOW_MS = 60_000; // 60s
const MAX_FILE_DEDUPE = 2000;

function isDuplicateFile(chatId, fileUniqueId) {
  if (!fileUniqueId) return false;
  const key = `${chatId}:${fileUniqueId}`;
  const now = Date.now();
  const last = _fileDedupe.get(key);
  if (last && now - last < FILE_DEDUPE_WINDOW_MS) {
    _fileDedupe.set(key, now);
    return true;
  }
  _fileDedupe.set(key, now);
  if (_fileDedupe.size > MAX_FILE_DEDUPE) {
    // Evict entries older than the window
    const cutoff = now - FILE_DEDUPE_WINDOW_MS;
    for (const [k, t] of _fileDedupe) {
      if (t < cutoff) _fileDedupe.delete(k);
    }
  }
  return false;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function checkSessionTimeout(conv, chatId) {
  if (conv.state !== 'idle' && conv.state !== 'payment_pending') {
    const lastActivity = new Date(conv.updatedAt).getTime();
    if (Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
      await conversationService.resetConversation(conv.id);
      sendResponse(chatId, {
        text: 'Your session expired after 30 minutes of inactivity.\n\nNo worries — just send your file again to start a new order.',
      });
      return true;
    }
  }
  return false;
}

/**
 * Send a formatted response with optional inline keyboard.
 * Handles both callback buttons and URL buttons.
 */
function buildKeyboard(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = buttons.slice(i, i + 2).map((btn) => {
      if (btn.url) return { text: btn.text, url: btn.url };
      return { text: btn.text, callback_data: btn.callback_data };
    });
    rows.push(row);
  }
  return rows;
}

function sendResponse(chatId, messageObj) {
  if (!messageObj || !messageObj.text) return;

  const opts = { parse_mode: 'Markdown' };

  if (messageObj.buttons && messageObj.buttons.length > 0) {
    opts.reply_markup = { inline_keyboard: buildKeyboard(messageObj.buttons) };
  }

  return bot.sendMessage(chatId, messageObj.text, opts).catch((err) => {
    console.error('Markdown send failed, retrying plain:', err.message);
    return bot.sendMessage(chatId, messageObj.text, { reply_markup: opts.reply_markup });
  });
}

async function editMessage(chatId, messageId, messageObj) {
  if (!messageObj || !messageObj.text) return;

  const keyboard = messageObj.buttons && messageObj.buttons.length > 0
    ? { inline_keyboard: buildKeyboard(messageObj.buttons) }
    : { inline_keyboard: [] };

  return bot.editMessageText(messageObj.text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  }).catch((err) => {
    // Message not modified or too old — fall back to sending a new message
    if (!err.message?.includes('message is not modified')) {
      console.error('Edit failed, sending new message:', err.message);
      return sendResponse(chatId, messageObj);
    }
  });
}

async function getOrCreateUser(telegramUser) {
  const chatId = String(telegramUser.id);

  let user = await prisma.user.findUnique({
    where: { telegramChatId: chatId },
  });

  if (!user) {
    const name = [telegramUser.first_name, telegramUser.last_name]
      .filter(Boolean)
      .join(' ');

    user = await prisma.user.create({
      data: {
        phone: `tg_${chatId}`,
        name: name || 'Telegram User',
        telegramChatId: chatId,
        referralCode: `REF${chatId.slice(-6)}${Date.now().toString(36).slice(-4)}`.toUpperCase(),
      },
    });
  }

  return user;
}

async function handleDocument(msg) {
  const chatId = String(msg.chat.id);
  const user = await getOrCreateUser(msg.from);

  const doc = msg.document;
  const fileName = doc.file_name || 'document';
  const fileSize = doc.file_size || 0;

  // Block re-deliveries of the same file within the dedupe window.
  if (isDuplicateFile(chatId, doc.file_unique_id)) {
    console.log(`[telegram] Duplicate document ignored: ${fileName} (${doc.file_unique_id})`);
    return;
  }

  // Validate
  const validation = fileService.validateFile(fileName, fileSize);
  if (!validation.valid) {
    return sendResponse(chatId, messages.errorMessage(validation.error));
  }

  // Show processing indicator
  bot.sendChatAction(chatId, 'upload_document');

  // Download file from Telegram
  const fileLink = await bot.getFileLink(doc.file_id);
  const saved = await fileService.downloadFile(fileLink);

  // Smart page count (with PDF conversion for office docs)
  const ext = fileService.getFileExtension(fileName);
  let pageCount;
  if (ext === 'pdf') {
    const fs = require('fs');
    const path = require('path');
    const localPath = path.join(config.upload.dir, path.basename(saved.key || saved.fileName));
    if (require('fs').existsSync(localPath)) {
      pageCount = await fileService.getPageCount(localPath, 'pdf');
    } else {
      pageCount = 1;
    }
  } else if (['doc', 'docx', 'ppt', 'pptx'].includes(ext)) {
    // Try converting to get page count
    try {
      const storage = require('../services/storage');
      const buffer = await storage.download(saved.key);
      pageCount = await fileService.getPageCountSmart(buffer, fileName);
    } catch {
      pageCount = 1;
    }
  } else {
    pageCount = 1;
  }

  // Get or create conversation
  const conv = await conversationService.getOrCreateConversation('telegram', chatId, user.id);

  // Handle file in state machine
  const result = await conversationService.handleMessage(conv, 'file', {
    fileUrl: saved.fileUrl || saved.url,
    fileKey: saved.key || null,
    fileName,
    pageCount,
  });

  return sendResponse(chatId, result.response);
}

async function handlePhoto(msg) {
  const chatId = String(msg.chat.id);
  const user = await getOrCreateUser(msg.from);

  // Get highest resolution photo
  const photo = msg.photo[msg.photo.length - 1];

  // Block re-deliveries of the same photo within the dedupe window.
  // Telegram sometimes re-sends the same photo with a new message_id.
  if (isDuplicateFile(chatId, photo.file_unique_id)) {
    console.log(`[telegram] Duplicate photo ignored: ${photo.file_unique_id}`);
    return;
  }

  bot.sendChatAction(chatId, 'upload_photo');

  const fileName = `photo_${Date.now()}.jpg`;

  const fileLink = await bot.getFileLink(photo.file_id);
  const saved = await fileService.downloadFile(fileLink);

  const conv = await conversationService.getOrCreateConversation('telegram', chatId, user.id);

  const result = await conversationService.handleMessage(conv, 'file', {
    fileUrl: saved.fileUrl || saved.url,
    fileKey: saved.key || null,
    fileName,
    pageCount: 1,
  });

  return sendResponse(chatId, result.response);
}

async function handleCallbackQuery(query) {
  const chatId = String(query.message.chat.id);
  const user = await getOrCreateUser(query.from);

  let conv = await conversationService.getOrCreateConversation('telegram', chatId, user.id);
  if (await checkSessionTimeout(conv, chatId)) {
    bot.answerCallbackQuery(query.id);
    return;
  }

  const result = await conversationService.handleMessage(conv, 'callback', {
    callback: query.data,
  });

  // Answer callback to remove loading state
  bot.answerCallbackQuery(query.id);

  // If the response should replace the current message (e.g. payment confirmed), edit in place
  if (result.response?.editMessage) {
    return editMessage(chatId, query.message.message_id, result.response);
  }

  const sentMsg = await sendResponse(chatId, result.response);

  // Store the message ID of the payment link message so we can delete it after payment (webhook path)
  if (result.response?.isPaymentLink && sentMsg?.message_id) {
    await conversationService.storePaymentMessageId(conv.id, chatId, sentMsg.message_id);
  }

  return sentMsg;
}

async function handleTextMessage(msg) {
  const chatId = String(msg.chat.id);
  const text = msg.text || '';

  // Handle commands
  if (text.startsWith('/')) {
    const user = await getOrCreateUser(msg.from);
    const command = text.split(' ')[0].toLowerCase();

    // /history — show recent orders (handled directly, not via state machine)
    if (command === '/history') {
      const { jobs } = await require('../services/job').getJobsByUser(user.id, 5);
      return sendResponse(chatId, messages.historyMessage(jobs));
    }

    const conv = await conversationService.getOrCreateConversation('telegram', chatId, user.id);
    const result = await conversationService.handleMessage(conv, 'command', { command });
    return sendResponse(chatId, result.response);
  }

  // Regular text — pass to state machine
  const user = await getOrCreateUser(msg.from);
  const conv = await conversationService.getOrCreateConversation('telegram', chatId, user.id);
  if (await checkSessionTimeout(conv, chatId)) return;

  const result = await conversationService.handleMessage(conv, 'text', { text });
  return sendResponse(chatId, result.response);
}

async function startTelegramBot(fastify) {
  if (!config.telegram.botToken) {
    console.log('No Telegram bot token configured, skipping');
    return;
  }

  const useWebhook = config.telegram.webhookUrl && config.nodeEnv === 'production';

  if (useWebhook) {
    // Webhook mode for production
    bot = new TelegramBot(config.telegram.botToken);
    await bot.setWebHook(config.telegram.webhookUrl);
    console.log(`Telegram bot webhook set: ${config.telegram.webhookUrl}`);

    // Register webhook route
    fastify.post('/api/webhooks/telegram', async (request) => {
      bot.processUpdate(request.body);
      return { ok: true };
    });
  } else {
    // Polling mode for development
    // Delete any stale webhook before polling (prevents 409 if previously set)
    const tempBot = new TelegramBot(config.telegram.botToken);
    try { await tempBot.deleteWebHook(); } catch {}

    bot = new TelegramBot(config.telegram.botToken, {
      polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
    });
    console.log('Telegram bot started in polling mode');

    // Handle 409 Conflict (another instance already polling) — stop and retry
    bot.on('polling_error', (err) => {
      if (err.code === 'ETELEGRAM' && err.message?.includes('409')) {
        console.warn('[Telegram] 409 Conflict — another instance running. Stopping poll, retrying in 15s...');
        bot.stopPolling().then(() => {
          setTimeout(() => {
            bot.startPolling({ restart: false }).catch(() => {});
          }, 15000);
        }).catch(() => {});
      }
      // Other errors (network, etc.) are handled by the library's built-in retry
    });
  }

  // Store bot reference for notifications
  setTelegramBot(bot);

  // --- Event Handlers ---

  bot.on('document', async (msg) => {
    if (isDuplicate(`doc_${msg.message_id}`)) return;
    try {
      await handleDocument(msg);
    } catch (err) {
      console.error('Telegram document error:', err);
      sendResponse(String(msg.chat.id), messages.errorMessage('server_error'));
    }
  });

  bot.on('photo', async (msg) => {
    if (isDuplicate(`photo_${msg.message_id}`)) return;
    try {
      await handlePhoto(msg);
    } catch (err) {
      console.error('Telegram photo error:', err);
      sendResponse(String(msg.chat.id), messages.errorMessage('server_error'));
    }
  });

  bot.on('callback_query', async (query) => {
    if (isDuplicate(`cb_${query.id}`)) {
      bot.answerCallbackQuery(query.id);
      return;
    }
    try {
      await handleCallbackQuery(query);
    } catch (err) {
      console.error('Telegram callback error:', err);
      bot.answerCallbackQuery(query.id);
      sendResponse(String(query.message.chat.id), messages.errorMessage('server_error'));
    }
  });

  bot.on('text', async (msg) => {
    if (msg.document || msg.photo) return;
    if (isDuplicate(`text_${msg.message_id}`)) return;
    try {
      await handleTextMessage(msg);
    } catch (err) {
      console.error('Telegram text error:', err);
      sendResponse(String(msg.chat.id), messages.errorMessage('server_error'));
    }
  });
}

async function stopTelegramBot() {
  if (!bot) return;
  try {
    if (bot.isPolling && bot.isPolling()) {
      await bot.stopPolling();
      console.log('Telegram bot polling stopped');
    }
    bot = null;
  } catch (err) {
    console.error('Error stopping Telegram bot:', err.message);
  }
}

module.exports = { startTelegramBot, stopTelegramBot };
