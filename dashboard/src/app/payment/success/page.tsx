'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, AlertCircle, Loader2, MessageCircle, Printer, Home } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface JobResult {
  token: number;
  shopName: string;
  fileName: string;
  status: string;
}

function PaymentSuccessContent() {
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

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const telegramLink = botUsername ? `https://t.me/${botUsername}` : null;

  useEffect(() => {
    if (!jobId) {
      setErrorMsg('Invalid payment link — missing job ID.');
      setState('error');
      return;
    }

    async function processPayment() {
      // If Razorpay sent its callback params, verify + process server-side
      if (razorpayPaymentId && razorpayPaymentLinkId) {
        try {
          const res = await fetch('/api/webhooks/razorpay/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              job_id: jobId,
              razorpay_payment_id: razorpayPaymentId,
              razorpay_payment_link_id: razorpayPaymentLinkId,
              razorpay_payment_link_reference_id: razorpayPaymentLinkRefId,
              razorpay_payment_link_status: razorpayPaymentLinkStatus,
              razorpay_signature: razorpaySignature,
            }),
          });

          const data = await res.json();

          if (res.ok && data.ok) {
            setJob({
              token: data.token,
              shopName: data.shopName,
              fileName: data.fileName,
              status: data.status,
            });
            setState('success');
            return;
          }
        } catch {
          // Fall through to polling
        }
      }

      // Fallback: poll until job is queued (webhook may still be processing)
      setState('polling');
      await pollJobStatus(jobId!);
    }

    processPayment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollJobStatus(id: string, attempts = 0) {
    if (attempts >= 12) {
      setErrorMsg('Payment is taking longer than expected. Check back in Telegram for your token.');
      setState('error');
      return;
    }

    try {
      const res = await fetch(`/api/webhooks/razorpay/job/${id}`);
      const data = await res.json();

      if (res.ok && data.token && ['queued', 'printing', 'ready', 'picked_up'].includes(data.status)) {
        setJob({
          token: data.token,
          shopName: data.shop?.name || data.shopName,
          fileName: data.fileName,
          status: data.status,
        });
        setState('success');
        return;
      }
    } catch {
      // continue polling
    }

    await new Promise((r) => setTimeout(r, 2500));
    await pollJobStatus(id, attempts + 1);
  }

  if (state === 'loading' || state === 'polling') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardBody className="p-8 text-center">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="font-medium text-gray-700">Confirming your payment...</p>
            <p className="text-sm text-gray-400 mt-1">This will only take a moment</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-red-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardBody className="p-8 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <p className="font-semibold text-gray-800">Something went wrong</p>
            <p className="text-sm text-gray-500">{errorMsg}</p>
            <div className="space-y-2 mt-2">
              {telegramLink && (
                <a href={telegramLink} target="_blank" rel="noopener noreferrer" className="block">
                  <Button className="w-full" variant="secondary">
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Open Telegram
                  </Button>
                </a>
              )}
              <Link href="/" className="block">
                <Button className="w-full" variant="secondary">
                  <Home className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // Success state
  const tokenFormatted = job ? `#${String(job.token).padStart(3, '0')}` : '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <Card className="max-w-sm w-full shadow-xl">
        <CardBody className="p-8 text-center space-y-5">
          {/* Success icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mx-auto">
            <CheckCircle className="w-9 h-9 text-green-600" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-green-700">Payment Successful!</h1>
            <p className="text-sm text-gray-500 mt-1">Your print job is confirmed</p>
          </div>

          {/* Token — the most important thing on this page */}
          <div className="bg-blue-50 rounded-2xl py-6 px-4">
            <p className="text-xs text-blue-500 font-semibold uppercase tracking-widest mb-1">Your Token</p>
            <div className="text-6xl font-black text-blue-600 tracking-tight">{tokenFormatted}</div>
            <p className="text-xs text-blue-400 mt-2">Show this at the shop when picking up</p>
          </div>

          {/* Job details */}
          {job && (
            <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Printer className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="font-medium">{job.shopName}</span>
              </div>
              <div className="text-gray-500 pl-6 truncate">{job.fileName}</div>
            </div>
          )}

          <p className="text-xs text-gray-400">
            You&apos;ll also receive this token in Telegram when your print is ready.
          </p>

          {/* Actions */}
          <div className="space-y-2">
            {telegramLink ? (
              <a href={telegramLink} target="_blank" rel="noopener noreferrer" className="block">
                <Button className="w-full" size="lg">
                  <MessageCircle className="w-5 h-5 mr-2" />
                  Back to Telegram
                </Button>
              </a>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-700">
                  Open your Telegram bot to track your print status.
                </p>
              </div>
            )}
            <Link href="/" className="block">
              <Button variant="secondary" className="w-full" size="lg">
                <Home className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    }>
      <PaymentSuccessContent />
    </Suspense>
  );
}
