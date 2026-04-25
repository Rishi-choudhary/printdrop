'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Printer, ArrowLeft, Loader2, Phone, Lock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { getSafeExternalUrl } from '@/lib/security';

export default function LoginPage() {
  const { login, user } = useAuth();
  const router = useRouter();
  const [phone, setPhone]   = useState('');
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const whatsappOrderUrl = getSafeExternalUrl(process.env.NEXT_PUBLIC_WHATSAPP_ORDER_URL);

  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => { phoneRef.current?.focus(); }, []);

  useEffect(() => {
    if (!user) return;
    router.replace(user.role === 'admin' ? '/admin' : '/dashboard');
  }, [router, user]);

  if (user) {
    return null;
  }

  const rawDigits    = phone.replace(/\D/g, '').slice(0, 10);
  const isPhoneValid = rawDigits.length === 10;
  const isPinValid   = /^\d{6}$/.test(pin);
  const canSubmit    = isPhoneValid && isPinValid;

  const formatPhone = (val: string) => {
    const d = val.replace(/\D/g, '').slice(0, 10);
    if (d.length <= 5) return d;
    return `${d.slice(0, 5)} ${d.slice(5)}`;
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      await login(`+91${rawDigits}`, pin);
      window.location.assign('/');
    } catch (err: any) {
      setError(err.message || 'Invalid phone number or PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Dot-grid background */}
      <div className="absolute inset-0 bg-dot-grid opacity-60 pointer-events-none" />
      {/* Soft gradient blob */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative w-full max-w-sm">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to home
        </Link>

        {/* Logo + heading */}
        <div className="mb-7">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-4 shadow-md shadow-primary/20">
            <Printer className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Shopkeeper Login</h1>
          <p className="text-sm text-muted-foreground">
            This portal is for PrintDrop shop partners only.
          </p>
        </div>

        {/* Card */}
        <div className="bg-background rounded-2xl border border-border shadow-md p-6 space-y-4">

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Phone number</label>
            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-sm font-medium text-muted-foreground select-none">+91</span>
              <input
                ref={phoneRef}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={formatPhone(phone)}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={handleKeyDown}
                className={[
                  'block w-full rounded-xl border pl-12 pr-4 py-3 text-base bg-background',
                  'placeholder:text-muted-foreground/40',
                  'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50',
                  'transition-shadow duration-150',
                  error ? 'border-destructive/60 focus:ring-destructive/30' : 'border-border',
                ].join(' ')}
              />
              <Phone className="absolute right-3.5 w-4 h-4 text-muted-foreground/40 pointer-events-none" />
            </div>
          </div>

          {/* PIN */}
          <div>
            <label className="block text-sm font-medium mb-1.5">6-digit PIN</label>
            <div className="relative flex items-center">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                placeholder="••••••"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={handleKeyDown}
                className={[
                  'block w-full rounded-xl border pl-4 pr-10 py-3 text-base bg-background tracking-widest',
                  'placeholder:text-muted-foreground/40 placeholder:tracking-normal',
                  'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50',
                  'transition-shadow duration-150',
                  error ? 'border-destructive/60 focus:ring-destructive/30' : 'border-border',
                ].join(' ')}
              />
              <Lock className="absolute right-3.5 w-4 h-4 text-muted-foreground/40 pointer-events-none" />
            </div>
            {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={loading || !canSubmit}
            className="w-full rounded-xl"
            size="lg"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
            ) : 'Sign in'}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Not a shop partner?{' '}
            <a
              href={whatsappOrderUrl || '#'}
              target={whatsappOrderUrl ? '_blank' : undefined}
              rel={whatsappOrderUrl ? 'noopener noreferrer' : undefined}
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Order via WhatsApp
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
