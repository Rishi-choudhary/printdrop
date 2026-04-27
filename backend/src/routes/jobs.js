const { authenticate, requireRole } = require('../middleware/auth');
const jobService = require('../services/job');
const paymentService = require('../services/payment');
const { notifyUser, notifyReadyForPickup } = require('../services/notification');
const messages = require('../bot/messages');
const { parseInteger, isAuthorizedForJob, isValidStorageKey } = require('../utils/request');
const { broadcastQueueUpdate } = require('./ws');

const JOB_STATUSES = new Set(['pending', 'payment_pending', 'queued', 'printing', 'ready', 'picked_up', 'cancelled']);
const PAPER_SIZES = new Set(['A4', 'A3', 'Letter', 'Legal']);
const BINDINGS = new Set(['none', 'staple', 'spiral']);

function toBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return defaultValue;
}

function normalizeCustomerPhone(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d+]/g, '');
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (!cleaned.startsWith('+') && digits.length === 10) return `+91${digits}`;
  if (!/^\d{10,15}$/.test(digits)) return null;
  return `+${digits}`;
}

function buildReferralCode(phone) {
  return `REF${phone.slice(-6)}${Date.now().toString(36).slice(-4)}`.toUpperCase();
}

async function findOrCreateCustomer(prisma, { phone, name }) {
  let user = await prisma.user.findUnique({ where: { phone } });
  if (user) {
    if (name && !user.name) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name },
      });
    }
    return user;
  }

  return prisma.user.create({
    data: {
      phone,
      name: name || 'Customer',
      role: 'customer',
      referralCode: buildReferralCode(phone),
    },
  });
}

function validateJobInput(body) {
  const errors = [];
  const pageCount = parseInteger(body.pageCount, { defaultValue: 1, min: 1, max: 5000 });
  const copies = parseInteger(body.copies, { defaultValue: 1, min: 1, max: 100 });
  const paperSize = body.paperSize || 'A4';
  const binding = body.binding || 'none';
  const fileType = String(body.fileType || 'pdf').toLowerCase();

  if (!body.shopId || typeof body.shopId !== 'string') errors.push('shopId is required');
  if (!body.fileName || typeof body.fileName !== 'string') errors.push('fileName is required');
  if (!body.fileKey || !isValidStorageKey(body.fileKey)) errors.push('A valid uploaded fileKey is required');
  if (body.fileUrl && typeof body.fileUrl !== 'string') errors.push('fileUrl must be a string');
  if (!/^[a-z0-9]+$/.test(fileType)) errors.push('fileType is invalid');
  if (!PAPER_SIZES.has(paperSize)) errors.push('paperSize is invalid');
  if (!BINDINGS.has(binding)) errors.push('binding is invalid');

  return {
    errors,
    value: {
      shopId: body.shopId,
      fileUrl: body.fileUrl || '',
      fileKey: body.fileKey,
      fileName: body.fileName,
      fileSize: parseInteger(body.fileSize, { defaultValue: 0, min: 0, max: 1024 * 1024 * 1024 }),
      fileType,
      pageCount,
      color: toBoolean(body.color),
      copies,
      doubleSided: toBoolean(body.doubleSided),
      paperSize,
      pageRange: body.pageRange || 'all',
      binding,
    },
  };
}

async function jobRoutes(fastify) {
  // GET /jobs — list jobs (role-filtered)
  fastify.get('/', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { role, id: userId } = request.user;
    const { status } = request.query;
    const limit = parseInteger(request.query.limit, { defaultValue: 20, min: 1, max: 100 });
    const offset = parseInteger(request.query.offset, { defaultValue: 0, min: 0, max: 100000 });

    const where = {};
    if (role === 'customer') {
      where.userId = userId;
    } else if (role === 'shopkeeper' && request.user.shop) {
      where.shopId = request.user.shop.id;
    }
    // Admin sees all

    if (status === 'completed') {
      where.status = { in: ['picked_up', 'cancelled'] };
    } else if (status && JOB_STATUSES.has(status)) {
      where.status = status;
    }

    const [jobs, total] = await Promise.all([
      fastify.prisma.job.findMany({
        where,
        include: { shop: true, user: { select: { id: true, name: true, phone: true } }, payment: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      fastify.prisma.job.count({ where }),
    ]);

    return { jobs, total, limit, offset };
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
    const { errors, value } = validateJobInput(request.body || {});
    if (errors.length > 0) {
      return reply.code(400).send({ error: errors.join(', ') });
    }

    const { job, pricing } = await jobService.createJob({
      userId: request.user.id,
      ...value,
      source: 'web',
    });

    return reply.code(201).send({ job, pricing });
  });

  // POST /jobs/public — create job from public website checkout
  fastify.post('/public', {
    config: { rateLimit: { max: 5, timeWindow: '1m' } },
  }, async (request, reply) => {
    const { customerPhone, customerName } = request.body || {};
    const phone = normalizeCustomerPhone(customerPhone);
    const name = typeof customerName === 'string' ? customerName.trim().slice(0, 80) : '';

    if (!phone) {
      return reply.code(400).send({ error: 'A valid customer phone number is required' });
    }

    const { errors, value } = validateJobInput(request.body || {});
    if (errors.length > 0) {
      return reply.code(400).send({ error: errors.join(', ') });
    }

    try {
      const user = await findOrCreateCustomer(fastify.prisma, { phone, name });
      const { job, pricing } = await jobService.createJob({
        userId: user.id,
        ...value,
        source: 'web',
      });

      const payment = await paymentService.createPaymentLink({
        jobId: job.id,
        amount: job.totalPrice,
        customerPhone: user.phone,
        customerName: user.name || 'Customer',
        description: `PrintDrop #${String(job.token).padStart(3, '0')} at ${job.shop?.name}`,
      });

      return reply.code(201).send({ job, pricing, ...payment });
    } catch (err) {
      request.log.error({ err }, 'Public job creation failed');
      const message = err.message || 'Failed to create print job';
      if (message.includes('Shop not found')) {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  // PATCH /jobs/:id/status — update status (shopkeeper or admin)
  fastify.patch('/:id/status', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { status, printerId, printerName } = request.body;
    if (!status || !JOB_STATUSES.has(status)) return reply.code(400).send({ error: 'Valid status is required' });

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

      broadcastQueueUpdate(job.shopId);

      // Notify customer — use template-aware call for "ready" (may arrive outside 24h window)
      try {
        if (status === 'ready') {
          await notifyReadyForPickup(updated.userId, updated.token, job.shop?.name || 'the shop');
        } else {
          await notifyUser(updated.userId, messages.statusUpdateMessage(status, updated.token));
        }
      } catch (err) {
        console.error('Notification error:', err);
      }

      return updated;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // POST /jobs/:id/claim — atomically claim a queued job for printing (agent use)
  fastify.post('/:id/claim', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { role } = request.user;
    if (role === 'customer') {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    const { printerName, printerId } = request.body || {};

    try {
      const job = await fastify.prisma.job.findUnique({ where: { id: request.params.id } });
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      if (role === 'shopkeeper' && request.user.shop?.id !== job.shopId) {
        return reply.code(403).send({ error: 'Not authorized' });
      }

      const claimed = await jobService.claimJob(request.params.id, { printerName, printerId });

      if (!claimed) {
        return reply.code(409).send({ claimed: false, error: 'Job already claimed or not queued' });
      }

      // Notify customer
      const updatedJob = await fastify.prisma.job.findUnique({
        where: { id: request.params.id },
        include: { shop: true, user: true },
      });

      if (updatedJob) {
        try {
          await notifyUser(updatedJob.userId, messages.statusUpdateMessage('printing', updatedJob.token));
        } catch (err) {
          console.error('Notification error:', err);
        }
      }

      return { claimed: true, job: updatedJob };
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
    if (role === 'shopkeeper' && request.user.shop?.id !== job.shopId) {
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
    const job = await fastify.prisma.job.findUnique({ where: { id: request.params.id } });
    if (!isAuthorizedForJob(request.user, job)) return reply.code(403).send({ error: 'Not authorized' });
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
    if (request.user.role === 'shopkeeper' && request.user.shop?.id !== job.shopId) {
      return reply.code(403).send({ error: 'Not authorized' });
    }
    if (request.user.role === 'customer' && job.userId !== request.user.id) {
      return reply.code(403).send({ error: 'Not authorized' });
    }
    return job;
  });
}

module.exports = jobRoutes;
