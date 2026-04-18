'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Printer, ArrowLeft, Loader2, Phone, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export default function LoginPage() {
  const { login, user } = useAuth();
  const router = useRouter();
  const [step, setStep]       = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone]     = useState('');
  const [otp, setOtp]         = useState(['', '', '', '', '', '']);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [devOtp, setDevOtp]   = useState('');
  const [sent, setSent]       = useState(false);

  const phoneRef = useRef<HTMLInputElement>(null);
  const otpRefs  = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { phoneRef.current?.focus(); }, []);
  useEffect(() => {
    if (step === 'otp') setTimeout(() => otpRefs.current[0]?.focus(), 80);
  }, [step]);

  if (user) {
    let dest = '/print';
    if (user.role === 'admin') dest = '/admin';
    else if (user.role === 'shopkeeper') dest = '/dashboard';
    router.push(dest);
    return null;
  }

  const rawDigits   = phone.replace(/\D/g, '').slice(0, 10);
  const isPhoneValid = rawDigits.length === 10;

  const formatPhone = (val: string) => {
    const d = val.replace(/\D/g, '').slice(0, 10);
    if (d.length <= 5) return d;
    return `${d.slice(0, 5)} ${d.slice(5)}`;
  };

  const sendOtp = async () => {
    if (!isPhoneValid) return;
    setError('');
    setLoading(true);
    try {
      const data = await api.post<{ otp?: string }>('/auth/send-otp', { phone: `+91${rawDigits}` });
      if (data.otp) setDevOtp(data.otp);
      setSent(true);
      setStep('otp');
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const phoneKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter') sendOtp(); };

  const otpValue     = otp.join('');
  const isOtpComplete = otpValue.length === 6;

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next  = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
    const full = next.join('');
    if (full.length === 6) verifyOtpValue(full);
  };

  const handleOtpKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
    if (e.key === 'Enter' && isOtpComplete) verifyOtpValue(otpValue);
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted.length) return;
    const next = [...otp];
    for (let i = 0; i < 6; i++) next[i] = pasted[i] || '';
    setOtp(next);
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
    if (pasted.length === 6) verifyOtpValue(pasted);
  };

  const verifyOtpValue = async (code: string) => {
    setError('');
    setLoading(true);
    try {
      await login(`+91${rawDigits}`, code);
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Invalid OTP. Please try again.');
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  const changeNumber = () => {
    setStep('phone');
    setOtp(['', '', '', '', '', '']);
    setError('');
    setDevOtp('');
    setSent(false);
    setTimeout(() => phoneRef.current?.focus(), 80);
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

        {/* Logo */}
        <div className="mb-7">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-4 shadow-md shadow-primary/20">
            <Printer className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Welcome back</h1>
          <p className="text-sm text-muted-foreground">
            {step === 'phone' ? 'Sign in with your Indian phone number' : 'Check your SMS for the code'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-background rounded-2xl border border-border shadow-md p-6">

          {/* Phone step */}
          {step === 'phone' && (
            <div className="space-y-4">
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
                    onKeyDown={phoneKeyDown}
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
                {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
              </div>

              <Button
                onClick={sendOtp}
                disabled={loading || !isPhoneValid}
                className="w-full rounded-xl"
                size="lg"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                ) : 'Send verification code'}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                We&apos;ll send a 6-digit code via SMS
              </p>
            </div>
          )}

          {/* OTP step */}
          {step === 'otp' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 bg-green-50 text-green-700 text-sm font-medium px-3 py-2.5 rounded-xl border border-green-100">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Sent to +91 {formatPhone(rawDigits)}</span>
              </div>

              {devOtp && (
                <div className="text-center text-xs bg-muted text-muted-foreground font-mono py-1.5 rounded-lg border border-border">
                  Dev code: <span className="font-bold tracking-widest text-foreground">{devOtp}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Verification code</label>
                <div className="flex gap-2 justify-between" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={el => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={i === 0 ? 'one-time-code' : 'off'}
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      className={[
                        'w-full aspect-square max-w-[48px] text-center text-xl font-bold tabular-nums rounded-xl border bg-background',
                        'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all',
                        digit ? 'border-primary/40 bg-primary/5' : 'border-border',
                        error ? 'border-destructive/60 focus:ring-destructive/30' : '',
                      ].join(' ')}
                    />
                  ))}
                </div>
                {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
              </div>

              <Button
                onClick={() => verifyOtpValue(otpValue)}
                disabled={loading || !isOtpComplete}
                className="w-full rounded-xl"
                size="lg"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                ) : 'Continue'}
              </Button>

              <button
                onClick={changeNumber}
                className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-full transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Change phone number
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
