/**
 * Winston logger.
 * Writes to userData/logs/agent.log with rotation (5MB × 3 files = 15MB max).
 * Console transport is active in development (NODE_ENV=development or !app.isPackaged).
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let _logger = null;

function getLogger() {
  if (_logger) return _logger;

  const logDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const fmt = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) =>
      stack
        ? `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`
        : `${timestamp} [${level.toUpperCase()}] ${message}`,
    ),
  );

  const transports = [
    new winston.transports.File({
      filename: path.join(logDir, 'agent.log'),
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 3,
      tailable: true, // most recent logs always in agent.log
      format: fmt,
    }),
  ];

  if (!app.isPackaged || process.env.NODE_ENV === 'development') {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
        ),
      }),
    );
  }

  _logger = winston.createLogger({ level: 'info', transports });
  return _logger;
}

// Proxy object so callers can `require('./logger').info(...)` directly
module.exports = new Proxy(
  {},
  {
    get(_, method) {
      return (...args) => getLogger()[method]?.(...args);
    },
  },
);
