const jwt = require('jsonwebtoken');
const config = require('../config');
const { getAuthTokenFromRequest } = require('../services/session-cookie');
const { findShopByAgentKey, redactAgentKeyFields, redactUserShop } = require('../services/agent-key');

/**
 * Fastify preHandler hook that verifies JWT from the HttpOnly session cookie
 * or agent keys from the Authorization header.
 * Attaches the full user object (with shop relation) to request.user.
 */
async function authenticate(request, reply) {
  const { token, source } = getAuthTokenFromRequest(request);
  if (!token) {
    return reply.status(401).send({ error: 'Missing or invalid authentication' });
  }

  // Agent keys stay header-only so a browser cookie cannot be confused with an
  // agent credential.
  if (source === 'authorization') {
    const shop = await findShopByAgentKey(request.server.prisma, token, {
      include: { owner: { include: { shop: true } } },
    });

    if (shop) {
      request.user = redactUserShop({
        ...shop.owner,
        shop: redactAgentKeyFields(shop),
        role: 'shopkeeper',
      });
      return;
    }
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

  request.user = redactUserShop(user);
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
