const { authenticate, requireRole } = require('../middleware/auth');
const jobService = require('../services/job');
const paymentService = require('../services/payment');
const { notifyUser } = require('../services/notification');
const messages = require('../bot/messages');

async function jobRoutes(fastify) {
  // GET /jobs — list jobs (role-filtered)
  fastify.get('/', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { role, id: userId } = request.user;
    const { status, limit = 20, offset = 0 } = request.query;

    const where = {};
    if (role === 'customer') {
      where.userId = userId;
    } else if (role === 'shopkeeper' && request.user.shop) {
      where.shopId = request.user.shop.id;
    }
    // Admin sees all

    if (status) where.status = status;

    const [jobs, total] = await Promise.all([
      fastify.prisma.job.findMany({
        where,
        include: { shop: true, user: { select: { id: true, name: true, phone: true } }, payment: true },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      fastify.prisma.job.count({ where }),
    ]);

    return { jobs, total, limit: parseInt(limit), offset: parseInt(offset) };
  });

  // GET /jobs/:id — job details
  fastify.get('/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
      include: { shop: true, user: { select: { id: true, name: true, phone: true } }, payment: true },
    });

    if (!job) return reply.code(404).send({ error: 'Job not found' });

    // Authorization
    const { role, id: userId } = request.user;
    if (role === 'customer' && job.userId !== userId) {
      return reply.code(403).send({ error: 'Not authorized' });
    }
    if (role === 'shopkeeper' && request.user.shop?.id !== job.shopId) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    return job;
  });

  // POST /jobs — create job from web
  fastify.post('/', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const {
      shopId, fileUrl, fileKey, fileName, fileSize, fileType,
      pageCount, color, copies, doubleSided, paperSize,
      pageRange, binding,
    } = request.body;

    if (!shopId || !fileUrl || !fileName) {
      return reply.code(400).send({ error: 'shopId, fileUrl, and fileName are required' });
    }

    const { job, pricing } = await jobService.createJob({
      userId: request.user.id,
      shopId,
      fileUrl,
      fileKey,
      fileName,
      fileSize: fileSize || 0,
      fileType: fileType || 'pdf',
      pageCount: pageCount || 1,
      color: color || false,
      copies: copies || 1,
      doubleSided: doubleSided || false,
      paperSize: paperSize || 'A4',
      pageRange: pageRange || 'all',
      binding: binding || 'none',
      source: 'web',
    });

    return reply.code(201).send({ job, pricing });
  });

  // PATCH /jobs/:id/status — update status (shopkeeper or admin)
  fastify.patch('/:id/status', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { status, printerId, printerName } = request.body;
    if (!status) return reply.code(400).send({ error: 'status is required' });

    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
      include: { shop: true },
    });

    if (!job) return reply.code(404).send({ error: 'Job not found' });

    // Only shopkeeper of that shop or admin
    const { role } = request.user;
    if (role === 'shopkeeper' && request.user.shop?.id !== job.shopId) {
      return reply.code(403).send({ error: 'Not authorized' });
    }
    if (role === 'customer') {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    try {
      const updated = await jobService.updateJobStatus(request.params.id, status, { printerId, printerName });

      // Notify customer
      try {
        await notifyUser(updated.userId, messages.statusUpdateMessage(status, updated.token));
      } catch (err) {
        console.error('Notification error:', err);
      }

      return updated;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // POST /jobs/:id/cancel — cancel job
  fastify.post('/:id/cancel', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
    });

    if (!job) return reply.code(404).send({ error: 'Job not found' });

    const { role, id: userId } = request.user;
    if (role === 'customer' && job.userId !== userId) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    try {
      const updated = await jobService.updateJobStatus(request.params.id, 'cancelled');
      return updated;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // POST /jobs/:id/refund — initiate refund (admin or shopkeeper)
  fastify.post('/:id/refund', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { role } = request.user;
    if (role === 'customer') {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
    });
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    if (role === 'shopkeeper' && request.user.shop?.id !== job.shopId) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    try {
      const result = await paymentService.initiateRefund(
        request.params.id,
        request.body.reason || 'Refund requested',
      );
      return { status: 'refunded', ...result };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // POST /jobs/:id/pay — create payment link for a job (web flow)
  fastify.post('/:id/pay', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
      include: { user: true, shop: true },
    });

    if (!job) return reply.code(404).send({ error: 'Job not found' });

    // Only the job owner can initiate payment
    if (job.userId !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    // Don't re-create if already paid or already has a link
    const existing = await paymentService.getPaymentStatus(job.id);
    if (existing?.status === 'paid') {
      return reply.code(400).send({ error: 'Job is already paid' });
    }
    if (existing?.paymentLink) {
      return { paymentLink: existing.paymentLink, paymentId: existing.id, existing: true };
    }

    try {
      const result = await paymentService.createPaymentLink({
        jobId: job.id,
        amount: job.totalPrice,
        customerPhone: job.user?.phone,
        customerName: job.user?.name || 'Customer',
        description: `PrintDrop #${String(job.token).padStart(3, '0')} at ${job.shop?.name}`,
      });
      return result;
    } catch (err) {
      fastify.log.error('Payment link creation error:', err);
      return reply.code(500).send({ error: 'Failed to create payment link' });
    }
  });

  // GET /jobs/:id/payment — payment status
  fastify.get('/:id/payment', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const payment = await paymentService.getPaymentStatus(request.params.id);
    if (!payment) return reply.code(404).send({ error: 'No payment found' });
    return payment;
  });

  // GET /jobs/token/:shopId/:token — lookup by token (shopkeeper)
  fastify.get('/token/:shopId/:token', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const job = await jobService.getJobByToken(
      request.params.shopId,
      parseInt(request.params.token),
    );

    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return job;
  });
}

module.exports = jobRoutes;
