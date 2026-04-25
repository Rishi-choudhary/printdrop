const { authenticate, requireRole } = require('../middleware/auth');
const shopService = require('../services/shop');
const jobService = require('../services/job');
const {
  generateAgentKey,
  hashAgentKey,
  redactAgentKeyFields,
} = require('../services/agent-key');

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
    return redactAgentKeyFields(shop);
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

    return reply.code(201).send(redactAgentKeyFields(shop));
  });

  // POST /shops/register — self-service shop registration (any authenticated user)
  fastify.post('/register', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { name, address, phone } = request.body;

    if (!name) {
      return reply.code(400).send({ error: 'Shop name is required' });
    }

    // Check if user already owns a shop
    const existingShop = await fastify.prisma.shop.findUnique({
      where: { ownerId: request.user.id },
    });
    if (existingShop) {
      return reply.code(400).send({ error: 'You already own a shop', shopId: existingShop.id });
    }

    // Create shop and promote user to shopkeeper
    const agentKey = generateAgentKey();

    const shop = await fastify.prisma.$transaction(async (tx) => {
      const newShop = await tx.shop.create({
        data: {
          name,
          address: address || '',
          phone: phone || request.user.phone,
          ownerId: request.user.id,
          agentKeyHash: hashAgentKey(agentKey),
        },
        include: { owner: { select: { id: true, name: true, phone: true } } },
      });

      await tx.user.update({
        where: { id: request.user.id },
        data: { role: 'shopkeeper' },
      });

      return newShop;
    });

    return reply.code(201).send({ shop: redactAgentKeyFields(shop), agentKey });
  });

  // POST /shops/:id/test-print — send a test print job (shopkeeper or admin)
  fastify.post('/:id/test-print', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const shop = await shopService.getShopById(request.params.id);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    if (request.user.role !== 'admin' && shop.ownerId !== request.user.id) {
      return reply.code(403).send({ error: 'Not authorized' });
    }

    // Create a test job that goes directly to queued (no payment needed)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const lastJob = await fastify.prisma.job.findFirst({
      where: { shopId: shop.id, createdAt: { gte: todayStart } },
      orderBy: { token: 'desc' },
    });
    const token = (lastJob?.token || 0) + 1;

    const job = await fastify.prisma.job.create({
      data: {
        token,
        userId: request.user.id,
        shopId: shop.id,
        fileName: 'PrintDrop-Test-Page.pdf',
        fileUrl: '',
        fileKey: null,
        fileSize: 0,
        fileType: 'pdf',
        pageCount: 1,
        color: false,
        copies: 1,
        doubleSided: false,
        paperSize: 'A4',
        pageRange: 'all',
        binding: 'none',
        pricePerPage: 0,
        totalPrice: 0,
        platformFee: 0,
        shopEarning: 0,
        status: 'queued',
        source: 'test',
        paidAt: new Date(),
      },
    });

    return reply.code(201).send({ job, message: 'Test print job created' });
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
    return redactAgentKeyFields(updated);
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
    return redactAgentKeyFields(updated);
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

    const newKey = generateAgentKey();
    await fastify.prisma.shop.update({
      where: { id: shop.id },
      data: { agentKey: null, agentKeyHash: hashAgentKey(newKey) },
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
