'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useShops } from '@/lib/hooks';
import { api } from '@/lib/api';
import { encodePathSegment, getSafeExternalUrl, getSafePaymentUrl } from '@/lib/security';
import { Navbar } from '@/components/navbar';
import { FileUpload, UploadedFileMeta } from '@/components/file-upload';
import { CartFile, CartFileList, DEFAULT_PREF, FilePref } from '@/components/multi-file-cart';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { upsertCachedOrder } from '@/lib/web-orders';
import {
  Printer, FileText, MapPin, Clock, IndianRupee, ChevronRight,
  Loader2, Check, ArrowLeft, MessageCircle, Home, Trash2,
  Phone, UserRound,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shop {
  id: string;
  name: string;
  address?: string;
  phone: string;
  opensAt: string;
  closesAt: string;
  ratesBwSingle: number;
  ratesColorSingle: number;
  isOpen: boolean;
}

interface CustomerDetails {
  name: string;
  phone: string;
}

type Step = 'upload' | 'configure' | 'shop' | 'contact' | 'review';

const ALL_STEPS: { key: Step; label: string }[] = [
  { key: 'upload',    label: 'Upload'    },
  { key: 'configure', label: 'Configure' },
  { key: 'shop',      label: 'Shop'      },
  { key: 'contact',   label: 'Contact'   },
  { key: 'review',    label: 'Review'    },
];

const MAX_FILES = 10;

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PrintPage() {
  const { user, loading: authLoading } = useAuth();
  const router   = useRouter();
  const { data: shops } = useShops();

  const steps = useMemo(
    () => user ? ALL_STEPS.filter((s) => s.key !== 'contact') : ALL_STEPS,
    [user],
  );

  const [step,         setStep]         = useState<Step>('upload');
  const [cartFiles,    setCartFiles]    = useState<CartFile[]>([]);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [customer,     setCustomer]     = useState<CustomerDetails>({ name: '', phone: '' });
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');

  const shopList: Shop[] = Array.isArray(shops) ? shops : [];

  // ── File cart helpers ────────────────────────────────────────────────────────

  const addFile = useCallback((meta: UploadedFileMeta) => {
    setCartFiles((prev) => {
      if (prev.length >= MAX_FILES) return prev;
      return [...prev, { id: crypto.randomUUID(), meta, pref: { ...DEFAULT_PREF } }];
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setCartFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const updatePref = useCallback((id: string, pref: FilePref) => {
    setCartFiles((prev) => prev.map((f) => f.id === id ? { ...f, pref } : f));
  }, []);

  // ── Price estimate ────────────────────────────────────────────────────────────

  const priceBreakdown = useMemo(() => {
    if (!selectedShop || cartFiles.length === 0) return null;
    const s = selectedShop;

    return cartFiles.map(({ meta, pref }) => {
      const pages   = pref.pageRange === 'all' ? meta.pageCount : estimatePageCount(pref.pageRange, meta.pageCount);
      const rate    = pref.color ? s.ratesColorSingle : s.ratesBwSingle;
      const sub     = rate * pages * pref.copies;
      const fee     = Math.round(0.50 * pages * pref.copies * 100) / 100;
      return {
        fileName: meta.fileName,
        rate,
        pages,
        copies: pref.copies,
        subtotal: sub,
        fee,
        total: Math.round((sub + fee) * 100) / 100,
      };
    });
  }, [cartFiles, selectedShop]);

  const grandTotal = priceBreakdown ? priceBreakdown.reduce((acc, r) => acc + r.total, 0) : 0;

  // ── Submit ────────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (cartFiles.length === 0 || !selectedShop) return;
    setSubmitting(true);
    setError('');
    try {
      const files = cartFiles.map(({ meta, pref }) => ({
        fileUrl:     meta.fileUrl,
        fileKey:     meta.fileKey,
        fileName:    meta.fileName,
        fileSize:    meta.fileSize,
        fileType:    meta.fileType,
        pageCount:   meta.pageCount,
        color:       pref.color,
        copies:      pref.copies,
        doubleSided: pref.doubleSided,
        paperSize:   pref.paperSize,
        pageRange:   pref.pageRange,
        binding:     pref.binding,
      }));

      let orderId = '';
      let paymentLink: unknown = '';

      if (user) {
        const { order } = await api.post('/orders', { shopId: selectedShop.id, files });
        orderId = order.id;
        upsertCachedOrder({
          orderId,
          token:     order.token,
          shopName:  selectedShop.name,
          fileCount: order.fileCount,
          status:    order.status,
          updatedAt: Date.now(),
        });
        const payment = await api.post(`/orders/${encodePathSegment(orderId)}/pay`, {});
        paymentLink = payment.paymentLink;
      } else {
        const result = await api.post('/orders/public', {
          shopId:        selectedShop.id,
          files,
          customerName:  customer.name,
          customerPhone: customer.phone,
        });
        orderId = result.order.id;
        paymentLink = result.paymentLink;
        upsertCachedOrder({
          orderId,
          token:     result.order.token,
          shopName:  result.order.shop?.name || selectedShop.name,
          fileCount: result.order.fileCount,
          status:    result.order.status,
          updatedAt: Date.now(),
        });
      }

      const safe = getSafePaymentUrl(paymentLink);
      if (safe) {
        window.location.assign(safe);
      } else {
        router.push(`/pay/${encodePathSegment(orderId)}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create order');
      setSubmitting(false);
    }
  };

  // ── Navigation ───────────────────────────────────────────────────────────────

  const canNext = (): boolean => {
    if (step === 'upload')    return cartFiles.length > 0;
    if (step === 'configure') return cartFiles.every((f) => f.pref.copies >= 1);
    if (step === 'shop')      return !!selectedShop;
    if (step === 'contact')   return isValidPhone(customer.phone);
    return true;
  };

  const next = () => {
    const idx = steps.findIndex((s) => s.key === step);
    if (idx < steps.length - 1) setStep(steps[idx + 1].key);
  };
  const back = () => {
    const idx = steps.findIndex((s) => s.key === step);
    if (idx > 0) setStep(steps[idx - 1].key);
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      {user ? <Navbar /> : <PublicPrintHeader />}

      <div className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <StepBar steps={steps} current={step} />

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Upload your files</h2>
              <p className="text-sm text-gray-500 mt-1">
                PDF, images, or documents — up to 50 MB each, max {MAX_FILES} files
              </p>
            </div>

            {cartFiles.length < MAX_FILES && (
              <FileUpload
                onUploaded={addFile}
                uploadUrl={user ? '/api/files/upload' : '/api/files/public-upload'}
              />
            )}

            {cartFiles.map((f) => (
              <Card key={f.id}>
                <CardBody className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{f.meta.fileName}</p>
                    <p className="text-xs text-gray-500">
                      {f.meta.pageCount} page{f.meta.pageCount !== 1 ? 's' : ''} · {(f.meta.fileSize / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <Check className="w-4 h-4 text-green-500 shrink-0" />
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </CardBody>
              </Card>
            ))}

            {cartFiles.length > 0 && cartFiles.length < MAX_FILES && (
              <p className="text-xs text-center text-gray-400">
                {MAX_FILES - cartFiles.length} more file{MAX_FILES - cartFiles.length !== 1 ? 's' : ''} can be added
              </p>
            )}
          </section>
        )}

        {/* ── Step 2: Configure ── */}
        {step === 'configure' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Print settings</h2>
              <p className="text-sm text-gray-500 mt-1">Configure each file individually</p>
            </div>
            <CartFileList files={cartFiles} onChange={updatePref} />
          </section>
        )}

        {/* ── Step 3: Shop ── */}
        {step === 'shop' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Choose a shop</h2>
              <p className="text-sm text-gray-500 mt-1">
                All {cartFiles.length} file{cartFiles.length !== 1 ? 's' : ''} will be printed here
              </p>
            </div>
            {shopList.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No shops available yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shopList.map((shop) => (
                  <button
                    type="button"
                    key={shop.id}
                    onClick={() => setSelectedShop(shop)}
                    className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                      selectedShop?.id === shop.id
                        ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{shop.name}</p>
                          <Badge status={shop.isOpen ? 'active' : 'inactive'} />
                        </div>
                        {shop.address && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{shop.address}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {shop.opensAt} – {shop.closesAt}
                          </span>
                          <span className="flex items-center gap-1">
                            <IndianRupee className="w-3 h-3" />
                            ₹{shop.ratesBwSingle}/pg BW · ₹{shop.ratesColorSingle}/pg Color
                          </span>
                        </div>
                      </div>
                      {selectedShop?.id === shop.id && (
                        <Check className="w-5 h-5 text-blue-600 shrink-0 mt-1" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Step 4: Contact (guest only) ── */}
        {step === 'contact' && !user && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Where should we send your token?</h2>
              <p className="text-sm text-gray-500 mt-1">
                Use your WhatsApp number so we can notify you when ready.
              </p>
            </div>
            <Card>
              <CardBody className="space-y-4">
                <label className="block">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                    <UserRound className="w-4 h-4 text-gray-400" />
                    Name
                  </span>
                  <input
                    type="text"
                    value={customer.name}
                    onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
                    placeholder="Your name"
                    maxLength={80}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                  />
                </label>
                <label className="block">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                    <Phone className="w-4 h-4 text-gray-400" />
                    WhatsApp number
                  </span>
                  <input
                    type="tel"
                    value={customer.phone}
                    onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">Include country code if outside India.</p>
                </label>
              </CardBody>
            </Card>
          </section>
        )}

        {/* ── Step 5: Review ── */}
        {step === 'review' && selectedShop && priceBreakdown && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Review your order</h2>
              <p className="text-sm text-gray-500 mt-1">
                {cartFiles.length} file{cartFiles.length !== 1 ? 's' : ''} · {selectedShop.name}
              </p>
            </div>

            {priceBreakdown.map((row, i) => (
              <Card key={i}>
                <CardBody className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                    <p className="font-medium text-sm truncate">{row.fileName}</p>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>
                      ₹{row.rate}/pg × {row.pages} pg × {row.copies} cop{row.copies === 1 ? 'y' : 'ies'}
                    </span>
                    <span>₹{row.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Platform fee</span>
                    <span>₹{row.fee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t border-gray-100 pt-1.5">
                    <span>File total</span>
                    <span>₹{row.total.toFixed(2)}</span>
                  </div>
                </CardBody>
              </Card>
            ))}

            <Card>
              <CardBody>
                <div className="flex justify-between text-base font-black">
                  <span>Total</span>
                  <span className="text-blue-600 flex items-center gap-0.5">
                    <IndianRupee className="w-4 h-4" />
                    {grandTotal.toFixed(2)}
                  </span>
                </div>
              </CardBody>
            </Card>

            {!user && (
              <Card>
                <CardBody className="flex items-center gap-3">
                  <MessageCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">{customer.name.trim() || 'Customer'}</p>
                    <p className="text-xs text-gray-500">{customer.phone}</p>
                  </div>
                </CardBody>
              </Card>
            )}

            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
            )}
          </section>
        )}
      </div>

      {/* ── Sticky bottom bar ── */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 z-30">
        <div className="max-w-2xl mx-auto flex gap-3">
          {step !== 'upload' && (
            <Button variant="secondary" onClick={back} className="rounded-xl px-5">
              <ArrowLeft className="w-4 h-4 mr-1.5" />Back
            </Button>
          )}
          {step !== steps[steps.length - 1].key ? (
            <Button
              onClick={next}
              disabled={!canNext()}
              className="flex-1 rounded-xl py-3 text-base"
              size="lg"
            >
              Continue<ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={submitting}
              className="flex-1 rounded-xl py-3 text-base"
              size="lg"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />Creating order…
                </span>
              ) : (
                <>Pay ₹{grandTotal.toFixed(2)}<ChevronRight className="w-4 h-4 ml-1" /></>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PublicPrintHeader() {
  const whatsappUrl = getSafeExternalUrl(process.env.NEXT_PUBLIC_WHATSAPP_ORDER_URL);
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-200">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-[15px]">
          <span className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Printer className="w-4 h-4 text-white" />
          </span>
          PrintDrop
        </Link>
        <div className="flex items-center gap-2">
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2 hover:bg-green-100"
            >
              <MessageCircle className="w-3.5 h-3.5" />WhatsApp
            </a>
          )}
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-100"
          >
            <Home className="w-3.5 h-3.5" />Home
          </Link>
        </div>
      </div>
    </header>
  );
}

function StepBar({ steps, current }: { steps: { key: Step; label: string }[]; current: Step }) {
  const currentIdx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex-1 flex flex-col items-center gap-1.5">
          <div
            className={`h-1 w-full rounded-full transition-all ${
              i <= currentIdx ? 'bg-blue-500' : 'bg-gray-200'
            }`}
          />
          <span
            className={`text-[11px] font-medium transition-colors ${
              i === currentIdx ? 'text-blue-600' : i < currentIdx ? 'text-gray-500' : 'text-gray-300'
            }`}
          >
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function isValidPhone(value: string): boolean {
  const cleaned = value.replace(/[^\d+]/g, '');
  const digits  = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  return /^\d{10,15}$/.test(digits);
}

function estimatePageCount(range: string, total: number): number {
  if (!range || range === 'all') return total;
  const pages = new Set<number>();
  for (const part of range.split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) return total;
    const start = Number(match[1]);
    const end   = match[2] ? Number(match[2]) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return total;
    for (let i = start; i <= Math.min(end, total); i++) pages.add(i);
  }
  return pages.size || total;
}
