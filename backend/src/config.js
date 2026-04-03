const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:3001',

  jwtSecret: process.env.JWT_SECRET || 'change-this-secret',

  database: {
    url: process.env.DATABASE_URL,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
  },

  whatsapp: {
    apiUrl: process.env.WHATSAPP_API_URL || '',
    apiKey: process.env.WHATSAPP_API_KEY || '',
    webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET || '',
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
    url: process.env.LIBREOFFICE_URL || 'http://localhost:3002',
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

  msg91: {
    authKey: process.env.MSG91_AUTH_KEY || '',
    templateId: process.env.MSG91_TEMPLATE_ID || '',
    senderId: process.env.MSG91_SENDER_ID || 'PRNTDP',
  },
};

module.exports = config;
