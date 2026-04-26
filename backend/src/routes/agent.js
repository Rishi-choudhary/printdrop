'use strict';

const jobService = require('../services/job');
const { notifyUser, notifyReadyForPickup } = require('../services/notification');
const messages = require('../bot/messages');
const { findShopByAgentKey } = require('../services/agent-key');
const { recomputeOrderStatus } = require('../services/order');

const AGENT_JOB_STATUSES = ['queued', 'printing', 'ready'];
const AGENT_HISTORY_STATUSES = ['picked_up', 'cancelled'];
const DEFAULT_AGENT_HISTORY_DAYS = 30;
const MAX_AGENT_HISTORY_DAYS = 365;

// Agent-scoped status transitions (subset of full transitions)
const AGENT_ALLOWED_TRANSITIONS = {
  printing: ['ready', 'cancelled'],
  queued:   ['cancelled'],
  ready:    ['picked_up'],
};

async function agentRoutes(fastify) {
  // ── Agent key auth ────────────────────────────────────────────────────────
  async function authenticateAgent(request, reply) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid authorization header' });
    }
    const token = authHeader.slice(7);
    const shop = await findShopByAgentKey(fastify.prisma, token, {
      include: {
        printers: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!shop) {
      return reply.status(401).send({ error: 'Invalid agent key' });
    }
    request.shop = shop;
  }

  // ── GET /agent/me — shop identity + settings ──────────────────────────────
  fastify.get('/me', {
    preHandler: [authenticateAgent],
  }, async (request, reply) => {
    const { shop } = request;
    return {
      shopId:       shop.id,
      shopName:     shop.name,
      autoPrint:    shop.autoPrint || false,
      agentLastSeen: shop.agentLastSeen,
      agentVersion: shop.agentVersion,
      printers:     shop.printers,
    };
  });

  // ── GET /agent/jobs — active + recent jobs for this shop ─────────────────
  fastify.get('/jobs', {
    preHandler: [authenticateAgent],
  }, async (request, reply) => {
    const { shop } = request;

    const requestedDays = Number.parseInt(request.query?.historyDays, 10);
    const historyDays = Number.isFinite(requestedDays)
      ? Math.min(Math.max(requestedDays, 1), MAX_AGENT_HISTORY_DAYS)
      : DEFAULT_AGENT_HISTORY_DAYS;

    const historyStart = new Date();
    historyStart.setDate(historyStart.getDate() - historyDays);

    const jobs = await fastify.prisma.job.findMany({
      where: {
        shopId: shop.id,
        OR: [
          { status: { in: AGENT_JOB_STATUSES } },
          {
            status: { in: AGENT_HISTORY_STATUSES },
            updatedAt: { gte: historyStart },
          },
        ],
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
      },
      orderBy: [
        { createdAt: 'asc' },
        { token: 'asc' },
      ],
    });

    return { jobs, historyDays };
  });

  // ── POST /agent/jobs/:id/claim — atomic queued → printing ─────────────────
  fastify.post('/jobs/:id/claim', {
    preHandler: [authenticateAgent],
  }, async (request, reply) => {
    const { shop } = request;
    const { printerName, printerId } = request.body || {};

    // Verify job belongs to this shop before claiming
    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
    });
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.shopId !== shop.id) return reply.status(403).send({ error: 'Not authorized for this job' });

    const claimed = await jobService.claimJob(request.params.id, { printerName, printerId });

    if (!claimed) {
      return reply.status(409).send({ claimed: false, error: 'Job already claimed or not queued' });
    }

    const updated = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
      include: { user: true, shop: true },
    });

    try {
      await notifyUser(updated.userId, messages.statusUpdateMessage('printing', updated.token));
    } catch {}

    return { claimed: true, job: updated };
  });

  // ── POST /agent/jobs/:id/retry — reset cancelled job to queued ───────────
  fastify.post('/jobs/:id/retry', {
    preHandler: [authenticateAgent],
  }, async (request, reply) => {
    const { shop } = request;

    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
    });
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.shopId !== shop.id) return reply.status(403).send({ error: 'Not authorized for this job' });
    if (job.status !== 'cancelled') {
      return reply.status(400).send({ error: `Can only retry cancelled jobs; job is ${job.status}` });
    }

    const updated = await fastify.prisma.job.update({
      where: { id: job.id },
      data: { status: 'queued', cancelledAt: null },
      include: { user: true, shop: true },
    });

    try {
      await notifyUser(updated.userId, messages.statusUpdateMessage('queued', updated.token));
    } catch {}

    return { ok: true, job: updated };
  });

  // ── PATCH /agent/jobs/:id/status — agent-scoped status update ─────────────
  fastify.patch('/jobs/:id/status', {
    preHandler: [authenticateAgent],
  }, async (request, reply) => {
    const { shop } = request;
    const { status, printerName, printerId } = request.body || {};

    if (!status) return reply.status(400).send({ error: 'status is required' });

    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
    });
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.shopId !== shop.id) return reply.status(403).send({ error: 'Not authorized for this job' });

    const allowed = AGENT_ALLOWED_TRANSITIONS[job.status];
    if (!allowed || !allowed.includes(status)) {
      return reply.status(400).send({
        error: `Agent cannot transition job from ${job.status} to ${status}`,
      });
    }

    try {
      const updated = await jobService.updateJobStatus(request.params.id, status, { printerName, printerId });

      try {
        await notifyUser(updated.userId, messages.statusUpdateMessage(status, updated.token));
      } catch {}

      // If this job belongs to a multi-file order, recompute order status.
      // When all sibling jobs reach 'ready', notify customer once for the whole order.
      if (updated.orderId) {
        try {
          const newOrderStatus = await recomputeOrderStatus(updated.orderId);
          if (newOrderStatus === 'ready') {
            const order = await fastify.prisma.order.findUnique({
              where:   { id: updated.orderId },
              include: { jobs: { take: 1, include: { shop: true } } },
            });
            if (order && order.jobs[0]) {
              notifyReadyForPickup(order.userId, order.token, order.jobs[0].shop.name).catch(() => {});
            }
          }
        } catch (err) {
          fastify.log.warn({ err }, 'recomputeOrderStatus failed — non-fatal');
        }
      }

      return updated;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });
}

module.exports = agentRoutes;
