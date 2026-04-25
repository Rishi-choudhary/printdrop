'use strict';

const STORAGE_KEY_RE = /^uploads\/[A-Za-z0-9_.-]+$/;

function parseInteger(value, { defaultValue, min = 0, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

function pickDefined(source, allowed) {
  const data = {};
  for (const key of allowed) {
    if (source && source[key] !== undefined) data[key] = source[key];
  }
  return data;
}

function isValidStorageKey(key) {
  return typeof key === 'string' && STORAGE_KEY_RE.test(key) && !key.includes('..');
}

function timingSafeEqualHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return require('crypto').timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorizedForJob(user, job) {
  if (!user || !job) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'customer') return job.userId === user.id;
  if (user.role === 'shopkeeper') return user.shop?.id === job.shopId || job.userId === user.id;
  return false;
}

module.exports = {
  parseInteger,
  pickDefined,
  isValidStorageKey,
  timingSafeEqualHex,
  isAuthorizedForJob,
};
