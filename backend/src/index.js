const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const fastifyWebsocket = require('@fastify/websocket');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const prisma = require('./services/prisma');

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.isDev ? 'info' : 'warn',
    },
  });

  // Decorate with Prisma client so routes can use fastify.prisma
  fastify.decorate('prisma', prisma);

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  // Register CORS — allow frontend origin and support preflight for file uploads
  const allowedOrigins = new Set([
    config.frontendUrl,
    'https://printdrop.app',
    'https://www.printdrop.app',
  ].filter(Boolean));
  if (config.isDev) {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://localhost:3001');
  }
  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const parsed = new URL(origin);
        const isLocalDev = config.isDev && ['localhost', '127.0.0.1'].includes(parsed.hostname);

        if (allowedOrigins.has(origin) || isLocalDev) {
          return cb(null, true);
        }
      } catch {
        return cb(new Error('Not allowed by CORS'), false);
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Register multipart for file uploads (50MB limit)
  await fastify.register(multipart, {
    limits: {
      fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
    },
  });

  // Capture raw body for routes that need it (e.g. Razorpay webhook HMAC verification).
  // Fastify v4 has no built-in rawBody option, so we override the JSON content-type
  // parser to also stash the original buffer on request.rawBody.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      req.rawBody = body.toString('utf8');
      done(null, JSON.parse(req.rawBody));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Ensure uploads directory exists
  if (!fs.existsSync(config.upload.dir)) {
    fs.mkdirSync(config.upload.dir, { recursive: true });
  }

  // Serve uploaded files as static
  await fastify.register(fastifyStatic, {
    root: config.upload.dir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Register rate limiter
  await fastify.register(require('./middleware/rate-limit'));

  // WebSocket support
  await fastify.register(fastifyWebsocket);
  fastify.register(require('./routes/ws').wsRoutes);

  // Register all routes under /api prefix
  await fastify.register(async function apiRoutes(api) {
    api.register(require('./routes/auth'),     { prefix: '/auth' });
    api.register(require('./routes/files'),    { prefix: '/files' });
    api.register(require('./routes/shops'),    { prefix: '/shops' });
    api.register(require('./routes/jobs'),     { prefix: '/jobs' });
    api.register(require('./routes/orders'),   { prefix: '/orders' });
    api.register(require('./routes/users'),    { prefix: '/users' });
    api.register(require('./routes/admin'),    { prefix: '/admin' });
    api.register(require('./routes/webhooks'), { prefix: '/webhooks' });
    api.register(require('./routes/printers'), { prefix: '/printers' });
    api.register(require('./routes/agent'),    { prefix: '/agent' });
  }, { prefix: '/api' });

  // Health check — includes WhatsApp webhook staleness indicator.
  // Set up an uptime monitor (UptimeRobot, BetterUptime) to alert on
  // whatsAppWebhookStale: true after business hours — means Gupshup stopped delivering.
  fastify.get('/health', async () => {
    const { getWebhookHealth } = require('./routes/webhooks');
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      ...getWebhookHealth(),
    };
  });

  return fastify;
}

function validateConfig() {
  const warnings = [];
  const errors = [];

  if (!config.database.url) errors.push('DATABASE_URL is not set');
  const WEAK_SECRETS = ['change-this-secret', 'printdrop_jwt_s3cr3t_change_in_prod_2024'];
  if (WEAK_SECRETS.includes(config.jwtSecret)) warnings.push('JWT_SECRET is using a known insecure value — generate a strong one with: openssl rand -base64 48');
  if (!config.razorpay.keyId) warnings.push('RAZORPAY_KEY_ID not set — payment links will use mock mode');
  if (!config.razorpay.webhookSecret) warnings.push('RAZORPAY_WEBHOOK_SECRET not set — webhook signature verification disabled');
  if (!config.telegram.disabled && !config.telegram.botToken) warnings.push('TELEGRAM_BOT_TOKEN not set — Telegram bot will not start');
  if (!config.whatsapp.apiKey) warnings.push('WHATSAPP_API_KEY not set — WhatsApp (Gupshup) cannot send messages');
  if (!config.whatsapp.sourceNumber) warnings.push('GUPSHUP_SOURCE_NUMBER not set — WhatsApp messages will not be sent');

  if (!config.isDev) {
    // Hard failures in production
    if (errors.length > 0) {
      console.error('\n  FATAL: Missing required configuration:\n');
      errors.forEach((e) => console.error(`    ✗ ${e}`));
      console.error('');
      process.exit(1);
    }
    const WEAK_SECRETS_PROD = ['change-this-secret', 'printdrop_jwt_s3cr3t_change_in_prod_2024'];
    if (WEAK_SECRETS_PROD.includes(config.jwtSecret) || config.jwtSecret.length < 32) {
      console.error('\n  FATAL: JWT_SECRET must be a strong secret (min 32 chars) in production.');
      console.error('  Generate one with: openssl rand -base64 48\n');
      process.exit(1);
    }
    if (config.storage.driver !== 'r2') {
      console.error('\n  FATAL: STORAGE_DRIVER must be "r2" in production so uploaded files are not served from the API host.\n');
      process.exit(1);
    }
  }

  if (warnings.length > 0) {
    console.warn('\n  Config warnings:');
    warnings.forEach((w) => console.warn(`    ⚠  ${w}`));
    console.warn('');
  }
  if (errors.length > 0 && config.isDev) {
    console.warn('\n  Config errors (non-fatal in dev):');
    errors.forEach((e) => console.warn(`    ✗ ${e}`));
    console.warn('');
  }
}

async function start() {
  validateConfig();
  const fastify = await buildServer();

  try {
    // Register Telegram webhook route before listen(); Fastify does not allow
    // new routes after the server has started.
    if (config.telegram.disabled) {
      fastify.log.warn('Telegram bot disabled by DISABLE_TELEGRAM_BOT');
    } else if (config.telegram.botToken) {
      try {
        const { startTelegramBot } = require('./bot/telegram');
        await startTelegramBot(fastify);
        fastify.log.info('Telegram bot started');
      } catch (err) {
        fastify.log.warn(`Telegram bot not started: ${err.message}`);
      }
    }

    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`PrintDrop API running on ${config.host}:${config.port}`);

    // WhatsApp (Gupshup) is purely webhook-driven — no polling required.
    // Ensure WHATSAPP_API_KEY and GUPSHUP_SOURCE_NUMBER are set in .env.
    if (config.whatsapp.apiKey && config.whatsapp.sourceNumber) {
      fastify.log.info(`WhatsApp (Gupshup) ready — webhook: POST /api/webhooks/whatsapp`);
    }
    // Start agent offline checker
    require('./jobs/agent-offline-checker').start(fastify);
    // Warn when experimental v2 bot is active
    const { isEnabled: isBotV2Enabled } = require('./bot/v2');
    if (isBotV2Enabled()) {
      fastify.log.warn('BOT_V2=1 — experimental in-memory bot is active. Sessions lost on restart. Not for production use without thorough testing.');
    }
    // Graceful shutdown — stop Telegram bot polling before exit
    const shutdown = async (signal) => {
      fastify.log.info(`${signal} received, shutting down...`);
      try {
        const { stopTelegramBot } = require('./bot/telegram');
        await stopTelegramBot();
      } catch (_) {}
      await fastify.close();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
