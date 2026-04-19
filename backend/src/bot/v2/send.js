'use strict';

/**
 * Thin wrapper over the existing Gupshup sender. Supports an optional buttons
 * array ({ text, callback_data }) for quick-reply prompts — the underlying
 * sender picks quick_reply (≤3) or list format automatically.
 */

const { sendWhatsAppMessage } = require('../../services/notification');

async function send(phone, text, buttons) {
  if (!text) return;
  try {
    return await sendWhatsAppMessage(phone, text, buttons);
  } catch (err) {
    console.error('[bot-v2] send failed', { phone, err: err.message });
  }
}

module.exports = { send };
