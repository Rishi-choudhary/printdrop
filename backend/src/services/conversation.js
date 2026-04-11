const prisma = require('./prisma');
const messages = require('../bot/messages');
const shopService = require('./shop');
const { calculatePrice, parsePageRange } = require('./pricing');
const jobService = require('./job');
const paymentService = require('./payment');

async function getOrCreateConversation(platform, chatId, userId) {
  let conv = await prisma.conversation.findUnique({
    where: { platform_chatId: { platform, chatId } },
  });

  if (!conv) {
    conv = await prisma.conversation.create({
      data: { userId, platform, chatId, state: 'idle', context: '{}' },
    });
  }

  return conv;
}

function getContext(conv) {
  try {
    return JSON.parse(conv.context || '{}');
  } catch {
    return {};
  }
}

async function updateConversation(id, state, context, extra = {}) {
  return prisma.conversation.update({
    where: { id },
    data: {
      state,
      context: JSON.stringify(context),
      ...extra,
    },
  });
}

async function resetConversation(id) {
  return prisma.conversation.update({
    where: { id },
    data: {
      state: 'idle',
      context: '{}',
      fileUrl: null,
      fileName: null,
      pageCount: null,
    },
  });
}

// --- State Handlers ---

async function handleFileReceived(conv, fileUrl, fileName, pageCount, fileKey) {
  const context = { fileUrl, fileKey, fileName, pageCount, pageRange: 'all' };

  await updateConversation(conv.id, 'file_received', context, {
    fileUrl,
    fileName,
    pageCount,
  });

  return { response: messages.fileReceivedMessage(pageCount, fileName) };
}

async function handlePagesSelection(conv, selection) {
  const ctx = getContext(conv);

  if (selection === 'custom') {
    // Don't transition yet, wait for the range input
    return { response: messages.customRangePromptMessage(), waitForInput: true };
  }

  if (selection === 'all') {
    ctx.pageRange = 'all';
  } else {
    // Validate custom range
    try {
      parsePageRange(selection, ctx.pageCount);
      ctx.pageRange = selection;
    } catch {
      return { response: messages.errorMessage('invalid_range') };
    }
  }

  await updateConversation(conv.id, 'color_choice', ctx);
  return { response: messages.colorChoiceMessage() };
}

async function handleColorChoice(conv, isColor) {
  const ctx = getContext(conv);
  ctx.color = isColor;

  await updateConversation(conv.id, 'copies_count', ctx);
  return { response: messages.copiesMessage() };
}

async function handleCopiesCount(conv, count) {
  const ctx = getContext(conv);

  if (count === 'other') {
    return { response: messages.customCopiesPromptMessage(), waitForInput: true };
  }

  const copies = parseInt(count, 10);
  if (isNaN(copies) || copies < 1 || copies > 100) {
    return { response: messages.errorMessage('invalid_copies') };
  }

  ctx.copies = copies;
  await updateConversation(conv.id, 'paper_size', ctx);
  return { response: messages.paperSizeMessage() };
}

async function handlePaperSize(conv, size) {
  const ctx = getContext(conv);
  ctx.paperSize = size;

  await updateConversation(conv.id, 'sides_choice', ctx);
  return { response: messages.sidesMessage() };
}

async function handleSidesChoice(conv, doubleSided) {
  const ctx = getContext(conv);
  ctx.doubleSided = doubleSided;

  // Fetch active shops
  const shops = await shopService.getActiveShops();
  const openShops = shops.filter((s) => shopService.isShopOpen(s));

  if (openShops.length === 0) {
    // If no open shops, try all active shops (might be outside hours but still valid)
    if (shops.length === 0) {
      return { response: messages.shopListMessage([]) };
    }
    // Auto-select if only one shop exists
    if (shops.length === 1) {
      return handleShopSelection(conv, shops[0].id);
    }
    await updateConversation(conv.id, 'shop_selection', ctx);
    return { response: messages.shopListMessage(shops) };
  }

  // Auto-select if only one shop is available — skip shop selection step
  if (openShops.length === 1) {
    return handleShopSelection(conv, openShops[0].id);
  }

  await updateConversation(conv.id, 'shop_selection', ctx);
  return { response: messages.shopListMessage(openShops) };
}

async function handleShopSelection(conv, shopId) {
  const ctx = getContext(conv);
  ctx.shopId = shopId;

  const shop = await shopService.getShopById(shopId);
  if (!shop) {
    return { response: messages.errorMessage('server_error') };
  }

  // Calculate price
  const effectivePages = ctx.pageRange === 'all'
    ? ctx.pageCount
    : parsePageRange(ctx.pageRange, ctx.pageCount).count;

  const pricing = calculatePrice({
    shop,
    pageCount: ctx.pageCount,
    pageRange: ctx.pageRange,
    color: ctx.color,
    doubleSided: ctx.doubleSided,
    copies: ctx.copies,
  });

  ctx.pricing = pricing;

  await updateConversation(conv.id, 'price_confirmation', ctx);

  return {
    response: messages.priceSummaryMessage({
      fileName: ctx.fileName,
      pages: effectivePages,
      pageRange: ctx.pageRange,
      color: ctx.color,
      copies: ctx.copies,
      doubleSided: ctx.doubleSided,
      paperSize: ctx.paperSize || 'A4',
      shopName: shop.name,
      pricePerPage: pricing.pricePerPage,
      subtotal: pricing.subtotal,
      platformFee: pricing.platformFee,
      total: pricing.total,
    }),
  };
}

async function handleConfirmation(conv, confirmed) {
  const ctx = getContext(conv);

  if (!confirmed) {
    await resetConversation(conv.id);
    return { response: messages.cancelledMessage() };
  }

  if (!ctx.shopId) throw new Error('No shop selected — context missing shopId');
  if (!ctx.fileUrl) throw new Error('No file URL — context missing fileUrl');

  // Idempotency: if job already created (double-tap), return existing payment link
  if (ctx.jobId && ctx.paymentLink) {
    return { response: messages.paymentLinkMessage(ctx.paymentLink, ctx.paymentTotal || ctx.pricing?.total) };
  }

  let job, pricing;
  try {
    ({ job, pricing } = await jobService.createJob({
      userId: conv.userId,
      shopId: ctx.shopId,
      fileUrl: ctx.fileUrl,
      fileKey: ctx.fileKey,
      fileName: ctx.fileName,
      fileSize: 0,
      fileType: ctx.fileName ? ctx.fileName.split('.').pop() : 'pdf',
      pageCount: ctx.pageCount,
      color: ctx.color,
      copies: ctx.copies,
      doubleSided: ctx.doubleSided,
      paperSize: ctx.paperSize || 'A4',
      pageRange: ctx.pageRange,
      binding: ctx.binding || 'none',
      source: conv.platform,
    }));
  } catch (err) {
    console.error('[conversation] createJob failed:', err.message, { shopId: ctx.shopId, userId: conv.userId });
    throw err;
  }

  // Get user phone for payment
  const user = await prisma.user.findUnique({ where: { id: conv.userId } });

  let paymentLink;
  try {
    ({ paymentLink } = await paymentService.createPaymentLink({
      jobId: job.id,
      amount: pricing.total,
      customerPhone: user?.phone || '',
      description: `PrintDrop #${job.token} - ${ctx.fileName}`,
    }));
  } catch (err) {
    console.error('[conversation] createPaymentLink failed:', err.message, { jobId: job.id });
    throw err;
  }

  ctx.jobId = job.id;
  ctx.paymentLink = paymentLink;
  ctx.paymentTotal = pricing.total;
  await updateConversation(conv.id, 'payment_pending', ctx);

  return { response: messages.paymentLinkMessage(paymentLink, pricing.total) };
}

async function handleCheckPayment(conv) {
  const ctx = getContext(conv);
  if (!ctx.jobId) {
    return { response: { text: 'No pending order found. Send /start to begin a new order.' } };
  }

  const result = await paymentService.checkAndProcessPaymentLink(ctx.jobId);

  if (!result.paid) {
    // Still pending — remind user and keep buttons
    return {
      response: {
        editMessage: true,
        text:
          `Payment not confirmed yet.\n\n` +
          `Please complete payment via the link, then tap *✅ I've Paid* again.\n\n` +
          `Amount: *Rs ${(ctx.paymentTotal || 0).toFixed(2)}*`,
        buttons: [
          { text: '💳 Pay Now', url: ctx.paymentLink },
          { text: '✅ I\'ve Paid', callback_data: 'check_payment' },
          { text: '❌ Cancel Order', callback_data: 'cancel_payment' },
        ],
      },
    };
  }

  // Payment confirmed — fetch job for token
  const job = await prisma.job.findUnique({
    where: { id: ctx.jobId },
    include: { shop: true },
  });

  // Clean up context
  await updateConversation(conv.id, 'idle', {});

  const tokenText = messages.tokenMessage(job.token, job.shop?.name || 'the shop', 10).text;
  return {
    response: {
      editMessage: true,
      text: tokenText,
      buttons: [],
    },
  };
}

async function handleCancel(conv) {
  const ctx = getContext(conv);

  // Cancel any pending job
  if (ctx.jobId) {
    try {
      await jobService.updateJobStatus(ctx.jobId, 'cancelled');
    } catch {
      // Job might already be in a non-cancellable state
    }
  }

  await resetConversation(conv.id);
  return { response: messages.cancelledMessage() };
}

async function handleStatus(userId) {
  const { jobs } = await jobService.getJobsByUser(userId, 5);
  const activeJobs = jobs.filter((j) =>
    ['queued', 'printing', 'ready', 'payment_pending'].includes(j.status)
  );

  if (activeJobs.length === 0) {
    return { response: messages.errorMessage('no_active_order') };
  }

  const job = activeJobs[0];
  return { response: messages.statusUpdateMessage(job.status, job.token) };
}

/**
 * Main dispatcher — routes incoming messages to the right handler
 * based on current conversation state.
 */
async function handleMessage(conv, messageType, data) {
  // Commands work in any state
  if (messageType === 'command') {
    if (data.command === '/cancel') return handleCancel(conv);
    if (data.command === '/status') return handleStatus(conv.userId);
    if (data.command === '/help') return { response: messages.helpMessage() };
    if (data.command === '/start') {
      await resetConversation(conv.id);
      return { response: messages.welcomeMessage() };
    }
  }

  // File received — works from idle or any state (restart flow)
  if (messageType === 'file') {
    return handleFileReceived(conv, data.fileUrl, data.fileName, data.pageCount, data.fileKey);
  }

  // State-based routing for callback/text inputs
  switch (conv.state) {
    case 'idle':
      return { response: messages.errorMessage('no_file') };

    case 'file_received':
      if (data.callback === 'pages_all') return handlePagesSelection(conv, 'all');
      if (data.callback === 'pages_custom') return handlePagesSelection(conv, 'custom');
      // Text input for custom range
      if (data.text) return handlePagesSelection(conv, data.text);
      return { response: messages.pagesSelectionMessage() };

    case 'color_choice':
      if (data.callback === 'color_bw') return handleColorChoice(conv, false);
      if (data.callback === 'color_color') return handleColorChoice(conv, true);
      return { response: messages.colorChoiceMessage() };

    case 'copies_count':
      if (data.callback?.startsWith('copies_')) {
        const val = data.callback.replace('copies_', '');
        return handleCopiesCount(conv, val);
      }
      if (data.text) return handleCopiesCount(conv, data.text);
      return { response: messages.copiesMessage() };

    case 'paper_size':
      if (data.callback?.startsWith('paper_')) {
        const size = data.callback.replace('paper_', '');
        return handlePaperSize(conv, size);
      }
      return { response: messages.paperSizeMessage() };

    case 'sides_choice':
      if (data.callback === 'sides_single') return handleSidesChoice(conv, false);
      if (data.callback === 'sides_double') return handleSidesChoice(conv, true);
      return { response: messages.sidesMessage() };

    case 'shop_selection':
      if (data.callback?.startsWith('shop_')) {
        const shopId = data.callback.replace('shop_', '');
        return handleShopSelection(conv, shopId);
      }
      return { response: { text: 'Please select a shop from the list above.' } };

    case 'price_confirmation':
      if (data.callback === 'confirm_yes') return handleConfirmation(conv, true);
      if (data.callback === 'confirm_cancel') return handleConfirmation(conv, false);
      return { response: { text: 'Please confirm or cancel your order.' } };

    case 'payment_pending': {
      if (data.callback === 'cancel_payment') return handleCancel(conv);
      if (data.callback === 'check_payment') return handleCheckPayment(conv);
      // Any text message also triggers a check (user may have typed "paid" or similar)
      if (data.text) return handleCheckPayment(conv);
      // Re-send the payment link if user taps an old button or asks again
      const pendingCtx = getContext(conv);
      if (pendingCtx.paymentLink && pendingCtx.paymentTotal) {
        return { response: messages.paymentLinkMessage(pendingCtx.paymentLink, pendingCtx.paymentTotal) };
      }
      return { response: { text: 'Please complete the payment or tap *✅ I\'ve Paid* once done.' } };
    }

    default:
      return { response: messages.welcomeMessage() };
  }
}

async function storePaymentMessageId(convId, chatId, messageId) {
  const conv = await prisma.conversation.findUnique({ where: { id: convId } });
  const ctx = getContext(conv);
  ctx.paymentMessageId = messageId;
  ctx.paymentChatId = chatId;
  return prisma.conversation.update({
    where: { id: convId },
    data: { context: JSON.stringify(ctx) },
  });
}

module.exports = {
  getOrCreateConversation,
  handleMessage,
  handleCancel,
  handleStatus,
  resetConversation,
  storePaymentMessageId,
};
