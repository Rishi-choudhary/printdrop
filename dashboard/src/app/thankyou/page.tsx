'use client';

import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle, CheckCircle, FileText, Home, Loader2, Printer,
  RefreshCw,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OrderProgress } from '@/components/order-progress';
import { encodePathSegment } from '@/lib/security';
import { getOrderStatusLabel, upsertCachedWebOrder } from '@/lib/web-orders';

interface JobResult {
  id: string;
  token: number;
  shopName: string;
  fileName: string;
  status: string;
}

const CONFIRMED_STATUSES = ['queued', 'printing', 'ready', 'picked_up'];

function normalizeJob(id: string, data: any): JobResult | null {
  if (!data?.token) return null;
  return {
    id,
    token: data.token,
    shopName: data.shop?.name || data.shopName || 'Print shop',
    fileName: data.fileName || 'Uploaded file',
    status: data.status || 'queued',
  };
}

function cacheJob(job: JobResult) {
  upsertCachedWebOrder({
    jobId: job.id,
    token: job.token,
    shopName: job.shopName,
    fileName: job.fileName,
    status: job.status,
  });
}

function ThankYouContent() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<'loading' | 'success' | 'polling' | 'error'>('loading');
  const [job, setJob] = useState<JobResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const jobId = searchParams.get('job_id');
  const razorpayPaymentId = searchParams.get('razorpay_payment_id');
  const razorpayPaymentLinkId = searchParams.get('razorpay_payment_link_id');
  const razorpayPaymentLinkRefId = searchParams.get('razorpay_payment_link_reference_id');
  const razorpayPaymentLinkStatus = searchParams.get('razorpay_payment_link_status');
  const razorpaySignature = searchParams.get('razorpay_signature');

  const loadJobStatus = useCallback(async (id: string) => {
    const res = await fetch(`/api/webhooks/razorpay/job/${encodePathSegment(id)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Could not load order status.');
    const next = normalizeJob(id, data);
    if (next) {
      setJob(next);
      cacheJob(next);
    }
    return next;
  }, []);

  const pollJobStatus = useCallback(async (id: string, attempts = 0): Promise<void> => {
    if (attempts >= 12) {
      setErrorMsg('Payment is still processing. Your order will appear here automatically once Razorpay confirms it.');
      setState('error');
      return;
    }

    try {
      const next = await loadJobStatus(id);
      if (next && CONFIRMED_STATUSES.includes(next.status)) {
        setState('success');
        return;
      }
    } catch {
      // continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    await pollJobStatus(id, attempts + 1);
  }, [loadJobStatus]);

  useEffect(() => {
    if (!jobId) {
      setErrorMsg('Invalid payment link. Missing job ID.');
      setState('error');
      return;
    }
    const id = jobId;

    async function processPayment() {
      const hasRazorpayCallback = Boolean(
        razorpayPaymentId &&
        razorpayPaymentLinkId &&
        razorpaySignature &&
        razorpayPaymentLinkStatus === 'paid',
      );

      if (hasRazorpayCallback) {
        try {
          const res = await fetch('/api/webhooks/razorpay/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              job_id: id,
              razorpay_payment_id: razorpayPaymentId,
              razorpay_payment_link_id: razorpayPaymentLinkId,
              razorpay_payment_link_reference_id: razorpayPaymentLinkRefId,
              razorpay_payment_link_status: razorpayPaymentLinkStatus,
              razorpay_signature: razorpaySignature,
            }),
          });

          const data = await res.json();
          if (res.ok && data.ok) {
            const next = normalizeJob(id, { ...data, id });
            if (next) {
              setJob(next);
              cacheJob(next);
            }
            setState('success');
            return;
          }

          if (res.status !== 402 && data?.error) {
            setErrorMsg(data.error);
            setState('error');
            return;
          }
        } catch {
          // Fall through to polling
        }
      }

      setState('polling');
      await pollJobStatus(id);
    }

    processPayment();
  }, [
    jobId,
    pollJobStatus,
    razorpayPaymentId,
    razorpayPaymentLinkId,
    razorpayPaymentLinkRefId,
    razorpayPaymentLinkStatus,
    razorpaySignature,
  ]);

  useEffect(() => {
    if (!jobId || state !== 'success') return;
    const interval = window.setInterval(() => {
      loadJobStatus(jobId).catch(() => {});
    }, 10000);
    return () => window.clearInterval(interval);
  }, [jobId, loadJobStatus, state]);

  if (state === 'loading' || state === 'polling') {
    return (
      <StatusShell tone="blue">
        <Card className="max-w-md w-full shadow-lg">
          <CardBody className="p-8 text-center">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="font-semibold text-gray-800">Confirming your payment</p>
            <p className="text-sm text-gray-500 mt-1">Keep this page open. Your token will show here.</p>
          </CardBody>
        </Card>
      </StatusShell>
    );
  }

  if (state === 'error') {
    return (
      <StatusShell tone="amber">
        <Card className="max-w-md w-full shadow-lg">
          <CardBody className="p-8 text-center space-y-5">
            <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
            <div>
              <p className="font-semibold text-gray-900">Almost there</p>
              <p className="text-sm text-gray-500 mt-1">{errorMsg}</p>
            </div>
            <div className="grid gap-2">
              {jobId && (
                <Link href={`/pay/${encodePathSegment(jobId)}`}>
                  <Button className="w-full" size="lg">
                    <RefreshCw className="w-4 h-4" />
                    Check payment
                  </Button>
                </Link>
              )}
              <Link href="/">
                <Button className="w-full" variant="secondary" size="lg">
                  <Home className="w-4 h-4" />
                  Go to home
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      </StatusShell>
    );
  }

  const tokenFormatted = job ? `#${String(job.token).padStart(3, '0')}` : '';

  return (
    <StatusShell tone="green">
      <Card className="w-full max-w-3xl shadow-xl">
        <CardBody className="p-5 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div className="rounded-2xl bg-blue-50 p-6 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Your token</p>
              <div className="mt-1 font-mono text-6xl font-black tracking-tight text-blue-700">
                {tokenFormatted}
              </div>
              <p className="mt-3 text-sm font-medium text-blue-700">
                Show this token at the shop.
              </p>
            </div>

            <div className="min-w-0">
              <div className="mb-5">
                <p className="text-sm font-semibold text-green-700">Payment successful</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950">Your print order is confirmed</h1>
                <p className="mt-2 text-sm text-gray-500">
                  Current status: <span className="font-semibold text-gray-800">{getOrderStatusLabel(job?.status)}</span>
                </p>
              </div>

              {job && (
                <div className="mb-5 grid gap-2 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
                  <span className="flex min-w-0 items-center gap-2">
                    <Printer className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="truncate font-medium">{job.shopName}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="truncate">{job.fileName}</span>
                  </span>
                </div>
              )}

              <OrderProgress status={job?.status} />

              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <Link href="/print">
                  <Button className="w-full" size="lg">Print another file</Button>
                </Link>
                <Link href="/">
                  <Button className="w-full" variant="secondary" size="lg">
                    <Home className="w-4 h-4" />
                    Go to home
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </StatusShell>
  );
}

function StatusShell({ children, tone }: { children: ReactNode; tone: 'blue' | 'green' | 'amber' }) {
  const bg = tone === 'green'
    ? 'from-green-50 via-white to-blue-50'
    : tone === 'amber'
    ? 'from-amber-50 via-white to-blue-50'
    : 'from-blue-50 via-white to-green-50';

  return (
    <div className={`min-h-screen bg-gradient-to-b ${bg} flex items-center justify-center p-4`}>
      {children}
    </div>
  );
}

export default function ThankYouPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    }>
      <ThankYouContent />
    </Suspense>
  );
}
