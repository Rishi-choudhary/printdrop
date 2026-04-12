import Cookies from 'js-cookie';

// Always use relative /api path — Vercel/Next.js rewrites proxy to the backend
const API_BASE = '/api';

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = Cookies.get('token');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: <T = any>(path: string) => apiFetch<T>(path),
  post: <T = any>(path: string, body: any) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T = any>(path: string, body: any) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T = any>(path: string, body?: any) =>
    apiFetch<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),

  /**
   * Upload a file as multipart/form-data.
   * Uses XMLHttpRequest for progress tracking (see FileUpload component).
   * This helper is a simple fetch-based fallback without progress.
   */
  upload: async <T = any>(path: string, file: File): Promise<T> => {
    const token = Cookies.get('token');
    const form  = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
};
