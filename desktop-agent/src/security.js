'use strict';

const dns = require('dns').promises;
const net = require('net');

const PRIVATE_HOSTS = new Set(['localhost', 'localhost.localdomain']);
const MAX_STRING_LENGTH = 2048;

function toSafeString(value, maxLength = MAX_STRING_LENGTH) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function toBoolean(value, defaultValue = false) {
  return typeof value === 'boolean' ? value : defaultValue;
}

function toEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeApiUrl(value, { allowLocalhost = process.env.NODE_ENV === 'development' } = {}) {
  const raw = toSafeString(value, 512).replace(/\/+$/, '');
  if (!raw) throw new Error('Server URL is required');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Server URL must be a valid http(s) URL');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Server URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Server URL must not contain credentials');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Server URL must contain only scheme, host, and optional port');
  }
  if (parsed.protocol !== 'https:' && !(allowLocalhost && isLocalHostname(parsed.hostname))) {
    throw new Error('Server URL must use https outside local development');
  }

  parsed.pathname = '';
  return parsed.toString().replace(/\/$/, '');
}

function isLocalHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return PRIVATE_HOSTS.has(host) || host.endsWith('.localhost') || isPrivateIp(host);
}

function isPrivateIp(hostname) {
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    const parts = hostname.split('.').map((p) => Number(p));
    const [a, b] = parts;
    return a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
  }
  if (ipVersion === 6) {
    const host = hostname.toLowerCase();
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
  }
  return false;
}

async function assertPublicHttpUrl(value, { allowHttp = false, allowPrivate = false } = {}) {
  const raw = toSafeString(value, 4096);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL is invalid');
  }

  if (parsed.username || parsed.password) throw new Error('URL credentials are not allowed');
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error('URL must use https');
  }

  if (!allowPrivate && isLocalHostname(parsed.hostname)) throw new Error('URL targets a private host');

  const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true }).catch(() => []);
  for (const record of records) {
    if (!allowPrivate && isPrivateIp(record.address)) throw new Error('URL resolves to a private address');
  }

  return parsed.toString();
}

function pickAllowed(input, schema) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};

  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];

    if (rule.type === 'string') {
      const str = toSafeString(value, rule.maxLength || MAX_STRING_LENGTH);
      if (rule.required && !str) throw new Error(`${key} is required`);
      out[key] = str || rule.default || '';
    } else if (rule.type === 'nullableString') {
      const str = toSafeString(value, rule.maxLength || MAX_STRING_LENGTH);
      out[key] = str || null;
    } else if (rule.type === 'boolean') {
      out[key] = toBoolean(value, rule.default || false);
    } else if (rule.type === 'integer') {
      const n = Number.parseInt(value, 10);
      const min = rule.min ?? Number.MIN_SAFE_INTEGER;
      const max = rule.max ?? Number.MAX_SAFE_INTEGER;
      out[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : (rule.default ?? min);
    } else if (rule.type === 'enum') {
      out[key] = toEnum(value, rule.values, rule.default);
    }
  }

  return out;
}

function sanitizeJobId(jobId) {
  const id = toSafeString(jobId, 128);
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(id)) throw new Error('Invalid job id');
  return id;
}

module.exports = {
  assertPublicHttpUrl,
  normalizeApiUrl,
  pickAllowed,
  sanitizeJobId,
  toBoolean,
  toSafeString,
};
