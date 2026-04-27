const crypto = require('crypto');
const Razorpay = require('razorpay');
const config = require('../config');
const prisma = require('./prisma');
const { timingSafeEqualHex } = require('../utils/request');

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
 * Create a Razorpay payment link for a Job or an Order.
 *
 * Pass exactly one of jobId or orderId. The webhook handler routes payment
 * success / failure based on which field is set on the Payment record.
 *
 * Idempotent: if a pending payment link already exists for the target, returns it.
 * Falls back to mock in dev mode (no Razorpay keys).
 */
async function createPaymentLink({ jobId, orderId, amount, customerPhone, customerName, description }) {
  if (!jobId && !orderId) throw new Error('jobId or orderId is required');
  if (jobId && orderId) throw new Error('Pass jobId OR orderId, not both');

  const rz = getRazorpay();
  const isOrder = !!orderId;
  const appCheckoutPath = isOrder ? `/pay/order/${orderId}` : `/pay/${jobId}`;
  const appCheckoutLink = `${config.frontendUrl || 'https://printdrop.app'}${appCheckoutPath}`;
  // Default to Razorpay-hosted payment links (rzp.io/...). Set
  // RAZORPAY_USE_HOSTED_LINKS=0 to fall back to the in-app /pay/[jobId] page
  // that opens Razorpay Standard Checkout via checkout.js.
  const useHostedPaymentLinks = process.env.RAZORPAY_USE_HOSTED_LINKS !== '0';

  let target;
  if (isOrder) {
    target = await prisma.order.findUnique({ where: { id: orderId } });
    if (!target) throw new Error('Order not found');
    if (target.status !== 'pending' && target.status !== 'payment_pending') {
      throw new Error(`Cannot create payment link for order in ${target.status} status`);
    }
  } else {
    target = await prisma.job.findUnique({ where: { id: jobId } });
    if (!target) throw new Error('Job not found');
    if (target.status !== 'pending' && target.status !== 'payment_pending') {
      throw new Error(`Cannot create payment link for job in ${target.status} status`);
    }
  }

  // Idempotency: return existing payment link for this target if any
  const existingPayment = isOrder
    ? await prisma.payment.findUnique({ where: { orderId } })
    : await prisma.payment.findUnique({ where: { jobId } });

  if (!useHostedPaymentLinks) {
    if (existingPayment) {
      if (existingPayment.razorpayPaymentLink !== appCheckoutLink) {
        await prisma.payment.update({
          where: { id: existingPayment.id },
          data: { razorpayPaymentLink: appCheckoutLink },
        });
      }
      return {
        paymentLink: appCheckoutLink,
        paymentId: existingPayment.id,
        mock: false,
        existing: true,
        status: existingPayment.status,
      };
    }

    const payment = await prisma.payment.create({
      data: {
        ...(isOrder ? { orderId } : { jobId }),
        amount,
        currency: 'INR',
        razorpayPaymentLink: appCheckoutLink,
        status: 'pending',
        userId: target?.userId,
      },
    });

    if (isOrder) {
      await prisma.order.updateMany({
        where: { id: orderId, status: 'pending' },
        data: { status: 'payment_pending' },
      });
      await prisma.job.updateMany({
        where: { orderId, status: 'pending' },
        data: { status: 'payment_pending' },
      });
    } else {
      await prisma.job.updateMany({
        where: { id: jobId, status: 'pending' },
        data: { status: 'payment_pending' },
      });
    }

    return { paymentLink: appCheckoutLink, paymentId: payment.id, mock: false };
  }

  if (existingPayment?.razorpayPaymentLink) {
    return {
      paymentLink: existingPayment.razorpayPaymentLink,
      paymentId: existingPayment.id,
      mock: existingPayment.razorpayOrderId?.startsWith('mock_') ?? false,
      existing: true,
      status: existingPayment.status,
    };
  }

  const mockPath = isOrder ? `/pay/order/${orderId}` : `/pay/${jobId}`;
  const callbackQs = isOrder ? `order_id=${orderId}` : `job_id=${jobId}`;

  if (!rz) {
    // No Razorpay keys configured — mock payment link via dashboard
    const mockLink = `${config.frontendUrl || 'https://printdrop.app'}${mockPath}`;
    const payment = await prisma.payment.create({
      data: {
        ...(isOrder ? { orderId } : { jobId }),
        amount,
        currency: 'INR',
        razorpayPaymentLink: mockLink,
        razorpayOrderId: `mock_order_${Date.now()}`,
        status: 'pending',
        userId: target?.userId,
      },
    });

    if (isOrder) {
      await prisma.order.updateMany({
        where: { id: orderId, status: 'pending' },
        data: { status: 'payment_pending' },
      });
      await prisma.job.updateMany({
        where: { orderId, status: 'pending' },
        data: { status: 'payment_pending' },
      });
    } else {
      await prisma.job.updateMany({
        where: { id: jobId, status: 'pending' },
        data: { status: 'payment_pending' },
      });
    }

    return { paymentLink: mockLink, paymentId: payment.id, mock: true };
  }

  // Production — real Razorpay payment link
  // Telegram users have phone stored as "tg_<chatId>" — not a real phone number.
  // Razorpay expects phone WITHOUT leading + and in E.164 digits only.
  const cleanPhone = (customerPhone || '').replace(/^\+/, '').trim();
  const validPhone = cleanPhone && !/^tg_/.test(cleanPhone) && /^\d{10,15}$/.test(cleanPhone)
    ? cleanPhone
    : '';

  const buildLinkData = (phone) => ({
    amount: Math.round(amount * 100), // Razorpay uses paise
    currency: 'INR',
    description: description || `PrintDrop Order`,
    // reference_id appears as razorpay_payment_link_reference_id in the redirect —
    // used as fallback when UPI mobile redirect drops our custom callback_url query params.
    reference_id: (isOrder ? orderId : jobId).slice(0, 40),
    customer: {
      contact: phone,
      name: customerName || 'Customer',
    },
    notify: {
      sms: !!phone,
      email: false,
    },
    // Put jobId/orderId in the URL PATH, not query string — Razorpay UPI mobile
    // redirect sometimes strips custom query params but never strips the path.
    callback_url: `${config.frontendUrl}/${isOrder ? `pay/order/${orderId}` : `pay/${jobId}`}`,
    callback_method: 'get',
    expire_by: Math.floor(Date.now() / 1000) + 1800, // 30 min expiry
    notes: {
      ...(isOrder ? { order_id: orderId } : { job_id: jobId }),
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
      ...(isOrder ? { orderId } : { jobId }),
      amount,
      currency: 'INR',
      razorpayOrderId: link.id,
      razorpayPaymentLink: link.short_url,
      status: 'pending',
      userId: target?.userId,
    },
  });

  if (isOrder) {
    await prisma.order.updateMany({
      where: { id: orderId, status: 'pending' },
      data: { status: 'payment_pending' },
    });
    await prisma.job.updateMany({
      where: { orderId, status: 'pending' },
      data: { status: 'payment_pending' },
    });
  } else {
    await prisma.job.updateMany({
      where: { id: jobId, status: 'pending' },
      data: { status: 'payment_pending' },
    });
  }

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
  return timingSafeEqualHex(expected, signature);
}

/**
 * Server-side verification: confirm Razorpay actually captured the money before
 * we mark anything as paid. This is the SOLE source of truth — never trust
 * client-side redirect params, even when their HMAC signature is valid.
 *
 * Razorpay's hosted UPI page can show "Confirm Payment" / optimistic success UI
 * before the bank settles the intent. Without this guard, a user who exits the
 * UPI app without paying could still trigger a token because the redirect URL
 * carries status=paid.
 *
 * Returns true if Razorpay confirms paid/captured, false otherwise.
 * Returns true (skips check) for mock IDs in development.
 */
async function verifyWithRazorpay(razorpayPaymentId, razorpayPaymentLinkId) {
  // Mock IDs (dev mode) — skip verification
  if (
    (razorpayPaymentId && razorpayPaymentId.startsWith('mock_')) ||
    (razorpayPaymentLinkId && razorpayPaymentLinkId.startsWith('mock_'))
  ) {
    return { ok: true, status: 'mock' };
  }

  const rz = getRazorpay();
  if (!rz) {
    // No Razorpay configured — only allowed in dev
    return { ok: !!config.isDev, status: 'no_client' };
  }

  // Prefer payment_link verification when we have a plink_ id (hosted links)
  if (razorpayPaymentLinkId && razorpayPaymentLinkId.startsWith('plink_')) {
    try {
      const link = await rz.paymentLink.fetch(razorpayPaymentLinkId);
      return { ok: link.status === 'paid', status: link.status };
    } catch (err) {
      console.error('[payment] paymentLink.fetch failed:', err.message);
      return { ok: false, status: 'fetch_error', error: err.message };
    }
  }

  // Standard Checkout — order_xxx id; check the order's payment status
  if (razorpayPaymentLinkId && razorpayPaymentLinkId.startsWith('order_')) {
    try {
      const order = await rz.orders.fetch(razorpayPaymentLinkId);
      // 'paid' on an order means at least one captured payment exists for it
      return { ok: order.status === 'paid', status: order.status };
    } catch (err) {
      console.error('[payment] orders.fetch failed:', err.message);
      return { ok: false, status: 'fetch_error', error: err.message };
    }
  }

  // Fallback to payment id verification
  if (razorpayPaymentId && /^pay_[A-Za-z0-9]+$/.test(razorpayPaymentId)) {
    try {
      const p = await rz.payments.fetch(razorpayPaymentId);
      return { ok: p.status === 'captured', status: p.status };
    } catch (err) {
      console.error('[payment] payments.fetch failed:', err.message);
      return { ok: false, status: 'fetch_error', error: err.message };
    }
  }

  return { ok: false, status: 'unverifiable' };
}

/**
 * Handle successful payment — update payment + job/order status.
 *
 * Routes by Payment.orderId vs Payment.jobId. Order payments cascade to all
 * child jobs in one transaction; single-job payments preserve legacy behavior.
 *
 * Server-side verifies with Razorpay API before any DB mutation. Returns
 * { payment, justPaid: false, notVerified: true } when Razorpay reports
 * the payment is not actually captured.
 */
async function handlePaymentSuccess(razorpayPaymentId, razorpayPaymentLinkId) {
  let payment;

  if (razorpayPaymentLinkId) {
    payment = await prisma.payment.findFirst({
      where: { razorpayOrderId: razorpayPaymentLinkId },
      include: { job: true, order: true },
    });
  }
  if (!payment && razorpayPaymentId) {
    payment = await prisma.payment.findFirst({
      where: { razorpayPaymentId },
      include: { job: true, order: true },
    });
  }

  if (!payment) throw new Error('Payment record not found');
  if (payment.status === 'paid') return { payment, justPaid: false };

  // Authoritative verification with Razorpay API
  const verified = await verifyWithRazorpay(razorpayPaymentId, razorpayPaymentLinkId);
  if (!verified.ok) {
    console.warn('[payment] verification failed', {
      razorpayPaymentId,
      razorpayPaymentLinkId,
      paymentId: payment.id,
      razorpayStatus: verified.status,
    });
    return { payment, justPaid: false, notVerified: true, razorpayStatus: verified.status };
  }

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

  if (payment.orderId) {
    await prisma.order.updateMany({
      where: { id: payment.orderId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'queued', paidAt: now },
    });
    await prisma.job.updateMany({
      where: { orderId: payment.orderId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'queued', paidAt: now },
    });
  } else if (payment.jobId) {
    await prisma.job.updateMany({
      where: { id: payment.jobId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'queued', paidAt: now },
    });
  }

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
      include: { job: true, order: true },
    });
  }
  if (!payment && razorpayPaymentId) {
    payment = await prisma.payment.findFirst({
      where: { razorpayPaymentId },
      include: { job: true, order: true },
    });
  }

  if (!payment) return null;

  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: 'pending' },
    data: { status: 'failed', razorpayPaymentId },
  });
  if (count === 0) return payment;

  const now = new Date();
  if (payment.orderId) {
    await prisma.order.updateMany({
      where: { id: payment.orderId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'cancelled', cancelledAt: now },
    });
    await prisma.job.updateMany({
      where: { orderId: payment.orderId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'cancelled', cancelledAt: now },
    });
  } else if (payment.jobId) {
    await prisma.job.updateMany({
      where: { id: payment.jobId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'cancelled', cancelledAt: now },
    });
  }

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
    const refundId = `mock_refund_${Date.now()}`;
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'refunded', refundId },
    });
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await resetUserConversation(payment.userId);
    return { refundId, mock: true };
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
 * Create a Razorpay order for Standard Checkout (inline modal flow).
 *
 * Unlike createPaymentLink (hosted page), this creates a Razorpay order that
 * the frontend opens via checkout.js. Signature is verified server-side in
 * the /razorpay/verify-checkout route before marking the payment as paid.
 *
 * Idempotent: if a checkout order already exists for the target (razorpayOrderId
 * starts with "order_"), returns it without creating a new one.
 */
async function createCheckoutOrder({ jobId, orderId }) {
  if (!jobId && !orderId) throw new Error('jobId or orderId is required');
  if (jobId && orderId) throw new Error('Pass jobId OR orderId, not both');

  const rz = getRazorpay();
  if (!rz) throw new Error('Razorpay not configured');

  const isOrder = !!orderId;
  let target;

  if (isOrder) {
    target = await prisma.order.findUnique({ where: { id: orderId } });
    if (!target) throw new Error('Order not found');
    if (!['pending', 'payment_pending'].includes(target.status)) {
      throw new Error(`Cannot create payment for order in ${target.status} status`);
    }
  } else {
    target = await prisma.job.findUnique({ where: { id: jobId } });
    if (!target) throw new Error('Job not found');
    if (!['pending', 'payment_pending'].includes(target.status)) {
      throw new Error(`Cannot create payment for job in ${target.status} status`);
    }
  }

  const existingPayment = isOrder
    ? await prisma.payment.findUnique({ where: { orderId } })
    : await prisma.payment.findUnique({ where: { jobId } });

  if (existingPayment?.status === 'paid') {
    throw new Error('Payment already completed');
  }

  // Idempotency: reuse an existing Razorpay order (not a payment link)
  if (existingPayment?.razorpayOrderId?.startsWith('order_')) {
    try {
      await rz.orders.fetch(existingPayment.razorpayOrderId);
      return {
        orderId: existingPayment.razorpayOrderId,
        amount: Math.round(target.totalPrice * 100),
        currency: 'INR',
        keyId: config.razorpay.keyId,
      };
    } catch (err) {
      console.warn(`[payment] Existing Razorpay order could not be fetched with current keys; creating a new order (${err.message})`);
    }
  }

  const receiptId = isOrder ? `ord_${orderId.slice(-12)}` : `job_${jobId.slice(-12)}`;
  const rzOrder = await rz.orders.create({
    amount: Math.round(target.totalPrice * 100),
    currency: 'INR',
    receipt: receiptId,
    notes: {
      ...(isOrder ? { order_id: orderId } : { job_id: jobId }),
      platform: 'printdrop',
    },
  });

  if (existingPayment) {
    // Overwrite payment link ID with the new Razorpay order ID so
    // handlePaymentSuccess can locate this record by razorpayOrderId.
    await prisma.payment.update({
      where: { id: existingPayment.id },
      data: { razorpayOrderId: rzOrder.id },
    });
  } else {
    await prisma.payment.create({
      data: {
        ...(isOrder ? { orderId } : { jobId }),
        amount: target.totalPrice,
        currency: 'INR',
        razorpayOrderId: rzOrder.id,
        status: 'pending',
        userId: target.userId,
      },
    });
  }

  if (isOrder) {
    await prisma.order.updateMany({
      where: { id: orderId, status: 'pending' },
      data: { status: 'payment_pending' },
    });
    await prisma.job.updateMany({
      where: { orderId, status: 'pending' },
      data: { status: 'payment_pending' },
    });
  } else {
    await prisma.job.updateMany({
      where: { id: jobId, status: 'pending' },
      data: { status: 'payment_pending' },
    });
  }

  return {
    orderId: rzOrder.id,
    amount: rzOrder.amount,
    currency: rzOrder.currency,
    keyId: config.razorpay.keyId,
  };
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
 * Get payment status for an order.
 */
async function getOrderPaymentStatus(orderId) {
  const payment = await prisma.payment.findUnique({
    where: { orderId },
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
  createCheckoutOrder,
  verifyWebhookSignature,
  handlePaymentSuccess,
  handlePaymentFailed,
  checkAndProcessPaymentLink,
  initiateRefund,
  getPaymentStatus,
  getOrderPaymentStatus,
};
