'use strict';

/**
 * Order service — multi-file batch orders.
 *
 * One Order groups N child Jobs under a single customer-facing token and
 * a single Razorpay payment link. Each child Job is still a regular print
 * record so the desktop agent can keep printing files one-by-one without
 * any change to its polling behavior.
 *
 * Order aggregate status lifecycle:
 *   pending → payment_pending → queued → printing → ready → picked_up
 *                                     ↘ cancelled (any pre-pickup state)
 */

const prisma = require('./prisma');
const { calculatePrice } = require('./pricing');

const MAX_TOKEN_RETRIES = 3;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Compute per-file pricing in a way that mirrors createJob, then return
 * an aggregate plus a per-file array.
 */
function computeBatchPricing({ shop, files, prefs }) {
  const childPricings = files.map((file) =>
    calculatePrice({
      shop,
      pageCount: file.pageCount,
      pageRange: prefs.pageRange,
      color: prefs.color,
      doubleSided: prefs.doubleSided,
      copies: prefs.copies,
      binding: prefs.binding,
    })
  );

  const totals = childPricings.reduce(
    (acc, p) => {
      acc.subtotal += p.subtotal;
      acc.platformFee += p.platformFee;
      acc.shopEarning += p.shopEarning;
      acc.total += p.total;
      acc.totalPages += p.effectivePages;
      return acc;
    },
    { subtotal: 0, platformFee: 0, shopEarning: 0, total: 0, totalPages: 0 },
  );

  return {
    childPricings,
    totals: {
      subtotal: round2(totals.subtotal),
      platformFee: round2(totals.platformFee),
      shopEarning: round2(totals.shopEarning),
      total: round2(totals.total),
      totalPages: totals.totalPages,
    },
  };
}

/**
 * Create one Order with N child Jobs, all sharing one token.
 *
 * files: [{ fileUrl, fileKey, fileName, fileSize, fileType, pageCount }]
 * prefs: { color, copies, doubleSided, paperSize, pageRange, binding }
 */
async function createOrder({
  userId, shopId, files, prefs, source, specialInstructions,
}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('files is required');
  }

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error('Shop not found');

  const safePrefs = {
    color: !!prefs?.color,
    copies: prefs?.copies || 1,
    doubleSided: !!prefs?.doubleSided,
    paperSize: prefs?.paperSize || 'A4',
    pageRange: prefs?.pageRange || 'all',
    binding: prefs?.binding || 'none',
  };

  const { childPricings, totals } = computeBatchPricing({
    shop, files, prefs: safePrefs,
  });

  for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Token = max(token from today's jobs/orders) + 1.
        // Both Job and Order populate token, so we look at both ranges.
        const [lastJob, lastOrder] = await Promise.all([
          tx.job.findFirst({
            where: { shopId, createdAt: { gte: todayStart } },
            orderBy: { token: 'desc' },
            select: { token: true },
          }),
          tx.order.findFirst({
            where: { shopId, createdAt: { gte: todayStart } },
            orderBy: { token: 'desc' },
            select: { token: true },
          }),
        ]);

        const lastToken = Math.max(lastJob?.token || 0, lastOrder?.token || 0);
        const token = lastToken + 1;

        const order = await tx.order.create({
          data: {
            token,
            userId,
            shopId,
            status: 'pending',
            source: source || 'web',
            fileCount: files.length,
            totalPages: totals.totalPages,
            totalPrice: totals.total,
            platformFee: totals.platformFee,
            shopEarning: totals.shopEarning,
            specialInstructions: specialInstructions || null,
          },
        });

        // Create child Jobs
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const p = childPricings[i];
          await tx.job.create({
            data: {
              orderId: order.id,
              token,
              userId,
              shopId,
              fileUrl: f.fileUrl,
              fileKey: f.fileKey || null,
              fileName: f.fileName,
              fileSize: f.fileSize || 0,
              fileType: (f.fileType || 'pdf').toLowerCase(),
              pageCount: f.pageCount,
              color: safePrefs.color,
              copies: safePrefs.copies,
              doubleSided: safePrefs.doubleSided,
              paperSize: safePrefs.paperSize,
              pageRange: safePrefs.pageRange,
              binding: safePrefs.binding,
              pricePerPage: p.pricePerPage,
              totalPrice: p.total,
              platformFee: p.platformFee,
              shopEarning: p.shopEarning,
              status: 'pending',
              source: source || 'web',
            },
          });
        }

        const fullOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: { jobs: true, shop: true, user: true },
        });

        return { order: fullOrder, totals, childPricings };
      }, { isolationLevel: 'Serializable' });
    } catch (err) {
      if ((err.code === 'P2034' || err.code === 'P2002') && attempt < MAX_TOKEN_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
}

/**
 * Create a Razorpay payment link for an Order.
 * Idempotent: if a payment record already exists for the order, returns the
 * existing payment link.
 */
async function createOrderPaymentLink(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, shop: true, payment: true, jobs: true },
  });
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending' && order.status !== 'payment_pending') {
    throw new Error(`Cannot create payment link for order in ${order.status} status`);
  }

  const paymentService = require('./payment');
  const result = await paymentService.createPaymentLink({
    orderId: order.id,
    amount: order.totalPrice,
    customerPhone: order.user?.phone,
    customerName: order.user?.name || 'Customer',
    description: `PrintDrop · ${order.fileCount} file${order.fileCount === 1 ? '' : 's'} at ${order.shop?.name || 'shop'}`,
  });

  return result;
}

/**
 * Mark an Order paid (idempotent). Used by Razorpay webhook handler.
 * Sets order + all child jobs to queued.
 */
async function markOrderPaid(orderId, razorpayPaymentId) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });
    if (!order) return { order: null, justPaid: false };

    if (order.status === 'queued' || order.status === 'printing'
        || order.status === 'ready' || order.status === 'picked_up') {
      return { order, justPaid: false };
    }

    // Atomic flip: only succeeds if status is pending or payment_pending
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'queued', paidAt: now },
    });
    if (count === 0) return { order, justPaid: false };

    await tx.job.updateMany({
      where: { orderId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'queued', paidAt: now },
    });

    if (order.payment) {
      await tx.payment.updateMany({
        where: { id: order.payment.id, status: 'pending' },
        data: { status: 'paid', paidAt: now, ...(razorpayPaymentId ? { razorpayPaymentId } : {}) },
      });
    }

    const fresh = await tx.order.findUnique({
      where: { id: orderId },
      include: { jobs: true, shop: true, user: true, payment: true },
    });
    return { order: fresh, justPaid: true };
  });
}

/**
 * Cancel an Order and all its unpaid child jobs.
 */
async function cancelOrder(orderId) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });
    if (!order) throw new Error('Order not found');

    if (['queued', 'printing', 'ready', 'picked_up', 'cancelled'].includes(order.status)) {
      // Already past payment — cannot self-cancel; require refund flow.
      if (order.status === 'cancelled') return order;
      throw new Error(`Cannot cancel order in ${order.status} status`);
    }

    await tx.order.update({
      where: { id: orderId },
      data: { status: 'cancelled', cancelledAt: now },
    });

    await tx.job.updateMany({
      where: { orderId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'cancelled', cancelledAt: now },
    });

    if (order.payment && order.payment.status === 'pending') {
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { status: 'cancelled' },
      });
    }

    return tx.order.findUnique({
      where: { id: orderId },
      include: { jobs: true, payment: true },
    });
  });
}

/**
 * Mark all child jobs of a paid Order as cancelled (e.g. payment failed
 * after the link was created). Idempotent.
 */
async function failOrder(orderId) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return null;
    if (order.status === 'cancelled') return order;
    if (['queued', 'printing', 'ready', 'picked_up'].includes(order.status)) {
      // Don't touch — payment already succeeded.
      return order;
    }

    await tx.order.update({
      where: { id: orderId },
      data: { status: 'cancelled', cancelledAt: now },
    });
    await tx.job.updateMany({
      where: { orderId, status: { in: ['pending', 'payment_pending'] } },
      data: { status: 'cancelled', cancelledAt: now },
    });

    return tx.order.findUnique({ where: { id: orderId } });
  });
}

/**
 * Recompute the order's aggregate status from its child jobs. Useful when
 * an individual job moves to printing/ready/picked_up so the order reflects
 * progress without spamming customers.
 *
 * Promotion rules (only forward):
 *   - any child printing → order.status = 'printing'
 *   - all children ready → order.status = 'ready'
 *   - all children picked_up → order.status = 'picked_up'
 */
async function recomputeOrderStatus(orderId) {
  if (!orderId) return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { jobs: true },
  });
  if (!order || !order.jobs.length) return order;

  const allReady = order.jobs.every((j) => j.status === 'ready' || j.status === 'picked_up');
  const allPickedUp = order.jobs.every((j) => j.status === 'picked_up');
  const anyPrinting = order.jobs.some((j) => j.status === 'printing');

  let next = order.status;
  if (allPickedUp) next = 'picked_up';
  else if (allReady) next = 'ready';
  else if (anyPrinting && order.status === 'queued') next = 'printing';

  if (next !== order.status) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: next },
    });
  }
  return next;
}

module.exports = {
  createOrder,
  createOrderPaymentLink,
  markOrderPaid,
  cancelOrder,
  failOrder,
  recomputeOrderStatus,
  computeBatchPricing,
};
