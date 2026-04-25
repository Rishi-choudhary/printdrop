const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  frontendUrl: process.env.FRONTEND_URL || 'https://printdrop.app',
  apiUrl: process.env.API_URL || 'https://api.printdrop.app',

  jwtSecret: process.env.JWT_SECRET || 'change-this-secret',

  database: {
    url: process.env.DATABASE_URL,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
    disabled: process.env.DISABLE_TELEGRAM_BOT === '1',
  },

  whatsapp: {
    // Gupshup send endpoint
    apiUrl: process.env.WHATSAPP_API_URL || 'https://api.gupshup.io/wa/api/v1/msg',
    // Gupshup template/HSM endpoint — used for business-initiated messages outside 24h session window
    templateApiUrl: process.env.WHATSAPP_TEMPLATE_URL || 'https://api.gupshup.io/wa/api/v1/template/msg',
    apiKey: process.env.WHATSAPP_API_KEY || '',           // Gupshup API key
    webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET || '', // optional token for webhook verification
    sourceNumber: process.env.GUPSHUP_SOURCE_NUMBER || '', // your WhatsApp number e.g. "918291234567"
    appName: process.env.GUPSHUP_APP_NAME || 'PrintDrop',  // Gupshup app/bot name
    // Approved Gupshup template IDs for business-initiated messages.
    // If blank, falls back to regular freeform message (only works within 24h session window).
    templates: {
      tokenIssued: process.env.GUPSHUP_TEMPLATE_TOKEN_ISSUED || '',
      readyForPickup: process.env.GUPSHUP_TEMPLATE_READY_FOR_PICKUP || '',
    },
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  // Cloudflare R2
  storage: {
    driver: process.env.STORAGE_DRIVER || 'local', // "local" or "r2"
    r2: {
      accountId: process.env.R2_ACCOUNT_ID || '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      bucketName: process.env.R2_BUCKET_NAME || 'printdrop',
      publicUrl: process.env.R2_PUBLIC_URL || '',
    },
  },

  // LibreOffice conversion service
  libreoffice: {
    url: process.env.LIBREOFFICE_URL || 'http://printdrop-libreoffice.railway.internal:3002',
  },

  upload: {
    dir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || './uploads'),
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50,
    allowedFileTypes: (process.env.ALLOWED_FILE_TYPES || 'pdf,jpg,jpeg,png,doc,docx,ppt,pptx').split(','),
  },

  redis: {
    url: process.env.REDIS_URL || '',
  },

  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 5,
  },

  adminPhone: process.env.ADMIN_PHONE || '+919999999999',

};

module.exports = config;
