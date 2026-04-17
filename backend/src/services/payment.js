const crypto = require('crypto');
const Razorpay = require('razorpay');
const config = require('../config');
const prisma = require('./prisma');

let razorpay = null;
function getRazorpay() {
  if (!razorpay && config.razorpay.keyId && config.razorpay.keySecret) {
    razorpay = new Razorpay({
      key_id: config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
    });
  }
  return razorpay;
}

/**
 * Create a Razorpay payment link for a job.
 * Falls back to mock in dev mode (no Razorpay keys).
 */
async function createPaymentLink({ jobId, amount, customerPhone, customerName, description }) {
  const rz = getRazorpay();
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!rz) {
    // No Razorpay keys configured — mock payment link via dashboard
    const mockLink = `${config.frontendUrl || 'http://localhost:3000'}/pay/${jobId}`;
    const payment = await prisma.payment.create({
      data: {
        jobId,
        amount,
        currency: 'INR',
        razorpayPaymentLink: mockLink,
        razorpayOrderId: `mock_order_${Date.now()}`,
        status: 'pending',
        userId: job?.userId,
      },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'payment_pending' },
    });

    return { paymentLink: mockLink, paymentId: payment.id, mock: true };
  }

  // Production — real Razorpay payment link
  // Telegram users have phone stored as "tg_<chatId>" — not a real phone number
  const validPhone = customerPhone && !customerPhone.startsWith('tg_') ? customerPhone : '';

  const buildLinkData = (phone) => ({
    amount: Math.round(amount * 100), // Razorpay uses paise
    currency: 'INR',
    description: description || `PrintDrop Order`,
    customer: {
      contact: phone,
      name: customerName || 'Customer',
    },
    notify: {
      sms: !!phone,
      email: false,
    },
    callback_url: `${config.frontendUrl}/thankyou?job_id=${jobId}`,
    callback_method: 'get',
    expire_by: Math.floor(Date.now() / 1000) + 1800, // 30 min expiry
    notes: {
      job_id: jobId,
      platform: 'printdrop',
    },
  });

  let link;
  try {
    link = await rz.paymentLink.create(buildLinkData(validPhone));
  } catch (err) {
    // If phone was rejected by Razorpay (e.g. recurring digits, invalid format), retry without it
    if (validPhone && err?.error?.code === 'BAD_REQUEST_ERROR') {
      console.warn(`[payment] Retrying without phone (${err?.error?.description})`);
      link = await rz.paymentLink.create(buildLinkData(''));
    } else {
      throw err;
    }
  }

  const payment = await prisma.payment.create({
    data: {
      jobId,
      amount,
      currency: 'INR',
      razorpayOrderId: link.id,
      razorpayPaymentLink: link.short_url,
      status: 'pending',
      userId: job?.userId,
    },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'payment_pending' },
  });

  return { paymentLink: link.short_url, paymentId: payment.id, mock: false };
}

/**
 * Verify Razorpay webhook signature (X-Razorpay-Signature header).
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret) {
    // In production, reject unsigned webhooks rather than silently accepting them
    if (!config.isDev) {
      console.warn('[payment] RAZORPAY_WEBHOOK_SECRET not set — rejecting unsigned webhook in production');
      return false;
    }
    return true; // Dev: allow unsigned for local testing
  }
  const expected = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

/**
 * Handle successful payment — update payment + job status.
 */
async function handlePaymentSuccess(razorpayPaymentId, razorpayPaymentLinkId) {
  let payment;

  if (razorpayPaymentLinkId) {
    payment = await prisma.payment.findFirst({
      where: { razorpayOrderId: razorpayPaymentLinkId },
      include: { job: true },
    });
  }
  if (!payment && razorpayPaymentId) {
    payment = await prisma.payment.findFirst({
      where: { razorpayPaymentId },
      include: { job: true },
    });
  }

  if (!payment) throw new Error('Payment record not found');
  if (payment.status === 'paid') return { payment, justPaid: false };

  // Atomic update: only succeeds if status is still 'pending' (prevents double-processing)
  const now = new Date();
  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: 'pending' },
    data: {
      status: 'paid',
      razorpayPaymentId,
      paidAt: now,
    },
  });

  // Another caller already processed this payment
  if (count === 0) return { payment, justPaid: false };

  await prisma.job.update({
    where: { id: payment.jobId },
    data: { status: 'queued', paidAt: now },
  });

  return { payment, justPaid: true };
}

/**
 * Handle failed payment.
 */
async function handlePaymentFailed(razorpayPaymentId, razorpayPaymentLinkId) {
  let payment;

  if (razorpayPaymentLinkId) {
    payment = await prisma.payment.findFirst({
      where: { razorpayOrderId: razorpayPaymentLinkId },
      include: { job: true },
    });
  }
  if (!payment && razorpayPaymentId) {
    payment = await prisma.payment.findFirst({
      where: { razorpayPaymentId },
      include: { job: true },
    });
  }

  if (!payment) return null;

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'failed', razorpayPaymentId },
  });

  await prisma.job.update({
    where: { id: payment.jobId },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });

  // Reset any conversation stuck in payment_pending for this user
  await resetUserConversation(payment.userId);

  return payment;
}

/**
 * Initiate a refund via Razorpay.
 */
async function resetUserConversation(userId) {
  if (!userId) return;
  try {
    await prisma.conversation.updateMany({
      where: { userId, state: 'payment_pending' },
      data: { state: 'idle', context: '{}' },
    });
  } catch {
    // Non-critical — best effort
  }
}

async function initiateRefund(jobId, reason) {
  const payment = await prisma.payment.findUnique({
    where: { jobId },
    include: { job: true },
  });

  if (!payment || payment.status !== 'paid') {
    throw new Error('No paid payment found for this job');
  }

  const rz = getRazorpay();

  if (!rz || !payment.razorpayPaymentId || payment.razorpayPaymentId.startsWith('mock_')) {
    // Dev mode mock refund
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'refunded', refundId: `mock_refund_${Date.now()}` },
    });
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await resetUserConversation(payment.userId);
    return { refundId: `mock_refund_${Date.now()}`, mock: true };
  }

  // Real Razorpay refund
  const refund = await rz.payments.refund(payment.razorpayPaymentId, {
    amount: Math.round(payment.amount * 100),
    speed: 'normal',
    notes: { reason, job_id: jobId },
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'refunded', refundId: refund.id },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });

  await resetUserConversation(payment.userId);

  return { refundId: refund.id, mock: false };
}

/**
 * Get payment status for a job.
 */
async function getPaymentStatus(jobId) {
  const payment = await prisma.payment.findUnique({
    where: { jobId },
  });
  if (!payment) return null;

  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    paymentLink: payment.razorpayPaymentLink,
    paidAt: payment.paidAt,
    refundId: payment.refundId,
  };
}

/**
 * Check Razorpay for payment status and process if paid.
 * Used when webhook hasn't fired (local dev, closed tab, etc.)
 */
async function checkAndProcessPaymentLink(jobId) {
  const payment = await prisma.payment.findFirst({
    where: { jobId },
    include: { job: true },
  });

  if (!payment) return { paid: false };

  // Already processed
  if (payment.status === 'paid') return { paid: true, alreadyPaid: true };

  // Mock payments can't be polled — return not paid
  if (!payment.razorpayOrderId || payment.razorpayOrderId.startsWith('mock_')) {
    return { paid: false };
  }

  const rz = getRazorpay();
  if (!rz) return { paid: false };

  try {
    const link = await rz.paymentLink.fetch(payment.razorpayOrderId);

    if (link.status === 'paid') {
      // Extract payment ID from the payments array if available
      const razorpayPaymentId = link.payments?.[0]?.payment_id || `rp_${Date.now()}`;
      const { payment: updatedPayment, justPaid } = await handlePaymentSuccess(
        razorpayPaymentId,
        payment.razorpayOrderId,
      );
      return { paid: true, justPaid, payment: updatedPayment };
    }

    return { paid: false };
  } catch (err) {
    console.error('Razorpay link fetch error:', err.message);
    return { paid: false };
  }
}

module.exports = {
  createPaymentLink,
  verifyWebhookSignature,
  handlePaymentSuccess,
  handlePaymentFailed,
  checkAndProcessPaymentLink,
  initiateRefund,
  getPaymentStatus,
};
