'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, CreditCard, IndianRupee, FileText, Printer, Loader2, Home } from 'lucide-react';
import { encodePathSegment, getSafePaymentUrl } from '@/lib/security';
import { OrderProgress } from '@/components/order-progress';
import { getOrderStatusLabel, upsertCachedWebOrder } from '@/lib/web-orders';

declare global {
  interface Window {
    Razorpay: new (options: object) => { open(): void; on(event: string, cb: (r: unknown) => void): void };
  }
}

const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
const RAZORPAY_ENABLE_UPI = process.env.NEXT_PUBLIC_RAZORPAY_ENABLE_UPI === '1';

export default function PaymentPage({ params }: { params: { jobId: string } }) {
  const { jobId } = params;
  const [job, setJob] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState('');

  const cacheOrder = (nextJob: any) => {
    if (!nextJob) return;
    upsertCachedWebOrder({
      jobId,
      token: nextJob.token,
      shopName: nextJob.shop?.name || nextJob.shopName,
      fileName: nextJob.fileName,
      status: nextJob.status,
    });
  };

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch(`/api/webhooks/razorpay/job/${encodePathSegment(jobId)}`);
        const data = await r.json();

        if (!r.ok) {
          setError('Could not load order details. This link may have expired.');
          setLoading(false);
          return;
        }

        setJob(data);
        cacheOrder(data);

        if (['queued', 'printing', 'ready', 'picked_up'].includes(data.status)) {
          setPaid(true);
        } else if (data.payment?.razorpayPaymentLink) {
          setPayment(data.payment);
        }
      } catch {
        setError('Could not load order details.');
      }
      setLoading(false);
    }
    load();
  }, [jobId]);

  useEffect(() => {
    if (!paid) return;
    const interval = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/webhooks/razorpay/job/${encodePathSegment(jobId)}`, { cache: 'no-store' });
        const data = await r.json();
        if (r.ok) {
          setJob(data);
          cacheOrder(data);
        }
      } catch {
        // ignore refresh failures
      }
    }, 10000);
    return () => window.clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, paid]);

  const handlePay = async () => {
    setPaying(true);
    setError('');

    const reportCheckoutError = (payload: any) => {
      fetch('/api/webhooks/razorpay/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    };

    // Standard Checkout — open Razorpay modal inline
    if (RAZORPAY_KEY_ID) {
      try {
        const res = await fetch('/api/webhooks/razorpay/checkout-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create payment order');

        const options = {
          key: RAZORPAY_KEY_ID,
          amount: data.amount,
          currency: data.currency,
          order_id: data.orderId,
          name: 'PrintDrop',
          description: job?.fileName ? `Print: ${job.fileName}` : 'PrintDrop Order',
          image: '/icon.png',
          handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
            try {
              const verifyRes = await fetch('/api/webhooks/razorpay/verify-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });
              const result = await verifyRes.json();
              if (verifyRes.ok && result.ok) {
                const nextJob = {
                  ...job,
                  token: result.token ?? job?.token,
                  status: result.status ?? 'queued',
                  shop: { name: result.shopName ?? job?.shop?.name },
                };
                setJob(nextJob);
                cacheOrder(nextJob);
                setPaid(true);
              } else {
                setError(result.error || 'Payment verification failed. Please do not retry if money was debited; your token will arrive once Razorpay confirms it.');
              }
            } catch {
              setError('Payment confirmation is pending. Please do not retry if money was debited; your token will arrive once Razorpay confirms it.');
            }
            setPaying(false);
          },
          modal: {
            ondismiss: () => {
              setPaying(false);
              setError('Payment was not completed. Please try again when you are ready.');
            },
          },
          config: RAZORPAY_ENABLE_UPI
            ? undefined
            : {
                display: {
                  hide: [{ method: 'upi' }],
                  preferences: { show_default_blocks: true },
                },
              },
          theme: { color: '#2563EB' },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', (response: any) => {
          reportCheckoutError({
            job_id: jobId,
            razorpay_order_id: data.orderId,
            code: response.error?.code,
            description: response.error?.description,
            source: response.error?.source,
            step: response.error?.step,
            reason: response.error?.reason,
            metadata: response.error?.metadata,
          });
          setError(response.error?.description || 'Payment failed. Please try again.');
          setPaying(false);
        });
        rzp.open();
        return; // control returns via handler/ondismiss callbacks
      } catch (err: any) {
        setError(err.message || 'Could not initiate payment. Please try again.');
        setPaying(false);
        return;
      }
    }

    // Fallback: redirect to Razorpay payment link (production without key in env)
    const safePaymentLink = getSafePaymentUrl(payment?.razorpayPaymentLink);
    if (safePaymentLink) {
      window.location.assign(safePaymentLink);
      return;
    }

    // Dev mode: simulate payment via mock webhook
    try {
      await fetch('/api/webhooks/razorpay/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const r = await fetch(`/api/webhooks/razorpay/job/${encodePathSegment(jobId)}`);
        const data = await r.json();
        if (r.ok && data.token) {
          setJob(data);
          cacheOrder(data);
          setPaid(true);
          setPaying(false);
          return;
        }
      }
      setPaid(true);
    } catch {
      setError('Payment failed. Please try again.');
    }
    setPaying(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md w-full mx-4">
          <CardBody className="text-center py-8">
            <p className="text-red-500 mb-4">{error}</p>
            <p className="text-sm text-gray-400">This payment link may have expired.</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <>
      {RAZORPAY_KEY_ID && (
        <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      )}

      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardBody className="p-6">
            {paid ? (
              /* Success State */
              <div className="py-4 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-green-700 mb-2">Payment Successful!</h2>
                <p className="text-gray-500 mb-4">Your print job is confirmed.</p>

                {job && (
                  <div className="bg-gray-50 rounded-lg p-4 text-left space-y-3">
                    <div className="text-center mb-3">
                      <span className="text-4xl font-bold text-blue-600">#{String(job.token).padStart(3, '0')}</span>
                      <p className="text-xs text-gray-500 mt-1">Your Token Number</p>
                    </div>
                    <p className="text-sm"><span className="text-gray-500">Shop:</span> {job.shop?.name || job.shopName}</p>
                    <p className="text-sm"><span className="text-gray-500">File:</span> {job.fileName}</p>
                    <p className="text-sm"><span className="text-gray-500">Status:</span> {getOrderStatusLabel(job.status || 'queued')}</p>
                  </div>
                )}

                <OrderProgress status={job?.status || 'queued'} className="mt-5" />

                <p className="text-xs text-gray-400 mt-4 text-center">Show this token at the shop. This page will update while it is open.</p>

                <Link href="/" className="block mt-4">
                  <Button variant="secondary" className="w-full">
                    <Home className="w-4 h-4 mr-2" />
                    Back to Home
                  </Button>
                </Link>
              </div>
            ) : (
              /* Payment State */
              <>
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 mb-3">
                    <CreditCard className="w-6 h-6 text-blue-600" />
                  </div>
                  <h2 className="text-xl font-bold">Complete Payment</h2>
                  <p className="text-sm text-gray-500">PrintDrop Order</p>
                </div>

                {job && (
                  <div className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">{job.fileName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Printer className="w-4 h-4 text-gray-400" />
                        <span>{job.shop?.name || 'Print Shop'}</span>
                      </div>

                      <div className="border-t border-gray-200 pt-2 mt-2 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">{job.pageCount} pages × {job.copies} copies ({job.color ? 'Color' : 'B&W'})</span>
                        </div>
                        <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 mt-1">
                          <span>Total</span>
                          <span className="text-blue-600 flex items-center">
                            <IndianRupee className="w-4 h-4" />
                            {job.totalPrice?.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {error && <p className="text-sm text-red-600 text-center">{error}</p>}

                    <Button
                      onClick={handlePay}
                      disabled={paying}
                      className="w-full py-3 text-base"
                      size="lg"
                    >
                      {paying ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                      ) : (
                        <>Pay ₹{job.totalPrice?.toFixed(2)}</>
                      )}
                    </Button>

                    <p className="text-xs text-gray-400 text-center">
                      Secure payment via Razorpay
                    </p>
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
