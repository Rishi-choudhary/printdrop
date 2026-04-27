const { authenticate, requireRole } = require('../middleware/auth');
const { parseInteger, pickDefined } = require('../utils/request');
const { redactAgentKeyFields, redactUserShop } = require('../services/agent-key');

const USER_ROLES = new Set(['customer', 'shopkeeper', 'admin']);
const JOB_STATUSES = new Set(['pending', 'payment_pending', 'queued', 'printing', 'ready', 'picked_up', 'cancelled']);
const SHOP_UPDATE_FIELDS = [
  'name', 'address', 'phone', 'latitude', 'longitude', 'isActive',
  'autoPrint', 'opensAt', 'closesAt', 'closedDays',
  'ratesBwSingle', 'ratesBwDouble', 'ratesColorSingle',
  'ratesColorDouble', 'bindingCharge', 'spiralCharge',
];

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
    const { search, role } = request.query;
    const limit = parseInteger(request.query.limit, { defaultValue: 50, min: 1, max: 200 });
    const offset = parseInteger(request.query.offset, { defaultValue: 0, min: 0, max: 100000 });

    const where = {};
    if (role && USER_ROLES.has(role)) where.role = role;
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
        take: limit,
        skip: offset,
      }),
      fastify.prisma.user.count({ where }),
    ]);

    return { users: users.map(redactUserShop), total };
  });

  // PATCH /admin/users/:id — change role
  fastify.patch('/users/:id', async (request, reply) => {
    const { role, name, email } = request.body;
    const updateData = {};
    if (role) {
      if (!USER_ROLES.has(role)) return reply.code(400).send({ error: 'Invalid role' });
      updateData.role = role;
    }
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;

    const user = await fastify.prisma.user.update({
      where: { id: request.params.id },
      data: updateData,
      include: { shop: true },
    });

    return redactUserShop(user);
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
    return shops.map(redactAgentKeyFields);
  });

  // PATCH /admin/shops/:id — update shop
  fastify.patch('/shops/:id', async (request, reply) => {
    const shop = await fastify.prisma.shop.findUnique({
      where: { id: request.params.id },
    });
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    const updateData = pickDefined(request.body || {}, SHOP_UPDATE_FIELDS);
    const updated = await fastify.prisma.shop.update({
      where: { id: request.params.id },
      data: updateData,
      include: { owner: { select: { id: true, name: true, phone: true } } },
    });

    return redactAgentKeyFields(updated);
  });

  // GET /admin/jobs — all jobs with filters
  fastify.get('/jobs', async (request) => {
    const { status, shopId, date } = request.query;
    const limit = parseInteger(request.query.limit, { defaultValue: 50, min: 1, max: 200 });
    const offset = parseInteger(request.query.offset, { defaultValue: 0, min: 0, max: 100000 });

    const where = {};
    if (status === 'completed') {
      where.status = { in: ['picked_up', 'cancelled'] };
    } else if (status && JOB_STATUSES.has(status)) {
      where.status = status;
    }
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
        take: limit,
        skip: offset,
      }),
      fastify.prisma.job.count({ where }),
    ]);

    return { jobs, total };
  });

  // GET /admin/revenue — revenue breakdown
  fastify.get('/revenue', async (request) => {
    const { days = 30 } = request.query;
    const dayCount = parseInteger(days, { defaultValue: 30, min: 1, max: 366 });
    const since = new Date();
    since.setDate(since.getDate() - dayCount);

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

  // GET /admin/jobs/:id/trace — full job lifecycle trace
  fastify.get('/jobs/:id/trace', async (request, reply) => {
    const job = await fastify.prisma.job.findUnique({
      where: { id: request.params.id },
      include: {
        shop: { select: { id: true, name: true, address: true, phone: true } },
        user: { select: { id: true, phone: true, name: true } },
        payment: true,
        printer: true,
      },
    });

    if (!job) return reply.code(404).send({ error: 'Job not found' });

    // Build timeline from timestamps
    const timeline = [];

    if (job.createdAt) {
      const specs = [
        `${job.pageCount} page${job.pageCount !== 1 ? 's' : ''}`,
        job.color ? 'Color' : 'B&W',
        job.paperSize || 'A4',
        `${job.copies} cop${job.copies !== 1 ? 'ies' : 'y'}`,
      ].join(', ');
      timeline.push({ event: 'created', at: job.createdAt.toISOString(), details: specs });
    }

    if (job.status === 'payment_pending' || job.paidAt) {
      timeline.push({
        event: 'payment_pending',
        at: job.createdAt.toISOString(), // best approximation
        details: job.payment?.razorpayPaymentLink ? 'Razorpay link created' : 'Payment link created',
      });
    }

    if (job.paidAt) {
      timeline.push({
        event: 'queued',
        at: job.paidAt.toISOString(),
        details: `Payment ₹${job.totalPrice?.toFixed(0)} received`,
      });
    }

    if (job.printedAt) {
      const agentInfo = job.agentVersion ? `Agent v${job.agentVersion}` : 'Agent';
      const printerInfo = job.printerName ? ` → ${job.printerName}` : '';
      timeline.push({
        event: 'printing',
        at: job.printedAt.toISOString(),
        details: `${agentInfo}${printerInfo}`,
      });
    }

    if (job.readyAt) {
      let details = 'Print ready';
      if (job.printedAt) {
        const secs = Math.round((new Date(job.readyAt) - new Date(job.printedAt)) / 1000);
        if (secs > 0) details = `Printed in ${secs}s`;
      }
      timeline.push({ event: 'ready', at: job.readyAt.toISOString(), details });
    }

    if (job.pickedUpAt) {
      timeline.push({ event: 'picked_up', at: job.pickedUpAt.toISOString(), details: 'Customer picked up' });
    }

    if (job.cancelledAt) {
      timeline.push({ event: 'cancelled', at: job.cancelledAt.toISOString(), details: 'Order cancelled' });
    }

    return { job, timeline };
  });
}

module.exports = adminRoutes;
