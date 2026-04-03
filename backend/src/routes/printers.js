const { authenticate, requireRole } = require('../middleware/auth');

async function printerRoutes(fastify) {
  // ─── Agent key auth helper ────────────────────────────────────────────────
  async function authenticateAgent(request, reply) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid authorization header' });
    }
    const token = authHeader.slice(7);
    const shop = await fastify.prisma.shop.findFirst({ where: { agentKey: token } });
    if (!shop) {
      return reply.status(401).send({ error: 'Invalid agent key' });
    }
    request.shop = shop;
  }

  // ─── GET /printers/shop/:shopId — list printers for a shop (used by agent) ─
  fastify.get('/shop/:shopId', async (request, reply) => {
    const { shopId } = request.params;
    const printers = await fastify.prisma.shopPrinter.findMany({
      where: { shopId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return printers;
  });

  // ─── POST /printers/heartbeat — agent reports discovered OS printers ──────
  fastify.post('/heartbeat', {
    preHandler: [authenticateAgent],
  }, async (request, reply) => {
    const { printers: discovered, shopId } = request.body;
    const shop = request.shop;

    // Verify shopId matches the agent key's shop
    if (shopId && shop.id !== shopId) {
      return reply.status(403).send({ error: 'shopId does not match agent key' });
    }

    if (Array.isArray(discovered) && discovered.length > 0) {
      // Update isOnline + lastSeen for printers we know about
      for (const d of discovered) {
        if (!d.systemName) continue;
        await fastify.prisma.shopPrinter.updateMany({
          where: { shopId: shop.id, systemName: d.systemName },
          data: {
            isOnline: d.isOnline !== false,
            lastSeen: new Date(),
          },
        });
      }

      // Mark printers NOT in the discovered list as offline
      const knownSystemNames = discovered.map((d) => d.systemName).filter(Boolean);
      await fastify.prisma.shopPrinter.updateMany({
        where: {
          shopId: shop.id,
          systemName: { notIn: knownSystemNames },
        },
        data: { isOnline: false },
      });
    }

    // Return the routing config so the agent knows how to route jobs
    const routing = await fastify.prisma.shopPrinter.findMany({
      where: { shopId: shop.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return { shopId: shop.id, printers: routing };
  });

  // ─── GET /printers/routing/:shopId — get printer routing for agent ────────
  fastify.get('/routing/:shopId', {
    preHandler: [authenticateAgent],
  }, async (request, reply) => {
    const shop = request.shop;
    if (shop.id !== request.params.shopId) {
      return reply.status(403).send({ error: 'Not authorized for this shop' });
    }
    const printers = await fastify.prisma.shopPrinter.findMany({
      where: { shopId: shop.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { shopId: shop.id, printers };
  });

  // ─── POST /printers — create a printer (shopkeeper auth) ─────────────────
  fastify.post('/', {
    preHandler: [authenticate, requireRole(['shopkeeper', 'admin'])],
  }, async (request, reply) => {
    const { shopId, name, systemName, isDefault, supportsColor, supportsDuplex, supportsA3 } = request.body;

    if (!shopId || !name || !systemName) {
      return reply.status(400).send({ error: 'shopId, name, and systemName are required' });
    }

    // Validate the user owns the shop
    const { role } = request.user;
    if (role === 'shopkeeper' && request.user.shop?.id !== shopId) {
      return reply.status(403).send({ error: 'Not authorized for this shop' });
    }

    // If setting as default, unset all existing defaults for this shop
    if (isDefault) {
      await fastify.prisma.shopPrinter.updateMany({
        where: { shopId },
        data: { isDefault: false },
      });
    }

    const printer = await fastify.prisma.shopPrinter.create({
      data: {
        shopId,
        name,
        systemName,
        isDefault: isDefault || false,
        supportsColor: supportsColor !== false,
        supportsDuplex: supportsDuplex || false,
        supportsA3: supportsA3 || false,
      },
    });

    return reply.status(201).send(printer);
  });

  // ─── PATCH /printers/:id — update printer settings ───────────────────────
  fastify.patch('/:id', {
    preHandler: [authenticate, requireRole(['shopkeeper', 'admin'])],
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, systemName, isDefault, supportsColor, supportsDuplex, supportsA3 } = request.body;

    const printer = await fastify.prisma.shopPrinter.findUnique({ where: { id } });
    if (!printer) return reply.status(404).send({ error: 'Printer not found' });

    // Validate shop ownership
    const { role } = request.user;
    if (role === 'shopkeeper' && request.user.shop?.id !== printer.shopId) {
      return reply.status(403).send({ error: 'Not authorized for this shop' });
    }

    // If setting as default, unset all others first
    if (isDefault) {
      await fastify.prisma.shopPrinter.updateMany({
        where: { shopId: printer.shopId, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (systemName !== undefined) updateData.systemName = systemName;
    if (isDefault !== undefined) updateData.isDefault = isDefault;
    if (supportsColor !== undefined) updateData.supportsColor = supportsColor;
    if (supportsDuplex !== undefined) updateData.supportsDuplex = supportsDuplex;
    if (supportsA3 !== undefined) updateData.supportsA3 = supportsA3;

    const updated = await fastify.prisma.shopPrinter.update({
      where: { id },
      data: updateData,
    });

    return updated;
  });

  // ─── DELETE /printers/:id — delete a printer ─────────────────────────────
  fastify.delete('/:id', {
    preHandler: [authenticate, requireRole(['shopkeeper', 'admin'])],
  }, async (request, reply) => {
    const { id } = request.params;

    const printer = await fastify.prisma.shopPrinter.findUnique({ where: { id } });
    if (!printer) return reply.status(404).send({ error: 'Printer not found' });

    const { role } = request.user;
    if (role === 'shopkeeper' && request.user.shop?.id !== printer.shopId) {
      return reply.status(403).send({ error: 'Not authorized for this shop' });
    }

    await fastify.prisma.shopPrinter.delete({ where: { id } });
    return reply.status(204).send();
  });
}

module.exports = printerRoutes;
