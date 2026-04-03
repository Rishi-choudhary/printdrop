const crypto = require('crypto');
const { authenticate, requireRole } = require('../middleware/auth');
const shopService = require('../services/shop');
const jobService = require('../services/job');

async function shopRoutes(fastify) {
  // GET /shops — list active shops (public)
  fastify.get('/', async (request, reply) => {
    const shops = await shopService.getActiveShops();
    return shops.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      phone: s.phone,
      opensAt: s.opensAt,
      closesAt: s.closesAt,
      ratesBwSingle: s.ratesBwSingle,
      ratesColorSingle: s.ratesColorSingle,
      isOpen: shopService.isShopOpen(s),
    }));
  });

  // GET /shops/:id — shop details (public)
  fastify.get('/:id', async (request, reply) => {
    const shop = await shopService.getShopById(request.params.id);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });
    return shop;
  });

  // POST /shops — create shop (admin only)
  fastify.post('/', {
    preHandler: [authenticate, requireRole(['admin'])],
  }, async (request, reply) => {
    const { name, address, phone, latitude, longitude, ownerId } = request.body;

    if (!name || !phone || !ownerId) {
      return reply.code(400).send({ error: 'name, phone, and ownerId are required' });
    }

    // Update owner role to shopkeeper
    await fastify.prisma.user.update({
      where: { id: ownerId },
      data: { role: 'shopkeeper' },
    });

    const shop = await shopService.createShop({
      name, address, phone, latitude, longitude, ownerId,
    });

    return reply.code(201).send(shop);
  });

  // PATCH /shops/:id — update shop (owner or admin)
  fastify.patch('/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const shop = await shopService.getShopById(request.params.id);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    if (request.user.role !== 'admin' && shop.ownerId !== request.user.id) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    const allowed = ['name', 'address', 'phone', 'latitude', 'longitude', 'isActive', 'autoPrint', 'opensAt', 'closesAt', 'closedDays'];
    const updateData = {};
    for (const key of allowed) {
      if (request.body[key] !== undefined) updateData[key] = request.body[key];
    }

    const updated = await shopService.updateShop(request.params.id, updateData);
    return updated;
  });

  // PATCH /shops/:id/rates — update pricing (owner or admin)
  fastify.patch('/:id/rates', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const shop = await shopService.getShopById(request.params.id);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    if (request.user.role !== 'admin' && shop.ownerId !== request.user.id) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    const updated = await shopService.updateShopRates(request.params.id, request.body);
    return updated;
  });

  // POST /shops/:id/agent-key — generate (or regenerate) the agent key
  fastify.post('/:id/agent-key', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const shop = await shopService.getShopById(request.params.id);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    if (request.user.role !== 'admin' && shop.ownerId !== request.user.id) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    const newKey = `agent_${crypto.randomBytes(20).toString('hex')}`;
    await fastify.prisma.shop.update({
      where: { id: shop.id },
      data: { agentKey: newKey },
    });

    return { agentKey: newKey };
  });

  // GET /shops/:id/queue — today's job queue (owner or admin)
  fastify.get('/:id/queue', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const shop = await shopService.getShopById(request.params.id);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    if (request.user.role !== 'admin' && shop.ownerId !== request.user.id) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    const date = request.query.date ? new Date(request.query.date) : new Date();
    const jobs = await jobService.getShopQueue(request.params.id, date);
    return jobs;
  });

  // GET /shops/:id/stats — shop stats (owner or admin)
  fastify.get('/:id/stats', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const shop = await shopService.getShopById(request.params.id);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    if (request.user.role !== 'admin' && shop.ownerId !== request.user.id) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const PAID_STATUSES = ['queued', 'printing', 'ready', 'picked_up'];

    const [todayJobs, totalJobs] = await Promise.all([
      fastify.prisma.job.findMany({
        where: { shopId: shop.id, createdAt: { gte: todayStart }, status: { not: 'cancelled' } },
      }),
      fastify.prisma.job.count({ where: { shopId: shop.id, status: { not: 'cancelled' } } }),
    ]);

    // Revenue only counts jobs that have actually been paid
    const todayRevenue = todayJobs
      .filter((j) => PAID_STATUSES.includes(j.status))
      .reduce((sum, j) => sum + j.shopEarning, 0);
    const todayReady = todayJobs.filter((j) => j.status === 'ready').length;
    const todayPickedUp = todayJobs.filter((j) => j.status === 'picked_up').length;

    return {
      today: {
        jobs: todayJobs.length,
        revenue: Math.round(todayRevenue * 100) / 100,
        ready: todayReady,
        pickedUp: todayPickedUp,
      },
      total: { jobs: totalJobs },
    };
  });
}

module.exports = shopRoutes;
