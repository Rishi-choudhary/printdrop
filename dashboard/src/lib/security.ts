const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:']);

export function encodePathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

export function buildApiPath(pathname: string, query?: Record<string, string | number | boolean | null | undefined>): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const params = new URLSearchParams();

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();
  return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
}

export function getSafeExternalUrl(value: unknown, allowedHosts?: readonly string[]): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const url = new URL(value);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
    if (allowedHosts?.length && !allowedHosts.includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getSafeHref(value: unknown, allowedHosts?: readonly string[]): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const url = new URL(value, window.location.origin);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
    if (url.origin !== window.location.origin && allowedHosts?.length && !allowedHosts.includes(url.hostname.toLowerCase())) {
      return null;
    }
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    return null;
  }
}

export function getSafePaymentUrl(value: unknown): string | null {
  return getSafeExternalUrl(value, ['rzp.io', 'razorpay.com', 'api.razorpay.com']);
}
