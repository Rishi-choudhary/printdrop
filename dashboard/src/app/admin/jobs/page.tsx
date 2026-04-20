'use client';

import { useState } from 'react';
import { useAdminJobs } from '@/lib/hooks';
import { api } from '@/lib/api';
import {
  History, Search, ChevronLeft, ChevronRight,
  FileText, CheckCircle, XCircle, IndianRupee, RefreshCw,
} from 'lucide-react';

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: '',           label: 'All statuses' },
  { value: 'queued',     label: 'Queued' },
  { value: 'printing',   label: 'Printing' },
  { value: 'ready',      label: 'Ready' },
  { value: 'picked_up',  label: 'Picked Up' },
  { value: 'cancelled',  label: 'Cancelled' },
  { value: 'completed',  label: 'Completed (done + cancelled)' },
];

const BADGE: Record<string, string> = {
  queued:          'bg-blue-100 text-blue-800',
  printing:        'bg-amber-100 text-amber-800',
  ready:           'bg-green-100 text-green-800',
  payment_pending: 'bg-yellow-100 text-yellow-800',
  picked_up:       'bg-green-100 text-green-700',
  cancelled:       'bg-red-100 text-red-700',
};

export default function AdminJobsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [search,       setSearch]       = useState('');
  const [page,         setPage]         = useState(0);

  const filters: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) };
  if (statusFilter) filters.status = statusFilter;

  const { data, mutate, isLoading } = useAdminJobs(filters);
  const jobs: any[]    = data?.jobs  || [];
  const total: number  = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = search.trim()
    ? jobs.filter((j: any) =>
        String(j.token).includes(search) ||
        j.fileName?.toLowerCase().includes(search.toLowerCase()) ||
        j.user?.phone?.includes(search) ||
        j.user?.name?.toLowerCase().includes(search.toLowerCase()) ||
        j.shop?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : jobs;

  const forceStatus = async (jobId: string, status: string) => {
    await api.patch(`/jobs/${jobId}/status`, { status });
    mutate();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <History className="w-4 h-4 text-gray-600" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900 leading-none">Job History</h1>
            <p className="text-xs text-gray-400 mt-0.5">{total} jobs total</p>
          </div>
        </div>
        <button onClick={() => mutate()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />Refresh
        </button>
      </div>

      {/* Filters row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by token, file, customer, or shop…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[180px]"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-400 font-bold">
              <tr>
                <th className="px-4 py-3 text-left">Token</th>
                <th className="px-4 py-3 text-left">File</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Shop</th>
                <th className="px-4 py-3 text-left">Specs</th>
                <th className="px-4 py-3 text-left">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <History className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                    <p className="text-gray-400 font-medium">No jobs found</p>
                  </td>
                </tr>
              ) : (
                filtered.map((job: any) => (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-black font-mono text-gray-800">
                      #{String(job.token).padStart(3, '0')}
                    </td>
                    <td className="px-4 py-3 max-w-[140px]">
                      <a href={job.fileUrl} target="_blank" rel="noopener"
                        className="flex items-center gap-1 text-blue-600 hover:underline text-xs truncate" title={job.fileName}>
                        <FileText className="w-3 h-3 shrink-0" />{job.fileName}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{job.user?.name || job.user?.phone || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{job.shop?.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {job.pageCount}pg · {job.copies}× · {job.color ? 'Color' : 'B&W'}
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-800 whitespace-nowrap">
                      <span className="flex items-center gap-0.5">
                        <IndianRupee className="w-3 h-3" />{job.totalPrice?.toFixed(0)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${BADGE[job.status] || 'bg-gray-100 text-gray-600'}`}>
                        {job.status === 'picked_up'
                          ? <CheckCircle className="w-3 h-3" />
                          : job.status === 'cancelled'
                          ? <XCircle className="w-3 h-3" />
                          : null}
                        {job.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      {' · '}
                      {new Date(job.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {job.status !== 'cancelled' && job.status !== 'picked_up' && (
                        <button
                          onClick={() => forceStatus(job.id, 'cancelled')}
                          className="px-2.5 py-1 text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
          <span>Page {page + 1} of {pages} · {total} total</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
