const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const {
  createAuthCookie,
  clearAuthCookie,
  clearLegacyAuthCookie,
} = require('../services/session-cookie');
const { redactUserShop } = require('../services/agent-key');

async function authRoutes(fastify, opts) {
  // ── Deprecated OTP endpoints ─────────────────────────────────────────────

  fastify.post('/send-otp', async (request, reply) => {
    return reply.status(410).send({
      error: 'OTP login has been removed. Shopkeepers should use /auth/shopkeeper-login with their PIN.',
    });
  });

  fastify.post('/verify-otp', async (request, reply) => {
    return reply.status(410).send({
      error: 'OTP login has been removed. Shopkeepers should use /auth/shopkeeper-login with their PIN.',
    });
  });

  // ── Shopkeeper PIN login ──────────────────────────────────────────────────

  // In-memory rate limiter: phone -> { failCount, resetAt }
  const loginAttempts = new Map();
  const LOGIN_MAX_FAILS = 5;
  const LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * POST /auth/shopkeeper-login
   * Body: { phone: string, pin: string }
   * Authenticates a shopkeeper or admin with their phone + 6-digit PIN.
   * Sets an HttpOnly session cookie and returns { user } on success.
   */
  fastify.post('/shopkeeper-login', async (request, reply) => {
    const { phone, pin } = request.body || {};

    if (!phone || typeof phone !== 'string' || phone.length < 10) {
      return reply.status(400).send({ error: 'Valid phone number is required' });
    }

    if (!pin || typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return reply.status(400).send({ error: 'PIN must be exactly 6 digits' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    // Rate limiting per phone
    const now = Date.now();
    let attempt = loginAttempts.get(normalizedPhone);
    if (!attempt || now > attempt.resetAt) {
      attempt = { failCount: 0, resetAt: now + LOGIN_WINDOW_MS };
      loginAttempts.set(normalizedPhone, attempt);
    }

    if (attempt.failCount >= LOGIN_MAX_FAILS) {
      const retryAfter = Math.ceil((attempt.resetAt - now) / 1000 / 60);
      return reply.status(429).send({
        error: `Too many failed attempts. Please wait ${retryAfter} minute(s) before trying again.`,
      });
    }

    // Look up user — use a generic failure message to avoid phone enumeration
    const user = await fastify.prisma.user.findUnique({
      where: { phone: normalizedPhone },
      include: { shop: true },
    });

    const genericError = { error: 'Invalid phone number or PIN' };

    if (!user) {
      attempt.failCount++;
      return reply.status(401).send(genericError);
    }

    if (user.role !== 'shopkeeper' && user.role !== 'admin') {
      attempt.failCount++;
      return reply.status(401).send(genericError);
    }

    if (!user.pinHash) {
      attempt.failCount++;
      return reply.status(401).send(genericError);
    }

    const pinValid = await bcrypt.compare(pin, user.pinHash);
    if (!pinValid) {
      attempt.failCount++;
      return reply.status(401).send(genericError);
    }

    // Successful login — clear fail count
    attempt.failCount = 0;

    const token = jwt.sign(
      { userId: user.id, phone: user.phone, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    // Strip pinHash before returning user object
    const { pinHash, ...safeUser } = redactUserShop(user);
    reply.header('Set-Cookie', [
      createAuthCookie(token, { secure: !config.isDev }),
      clearLegacyAuthCookie({ secure: !config.isDev }),
    ]);
    return reply.send({ user: safeUser });
  });

  // ── Current user ─────────────────────────────────────────────────────────

  /**
   * POST /auth/logout
   * Clears the HttpOnly session cookie and any legacy JavaScript-readable token.
   */
  fastify.post('/logout', async (request, reply) => {
    reply.header('Set-Cookie', [
      clearAuthCookie({ secure: !config.isDev }),
      clearLegacyAuthCookie({ secure: !config.isDev }),
    ]);
    return reply.send({ ok: true });
  });

  /**
   * GET /auth/me
   * Returns the currently authenticated user with their shop (if shopkeeper).
   */
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send({ user: request.user });
  });
}

module.exports = authRoutes;
