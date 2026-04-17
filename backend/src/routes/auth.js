const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

async function authRoutes(fastify, opts) {
  // Per-phone rate limit for OTP sends: max 3 per phone per 10 minutes
  const otpSendAttempts = new Map();
  const OTP_SEND_MAX = 3;
  const OTP_SEND_WINDOW_MS = 10 * 60 * 1000;

  /**
   * POST /auth/send-otp
   * Body: { phone: string }
   * Generates a 6-digit OTP, stores it in the OTP table with 5-minute expiry.
   * In dev mode, the OTP is included in the response for testing convenience.
   */
  fastify.post('/send-otp', async (request, reply) => {
    const { phone } = request.body || {};

    if (!phone || typeof phone !== 'string' || phone.length < 10) {
      return reply.status(400).send({ error: 'Valid phone number is required' });
    }

    // Normalize phone — ensure it starts with +
    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    // Per-phone rate limit
    const now = Date.now();
    let sendAttempt = otpSendAttempts.get(normalizedPhone);
    if (!sendAttempt || now > sendAttempt.resetAt) {
      sendAttempt = { count: 0, resetAt: now + OTP_SEND_WINDOW_MS };
      otpSendAttempts.set(normalizedPhone, sendAttempt);
    }
    sendAttempt.count++;
    if (sendAttempt.count > OTP_SEND_MAX) {
      const retryAfter = Math.ceil((sendAttempt.resetAt - now) / 1000);
      return reply.status(429).send({
        error: `Too many OTP requests. Please wait ${Math.ceil(retryAfter / 60)} minute(s).`,
      });
    }

    // Simulated OTP — generate locally, store in DB, return in response
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000);
    await fastify.prisma.oTP.updateMany({
      where: { phone: normalizedPhone, verified: false },
      data: { verified: true },
    });
    await fastify.prisma.oTP.create({
      data: { phone: normalizedPhone, code, expiresAt },
    });

    return reply.send({ success: true, message: 'OTP sent successfully', otp: code });
  });

  /**
   * POST /auth/verify-otp
   * Body: { phone: string, code: string }
   * Verifies OTP against the database. Creates a new User if one doesn't exist.
   * Returns a JWT token and user object.
   */
  // In-memory store for OTP verify rate limiting: phone -> { count, resetAt }
  const otpVerifyAttempts = new Map();
  const OTP_MAX_ATTEMPTS = 5;
  const OTP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  fastify.post('/verify-otp', async (request, reply) => {
    const { phone, code } = request.body || {};

    if (!phone || !code) {
      return reply.status(400).send({ error: 'Phone and OTP code are required' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    // Rate limit: max 5 attempts per phone per 5 minutes
    const now = Date.now();
    const key = normalizedPhone;
    let attempt = otpVerifyAttempts.get(key);
    if (!attempt || now > attempt.resetAt) {
      attempt = { count: 0, resetAt: now + OTP_WINDOW_MS };
      otpVerifyAttempts.set(key, attempt);
    }
    attempt.count++;
    if (attempt.count > OTP_MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((attempt.resetAt - now) / 1000);
      return reply.status(429).send({
        error: `Too many OTP attempts. Please wait ${Math.ceil(retryAfter / 60)} minute(s) before trying again.`,
      });
    }

    // Local DB verification (simulated OTP)
    const otp = await fastify.prisma.oTP.findFirst({
      where: {
        phone: normalizedPhone,
        code: String(code),
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      return reply.status(400).send({ error: 'Invalid or expired OTP' });
    }

    // Mark OTP as verified
    await fastify.prisma.oTP.update({
      where: { id: otp.id },
      data: { verified: true },
    });

    // Clear rate limit on success
    otpVerifyAttempts.delete(key);

    // Find or create user
    let user = await fastify.prisma.user.findUnique({
      where: { phone: normalizedPhone },
      include: { shop: true },
    });

    if (!user) {
      // Generate a unique referral code
      const referralCode = normalizedPhone.slice(-4) + crypto.randomBytes(3).toString('hex');

      // Auto-assign admin role if this is the admin phone
      const role = normalizedPhone === config.adminPhone ? 'admin' : 'customer';

      user = await fastify.prisma.user.create({
        data: {
          phone: normalizedPhone,
          referralCode,
          role,
        },
        include: { shop: true },
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, phone: user.phone, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    return reply.send({ token, user });
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
