'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { encodePathSegment } from '@/lib/security';
import {
  ArrowLeft, CheckCircle, Clock, Printer, IndianRupee,
  Package, XCircle, FileText, AlertCircle, RefreshCw,
} from 'lucide-react';

const EVENT_ICONS: Record<string, JSX.Element> = {
  created:         <FileText className="w-4 h-4 text-gray-500" />,
  payment_pending: <IndianRupee className="w-4 h-4 text-yellow-500" />,
  queued:          <Clock className="w-4 h-4 text-blue-500" />,
  printing:        <Printer className="w-4 h-4 text-amber-500" />,
  ready:           <CheckCircle className="w-4 h-4 text-green-500" />,
  picked_up:       <Package className="w-4 h-4 text-green-600" />,
  cancelled:       <XCircle className="w-4 h-4 text-red-500" />,
};

const EVENT_LABELS: Record<string, string> = {
  created:         'Order Created',
  payment_pending: 'Payment Pending',
  queued:          'Queued for Printing',
  printing:        'Printing',
  ready:           'Ready for Pickup',
  picked_up:       'Picked Up',
  cancelled:       'Cancelled',
};

export default function JobTracePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trace, setTrace] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forcing, setForcing] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const data = await api.get(`/admin/jobs/${encodePathSegment(id)}/trace`);
      setTrace(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load job');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const forceRetry = async () => {
    if (!trace?.job) return;
    setForcing(true);
    try {
      await api.patch(`/jobs/${encodePathSegment(trace.job.id)}/status`, { status: 'queued' });
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed to retry job');
    } finally {
      setForcing(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-400">Loading trace…</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!trace) return null;

  const { job, timeline } = trace;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/jobs" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-black text-gray-900">
            Job #{String(job.token).padStart(3, '0')}
          </h1>
          <p className="text-xs text-gray-400">{job.id}</p>
        </div>
        <button onClick={load} className="ml-auto p-2 rounded-lg hover:bg-gray-100 text-gray-400">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">Summary</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="File" value={job.fileName} />
          <Row label="Shop" value={job.shop?.name || '—'} />
          <Row label="Customer" value={job.user?.name || job.user?.phone || '—'} />
          <Row label="Status" value={job.status.replace('_', ' ')} />
          <Row label="Pages" value={String(job.pageCount)} />
          <Row label="Mode" value={`${job.color ? 'Color' : 'B&W'} · ${job.doubleSided ? 'Duplex' : 'Single'}`} />
          <Row label="Copies" value={String(job.copies)} />
          <Row label="Paper" value={job.paperSize || 'A4'} />
          <Row label="Total" value={`₹${job.totalPrice?.toFixed(0)}`} />
          <Row label="Shop Earning" value={`₹${job.shopEarning?.toFixed(0)}`} />
        </div>
      </div>

      {/* Payment */}
      {job.payment && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">Payment</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Status" value={job.payment.status} />
            <Row label="Amount" value={`₹${job.payment.amount?.toFixed(0)}`} />
            {job.payment.razorpayPaymentId && (
              <Row label="Payment ID" value={job.payment.razorpayPaymentId} />
            )}
            {job.payment.razorpayOrderId && (
              <Row label="Order ID" value={job.payment.razorpayOrderId} />
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-4">Timeline</h2>
        <div className="space-y-4">
          {timeline.map((entry: any, i: number) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center shrink-0">
                  {EVENT_ICONS[entry.event] || <AlertCircle className="w-4 h-4 text-gray-400" />}
                </div>
                {i < timeline.length - 1 && (
                  <div className="w-px flex-1 bg-gray-200 mt-1" />
                )}
              </div>
              <div className="pb-4 flex-1">
                <p className="font-semibold text-sm text-gray-800">
                  {EVENT_LABELS[entry.event] || entry.event}
                </p>
                <p className="text-xs text-gray-400">
                  {new Date(entry.at).toLocaleString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true,
                  })}
                </p>
                {entry.details && (
                  <p className="text-xs text-gray-500 mt-0.5">{entry.details}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      {job.status === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-red-700">Job Failed</p>
            <p className="text-xs text-red-500">Force-retry will re-queue this job for printing</p>
          </div>
          <button
            onClick={forceRetry}
            disabled={forcing}
            className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {forcing ? 'Retrying…' : 'Force Retry'}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="font-medium text-gray-800 truncate">{value}</p>
    </div>
  );
}
