const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Fastify preHandler hook that verifies JWT from the Authorization header.
 * Attaches the full user object (with shop relation) to request.user.
 */
async function authenticate(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);

  // Try agent key auth first (for print-agent)
  const shop = await request.server.prisma.shop.findUnique({
    where: { agentKey: token },
    include: { owner: { include: { shop: true } } },
  });

  if (shop) {
    // Agent key auth — treat as the shop owner (shopkeeper role)
    request.user = { ...shop.owner, shop, role: 'shopkeeper' };
    return;
  }

  // Standard JWT auth
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  const user = await request.server.prisma.user.findUnique({
    where: { id: payload.userId },
    include: { shop: true },
  });

  if (!user) {
    return reply.status(401).send({ error: 'User not found' });
  }

  request.user = user;
}

/**
 * Returns a Fastify preHandler hook that checks if the authenticated user
 * has one of the allowed roles.
 *
 * Usage: { preHandler: [authenticate, requireRole(['admin'])] }
 *
 * @param {string[]} roles - Allowed role strings (e.g. ['admin', 'shopkeeper'])
 */
function requireRole(roles) {
  return async function checkRole(request, reply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }
  };
}

module.exports = { authenticate, requireRole };
