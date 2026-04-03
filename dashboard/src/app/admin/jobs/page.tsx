'use client';

import { useState } from 'react';
import { useAdminJobs } from '@/lib/hooks';
import { api } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const STATUSES = ['', 'pending', 'payment_pending', 'queued', 'printing', 'ready', 'picked_up', 'cancelled'];

export default function AdminJobsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const filters: Record<string, string> = {};
  if (statusFilter) filters.status = statusFilter;
  const { data, mutate } = useAdminJobs(filters);

  const forceStatus = async (jobId: string, status: string) => {
    await api.patch(`/jobs/${jobId}/status`, { status });
    mutate();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">All Jobs</h1>

      {/* Filters */}
      <div className="flex space-x-2 overflow-x-auto">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${statusFilter === s ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-600 border'}`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Token</th>
                  <th className="px-4 py-3 text-left">File</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Shop</th>
                  <th className="px-4 py-3 text-left">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data?.jobs || []).map((job: any) => (
                  <tr key={job.id}>
                    <td className="px-4 py-3 font-bold">#{String(job.token).padStart(3, '0')}</td>
                    <td className="px-4 py-3">
                      <a href={job.fileUrl} target="_blank" rel="noopener" className="text-blue-600 hover:underline text-xs">
                        {job.fileName}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs">{job.user?.name || job.user?.phone || '—'}</td>
                    <td className="px-4 py-3 text-xs">{job.shop?.name || '—'}</td>
                    <td className="px-4 py-3">₹{job.totalPrice.toFixed(0)}</td>
                    <td className="px-4 py-3"><Badge status={job.status} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(job.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {job.status !== 'cancelled' && job.status !== 'picked_up' && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => forceStatus(job.id, 'cancelled')}
                        >
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && <p className="text-xs text-gray-400 px-4 py-2">Showing {data.jobs?.length || 0} of {data.total || 0} jobs</p>}
        </CardBody>
      </Card>
    </div>
  );
}
