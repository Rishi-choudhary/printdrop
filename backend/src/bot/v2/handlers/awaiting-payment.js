'use strict';

/**
 * AWAITING_PAYMENT state handler.
 *
 * Entry: Razorpay link was sent; we're waiting on the webhook.
 *
 * Transitions:
 *   - New file → treat as a fresh start (replaces the draft — old link expires naturally)
 *   - Any other text → gentle nudge, state unchanged
 *   - CANCEL → handled higher up in dispatcher
 */

const { send } = require('../send');
const M = require('../messages');
const idle = require('./idle');

async function handle(msg, user, session) {
  if (msg.type === 'document' || msg.type === 'image') {
    return idle.handle(msg, user, session);
  }
  return send(user.phone, M.alreadyPending);
}

module.exports = { handle };
