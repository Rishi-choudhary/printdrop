'use client';

import useSWR from 'swr';
import { useEffect } from 'react';
import { apiFetch } from './api';

const fetcher = (url: string) => apiFetch(url);

export function useJobs(filters?: Record<string, string>) {
  const params = new URLSearchParams(filters || {}).toString();
  const path = `/jobs${params ? `?${params}` : ''}`;
  return useSWR(path, fetcher, { refreshInterval: 15000 });
}

export function useShopQueue(shopId: string | undefined) {
  return useSWR(
    shopId ? `/shops/${shopId}/queue` : null,
    fetcher,
    { refreshInterval: 5000 }
  );
}

export function useShopStats(shopId: string | undefined) {
  return useSWR(
    shopId ? `/shops/${shopId}/stats` : null,
    fetcher,
    { refreshInterval: 30000 }
  );
}

export function useShops() {
  return useSWR('/shops', fetcher);
}

export function useAdminStats() {
  return useSWR('/admin/stats', fetcher, { refreshInterval: 30000 });
}

export function useAdminUsers(filters?: Record<string, string>) {
  const params = new URLSearchParams(filters || {}).toString();
  return useSWR(`/admin/users${params ? `?${params}` : ''}`, fetcher);
}

export function useAdminShops() {
  return useSWR('/admin/shops', fetcher);
}

export function useAdminJobs(filters?: Record<string, string>) {
  const params = new URLSearchParams(filters || {}).toString();
  return useSWR(`/admin/jobs${params ? `?${params}` : ''}`, fetcher, { refreshInterval: 15000 });
}

export function useAdminRevenue(days = 30) {
  return useSWR(`/admin/revenue?days=${days}`, fetcher);
}

export function useUserProfile() {
  return useSWR('/users/me', fetcher);
}

export function useUserJobs() {
  return useSWR('/users/me/jobs', fetcher);
}

export function useUserOrders(page = 1, limit = 20) {
  return useSWR(`/users/me/orders?page=${page}&limit=${limit}`, fetcher);
}

export function useShopEarnings(shopId: string | undefined) {
  return useSWR(
    shopId ? `/shops/${shopId}/earnings` : null,
    fetcher,
    { refreshInterval: 60000 }
  );
}

// WebSocket-enhanced queue hook — falls back to SWR polling when WS is disconnected.
// Connects to the backend WS endpoint directly (bypasses Next.js proxy).
export function useShopQueueWS(shopId: string | undefined) {
  const swrResult = useShopQueue(shopId);
  const { mutate } = swrResult;

  useEffect(() => {
    if (!shopId || typeof window === 'undefined') return;

    let ws: WebSocket | null = null;
    let reconnectDelay = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.printdrop.app';
        const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\/api$/, '');
        ws = new WebSocket(`${wsUrl}/ws/shop/${shopId}`);

        ws.onopen = () => { reconnectDelay = 1000; };

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'queue_update') mutate();
          } catch (_) {}
        };

        ws.onclose = () => {
          if (destroyed) return;
          timer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
            connect();
          }, reconnectDelay);
        };

        ws.onerror = () => { ws?.close(); };
      } catch (_) {}
    }

    connect();
    return () => {
      destroyed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [shopId, mutate]);

  return swrResult;
}

export function useAdminShopHealth(shopId: string | undefined) {
  return useSWR(shopId ? `/admin/shops/${shopId}/health` : null, fetcher, { refreshInterval: 30000 });
}

export function useShopHistory(shopId: string | undefined, page = 0, limit = 50) {
  const params = new URLSearchParams({ status: 'completed', limit: String(limit), offset: String(page * limit) }).toString();
  return useSWR(
    shopId ? `/jobs?${params}` : null,
    fetcher,
    { refreshInterval: 30000 }
  );
}
