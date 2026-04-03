const { authenticate } = require('../middleware/auth');
const jobService = require('../services/job');

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
      ...user,
      stats: {
        totalJobs: jobCount,
        totalSpent: totalSpent._sum.totalPrice || 0,
      },
    };
  });

  // PATCH /users/me — update name/email
  fastify.patch('/me', {
    preHandler: [authenticate],
  }, async (request) => {
    const { name, email } = request.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;

    return fastify.prisma.user.update({
      where: { id: request.user.id },
      data: updateData,
    });
  });

  // GET /users/me/jobs — paginated job history
  fastify.get('/me/jobs', {
    preHandler: [authenticate],
  }, async (request) => {
    const limit = parseInt(request.query.limit || '20');
    const offset = parseInt(request.query.offset || '0');
    return jobService.getJobsByUser(request.user.id, limit, offset);
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
