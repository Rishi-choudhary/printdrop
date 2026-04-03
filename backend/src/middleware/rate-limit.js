const fp = require('fastify-plugin');

/**
 * Simple in-memory rate limiter.
 * Tracks request counts per IP address within a sliding window.
 * Default: 100 requests per 60 seconds.
 */
function rateLimitPlugin(fastify, opts, done) {
  const maxRequests = opts.max || 100;
  const windowMs = opts.windowMs || 60 * 1000; // 1 minute

  // Map of IP -> { count, resetTime }
  const store = new Map();

  // Periodically clean up expired entries to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store) {
      if (now > entry.resetTime) {
        store.delete(ip);
      }
    }
  }, windowMs * 2);

  // Ensure the interval doesn't keep the process alive
  cleanupInterval.unref();

  fastify.addHook('onRequest', async (request, reply) => {
    const ip = request.ip;
    const now = Date.now();

    let entry = store.get(ip);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      store.set(ip, entry);
    }

    entry.count++;

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', maxRequests);
    reply.header('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    reply.header('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > maxRequests) {
      return reply.status(429).send({
        error: 'Too many requests',
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
      });
    }
  });

  done();
}

module.exports = fp(rateLimitPlugin, {
  name: 'rate-limit',
});
