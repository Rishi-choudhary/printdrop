const AUTH_COOKIE_NAME = 'pd_session';
const LEGACY_AUTH_COOKIE_NAME = 'token';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);

  return parts.join('; ');
}

function createAuthCookie(token, { secure } = {}) {
  return serializeCookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

function clearAuthCookie({ secure } = {}) {
  return serializeCookie(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: 0,
    expires: new Date(0),
  });
}

function clearLegacyAuthCookie({ secure } = {}) {
  return serializeCookie(LEGACY_AUTH_COOKIE_NAME, '', {
    secure,
    sameSite: 'Lax',
    maxAge: 0,
    expires: new Date(0),
  });
}

function parseCookies(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const eq = part.indexOf('=');
      if (eq === -1) return cookies;
      const name = part.slice(0, eq);
      const value = part.slice(eq + 1);
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

function getAuthTokenFromRequest(request) {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return { token: authHeader.slice(7), source: 'authorization' };
  }

  const cookies = parseCookies(request.headers.cookie);
  if (cookies[AUTH_COOKIE_NAME]) {
    return { token: cookies[AUTH_COOKIE_NAME], source: 'cookie' };
  }

  return { token: null, source: null };
}

module.exports = {
  AUTH_COOKIE_NAME,
  createAuthCookie,
  clearAuthCookie,
  clearLegacyAuthCookie,
  getAuthTokenFromRequest,
};
