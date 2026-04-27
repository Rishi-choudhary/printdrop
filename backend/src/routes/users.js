const { authenticate } = require('../middleware/auth');
const jobService = require('../services/job');
const { parseInteger } = require('../utils/request');
const { redactUserShop } = require('../services/agent-key');

async function userRoutes(fastify) {
  // GET /users/me — profile with stats
  fastify.get('/me', {
    preHandler: [authenticate],
  }, async (request) => {
    const user = await fastify.prisma.user.findUnique({
      where: { id: request.user.id },
      include: { shop: true },
    });

    const jobCount = await fastify.prisma.job.count({
      where: { userId: user.id },
    });

    const totalSpent = await fastify.prisma.job.aggregate({
      where: { userId: user.id, status: { in: ['queued', 'printing', 'ready', 'picked_up'] } },
      _sum: { totalPrice: true },
    });

    return {
      ...redactUserShop(user),
      stats: {
        totalJobs: jobCount,
        totalSpent: totalSpent._sum.totalPrice || 0,
      },
    };
  });

  // PATCH /users/me — update name/email
  fastify.patch('/me', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { name, email } = request.body || {};
    const updateData = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.length > 120) {
        return reply.code(400).send({ error: 'Invalid name' });
      }
      updateData.name = name.trim();
    }
    if (email !== undefined) {
      if (email !== null && (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return reply.code(400).send({ error: 'Invalid email' });
      }
      updateData.email = email ? email.trim().toLowerCase() : null;
    }

    const user = await fastify.prisma.user.update({
      where: { id: request.user.id },
      data: updateData,
    });
    return redactUserShop(user);
  });

  // GET /users/me/jobs — paginated job history
  fastify.get('/me/jobs', {
    preHandler: [authenticate],
  }, async (request) => {
    const limit = parseInteger(request.query.limit, { defaultValue: 20, min: 1, max: 100 });
    const offset = parseInteger(request.query.offset, { defaultValue: 0, min: 0, max: 100000 });
    return jobService.getJobsByUser(request.user.id, limit, offset);
  });

  // GET /users/me/orders?page=1&limit=20 — paginated order history (excludes pending)
  fastify.get('/me/orders', {
    preHandler: [authenticate],
  }, async (request) => {
    const limit = parseInteger(request.query.limit, { defaultValue: 20, min: 1, max: 100 });
    const page = parseInteger(request.query.page, { defaultValue: 1, min: 1 });
    const offset = (page - 1) * limit;

    const where = {
      userId: request.user.id,
      status: { not: 'pending' },
    };

    const [jobs, total] = await Promise.all([
      fastify.prisma.job.findMany({
        where,
        select: {
          id: true,
          token: true,
          fileName: true,
          pageCount: true,
          status: true,
          totalPrice: true,
          createdAt: true,
          paidAt: true,
          shop: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      fastify.prisma.job.count({ where }),
    ]);

    return {
      jobs,
      total,
      page,
      limit,
      hasMore: offset + jobs.length < total,
    };
  });

  // GET /users/me/referrals — referral status
  fastify.get('/me/referrals', {
    preHandler: [authenticate],
  }, async (request) => {
    const referrals = await fastify.prisma.referral.findMany({
      where: { referrerId: request.user.id },
      include: { referee: { select: { id: true, name: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      referralCode: request.user.referralCode,
      referrals,
      total: referrals.length,
      completed: referrals.filter((r) => r.status === 'completed').length,
    };
  });
}

module.exports = userRoutes;
