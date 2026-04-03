/**
 * PrintDrop — Message templates for WhatsApp & Telegram bots.
 * Each function returns { text, buttons? } for consistent cross-platform use.
 */

function welcomeMessage() {
  return {
    text:
      `*PrintDrop* \n\n` +
      `Send me a PDF, image, or document and I'll get it printed at a shop near you.\n\n` +
      `*How it works:*\n` +
      `1. Send a file\n` +
      `2. Choose print settings\n` +
      `3. Pay online\n` +
      `4. Pick up with your token\n\n` +
      `You can also place orders on our website: random\\_link.com\n\n` +
      `*Commands:*\n` +
      `/start - Start over\n` +
      `/help - How to use\n` +
      `/status - Check print status\n` +
      `/history - Recent orders\n` +
      `/cancel - Cancel current order`,
  };
}

function fileReceivedMessage(pageCount, fileName) {
  return {
    text:
      `Got *${escapeText(fileName)}*\n` +
      `${pageCount} page${pageCount !== 1 ? 's' : ''} detected.\n\n` +
      `Which pages do you want to print?`,
    buttons: [
      { text: 'All Pages', callback_data: 'pages_all' },
      { text: 'Custom Range', callback_data: 'pages_custom' },
    ],
  };
}

function pagesSelectionMessage() {
  return {
    text: 'Which pages would you like to print?',
    buttons: [
      { text: 'All Pages', callback_data: 'pages_all' },
      { text: 'Custom Range', callback_data: 'pages_custom' },
    ],
  };
}

function customRangePromptMessage() {
  return {
    text: 'Enter the page range (e.g. `1-5,8,10-12`):',
  };
}

function colorChoiceMessage() {
  return {
    text: 'Color or Black & White?',
    buttons: [
      { text: 'B&W', callback_data: 'color_bw' },
      { text: 'Color', callback_data: 'color_color' },
    ],
  };
}

function copiesMessage() {
  return {
    text: 'How many copies?',
    buttons: [
      { text: '1', callback_data: 'copies_1' },
      { text: '2', callback_data: 'copies_2' },
      { text: '3', callback_data: 'copies_3' },
      { text: '5', callback_data: 'copies_5' },
      { text: 'Other', callback_data: 'copies_other' },
    ],
  };
}

function paperSizeMessage() {
  return {
    text: 'Paper size?',
    buttons: [
      { text: 'A4', callback_data: 'paper_A4' },
      { text: 'A3', callback_data: 'paper_A3' },
      { text: 'Legal', callback_data: 'paper_Legal' },
    ],
  };
}

function sidesMessage() {
  return {
    text: 'Single-sided or Double-sided?',
    buttons: [
      { text: 'Single-sided', callback_data: 'sides_single' },
      { text: 'Double-sided', callback_data: 'sides_double' },
    ],
  };
}

function shopListMessage(shops) {
  if (!shops || shops.length === 0) {
    return {
      text: 'Sorry, no shops are available right now. Please try again later.',
    };
  }

  let text = 'Select a shop:\n\n';
  const buttons = [];

  shops.forEach((shop, i) => {
    const num = i + 1;
    const distance = shop.distance ? ` (${shop.distance})` : '';
    const hours = `${shop.opensAt} - ${shop.closesAt}`;
    text += `*${num}. ${escapeText(shop.name)}*${distance}\n`;
    text += `   ${escapeText(shop.address || 'Address not available')}\n`;
    text += `   Hours: ${hours}\n\n`;
    buttons.push({ text: `${num}. ${shop.name}`, callback_data: `shop_${shop.id}` });
  });

  return { text, buttons };
}

function priceSummaryMessage(details) {
  const {
    fileName,
    pages,
    pageRange,
    color,
    copies,
    doubleSided,
    paperSize,
    shopName,
    pricePerPage,
    subtotal,
    platformFee,
    total,
  } = details;

  const colorStr = color ? 'Color' : 'B&W';
  const sidesStr = doubleSided ? 'Double-sided' : 'Single-sided';
  const rangeStr = pageRange === 'all' ? 'All' : pageRange;

  let text = `*Order Summary*\n\n`;
  text += `File: ${escapeText(fileName)}\n`;
  text += `Pages: ${rangeStr} (${pages} page${pages !== 1 ? 's' : ''})\n`;
  text += `Mode: ${colorStr} | ${sidesStr}\n`;
  text += `Paper: ${paperSize}\n`;
  text += `Copies: ${copies}\n`;
  text += `Shop: ${escapeText(shopName)}\n\n`;
  text += `${pricePerPage}/page x ${pages}pg x ${copies} = ${subtotal.toFixed(2)}\n`;
  text += `Platform fee: ${platformFee.toFixed(2)}\n`;
  text += `*Total: Rs ${total.toFixed(2)}*\n\n`;
  text += `Confirm this order?`;

  return {
    text,
    buttons: [
      { text: 'Confirm & Pay', callback_data: 'confirm_yes' },
      { text: 'Cancel', callback_data: 'confirm_cancel' },
    ],
  };
}

function paymentLinkMessage(link, amount) {
  return {
    isPaymentLink: true,
    text:
      `Pay *Rs ${amount.toFixed(2)}* to confirm your order.\n\n` +
      `The link expires in 30 minutes. Once paid, tap *✅ I've Paid* to confirm.\n\n` +
      `To cancel this order, tap *❌ Cancel Order* below.`,
    buttons: [
      { text: '💳 Pay Now', url: link },
      { text: '✅ I\'ve Paid', callback_data: 'check_payment' },
      { text: '❌ Cancel Order', callback_data: 'cancel_payment' },
    ],
  };
}

function tokenMessage(token, shopName, eta) {
  return {
    text:
      `Payment confirmed!\n\n` +
      `Your token: *#${String(token).padStart(3, '0')}*\n` +
      `Shop: *${escapeText(shopName)}*\n` +
      `ETA: ~${eta} min\n\n` +
      `Show this token number at the shop to pick up your print.`,
  };
}

function statusUpdateMessage(status, token) {
  const formattedToken = `#${String(token).padStart(3, '0')}`;
  const statusMap = {
    queued: `Your print ${formattedToken} is *queued* and will be printed soon.`,
    printing: `Your print ${formattedToken} is *being printed* right now!`,
    ready: `Your print ${formattedToken} is *ready for pickup*! Head to the shop.`,
    picked_up: `Your print ${formattedToken} has been *picked up*. Thanks for using PrintDrop!`,
    cancelled: `Your print ${formattedToken} has been *cancelled*.`,
    payment_pending: `Your print ${formattedToken} is *awaiting payment*.`,
  };

  return {
    text: statusMap[status] || `Your print ${formattedToken} status: *${status}*`,
  };
}

function historyMessage(jobs) {
  if (!jobs || jobs.length === 0) {
    return { text: 'No order history yet. Send a file to get started!' };
  }

  let text = '*Recent Orders*\n\n';
  for (const job of jobs.slice(0, 5)) {
    const token = `#${String(job.token).padStart(3, '0')}`;
    const statusIcon = {
      queued: '[Q]', printing: '[P]', ready: '[R]',
      picked_up: '[D]', cancelled: '[X]', payment_pending: '[$]',
    }[job.status] || '[?]';
    const date = new Date(job.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    text += `${statusIcon} ${token} ${escapeText(job.fileName)} - Rs ${job.totalPrice.toFixed(0)} (${date})\n`;
  }

  return { text };
}

function errorMessage(error) {
  const messages = {
    file_too_large: 'That file is too large. Maximum size is 50 MB.',
    unsupported_type: 'Sorry, that file type is not supported.\nSupported: PDF, JPG, PNG, DOCX, PPTX',
    no_file: 'Please send a file (PDF, image, or document) to get started.',
    invalid_range: 'Invalid page range. Use format like `1-5,8,10-12`.',
    invalid_copies: 'Please enter a number between 1 and 100.',
    payment_failed: 'Payment failed. Please try again or contact support.',
    shop_closed: 'This shop is currently closed. Please choose another shop or try later.',
    server_error: 'Something went wrong. Please try again or type /start to restart.',
    no_active_order: 'You don\'t have an active order. Send a file to start a new one.',
    expired_session: 'Your session has expired. Please send the file again to start over.',
    converting: 'Converting your document to PDF... This may take a moment.',
  };

  return {
    text: messages[error] || `Error: ${error}. Please try again or type /help.`,
  };
}

function helpMessage() {
  return {
    text:
      `*How to use PrintDrop:*\n\n` +
      `1. Send a PDF, image, or document\n` +
      `2. Choose pages, color, copies, paper, and sides\n` +
      `3. Confirm the order summary\n` +
      `4. Pay online via the payment link\n` +
      `5. Pick up with your token number\n\n` +
      `*Supported files:* PDF, JPG, PNG, DOCX, PPTX\n` +
      `*Max size:* 50 MB\n\n` +
      `*Commands:*\n` +
      `/start - Start over\n` +
      `/help - This message\n` +
      `/status - Check print status\n` +
      `/history - Recent orders\n` +
      `/cancel - Cancel current order`,
  };
}

function cancelledMessage() {
  return {
    text: 'Order cancelled. Send a new file whenever you\'re ready!',
  };
}

function customCopiesPromptMessage() {
  return {
    text: 'Enter the number of copies (1-100):',
  };
}

function processingMessage() {
  return {
    text: 'Processing your file...',
  };
}

/**
 * Escape characters that break Telegram Markdown.
 */
function escapeText(text) {
  if (!text) return '';
  return text.replace(/([_`\[\]])/g, '\\$1');
}

module.exports = {
  welcomeMessage,
  fileReceivedMessage,
  pagesSelectionMessage,
  customRangePromptMessage,
  colorChoiceMessage,
  copiesMessage,
  paperSizeMessage,
  sidesMessage,
  shopListMessage,
  priceSummaryMessage,
  paymentLinkMessage,
  tokenMessage,
  statusUpdateMessage,
  historyMessage,
  errorMessage,
  helpMessage,
  cancelledMessage,
  customCopiesPromptMessage,
  processingMessage,
  escapeText,
};
