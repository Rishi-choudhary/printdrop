const { authenticate, requireRole } = require('../middleware/auth');

async function adminRoutes(fastify) {
  // All admin routes require admin role
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole(['admin']));

  // GET /admin/stats — platform-wide stats
  fastify.get('/stats', async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalUsers, totalShops, totalJobs, activeShops,
      todayJobs, revenue, statusBreakdown,
    ] = await Promise.all([
      fastify.prisma.user.count(),
      fastify.prisma.shop.count(),
      fastify.prisma.job.count(),
      fastify.prisma.shop.count({ where: { isActive: true } }),
      fastify.prisma.job.count({ where: { createdAt: { gte: todayStart } } }),
      fastify.prisma.job.aggregate({
        where: { status: { in: ['queued', 'printing', 'ready', 'picked_up'] } },
        _sum: { totalPrice: true, platformFee: true },
      }),
      fastify.prisma.job.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
    ]);

    return {
      totalUsers,
      totalShops,
      activeShops,
      totalJobs,
      todayJobs,
      totalRevenue: revenue._sum.totalPrice || 0,
      platformEarnings: revenue._sum.platformFee || 0,
      jobsByStatus: Object.fromEntries(
        statusBreakdown.map((s) => [s.status, s._count.id])
      ),
    };
  });

  // GET /admin/users — paginated user list
  fastify.get('/users', async (request) => {
    const { search, role, limit = 50, offset = 0 } = request.query;

    const where = {};
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { name: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      fastify.prisma.user.findMany({
        where,
        include: {
          shop: { select: { id: true, name: true } },
          _count: { select: { jobs: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      fastify.prisma.user.count({ where }),
    ]);

    return { users, total };
  });

  // PATCH /admin/users/:id — change role
  fastify.patch('/users/:id', async (request, reply) => {
    const { role, name, email } = request.body;
    const updateData = {};
    if (role) updateData.role = role;
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;

    const user = await fastify.prisma.user.update({
      where: { id: request.params.id },
      data: updateData,
      include: { shop: true },
    });

    return user;
  });

  // GET /admin/shops — all shops
  fastify.get('/shops', async () => {
    const shops = await fastify.prisma.shop.findMany({
      include: {
        owner: { select: { id: true, name: true, phone: true } },
        _count: { select: { jobs: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return shops;
  });

  // PATCH /admin/shops/:id — update shop
  fastify.patch('/shops/:id', async (request, reply) => {
    const shop = await fastify.prisma.shop.findUnique({
      where: { id: request.params.id },
    });
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    const updated = await fastify.prisma.shop.update({
      where: { id: request.params.id },
      data: request.body,
      include: { owner: { select: { id: true, name: true, phone: true } } },
    });

    return updated;
  });

  // GET /admin/jobs — all jobs with filters
  fastify.get('/jobs', async (request) => {
    const { status, shopId, date, limit = 50, offset = 0 } = request.query;

    const where = {};
    if (status) where.status = status;
    if (shopId) where.shopId = shopId;
    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      where.createdAt = { gte: dayStart, lte: dayEnd };
    }

    const [jobs, total] = await Promise.all([
      fastify.prisma.job.findMany({
        where,
        include: {
          shop: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, phone: true } },
          payment: true,
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      fastify.prisma.job.count({ where }),
    ]);

    return { jobs, total };
  });

  // GET /admin/revenue — revenue breakdown
  fastify.get('/revenue', async (request) => {
    const { days = 30 } = request.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    const jobs = await fastify.prisma.job.findMany({
      where: {
        createdAt: { gte: since },
        status: { in: ['queued', 'printing', 'ready', 'picked_up'] },
      },
      select: { totalPrice: true, platformFee: true, shopEarning: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date
    const dailyRevenue = {};
    for (const job of jobs) {
      const dateKey = job.createdAt.toISOString().split('T')[0];
      if (!dailyRevenue[dateKey]) {
        dailyRevenue[dateKey] = { date: dateKey, totalRevenue: 0, platformFee: 0, shopEarning: 0, jobCount: 0 };
      }
      dailyRevenue[dateKey].totalRevenue += job.totalPrice;
      dailyRevenue[dateKey].platformFee += job.platformFee;
      dailyRevenue[dateKey].shopEarning += job.shopEarning;
      dailyRevenue[dateKey].jobCount += 1;
    }

    return Object.values(dailyRevenue);
  });
}

module.exports = adminRoutes;
