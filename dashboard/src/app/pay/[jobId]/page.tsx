'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, CreditCard, IndianRupee, FileText, Printer, Loader2, Home } from 'lucide-react';

export default function PaymentPage({ params }: { params: { jobId: string } }) {
  const { jobId } = params;
  const [job, setJob] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        // Public endpoint — no auth needed, works for Telegram users too
        const r = await fetch(`/api/webhooks/razorpay/job/${jobId}`);
        const data = await r.json();

        if (!r.ok) {
          setError('Could not load order details. This link may have expired.');
          setLoading(false);
          return;
        }

        setJob(data);

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

  const handlePay = async () => {
    setPaying(true);
    setError('');

    // Production: redirect to Razorpay payment link
    if (payment?.razorpayPaymentLink && !payment.razorpayPaymentLink.includes('/pay/')) {
      window.location.href = payment.razorpayPaymentLink;
      return;
    }

    // Dev mode: simulate payment via mock webhook
    try {
      await fetch('/api/webhooks/razorpay/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      // Poll for confirmation
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const r = await fetch(`/api/webhooks/razorpay/job/${jobId}`);
        const data = await r.json();
        if (r.ok && data.token) {
          setJob(data);
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
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-lg">
        <CardBody className="p-6">
          {paid ? (
            /* Success State */
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-green-700 mb-2">Payment Successful!</h2>
              <p className="text-gray-500 mb-4">Your print job is now in the queue.</p>

              {job && (
                <div className="bg-gray-50 rounded-lg p-4 text-left space-y-2">
                  <div className="text-center mb-3">
                    <span className="text-4xl font-bold text-blue-600">#{String(job.token).padStart(3, '0')}</span>
                    <p className="text-xs text-gray-500 mt-1">Your Token Number</p>
                  </div>
                  <p className="text-sm"><span className="text-gray-500">Shop:</span> {job.shop?.name || job.shopName}</p>
                  <p className="text-sm"><span className="text-gray-500">File:</span> {job.fileName}</p>
                  <p className="text-sm"><span className="text-gray-500">Status:</span> <Badge status={job.status || 'queued'} /></p>
                </div>
              )}

              <p className="text-xs text-gray-400 mt-4">Show this token at the shop. You&apos;ll get a notification when your print is ready.</p>

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
                    {payment?.razorpayPaymentLink && !payment.razorpayPaymentLink.includes('/pay/')
                      ? 'Secure payment via Razorpay'
                      : 'Dev mode — payment will be simulated'}
                  </p>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
