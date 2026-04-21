'use strict';

const jobService = require('../services/job');
const { notifyUser } = require('../services/notification');
const messages = require('../bot/messages');

const AGENT_JOB_STATUSES = ['queued', 'printing', 'ready'];
const AGENT_HISTORY_STATUSES = ['picked_up', 'cancelled'];

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
    const shop = await fastify.prisma.shop.findFirst({
      where: { agentKey: token },
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

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const jobs = await fastify.prisma.job.findMany({
      where: {
        shopId: shop.id,
        OR: [
          { status: { in: AGENT_JOB_STATUSES } },
          {
            status: { in: AGENT_HISTORY_STATUSES },
            updatedAt: { gte: todayStart },
          },
        ],
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { token: 'asc' },
    });

    return { jobs };
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

      return updated;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });
}

module.exports = agentRoutes;
