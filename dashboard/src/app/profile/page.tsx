'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/navbar';
import { useAuth } from '@/lib/auth';
import { useUserProfile, useUserJobs } from '@/lib/hooks';
import { api } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';
import {
  FileText, IndianRupee, Printer, Upload, ArrowRight,
  CheckCircle, Clock, Loader2, Package, Bell,
} from 'lucide-react';
import { encodePathSegment, getSafePaymentUrl } from '@/lib/security';

const STATUS_STEPS = [
  { key: 'payment_pending', label: 'Payment',  icon: <IndianRupee className="w-3.5 h-3.5" /> },
  { key: 'queued',          label: 'Queued',    icon: <Clock className="w-3.5 h-3.5" /> },
  { key: 'printing',        label: 'Printing',  icon: <Printer className="w-3.5 h-3.5" /> },
  { key: 'ready',           label: 'Ready',     icon: <CheckCircle className="w-3.5 h-3.5" /> },
  { key: 'picked_up',       label: 'Picked Up', icon: <Package className="w-3.5 h-3.5" /> },
];

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const { data: profile, mutate: mutateProfile } = useUserProfile();
  const { data: jobsData } = useUserJobs();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [readyBanner, setReadyBanner] = useState<any[]>([]);
  const prevJobStatuses = useRef<Record<string, string>>({});

  // Detect jobs that just transitioned to 'ready' and show a notification banner
  useEffect(() => {
    const jobs: any[] = jobsData?.jobs || [];
    const newlyReady = jobs.filter((j: any) => {
      const prev = prevJobStatuses.current[j.id];
      return j.status === 'ready' && prev && prev !== 'ready';
    });
    if (newlyReady.length > 0) {
      setReadyBanner((b) => [...b, ...newlyReady]);
    }
    const map: Record<string, string> = {};
    jobs.forEach((j: any) => { map[j.id] = j.status; });
    prevJobStatuses.current = map;
  }, [jobsData]);

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.assign('/login');
    }
  }, [authLoading, user]);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  if (!user) {
    return null;
  }

  const startEdit = () => { setName(profile?.name || ''); setEmail(profile?.email || ''); setEditing(true); };
  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.patch('/users/me', { name, email });
      setEditing(false);
      mutateProfile();
    } finally {
      setSaving(false);
    }
  };

  const jobs = jobsData?.jobs || [];
  const activeJobs = jobs.filter((j: any) => ['queued', 'printing', 'ready', 'payment_pending'].includes(j.status));
  const pastJobs   = jobs.filter((j: any) => !['queued', 'printing', 'ready', 'payment_pending'].includes(j.status));

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* Ready for pickup banners */}
        {readyBanner.map((job) => (
          <div key={job.id} className="mb-3 flex items-center gap-3 bg-green-600 text-white rounded-xl px-4 py-3 shadow-lg animate-pulse">
            <Bell className="w-5 h-5 shrink-0" />
            <div className="flex-1 text-sm font-semibold">
              Your print #{String(job.token).padStart(3, '0')} is ready for pickup at {job.shop?.name}!
            </div>
            <button onClick={() => setReadyBanner((b) => b.filter((j) => j.id !== job.id))} className="text-white/80 hover:text-white text-lg leading-none">×</button>
          </div>
        ))}

        {/* Active orders */}
        {activeJobs.length > 0 && (
          <div className="space-y-3 mb-6">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Active Orders</h2>
            {activeJobs.map((job: any) => (
              <ActiveOrderCard key={job.id} job={job} />
            ))}
          </div>
        )}

        {/* Empty state with CTA */}
        {activeJobs.length === 0 && (
          <Card className="mb-6 overflow-hidden">
            <CardBody className="flex flex-col items-center text-center py-10 px-6">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                <Upload className="w-7 h-7 text-blue-500" />
              </div>
              <h3 className="font-bold text-lg mb-1">No active print jobs</h3>
              <p className="text-sm text-gray-500 mb-5 max-w-xs">
                Upload a file, choose your preferences, pick a nearby shop, and get your prints in minutes.
              </p>
              <Link href="/print">
                <Button size="lg" className="rounded-xl px-6">
                  <Printer className="w-4 h-4 mr-2" />
                  Start a Print Job
                </Button>
              </Link>
            </CardBody>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatCard
            label="Total Orders"
            value={profile?.stats?.totalJobs || 0}
            icon={<FileText className="w-5 h-5 text-blue-500" />}
          />
          <StatCard
            label="Total Spent"
            value={`₹${(profile?.stats?.totalSpent || 0).toFixed(0)}`}
            icon={<IndianRupee className="w-5 h-5 text-green-500" />}
          />
        </div>

        {/* Profile info */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Profile</h2>
              {!editing && (
                <button onClick={startEdit} className="text-sm text-blue-600 font-medium hover:underline">
                  Edit
                </button>
              )}
            </div>
          </CardHeader>
          <CardBody>
            {editing ? (
              <div className="space-y-3">
                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" />
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={saveProfile} disabled={saving} className="rounded-lg">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)} className="rounded-lg">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <Row label="Phone" value={user.phone} />
                <Row label="Name"  value={profile?.name || '—'} />
                <Row label="Email" value={profile?.email || '—'} />
              </div>
            )}
          </CardBody>
        </Card>

        {/* Order History */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Order History</h2>
              <div className="flex items-center gap-3">
                {pastJobs.length > 0 && (
                  <span className="text-xs text-gray-400">{pastJobs.length} orders</span>
                )}
                <Link href="/profile/orders" className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1">
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {pastJobs.length === 0 ? (
              <p className="text-sm text-gray-400 p-6 text-center">No past orders yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {pastJobs.map((job: any) => (
                  <div key={job.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{job.fileName}</p>
                      <p className="text-xs text-gray-400">
                        #{String(job.token).padStart(3, '0')} · {job.shop?.name} · {new Date(job.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="text-sm font-semibold">₹{job.totalPrice.toFixed(0)}</span>
                      <Badge status={job.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-700">{value}</span>
    </div>
  );
}

function ActiveOrderCard({ job }: { job: any }) {
  const currentIdx = STATUS_STEPS.findIndex(s => s.key === job.status);
  const safePaymentLink = getSafePaymentUrl(job.payment?.razorpayPaymentLink);

  return (
    <Card className="border-blue-200 bg-gradient-to-br from-blue-50/80 to-white overflow-hidden">
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-blue-500 font-semibold uppercase tracking-wide">Active Order</p>
            <p className="text-3xl font-black text-blue-700 leading-none mt-1">
              #{String(job.token).padStart(3, '0')}
            </p>
          </div>
          <Badge status={job.status} className="mt-1" />
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-600">
          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="truncate">{job.fileName}</span>
          <span className="text-gray-300">·</span>
          <span className="shrink-0">{job.shop?.name}</span>
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-1 pt-1">
          {STATUS_STEPS.map((step, i) => {
            const done    = i <= currentIdx;
            const current = i === currentIdx;
            return (
              <div key={step.key} className="flex-1 flex flex-col items-center gap-1">
                <div className={`h-1.5 w-full rounded-full transition-all ${
                  done ? 'bg-blue-500' : 'bg-gray-200'
                } ${current ? 'animate-pulse' : ''}`} />
                <span className={`text-[10px] font-medium leading-none ${
                  done ? 'text-blue-600' : 'text-gray-300'
                }`}>{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Pay button if pending */}
        {job.status === 'payment_pending' && safePaymentLink && (
          <a
            href={safePaymentLink}
            className="block w-full text-center bg-blue-600 text-white font-semibold text-sm py-2.5 rounded-xl hover:bg-blue-700 transition-colors mt-1"
          >
            Complete Payment — ₹{job.totalPrice.toFixed(0)}
          </a>
        )}
        {job.status === 'payment_pending' && !safePaymentLink && (
          <Link
            href={`/pay/${encodePathSegment(job.id)}`}
            className="block w-full text-center bg-blue-600 text-white font-semibold text-sm py-2.5 rounded-xl hover:bg-blue-700 transition-colors mt-1"
          >
            Complete Payment — ₹{job.totalPrice.toFixed(0)}
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
