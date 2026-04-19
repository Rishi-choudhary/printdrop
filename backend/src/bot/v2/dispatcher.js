'use strict';

/**
 * WhatsApp bot v2 — inbound dispatcher.
 *
 * Single entry point for parsed inbound messages. Handles:
 *   1. Idempotency (drop duplicate webhook deliveries)
 *   2. User lookup / creation (phone = identity, no OTP)
 *   3. Universal commands (CANCEL / HELP / START) before state routing
 *   4. State-machine dispatch: IDLE | AWAITING_CHOICE | AWAITING_PAYMENT
 */

const prisma = require('../../services/prisma');
const { wasSeen } = require('./idempotency');
const { getSession, clearSession, STATES } = require('./session');
const { isCancelCommand, isHelpCommand, isStartCommand } = require('./parsers');
const { send } = require('./send');
const M = require('./messages');

const idle     = require('./handlers/idle');
const choice   = require('./handlers/awaiting-choice');
const payment  = require('./handlers/awaiting-payment');

async function dispatch(msg) {
  if (!msg || !msg.phone) return;

  if (msg.messageId && wasSeen('wa', msg.messageId)) return;

  const user = await findOrCreateUser(msg.phone);
  const session = getSession(user.phone);

  // Keep last-active fresh (cheap, async safe).
  prisma.user.update({
    where: { id: user.id },
    data:  { updatedAt: new Date() },
  }).catch(() => {});

  // ── Universal commands ──────────────────────────────────────────────────
  if (msg.type === 'text') {
    if (isCancelCommand(msg.text)) return handleCancel(user, session);
    if (isHelpCommand(msg.text))   return send(user.phone, M.welcome);
    if (isStartCommand(msg.text) && session.state === STATES.IDLE) {
      return send(user.phone, M.welcome);
    }
  }

  // ── State routing ────────────────────────────────────────────────────────
  switch (session.state) {
    case STATES.AWAITING_CHOICE:  return choice.handle(msg, user, session);
    case STATES.AWAITING_PAYMENT: return payment.handle(msg, user, session);
    case STATES.IDLE:
    default:                      return idle.handle(msg, user, session);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function findOrCreateUser(phone) {
  let user = await prisma.user.findUnique({ where: { phone } });
  if (user) return user;

  return prisma.user.create({
    data: {
      phone,
      name: null,
      referralCode: `REF${phone.slice(-6)}${Date.now().toString(36).slice(-4)}`.toUpperCase(),
    },
  });
}

async function handleCancel(user, session) {
  const { pendingJobId, state } = session;

  if (state === STATES.IDLE || !pendingJobId) {
    return send(user.phone, M.noActiveOrder);
  }

  try {
    const job = await prisma.job.findUnique({ where: { id: pendingJobId } });
    if (job && (job.status === 'pending' || job.status === 'payment_pending')) {
      await prisma.job.update({
        where: { id: pendingJobId },
        data:  { status: 'cancelled', cancelledAt: new Date() },
      });
    }
  } catch (err) {
    console.error('[bot-v2] cancel failed', err.message);
  }

  clearSession(user.phone);
  return send(user.phone, M.cancelled);
}

module.exports = { dispatch };
