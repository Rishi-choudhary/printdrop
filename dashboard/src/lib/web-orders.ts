'use client';

export interface CachedWebOrder {
  jobId: string;
  token?: number;
  shopName?: string;
  fileName?: string;
  status?: string;
  createdAt: number;
  updatedAt: number;
}

export const WEB_ORDER_STORAGE_KEY = 'printdrop.webOrders.v1';

export const ORDER_PROGRESS_STEPS = [
  'Order received',
  'Printing in progress',
  'Ready for pickup',
  'Picked up',
  'Thank you!',
] as const;

export function getOrderProgressIndex(status?: string): number {
  switch (status) {
    case 'printing':
      return 1;
    case 'ready':
      return 2;
    case 'picked_up':
      return 4;
    case 'queued':
    case 'payment_pending':
    case 'pending':
    default:
      return 0;
  }
}

export function getOrderStatusLabel(status?: string): string {
  switch (status) {
    case 'pending':
      return 'Awaiting payment';
    case 'payment_pending':
      return 'Payment pending';
    case 'queued':
      return 'Token generated';
    case 'printing':
      return 'Printing';
    case 'ready':
      return 'Ready for pickup';
    case 'picked_up':
      return 'Picked up';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Order received';
  }
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readCachedWebOrders(): CachedWebOrder[] {
  if (!hasStorage()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WEB_ORDER_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.jobId === 'string')
      .map((item) => ({
        jobId: item.jobId,
        token: typeof item.token === 'number' ? item.token : undefined,
        shopName: typeof item.shopName === 'string' ? item.shopName : undefined,
        fileName: typeof item.fileName === 'string' ? item.fileName : undefined,
        status: typeof item.status === 'string' ? item.status : undefined,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function upsertCachedWebOrder(order: Partial<CachedWebOrder> & { jobId: string }): CachedWebOrder[] {
  if (!hasStorage()) return [];

  const now = Date.now();
  const current = readCachedWebOrders();
  const existing = current.find((item) => item.jobId === order.jobId);
  const nextOrder: CachedWebOrder = {
    jobId: order.jobId,
    token: order.token ?? existing?.token,
    shopName: order.shopName ?? existing?.shopName,
    fileName: order.fileName ?? existing?.fileName,
    status: order.status ?? existing?.status,
    createdAt: existing?.createdAt ?? order.createdAt ?? now,
    updatedAt: now,
  };

  const next = [
    nextOrder,
    ...current.filter((item) => item.jobId !== order.jobId),
  ].slice(0, 8);

  window.localStorage.setItem(WEB_ORDER_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('printdrop:web-orders-updated'));
  return next;
}

export function removeCachedWebOrder(jobId: string): CachedWebOrder[] {
  if (!hasStorage()) return [];
  const next = readCachedWebOrders().filter((item) => item.jobId !== jobId);
  window.localStorage.setItem(WEB_ORDER_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('printdrop:web-orders-updated'));
  return next;
}
