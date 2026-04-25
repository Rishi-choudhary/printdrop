'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, AlertCircle, Loader2, MessageCircle, Printer } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { encodePathSegment, getSafeExternalUrl } from '@/lib/security';

interface JobResult {
  token: number;
  shopName: string;
  fileName: string;
  status: string;
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

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const telegramLink = botUsername && /^[A-Za-z0-9_]{5,32}$/.test(botUsername)
    ? `https://t.me/${botUsername}`
    : null;
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER; // e.g. "918291234567"
  const whatsappLink = whatsappNumber && /^\d{8,15}$/.test(whatsappNumber)
    ? getSafeExternalUrl(`https://wa.me/${whatsappNumber}`)
    : null;

  useEffect(() => {
    if (!jobId) {
      setErrorMsg('Invalid payment link — missing job ID.');
      setState('error');
      return;
    }

    async function processPayment() {
      // Try server-side callback verification first (Razorpay params present)
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

      // Fallback: poll until job status reflects payment (webhook may be in-flight)
      setState('polling');
      await pollJobStatus(jobId!);
    }

    processPayment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollJobStatus(id: string, attempts = 0) {
    if (attempts >= 12) {
      setErrorMsg('Payment is processing. Your token will arrive via WhatsApp or Telegram shortly.');
      setState('error');
      return;
    }

    try {
      const res = await fetch(`/api/webhooks/razorpay/job/${encodePathSegment(id)}`);
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
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardBody className="p-8 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-amber-400 mx-auto" />
            <p className="font-semibold text-gray-800">Almost there!</p>
            <p className="text-sm text-gray-500">{errorMsg}</p>
            {telegramLink ? (
              <a href={telegramLink} target="_blank" rel="noopener noreferrer" className="block mt-2">
                <Button className="w-full" size="lg">
                  <MessageCircle className="w-5 h-5 mr-2" />
                  Open Telegram
                </Button>
              </a>
            ) : whatsappLink ? (
              <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="block mt-2">
                <Button className="w-full" size="lg">
                  <MessageCircle className="w-5 h-5 mr-2" />
                  Open WhatsApp
                </Button>
              </a>
            ) : null}
          </CardBody>
        </Card>
      </div>
    );
  }

  const tokenFormatted = job ? `#${String(job.token).padStart(3, '0')}` : '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <Card className="max-w-sm w-full shadow-xl">
        <CardBody className="p-8 text-center space-y-5">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mx-auto">
            <CheckCircle className="w-9 h-9 text-green-600" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-green-700">Payment Successful!</h1>
            <p className="text-sm text-gray-500 mt-1">Your print job is confirmed</p>
          </div>

          <div className="bg-blue-50 rounded-2xl py-6 px-4">
            <p className="text-xs text-blue-500 font-semibold uppercase tracking-widest mb-1">Your Token</p>
            <div className="text-6xl font-black text-blue-600 tracking-tight">{tokenFormatted}</div>
            <p className="text-xs text-blue-400 mt-2">Show this at the shop when picking up</p>
          </div>

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
            Your token has also been sent to you via WhatsApp or Telegram.
          </p>

          {telegramLink ? (
            <a href={telegramLink} target="_blank" rel="noopener noreferrer" className="block">
              <Button className="w-full" size="lg">
                <MessageCircle className="w-5 h-5 mr-2" />
                Back to Telegram
              </Button>
            </a>
          ) : whatsappLink ? (
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="block">
              <Button className="w-full" size="lg">
                <MessageCircle className="w-5 h-5 mr-2" />
                Back to WhatsApp
              </Button>
            </a>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700">
                Your token has been sent to you via WhatsApp or Telegram.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default function ThankYouPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    }>
      <ThankYouContent />
    </Suspense>
  );
}
