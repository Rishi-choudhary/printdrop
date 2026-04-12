const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const prisma = new PrismaClient();

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
  const allowedOrigins = [
    config.frontendUrl,
    'http://localhost:3000',
    'http://localhost:3001',
  ];
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return cb(null, true);
      // Allow configured origins and any *.railway.app / *.vercel.app domain
      if (allowedOrigins.includes(origin) || origin.endsWith('.railway.app') || origin.endsWith('.vercel.app')) {
        return cb(null, true);
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

  // Register all routes under /api prefix
  await fastify.register(async function apiRoutes(api) {
    api.register(require('./routes/auth'),     { prefix: '/auth' });
    api.register(require('./routes/files'),    { prefix: '/files' });
    api.register(require('./routes/shops'),    { prefix: '/shops' });
    api.register(require('./routes/jobs'),     { prefix: '/jobs' });
    api.register(require('./routes/users'),    { prefix: '/users' });
    api.register(require('./routes/admin'),    { prefix: '/admin' });
    api.register(require('./routes/webhooks'), { prefix: '/webhooks' });
    api.register(require('./routes/printers'), { prefix: '/printers' });
  }, { prefix: '/api' });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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
  if (!config.telegram.botToken) warnings.push('TELEGRAM_BOT_TOKEN not set — Telegram bot will not start');
  if (!config.whatsapp.apiKey) warnings.push('WHATSAPP_API_KEY not set — WhatsApp (Gupshup) cannot send messages');
  if (!config.whatsapp.sourceNumber) warnings.push('GUPSHUP_SOURCE_NUMBER not set — WhatsApp messages will not be sent');
  if (!config.msg91.authKey) warnings.push('MSG91_AUTH_KEY not set — OTP will be returned in API response (dev mode only)');

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
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`PrintDrop API running on ${config.host}:${config.port}`);

    // Start Telegram bot (optional — WhatsApp via Gupshup is the primary channel)
    if (config.telegram.botToken) {
      try {
        const startBot = require('./bot/telegram');
        if (typeof startBot === 'function') {
          await startBot(fastify);
          fastify.log.info('Telegram bot started');
        }
      } catch (err) {
        fastify.log.warn(`Telegram bot not started: ${err.message}`);
      }
    }

    // WhatsApp (Gupshup) is purely webhook-driven — no polling required.
    // Ensure WHATSAPP_API_KEY and GUPSHUP_SOURCE_NUMBER are set in .env.
    if (config.whatsapp.apiKey && config.whatsapp.sourceNumber) {
      fastify.log.info(`WhatsApp (Gupshup) ready — webhook: POST /api/webhooks/whatsapp`);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
