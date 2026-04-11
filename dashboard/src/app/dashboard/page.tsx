'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useShopQueue, useShopStats } from '@/lib/hooks';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  Printer, CheckCircle, Zap, ZapOff, Volume2, VolumeX,
  RefreshCw, IndianRupee, FileText, Layers, Palette, Copy as CopyIcon,
  WifiOff, Settings, BarChart3, LogOut,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Job {
  id: string;
  token: number;
  fileName: string;
  pageCount: number;
  copies: number;
  color: boolean;
  doubleSided: boolean;
  paperSize: string;
  binding?: string;
  totalPrice: number;
  status: string;
  createdAt: string;
  user?: { name?: string; phone: string };
}

// ─── Audio engine (Web Audio API — zero deps) ─────────────────────────────────
function useAudio() {
  const enabledRef = useRef(true);
  const [enabled, setEnabled] = useState(true);

  const toggle = () => { enabledRef.current = !enabledRef.current; setEnabled(e => !e); };

  const playTone = useCallback((freqs: number[], dur = 0.12, gap = 0.05) => {
    if (!enabledRef.current) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      freqs.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = freq;
        const t = ctx.currentTime + i * (dur + gap);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
        gain.gain.linearRampToValueAtTime(0, t + dur);
        osc.start(t); osc.stop(t + dur + 0.02);
      });
    } catch {}
  }, []);

  const newJobSound = useCallback(() => playTone([440, 554, 659], 0.10, 0.05), [playTone]);
  const readySound  = useCallback(() => playTone([523, 659, 784], 0.14, 0.06), [playTone]);
  const printSound  = useCallback(() => playTone([330, 440], 0.10, 0.04), [playTone]);

  return { enabled, toggle, newJobSound, readySound, printSound };
}

// ─── Status config ────────────────────────────────────────────────────────────
const S: Record<string, { label: string; cardBg: string; border: string; token: string; badge: string; glow?: string; pulse?: boolean }> = {
  queued:          { label: 'QUEUED',       cardBg: 'bg-blue-50',   border: 'border-blue-200',  token: 'text-blue-600',  badge: 'bg-blue-100 text-blue-700' },
  printing:        { label: 'PRINTING',     cardBg: 'bg-amber-50',  border: 'border-amber-300', token: 'text-amber-600', badge: 'bg-amber-100 text-amber-800', glow: 'shadow-[0_0_24px_rgba(245,158,11,0.18)]', pulse: true },
  ready:           { label: 'READY',        cardBg: 'bg-green-50',  border: 'border-green-300', token: 'text-green-600', badge: 'bg-green-100 text-green-700', glow: 'shadow-[0_0_24px_rgba(34,197,94,0.20)]',  pulse: true },
  payment_pending: { label: 'AWAITING PAY', cardBg: 'bg-yellow-50', border: 'border-yellow-300',token: 'text-yellow-700',badge: 'bg-yellow-100 text-yellow-800' },
  picked_up:       { label: 'PICKED UP',    cardBg: 'bg-gray-50',   border: 'border-gray-200',  token: 'text-gray-400',  badge: 'bg-gray-100 text-gray-500' },
  cancelled:       { label: 'CANCELLED',    cardBg: 'bg-red-50',    border: 'border-red-200',   token: 'text-red-300',   badge: 'bg-red-100 text-red-400' },
};
const cfg = (status: string) => S[status] || S.queued;

// ─── Job Card ─────────────────────────────────────────────────────────────────
function JobCard({ job, autoMode, onAction, isUpdating, audio }: {
  job: Job; autoMode: boolean;
  onAction: (id: string, s: string) => void;
  isUpdating: boolean;
  audio: ReturnType<typeof useAudio>;
}) {
  const c    = cfg(job.status);
  const done = ['picked_up', 'cancelled'].includes(job.status);

  return (
    <div className={`relative rounded-2xl border-2 p-5 flex flex-col gap-3 transition-all duration-300
      ${c.cardBg} ${c.border} ${c.glow || ''}
      ${done ? 'opacity-40' : ''}
      ${c.pulse ? 'animate-[pulse_2.8s_ease-in-out_infinite]' : ''}
    `}>
      {/* Token + status */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.25em] text-gray-400 uppercase mb-0.5">Token</p>
          <p className={`text-7xl font-black leading-none font-mono ${c.token}`}>
            {String(job.token).padStart(3, '0')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 mt-1">
          <span className={`text-[10px] font-bold tracking-widest px-3 py-1 rounded-full uppercase ${c.badge}`}>
            {c.label}
          </span>
          {job.user && (
            <span className="text-[10px] text-gray-400 truncate max-w-[120px]">
              {job.user.name || job.user.phone}
            </span>
          )}
        </div>
      </div>

      {/* File name */}
      <p className="text-sm font-semibold text-gray-700 truncate">{job.fileName}</p>

      {/* Specs grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Chip icon={<FileText className="w-3.5 h-3.5" />} label={`${job.pageCount} pg`} />
        <Chip icon={<CopyIcon className="w-3.5 h-3.5" />} label={`${job.copies}×`} />
        <Chip icon={<Palette className="w-3.5 h-3.5" />} label={job.color ? 'Color' : 'B&W'} hi={job.color} />
        <Chip icon={<Layers className="w-3.5 h-3.5" />} label={job.doubleSided ? '2-sided' : '1-sided'} />
        {job.paperSize !== 'A4' && <Chip icon={<FileText className="w-3.5 h-3.5" />} label={job.paperSize} />}
        {job.binding && job.binding !== 'none' && <Chip icon={<Layers className="w-3.5 h-3.5" />} label={job.binding} />}
      </div>

      {/* Price + time */}
      <div className="flex items-center text-xs text-gray-500">
        <IndianRupee className="w-3 h-3 mr-0.5" />
        <span className="font-bold text-gray-700">{job.totalPrice.toFixed(2)}</span>
        <span className="ml-auto text-[10px] text-gray-400">
          {new Date(job.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Retry cancelled */}
      {job.status === 'cancelled' && (
        <div className="flex gap-2 mt-1">
          <button onClick={() => onAction(job.id, 'queued')}
            disabled={isUpdating}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-blue-500 hover:bg-blue-600 active:scale-95 text-white transition-all disabled:opacity-50">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* Actions */}
      {['queued', 'printing', 'ready'].includes(job.status) && (
        <div className="flex gap-2 mt-1">
          {job.status === 'queued' && !autoMode && (
            <button onClick={() => { audio.printSound(); onAction(job.id, 'printing'); }}
              disabled={isUpdating}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-sm uppercase tracking-wider bg-orange-500 hover:bg-orange-600 active:scale-95 text-white transition-all disabled:opacity-50 shadow-md shadow-orange-200">
              <Printer className="w-5 h-5" /> PRINT
            </button>
          )}
          {job.status === 'queued' && autoMode && (
            <div className="flex-1 py-3 rounded-xl text-center text-xs text-gray-400 bg-gray-100 border border-gray-200">
              Auto-printing…
            </div>
          )}
          {job.status === 'printing' && (
            <button onClick={() => { audio.readySound(); onAction(job.id, 'ready'); }}
              disabled={isUpdating}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-sm uppercase tracking-wider bg-green-600 hover:bg-green-700 active:scale-95 text-white transition-all disabled:opacity-50 shadow-md shadow-green-200">
              <CheckCircle className="w-5 h-5" /> MARK READY
            </button>
          )}
          {job.status === 'ready' && (
            <button onClick={() => onAction(job.id, 'picked_up')}
              disabled={isUpdating}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-sm uppercase tracking-wider bg-gray-200 hover:bg-gray-300 active:scale-95 text-gray-700 transition-all disabled:opacity-50">
              <CheckCircle className="w-4 h-4" /> PICKED UP
            </button>
          )}
          {['queued', 'printing'].includes(job.status) && (
            <button onClick={() => onAction(job.id, 'cancelled')} disabled={isUpdating}
              title="Cancel" className="px-3 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 text-red-500 text-lg transition-all">
              ✕
            </button>
          )}
        </div>
      )}

      {/* Spinner overlay */}
      {isUpdating && (
        <div className="absolute inset-0 rounded-2xl bg-white/70 flex items-center justify-center">
          <RefreshCw className="w-7 h-7 text-gray-500 animate-spin" />
        </div>
      )}
    </div>
  );
}

function Chip({ icon, label, hi }: { icon: React.ReactNode; label: string; hi?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium ${hi ? 'text-amber-600' : 'text-gray-500'}`}>
      <span className={hi ? 'text-amber-500' : 'text-gray-400'}>{icon}</span>
      {label}
    </div>
  );
}

// ─── New-job flash banner ─────────────────────────────────────────────────────
function NewJobBanner({ count, onDone }: { count: number; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [count, onDone]);
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-orange-500 text-white px-6 py-3 rounded-full shadow-2xl shadow-orange-300/60 font-black text-sm animate-bounce pointer-events-none">
      <Zap className="w-4 h-4" />
      {count} new job{count > 1 ? 's' : ''} received!
    </div>
  );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────
function Pill({ val, label, color, bg, pulse }: { val: string | number; label: string; color: string; bg: string; pulse?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${bg} ${pulse ? 'animate-pulse' : ''}`}>
      <span className={`font-black text-sm tabular-nums ${color}`}>{val}</span>
      <span className="text-gray-500 text-[10px] font-medium hidden sm:inline">{label}</span>
    </div>
  );
}

// ─── Live clock ───────────────────────────────────────────────────────────────
function Clock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-gray-700 font-mono font-bold text-sm tabular-nums">{t}</span>;
}

// ─── Main KDS Page ────────────────────────────────────────────────────────────
export default function KDSPage() {
  const { user, logout }        = useAuth();
  const shopId                  = user?.shop?.id;
  const { data: raw, mutate, error: pollError } = useShopQueue(shopId);
  const { data: stats }         = useShopStats(shopId);
  const audio                   = useAudio();
  const { toast }               = useToast();

  const [autoMode, setAutoMode] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('kds_auto') === 'true'
  );
  const [updating, setUpdating] = useState<string | null>(null);
  const [alert, setAlert]       = useState(0);
  const [flashBg, setFlashBg]   = useState(false);

  const prevIds     = useRef<Set<string>>(new Set());
  const prevStatus  = useRef<Record<string, string>>({});

  const allJobs: Job[] = Array.isArray(raw) ? raw : (raw?.jobs || raw?.queue || []);
  const ORDER: Record<string, number> = { printing: 0, queued: 1, ready: 2, payment_pending: 3 };

  const active   = allJobs.filter(j => ['queued','printing','ready','payment_pending'].includes(j.status));
  const done     = allJobs.filter(j => ['picked_up','cancelled'].includes(j.status)).slice(0, 8);
  const sorted   = [...active].sort((a,b) => (ORDER[a.status]??9) - (ORDER[b.status]??9));

  const counts = {
    queued:   active.filter(j => j.status === 'queued').length,
    printing: active.filter(j => j.status === 'printing').length,
    ready:    active.filter(j => j.status === 'ready').length,
    today:    stats?.today?.jobs   || 0,
    revenue:  stats?.today?.revenue || 0,
  };

  // Detect new jobs and ready transitions
  useEffect(() => {
    if (!allJobs.length) return;
    const newJobs = allJobs.filter(j => !prevIds.current.has(j.id) && j.status === 'queued');
    if (newJobs.length > 0 && prevIds.current.size > 0) {
      audio.newJobSound();
      setAlert(newJobs.length);
      setFlashBg(true);
      setTimeout(() => setFlashBg(false), 700);
    }
    allJobs.forEach(j => {
      if (prevStatus.current[j.id] && prevStatus.current[j.id] !== 'ready' && j.status === 'ready') {
        audio.readySound();
      }
    });
    prevIds.current    = new Set(allJobs.map(j => j.id));
    prevStatus.current = Object.fromEntries(allJobs.map(j => [j.id, j.status]));
  }, [allJobs]); // eslint-disable-line

  // Auto-mode: forward first queued job to printing when nothing is printing
  useEffect(() => {
    if (!autoMode) return;
    const printing = active.filter(j => j.status === 'printing');
    const queued   = active.filter(j => j.status === 'queued');
    if (printing.length === 0 && queued.length > 0) {
      api.patch(`/jobs/${queued[0].id}/status`, { status: 'printing' }).then(() => mutate()).catch(() => {
        toast('Auto-print failed — try printing manually', 'error');
      });
    }
  }, [allJobs, autoMode]); // eslint-disable-line

  const handleAction = async (id: string, status: string) => {
    setUpdating(id);
    try { await api.patch(`/jobs/${id}/status`, { status }); mutate(); }
    catch (e: any) { toast(e.message || 'Failed to update job status', 'error'); }
    finally { setUpdating(null); }
  };

  const toggleAuto = () => {
    const next = !autoMode;
    setAutoMode(next);
    localStorage.setItem('kds_auto', String(next));
    if (user?.shop?.id) api.patch(`/shops/${user.shop.id}`, { autoPrint: next }).catch(() => {});
  };

  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className={`min-h-screen bg-gray-50 transition-colors duration-300 ${flashBg ? '!bg-green-50' : ''}`}>
      {alert > 0 && <NewJobBanner count={alert} onDone={() => setAlert(0)} />}

      {/* ─── Header ─── */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm px-4 lg:px-6">
        <div className="flex items-center justify-between h-14 gap-3">

          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
              <Printer className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <p className="text-gray-900 font-black text-sm leading-none">PrintDrop</p>
              <p className="text-gray-400 text-[10px] leading-none">{user?.shop?.name || 'KDS'}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 justify-center">
            <Pill val={counts.queued}   label="Queued"   color="text-blue-600"  bg="bg-blue-50 border-blue-200" />
            <Pill val={counts.printing} label="Printing" color="text-amber-600" bg="bg-amber-50 border-amber-200" pulse={counts.printing > 0} />
            <Pill val={counts.ready}    label="Ready"    color="text-green-600" bg="bg-green-50 border-green-200" pulse={counts.ready > 0} />
            <Pill val={counts.today}    label="Today"    color="text-gray-700"  bg="bg-gray-100 border-gray-200" />
            <Pill val={`₹${counts.revenue.toFixed(0)}`} label="Revenue" color="text-green-700" bg="bg-green-50 border-green-200" />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Link href="/dashboard/settings" title="Settings"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <Settings className="w-4 h-4" />
            </Link>
            <Link href="/dashboard/analytics" title="Analytics"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <BarChart3 className="w-4 h-4" />
            </Link>

            <button onClick={audio.toggle} title="Toggle sound"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              {audio.enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <button onClick={toggleAuto}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs uppercase tracking-wider border transition-all ${
                autoMode ? 'bg-orange-50 border-orange-200 text-orange-600' : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-700'
              }`}>
              {autoMode ? <Zap className="w-3 h-3" /> : <ZapOff className="w-3 h-3" />}
              <span className="hidden sm:inline">{autoMode ? 'Auto' : 'Manual'}</span>
            </button>

            <button onClick={() => mutate()}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>

            <button onClick={logout} title="Logout"
              className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>

            <div className="hidden md:flex flex-col items-end leading-none pl-1">
              <Clock />
              <span className="text-gray-400 text-[10px]">{dateStr}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Connectivity warning ─── */}
      {pollError && (
        <div className="mx-4 mt-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm font-medium">
          <WifiOff className="w-4 h-4 shrink-0" />
          Connection lost — queue may be outdated. Retrying...
        </div>
      )}

      {/* ─── Content ─── */}
      <main className="p-4 lg:p-5">

        {/* Mode pill */}
        <div className="flex items-center gap-2 mb-4">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-widest border ${
            autoMode ? 'bg-orange-50 border-orange-200 text-orange-600' : 'bg-white border-gray-200 text-gray-500'
          }`}>
            {autoMode ? <Zap className="w-3 h-3" /> : <ZapOff className="w-3 h-3" />}
            {autoMode ? 'Auto-print — jobs print automatically in order' : 'Manual mode — tap PRINT to start each job'}
          </span>
        </div>

        {/* Active jobs */}
        {sorted.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 mb-8">
            {sorted.map(job => (
              <JobCard key={job.id} job={job} autoMode={autoMode}
                onAction={handleAction} isUpdating={updating === job.id} audio={audio} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-28 text-center select-none">
            <Printer className="w-20 h-20 text-gray-200 mb-5" />
            <p className="text-gray-400 font-bold text-xl">Queue is empty</p>
            <p className="text-gray-300 text-sm mt-1.5">New orders will appear here in real time</p>
          </div>
        )}

        {/* Completed */}
        {done.length > 0 && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">Completed</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {done.map(job => (
                <JobCard key={job.id} job={job} autoMode={autoMode}
                  onAction={handleAction} isUpdating={updating === job.id} audio={audio} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
