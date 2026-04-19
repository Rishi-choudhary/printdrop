'use strict';

/**
 * AWAITING_CHOICE state handler.
 *
 * Entry: user has an in-flight draft Job. We're waiting for either a
 *   - text choice (`1`, `color 2`, …)
 *   - quick_reply callback (`bw_1`, `color_1`, …)
 *   - new file (replaces the draft)
 *
 * Pricing (MVP): print = shop rate × pages × copies, service fee = ₹0.5 × pages
 * (flat, NOT × copies). Rate is selected from the shop's BW/color × single/double
 * rate matrix; v2 defaults to single-sided.
 */

const prisma = require('../../../services/prisma');
const paymentService = require('../../../services/payment');
const { parseChoice } = require('../parsers');
const { setState, STATES } = require('../session');
const { send } = require('../send');
const M = require('../messages');
const idle = require('./idle');

const PLATFORM_FEE_PER_PAGE = 0.5;

async function handle(msg, user, session) {
  // Hot-swap: new file mid-choice → treat as a fresh start
  if (msg.type === 'document' || msg.type === 'image') {
    return idle.handle(msg, user, session);
  }

  const raw = msg.type === 'callback' ? msg.callback : msg.type === 'text' ? msg.text : null;
  if (!raw) return;

  const parsed = parseChoice(raw);
  if (!parsed) return send(user.phone, M.choiceInvalid);

  const job = await prisma.job.findUnique({
    where: { id: session.pendingJobId },
    include: { shop: true },
  });

  if (!job || job.status !== 'pending') {
    setState(user.phone, STATES.IDLE, { pendingJobId: null });
    return send(user.phone, M.sendPdfPlease);
  }

  // ── Pricing ──────────────────────────────────────────────────────────────
  const pricePerPage = pickRate(job.shop, { color: parsed.color, doubleSided: false });
  const printCost = round2(pricePerPage * job.pageCount * parsed.copies);
  const platformFee = round2(PLATFORM_FEE_PER_PAGE * job.pageCount);
  const totalPrice = round2(printCost + platformFee);

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      color: parsed.color,
      copies: parsed.copies,
      pricePerPage,
      totalPrice,
      platformFee,
      shopEarning: printCost,
      paperSize: 'A4',
      doubleSided: false,
    },
  });

  // ── Razorpay link ────────────────────────────────────────────────────────
  let paymentLink;
  try {
    const result = await paymentService.createPaymentLink({
      jobId: updated.id,
      amount: updated.totalPrice,
      customerPhone: user.phone,
      customerName: user.name || 'Customer',
      description: `PrintDrop · ${updated.fileName} · ${updated.pageCount}p × ${updated.copies}`,
    });
    paymentLink = result.paymentLink;
  } catch (err) {
    console.error('[bot-v2] razorpay link create failed', err.message);
    return send(user.phone, M.serverError);
  }

  setState(user.phone, STATES.AWAITING_PAYMENT, { pendingJobId: updated.id });

  return send(user.phone, M.askPay(updated, paymentLink));
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pickRate(shop, { color, doubleSided }) {
  if (color && doubleSided) return shop.ratesColorDouble ?? 4;
  if (color)                return shop.ratesColorSingle ?? 5;
  if (doubleSided)          return shop.ratesBwDouble    ?? 1.5;
  return shop.ratesBwSingle ?? 2;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { handle };
