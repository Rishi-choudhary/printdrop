'use strict';

const { authenticate } = require('../middleware/auth');
const orderService     = require('../services/order');

async function orderRoutes(fastify) {

  // ── POST /orders — create multi-file order (authenticated) ───────────────
  fastify.post('/', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { shopId, files, specialInstructions } = request.body || {};

    if (!shopId)                             return reply.code(400).send({ error: 'shopId is required' });
    if (!Array.isArray(files) || !files.length) return reply.code(400).send({ error: 'files array is required' });
    if (files.length > 10)                   return reply.code(400).send({ error: 'Maximum 10 files per order' });

    for (const f of files) {
      if (!f.fileUrl || !f.fileName || !f.pageCount) {
        return reply.code(400).send({ error: 'Each file needs fileUrl, fileName, and pageCount' });
      }
    }

    const shop = await fastify.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || !shop.isActive) return reply.code(404).send({ error: 'Shop not found or inactive' });

    try {
      const result = await orderService.createOrder({
        userId:             request.user.id,
        shopId,
        files,
        source:             'web',
        specialInstructions,
      });

      return reply.code(201).send({
        order: {
          id:         result.order.id,
          token:      result.order.token,
          totalPrice: result.order.totalPrice,
          fileCount:  result.order.fileCount,
          status:     result.order.status,
          jobs:       result.order.jobs.map((j) => ({
            id:         j.id,
            fileName:   j.fileName,
            totalPrice: j.totalPrice,
            status:     j.status,
          })),
        },
      });
    } catch (err) {
      fastify.log.error(err, 'createOrder failed');
      return reply.code(500).send({ error: err.message || 'Failed to create order' });
    }
  });

  // ── POST /orders/public — create order for unauthenticated guest ─────────
  fastify.post('/public', async (request, reply) => {
    const { shopId, files, customerName, customerPhone, specialInstructions } = request.body || {};

    if (!shopId)                             return reply.code(400).send({ error: 'shopId is required' });
    if (!Array.isArray(files) || !files.length) return reply.code(400).send({ error: 'files array is required' });
    if (files.length > 10)                   return reply.code(400).send({ error: 'Maximum 10 files per order' });
    if (!customerPhone)                      return reply.code(400).send({ error: 'customerPhone is required' });

    for (const f of files) {
      if (!f.fileUrl || !f.fileName || !f.pageCount) {
        return reply.code(400).send({ error: 'Each file needs fileUrl, fileName, and pageCount' });
      }
    }

    const shop = await fastify.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || !shop.isActive) return reply.code(404).send({ error: 'Shop not found or inactive' });

    // Find or create guest user by phone
    const normalizedPhone = customerPhone.replace(/\s+/g, '');
    let user = await fastify.prisma.user.findUnique({ where: { phone: normalizedPhone } });
    if (!user) {
      user = await fastify.prisma.user.create({
        data: { phone: normalizedPhone, name: customerName?.trim() || null, role: 'customer' },
      });
    }

    try {
      const result = await orderService.createOrder({
        userId:             user.id,
        shopId,
        files,
        source:             'web',
        specialInstructions,
      });

      // Create payment link immediately for guests (no separate /pay step needed)
      const payment = await orderService.createOrderPaymentLink(result.order.id);

      return reply.code(201).send({
        order: {
          id:         result.order.id,
          token:      result.order.token,
          totalPrice: result.order.totalPrice,
          fileCount:  result.order.fileCount,
          status:     result.order.status,
          shop:       { name: shop.name },
        },
        paymentLink: payment.paymentLink,
      });
    } catch (err) {
      fastify.log.error(err, 'createOrder (public) failed');
      return reply.code(500).send({ error: err.message || 'Failed to create order' });
    }
  });

  // ── POST /orders/:id/pay — create Razorpay payment link for order ────────
  fastify.post('/:id/pay', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const order = await fastify.prisma.order.findUnique({
      where: { id: request.params.id },
    });
    if (!order)                          return reply.code(404).send({ error: 'Order not found' });
    if (order.userId !== request.user.id) return reply.code(403).send({ error: 'Not authorized' });
    if (!['pending', 'payment_pending'].includes(order.status)) {
      return reply.code(409).send({ error: `Order is already ${order.status}` });
    }

    try {
      const payment = await orderService.createOrderPaymentLink(order.id);

      // Flip order to payment_pending
      await fastify.prisma.order.update({
        where: { id: order.id },
        data:  { status: 'payment_pending' },
      });
      await fastify.prisma.job.updateMany({
        where: { orderId: order.id, status: 'pending' },
        data:  { status: 'payment_pending' },
      });

      return { paymentLink: payment.paymentLink, orderId: order.id };
    } catch (err) {
      fastify.log.error(err, 'createOrderPaymentLink failed');
      return reply.code(500).send({ error: err.message || 'Failed to create payment link' });
    }
  });

}

module.exports = orderRoutes;
