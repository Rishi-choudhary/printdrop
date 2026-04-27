'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api';
import { api } from '@/lib/api';
import { encodePathSegment } from '@/lib/security';
import {
  Store, ArrowLeft, Wifi, WifiOff, CheckCircle, XCircle,
  IndianRupee, FileText, Monitor, RefreshCw, Zap, ZapOff,
  Power,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';

const STATUS_BADGE: Record<string, string> = {
  queued:          'bg-blue-100 text-blue-700',
  printing:        'bg-amber-100 text-amber-700',
  ready:           'bg-green-100 text-green-700',
  payment_pending: 'bg-yellow-100 text-yellow-700',
  picked_up:       'bg-gray-100 text-gray-500',
  cancelled:       'bg-red-100 text-red-600',
};

function Stat({ label, value, sub, color = 'text-gray-900' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ShopHealthPage() {
  const params = useParams();
  const shopId = params.id as string;
  const { toast } = useToast();

  const { data: rawData, error, isLoading, mutate } = useSWR(
    shopId ? `/admin/shops/${encodePathSegment(shopId)}/health` : null,
    apiFetch,
    { refreshInterval: 30000 }
  );
  const data = rawData as any;

  const toggleActive = async () => {
    try {
      await api.patch(`/admin/shops/${encodePathSegment(shopId)}`, { isActive: !data?.shop?.isActive });
      mutate();
    } catch (err: any) {
      toast(err.message || 'Failed to update shop', 'error');
    }
  };

  const toggleAutoPrint = async () => {
    try {
      await api.patch(`/admin/shops/${encodePathSegment(shopId)}`, { autoPrint: !data?.shop?.autoPrint });
      mutate();
    } catch (err: any) {
      toast(err.message || 'Failed to update shop', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-100 rounded w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-16">
        <p className="text-red-500 font-medium">Failed to load shop health data</p>
        <Link href="/admin/shops" className="text-blue-600 text-sm mt-2 inline-block">← Back to shops</Link>
      </div>
    );
  }

  const { shop, agentOnline, todayJobs, queuedJobs, cancelledToday, todayRevenue, recentJobs } = data;
  const cancelRate = todayJobs > 0 ? Math.round((cancelledToday / todayJobs) * 100) : 0;
  const agentLastSeen = shop.agentLastSeen
    ? new Date(shop.agentLastSeen).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/admin/shops" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
            <Store className="w-5 h-5 text-gray-600" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900 leading-none">{shop.name}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{shop.address || 'No address'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />Refresh
          </button>
          <button onClick={toggleActive}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
              shop.isActive
                ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                : 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100'
            }`}>
            <Power className="w-3.5 h-3.5" />
            {shop.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={toggleAutoPrint}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
              shop.autoPrint
                ? 'bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}>
            {shop.autoPrint ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
            Auto-Print {shop.autoPrint ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
          shop.isActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-100 border-gray-200 text-gray-500'
        }`}>
          {shop.isActive ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {shop.isActive ? 'Active' : 'Inactive'}
        </span>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
          agentOnline ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'
        }`}>
          {agentOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          Agent {agentOnline ? 'Online' : 'Offline'}
          {agentLastSeen && !agentOnline && <span className="text-[10px] ml-1">· last seen {agentLastSeen}</span>}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border bg-gray-50 border-gray-200 text-gray-600">
          <Monitor className="w-3.5 h-3.5" />
          v{shop.agentVersion || '—'}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Today's Jobs" value={todayJobs} color="text-blue-700" />
        <Stat label="In Queue" value={queuedJobs} color={queuedJobs > 0 ? 'text-amber-700' : 'text-gray-900'} />
        <Stat label="Today's Revenue" value={`₹${todayRevenue.toFixed(0)}`} color="text-green-700" />
        <Stat
          label="Cancel Rate"
          value={`${cancelRate}%`}
          sub={`${cancelledToday} cancelled today`}
          color={cancelRate > 20 ? 'text-red-600' : 'text-gray-900'}
        />
      </div>

      {/* Shop details */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Owner</p>
          <p className="font-medium">{shop.owner?.name || '—'}</p>
          <p className="text-xs text-gray-400">{shop.owner?.phone}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">B&W Rate</p>
          <p className="font-medium">₹{shop.ratesBwSingle}/pg (single) · ₹{shop.ratesBwDouble}/pg (double)</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Color Rate</p>
          <p className="font-medium">₹{shop.ratesColorSingle}/pg (single) · ₹{shop.ratesColorDouble}/pg (double)</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Hours</p>
          <p className="font-medium">{shop.opensAt} – {shop.closesAt}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Phone</p>
          <p className="font-medium">{shop.phone}</p>
        </div>
      </div>

      {/* Recent jobs */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-bold text-sm text-gray-700">Recent Jobs</h2>
        </div>
        {recentJobs.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No jobs yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentJobs.map((job: any) => (
              <div key={job.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-black font-mono text-gray-700 shrink-0">
                    #{String(job.token).padStart(3, '0')}
                  </span>
                  <span className="text-sm text-gray-600 truncate">{job.fileName}</span>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="flex items-center gap-0.5 text-sm font-bold text-gray-700">
                    <IndianRupee className="w-3 h-3" />{job.totalPrice?.toFixed(0)}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${STATUS_BADGE[job.status] || 'bg-gray-100 text-gray-600'}`}>
                    {job.status.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(job.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
