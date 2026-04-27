'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/navbar';
import { useAuth } from '@/lib/auth';
import { useUserOrders } from '@/lib/hooks';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer } from 'lucide-react';

export default function OrderHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [page, setPage] = useState(1);
  const { data, error } = useUserOrders(page);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  if (!user) {
    if (typeof window !== 'undefined') window.location.assign('/login');
    return null;
  }

  const jobs = data?.jobs || [];
  const hasMore = data?.hasMore || false;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/profile" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold">Order History</h1>
        </div>

        {error && (
          <p className="text-center text-red-500 py-8">Failed to load orders. Please try again.</p>
        )}

        {!error && jobs.length === 0 && !data && (
          <p className="text-center text-gray-400 py-8">Loading…</p>
        )}

        {!error && data && jobs.length === 0 && (
          <Card>
            <CardBody className="flex flex-col items-center text-center py-12">
              <Printer className="w-12 h-12 text-gray-200 mb-4" />
              <p className="text-gray-500 mb-4">No orders yet — start printing at</p>
              <Link href="/print">
                <Button>Start a Print Job</Button>
              </Link>
            </CardBody>
          </Card>
        )}

        {jobs.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">All Orders</h2>
                <span className="text-xs text-gray-400">{data?.total} total</span>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-gray-50">
                {jobs.map((job: any) => (
                  <div key={job.id} className="px-5 py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{job.fileName}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        #{String(job.token).padStart(3, '0')} · {job.shop?.name} · {new Date(job.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="text-sm font-semibold">₹{job.totalPrice.toFixed(0)}</span>
                      <Badge status={job.status} />
                    </div>
                  </div>
                ))}
              </div>
              {hasMore && (
                <div className="p-4 text-center border-t">
                  <Button variant="ghost" onClick={() => setPage((p) => p + 1)}>
                    Load more
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
