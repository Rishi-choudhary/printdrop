'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock3, FileText, Printer, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { encodePathSegment } from '@/lib/security';
import {
  CachedWebOrder,
  getOrderStatusLabel,
  readCachedWebOrders,
  removeCachedWebOrder,
  upsertCachedWebOrder,
} from '@/lib/web-orders';
import { OrderProgress } from '@/components/order-progress';

type JobStatusResponse = {
  id: string;
  token: number;
  status: string;
  fileName: string;
  shop?: { name?: string };
  shopName?: string;
};

export function RecentWebOrders({ className = '' }: { className?: string }) {
  const [orders, setOrders] = useState<CachedWebOrder[]>([]);

  const refresh = useCallback(async () => {
    const cached = readCachedWebOrders();
    if (cached.length === 0) {
      setOrders([]);
      return;
    }

    const refreshed = await Promise.all(
      cached.map(async (order) => {
        try {
          const res = await fetch(`/api/webhooks/razorpay/job/${encodePathSegment(order.jobId)}`, {
            cache: 'no-store',
          });
          if (!res.ok) return order;
          const data = (await res.json()) as JobStatusResponse;
          const next = {
            jobId: order.jobId,
            token: data.token,
            status: data.status,
            fileName: data.fileName,
            shopName: data.shop?.name || data.shopName || order.shopName,
          };
          upsertCachedWebOrder(next);
          return { ...order, ...next, updatedAt: Date.now() };
        } catch {
          return order;
        }
      }),
    );

    setOrders(refreshed.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4));
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 15000);
    const onUpdated = () => setOrders(readCachedWebOrders());
    window.addEventListener('printdrop:web-orders-updated', onUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('printdrop:web-orders-updated', onUpdated);
    };
  }, [refresh]);

  if (orders.length === 0) return null;

  return (
    <section className={className}>
      <div className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-6">
        <div className="rounded-2xl border border-blue-100 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Recent web orders</p>
              <h2 className="text-xl font-semibold tracking-tight text-gray-950">Track your print from this browser</h2>
            </div>
            <Link href="/print">
              <Button size="sm" className="w-full sm:w-auto">Upload another file</Button>
            </Link>
          </div>

          <div className="divide-y divide-gray-100">
            {orders.map((order) => (
              <article key={order.jobId} className="px-5 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-3xl font-black tracking-tight text-blue-600">
                        {order.token ? `#${String(order.token).padStart(3, '0')}` : 'Token'}
                      </span>
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                        {getOrderStatusLabel(order.status)}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-1 text-sm text-gray-500 sm:grid-cols-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Printer className="h-4 w-4 shrink-0 text-gray-400" />
                        <span className="truncate">{order.shopName || 'Selected print shop'}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                        <span className="truncate">{order.fileName || 'Uploaded file'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Link href={`/pay/${encodePathSegment(order.jobId)}`}>
                      <Button variant="secondary" size="sm">View</Button>
                    </Link>
                    <button
                      onClick={() => setOrders(removeCachedWebOrder(order.jobId))}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Remove from this browser"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <OrderProgress status={order.status} className="mt-5" />

                <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
                  <Clock3 className="h-3.5 w-3.5" />
                  Saved only on this device.
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
