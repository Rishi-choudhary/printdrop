'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useShops } from '@/lib/hooks';
import { api } from '@/lib/api';
import { encodePathSegment, getSafePaymentUrl } from '@/lib/security';
import { Navbar } from '@/components/navbar';
import { FileUpload, UploadedFileMeta } from '@/components/file-upload';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Printer, FileText, Palette, Copy, Layers, Maximize,
  MapPin, Clock, IndianRupee, ChevronRight, Loader2,
  Check, ArrowLeft, Scissors, BookOpen,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
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

interface Prefs {
  color: boolean;
  copies: number;
  doubleSided: boolean;
  paperSize: string;
  pageRange: string;
  binding: string;
}

type Step = 'upload' | 'preferences' | 'shop' | 'review';

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload',      label: 'Upload' },
  { key: 'preferences', label: 'Options' },
  { key: 'shop',        label: 'Shop' },
  { key: 'review',      label: 'Review' },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PrintPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: shops } = useShops();

  const [step, setStep]   = useState<Step>('upload');
  const [file, setFile]   = useState<UploadedFileMeta | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({
    color: false, copies: 1, doubleSided: false,
    paperSize: 'A4', pageRange: 'all', binding: 'none',
  });
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState('');

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  const shopList: Shop[] = Array.isArray(shops) ? shops : [];

  // ── Price estimate ──────────────────────────────────────────────
  const priceEstimate = useMemo(() => {
    if (!file || !selectedShop) return null;
    const s = selectedShop;
    const pages = prefs.pageRange === 'all' ? file.pageCount : estimatePageCount(prefs.pageRange, file.pageCount);
    const rate  = prefs.color ? s.ratesColorSingle : s.ratesBwSingle;
    const sub   = rate * pages * prefs.copies;
    const fee   = Math.round(0.50 * pages * prefs.copies * 100) / 100;
    return { rate, pages, subtotal: sub, fee, total: Math.round((sub + fee) * 100) / 100 };
  }, [file, selectedShop, prefs]);

  // ── Submit ──────────────────────────────────────────────────────
  const submit = async () => {
    if (!file || !selectedShop || !user) return;
    setSubmitting(true);
    setError('');
    try {
      const { job } = await api.post('/jobs', {
        shopId:      selectedShop.id,
        fileUrl:     file.fileUrl,
        fileKey:     file.fileKey,
        fileName:    file.fileName,
        fileSize:    file.fileSize,
        fileType:    file.fileType,
        pageCount:   file.pageCount,
        color:       prefs.color,
        copies:      prefs.copies,
        doubleSided: prefs.doubleSided,
        paperSize:   prefs.paperSize,
        pageRange:   prefs.pageRange,
        binding:     prefs.binding,
      });

      // Create payment link
      const { paymentLink } = await api.post(`/jobs/${encodePathSegment(job.id)}/pay`, {});

      // Redirect to payment
      const safePaymentLink = getSafePaymentUrl(paymentLink);
      if (safePaymentLink) {
        window.location.assign(safePaymentLink);
      } else {
        router.push(`/pay/${encodePathSegment(job.id)}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create print job');
      setSubmitting(false);
    }
  };

  // ── Step navigation ─────────────────────────────────────────────
  const canNext = () => {
    if (step === 'upload') return !!file;
    if (step === 'preferences') return prefs.copies >= 1;
    if (step === 'shop') return !!selectedShop;
    return true;
  };

  const next = () => {
    const idx = STEPS.findIndex(s => s.key === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key);
  };
  const back = () => {
    const idx = STEPS.findIndex(s => s.key === step);
    if (idx > 0) setStep(STEPS[idx - 1].key);
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-6 pb-28">
        {/* Progress bar */}
        <StepBar steps={STEPS} current={step} />

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Upload your file</h2>
              <p className="text-sm text-gray-500 mt-1">PDF, images, or documents up to 50 MB</p>
            </div>
            <FileUpload
              onUploaded={setFile}
              onClear={() => setFile(null)}
            />
            {file && (
              <Card>
                <CardBody className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{file.fileName}</p>
                    <p className="text-xs text-gray-500">
                      {file.pageCount} page{file.pageCount !== 1 ? 's' : ''} · {(file.fileSize / 1024).toFixed(0)} KB · {file.fileType.toUpperCase()}
                    </p>
                  </div>
                  <Check className="w-5 h-5 text-green-500 shrink-0" />
                </CardBody>
              </Card>
            )}
          </section>
        )}

        {/* ── Step 2: Preferences ── */}
        {step === 'preferences' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Print options</h2>
              <p className="text-sm text-gray-500 mt-1">{file?.fileName} · {file?.pageCount} pages</p>
            </div>

            {/* Color / B&W */}
            <OptionToggle
              icon={<Palette className="w-4 h-4" />}
              label="Print type"
              options={[
                { value: false, label: 'B&W', desc: 'Grayscale' },
                { value: true,  label: 'Color', desc: 'Full color' },
              ]}
              selected={prefs.color}
              onChange={(v) => setPrefs(p => ({ ...p, color: v as boolean }))}
            />

            {/* Copies */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Copy className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium">Copies</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPrefs(p => ({ ...p, copies: Math.max(1, p.copies - 1) }))}
                    className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-bold"
                  >−</button>
                  <span className="w-8 text-center font-bold text-lg">{prefs.copies}</span>
                  <button
                    onClick={() => setPrefs(p => ({ ...p, copies: Math.min(99, p.copies + 1) }))}
                    className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-bold"
                  >+</button>
                </div>
              </div>
            </div>

            {/* Sides */}
            <OptionToggle
              icon={<Layers className="w-4 h-4" />}
              label="Sides"
              options={[
                { value: false, label: 'Single', desc: 'One-sided' },
                { value: true,  label: 'Double', desc: 'Both sides' },
              ]}
              selected={prefs.doubleSided}
              onChange={(v) => setPrefs(p => ({ ...p, doubleSided: v as boolean }))}
            />

            {/* Paper size */}
            <OptionToggle
              icon={<Maximize className="w-4 h-4" />}
              label="Paper size"
              options={[
                { value: 'A4',     label: 'A4',     desc: 'Standard' },
                { value: 'A3',     label: 'A3',     desc: 'Large' },
                { value: 'Letter', label: 'Letter', desc: 'US Letter' },
                { value: 'Legal',  label: 'Legal',  desc: 'US Legal' },
              ]}
              selected={prefs.paperSize}
              onChange={(v) => setPrefs(p => ({ ...p, paperSize: v as string }))}
            />

            {/* Page range */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2.5 mb-2.5">
                <Scissors className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium">Pages</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPrefs(p => ({ ...p, pageRange: 'all' }))}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                    prefs.pageRange === 'all' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >All pages</button>
                <input
                  type="text"
                  placeholder="e.g. 1-3, 5, 8"
                  value={prefs.pageRange === 'all' ? '' : prefs.pageRange}
                  onChange={(e) => setPrefs(p => ({ ...p, pageRange: e.target.value || 'all' }))}
                  onFocus={() => { if (prefs.pageRange === 'all') setPrefs(p => ({ ...p, pageRange: '' })); }}
                  className="flex-1 px-3 py-2 rounded-lg text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Binding */}
            <OptionToggle
              icon={<BookOpen className="w-4 h-4" />}
              label="Binding"
              options={[
                { value: 'none',   label: 'None',   desc: 'Loose pages' },
                { value: 'staple', label: 'Staple',  desc: 'Corner staple' },
                { value: 'spiral', label: 'Spiral',  desc: 'Spiral bind' },
              ]}
              selected={prefs.binding}
              onChange={(v) => setPrefs(p => ({ ...p, binding: v as string }))}
            />
          </section>
        )}

        {/* ── Step 3: Shop ── */}
        {step === 'shop' && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Choose a shop</h2>
              <p className="text-sm text-gray-500 mt-1">Select a nearby print shop for pickup</p>
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
                        {shop.address && <p className="text-xs text-gray-500 mt-0.5 truncate">{shop.address}</p>}
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

        {/* ── Step 4: Review & Pay ── */}
        {step === 'review' && file && selectedShop && (
          <section className="mt-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">Review your order</h2>
              <p className="text-sm text-gray-500 mt-1">Confirm details and proceed to payment</p>
            </div>

            {/* File summary */}
            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{file.fileName}</p>
                    <p className="text-xs text-gray-500">{file.pageCount} pages · {file.fileType.toUpperCase()}</p>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-3 grid grid-cols-2 gap-2 text-sm">
                  <ReviewRow label="Color"   value={prefs.color ? 'Color' : 'B&W'} />
                  <ReviewRow label="Copies"  value={`${prefs.copies}×`} />
                  <ReviewRow label="Sides"   value={prefs.doubleSided ? 'Double' : 'Single'} />
                  <ReviewRow label="Paper"   value={prefs.paperSize} />
                  <ReviewRow label="Pages"   value={prefs.pageRange === 'all' ? 'All' : prefs.pageRange} />
                  <ReviewRow label="Binding" value={prefs.binding === 'none' ? 'None' : prefs.binding} />
                </div>
              </CardBody>
            </Card>

            {/* Shop */}
            <Card>
              <CardBody className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{selectedShop.name}</p>
                  <p className="text-xs text-gray-500">{selectedShop.address || selectedShop.phone}</p>
                </div>
              </CardBody>
            </Card>

            {/* Pricing */}
            {priceEstimate && (
              <Card>
                <CardBody className="space-y-2">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>₹{priceEstimate.rate}/page × {priceEstimate.pages} pages × {prefs.copies} copies</span>
                    <span>₹{priceEstimate.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Platform fee (₹0.50/page)</span>
                    <span>₹{priceEstimate.fee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold border-t border-gray-100 pt-2 mt-1">
                    <span>Total</span>
                    <span className="text-blue-600 flex items-center gap-0.5">
                      <IndianRupee className="w-4 h-4" />
                      {priceEstimate.total.toFixed(2)}
                    </span>
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
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back
            </Button>
          )}

          {step !== 'review' ? (
            <Button
              onClick={next}
              disabled={!canNext()}
              className="flex-1 rounded-xl py-3 text-base"
              size="lg"
            >
              Continue
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={submitting}
              className="flex-1 rounded-xl py-3 text-base"
              size="lg"
            >
              {submitting ? (
                <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Creating order…</span>
              ) : (
                <>
                  Pay ₹{priceEstimate?.total.toFixed(2) || '—'}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepBar({ steps, current }: { steps: typeof STEPS; current: Step }) {
  const currentIdx = steps.findIndex(s => s.key === current);
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex-1 flex flex-col items-center gap-1.5">
          <div className={`h-1 w-full rounded-full transition-all ${
            i <= currentIdx ? 'bg-blue-500' : 'bg-gray-200'
          }`} />
          <span className={`text-[11px] font-medium transition-colors ${
            i === currentIdx ? 'text-blue-600' : i < currentIdx ? 'text-gray-500' : 'text-gray-300'
          }`}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function OptionToggle<T extends string | boolean>({
  icon, label, options, selected, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  options: { value: T; label: string; desc: string }[];
  selected: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="text-gray-400">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-3 py-2.5 rounded-lg text-center border transition-all ${
              selected === opt.value
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-700">{value}</span>
    </div>
  );
}

function estimatePageCount(range: string, total: number): number {
  if (!range || range === 'all') return total;
  const pages = new Set<number>();

  for (const part of range.split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) return total;

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return total;
    }

    for (let i = start; i <= Math.min(end, total); i += 1) {
      pages.add(i);
    }
  }

  return pages.size || total;
}
