'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useShopHistory } from '@/lib/hooks';
import Link from 'next/link';
import {
  History, ChevronLeft, ChevronRight, Search, FileText,
  CheckCircle, XCircle, IndianRupee, Printer,
} from 'lucide-react';

const PAGE_SIZE = 50;

const STATUS_STYLES: Record<string, string> = {
  picked_up: 'bg-green-100 text-green-800',
  cancelled:  'bg-red-100  text-red-700',
};

function statusLabel(s: string) {
  return s === 'picked_up' ? 'Picked Up' : s === 'cancelled' ? 'Cancelled' : s;
}

export default function ShopHistoryPage() {
  const { user } = useAuth();
  const shopId   = user?.shop?.id;

  const [page,   setPage]   = useState(0);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useShopHistory(shopId, page, PAGE_SIZE);
  const jobs: any[]  = data?.jobs  || [];
  const total: number = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = search.trim()
    ? jobs.filter((j) =>
        String(j.token).includes(search) ||
        j.fileName?.toLowerCase().includes(search.toLowerCase()) ||
        j.user?.phone?.includes(search) ||
        j.user?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : jobs;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <History className="w-4 h-4 text-gray-600" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900 leading-none">Print History</h1>
            <p className="text-xs text-gray-400 mt-0.5">{total} completed jobs</p>
          </div>
        </div>
        <Link href="/dashboard"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <Printer className="w-4 h-4" />
          <span className="hidden sm:inline">Live queue</span>
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by token, file name, or customer…"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
        />
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
                <th className="px-4 py-3 text-left">Specs</th>
                <th className="px-4 py-3 text-left">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <History className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                    <p className="text-gray-400 font-medium">No completed jobs yet</p>
                    <p className="text-gray-300 text-xs mt-1">Picked-up and cancelled jobs will appear here</p>
                  </td>
                </tr>
              ) : (
                filtered.map((job: any) => (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-black font-mono text-gray-800">
                      #{String(job.token).padStart(3, '0')}
                    </td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <span className="truncate block text-xs text-gray-600 font-medium" title={job.fileName}>
                        <FileText className="w-3 h-3 inline mr-1 text-gray-400" />
                        {job.fileName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {job.user?.name || job.user?.phone || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {job.pageCount}pg · {job.copies}× · {job.color ? 'Color' : 'B&W'} · {job.paperSize || 'A4'}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-800">
                      <span className="flex items-center gap-0.5">
                        <IndianRupee className="w-3 h-3" />{job.totalPrice?.toFixed(0)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[job.status] || 'bg-gray-100 text-gray-600'}`}>
                        {job.status === 'picked_up'
                          ? <CheckCircle className="w-3 h-3" />
                          : <XCircle className="w-3 h-3" />}
                        {statusLabel(job.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      {' '}
                      {new Date(job.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
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
        )}
      </div>
    </div>
  );
}
