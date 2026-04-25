'use strict';

/**
 * PrintDrop WhatsApp bot v2 — zero-OTP, 3-state, minimal-message flow.
 *
 * ⚠️  EXPERIMENTAL — enabled via BOT_V2=1 env flag.
 *
 * This is NOT the production path. The default production bot is the
 * legacy DB-backed flow in bot/whatsapp.js + services/conversation.js.
 *
 * Key differences from v1 (legacy):
 *   - In-memory sessions (lost on restart; users fall back to IDLE gracefully)
 *   - No OTP — phone number is identity
 *   - 3-state FSM: IDLE → AWAITING_CHOICE → AWAITING_PAYMENT
 *   - Simplified pricing: no paper size / sides / custom page range choices
 *   - Multi-shop selection NOT supported (picks first active shop)
 *
 * The flag is re-read on every webhook so you can flip it live without a restart.
 */

const prisma = require('../../services/prisma');
const { dispatch } = require('./dispatcher');
const { getSession, clearSession, stats: sessionStats } = require('./session');

function isEnabled() {
  const flag = (process.env.BOT_V2 || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * Entry point called by the legacy handleWebhook when BOT_V2 is enabled.
 * Accepts the raw payload and the pre-parsed message (to avoid re-parsing).
 */
async function handleWebhook(parsedMessage) {
  // parsedMessage shape matches parseWebhookPayload() in bot/whatsapp.js +
  // we augment it with messageId where available.
  return dispatch(parsedMessage);
}

/**
 * Clear the v2 session tied to a job once it's been paid / cancelled, so the
 * user can start a fresh order immediately without seeing the "payment
 * pending" nag. Best-effort — called from the Razorpay webhook.
 */
async function clearSessionForJob(jobId) {
  if (!jobId) return;
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { user: { select: { phone: true } } },
    });
    if (job?.user?.phone) clearSession(job.user.phone);
  } catch {
    // non-fatal
  }
}

module.exports = {
  isEnabled,
  handleWebhook,
  getSession,
  clearSession,
  clearSessionForJob,
  sessionStats,
};
