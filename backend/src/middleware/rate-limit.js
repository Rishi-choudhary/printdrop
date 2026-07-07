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

  // "1m" / "30s" / number(ms) → ms
  function parseWindow(win) {
    if (typeof win === 'number') return win;
    const m = /^(\d+)\s*([sm])$/.exec(String(win || ''));
    if (!m) return windowMs;
    return Number(m[1]) * (m[2] === 's' ? 1000 : 60000);
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const ip = request.ip;
    const now = Date.now();

    // Routes may declare stricter limits via config: { rateLimit: { max, timeWindow } }
    // (e.g. public upload). Those are tracked in a separate per-route bucket.
    const routeLimit = request.routeOptions?.config?.rateLimit;
    const max = routeLimit?.max || maxRequests;
    const window = routeLimit ? parseWindow(routeLimit.timeWindow) : windowMs;
    const key = routeLimit ? `${ip}:${request.routeOptions.url}` : ip;

    let entry = store.get(key);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + window };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    reply.header('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > max) {
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
