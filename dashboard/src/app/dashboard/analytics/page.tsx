'use client';

import { useAuth } from '@/lib/auth';
import { useShopStats, useShopQueue } from '@/lib/hooks';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { FileText, IndianRupee, TrendingUp, Clock, Printer } from 'lucide-react';

export default function AnalyticsPage() {
  const { user } = useAuth();
  const shopId = user?.shop?.id;
  const { data: stats, error: statsError } = useShopStats(shopId);
  const { data: jobs, error: queueError } = useShopQueue(shopId);

  if (!shopId) {
    return (
      <div className="py-12 text-center text-gray-500">
        <Printer className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p>No shop linked to your account.</p>
      </div>
    );
  }

  if (statsError || queueError) {
    return (
      <div className="py-12 text-center text-red-500">
        Failed to load analytics. Please try refreshing.
      </div>
    );
  }

  // Process jobs for chart data
  const jobsList: any[] = Array.isArray(jobs) ? jobs : [];
  const statusCounts: Record<string, number> = {};
  let totalRevenue = 0;

  for (const job of jobsList) {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    if (['queued', 'printing', 'ready', 'picked_up'].includes(job.status)) {
      totalRevenue += job.shopEarning || 0;
    }
  }

  // Hourly distribution
  const hourlyJobs: Record<number, number> = {};
  for (const job of jobsList) {
    const hour = new Date(job.createdAt).getHours();
    hourlyJobs[hour] = (hourlyJobs[hour] || 0) + 1;
  }
  const busiestHour = Object.entries(hourlyJobs).sort(([, a], [, b]) => (b as number) - (a as number))[0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Today's Jobs" value={stats?.today?.jobs || 0} icon={<FileText className="w-6 h-6" />} />
        <StatCard label="Today's Revenue" value={`₹${(stats?.today?.revenue || 0).toFixed(0)}`} icon={<IndianRupee className="w-6 h-6" />} />
        <StatCard label="Ready for Pickup" value={stats?.today?.ready || 0} icon={<TrendingUp className="w-6 h-6" />} />
        <StatCard label="Busiest Hour" value={busiestHour ? `${busiestHour[0]}:00` : '—'} icon={<Clock className="w-6 h-6" />} />
      </div>

      {/* Status Breakdown */}
      <Card>
        <CardHeader><h2 className="font-semibold">Today&apos;s Status Breakdown</h2></CardHeader>
        <CardBody>
          {Object.keys(statusCounts).length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No jobs today yet</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(statusCounts).map(([status, count]) => (
                <div key={status} className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-3xl font-bold">{count}</p>
                  <Badge status={status} className="mt-1" />
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Hourly Chart */}
      <Card>
        <CardHeader><h2 className="font-semibold">Jobs by Hour (Today)</h2></CardHeader>
        <CardBody>
          {Object.keys(hourlyJobs).length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No data yet</p>
          ) : (
            <div className="flex items-end gap-1 h-40">
              {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                const count = hourlyJobs[hour] || 0;
                const maxCount = Math.max(...Object.values(hourlyJobs), 1);
                const heightPct = (count / maxCount) * 100;
                return (
                  <div key={hour} className="flex-1 flex flex-col items-center justify-end h-full" title={`${hour}:00 — ${count} jobs`}>
                    <div
                      className={`w-full rounded-t transition-all ${count > 0 ? 'bg-blue-500' : 'bg-gray-100'}`}
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    />
                    {hour % 3 === 0 && (
                      <span className="text-[10px] text-gray-400 mt-1">{hour}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Revenue summary */}
      <Card>
        <CardHeader><h2 className="font-semibold">Revenue Summary</h2></CardHeader>
        <CardBody>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-green-600">₹{totalRevenue.toFixed(0)}</p>
              <p className="text-xs text-gray-500">Shop Earning (Today)</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{jobsList.length}</p>
              <p className="text-xs text-gray-500">Total Jobs</p>
            </div>
            <div>
              <p className="text-2xl font-bold">₹{jobsList.length > 0 ? (totalRevenue / jobsList.length).toFixed(0) : '0'}</p>
              <p className="text-xs text-gray-500">Avg Job Value</p>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
