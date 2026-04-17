'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Printer, ArrowLeft, Loader2, Phone, ShieldCheck } from 'lucide-react';
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

  // Auto-focus phone input on mount
  useEffect(() => { phoneRef.current?.focus(); }, []);

  // Auto-focus first OTP box when switching to OTP step
  useEffect(() => {
    if (step === 'otp') {
      setTimeout(() => otpRefs.current[0]?.focus(), 80);
    }
  }, [step]);

  // Redirect if already logged in
  if (user) {
    let dest = '/print';
    if (user.role === 'admin') {
      dest = '/admin';
    } else if (user.role === 'shopkeeper') {
      dest = '/dashboard';
    }
    router.push(dest);
    return null;
  }

  // ── Phone handling ──────────────────────────────────────────────
  const rawDigits = phone.replace(/\D/g, '').slice(0, 10);
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
      const fullPhone = `+91${rawDigits}`;
      const data = await api.post<{ otp?: string }>('/auth/send-otp', { phone: fullPhone });
      if (data.otp) setDevOtp(data.otp);
      setSent(true);
      setStep('otp');
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const phoneKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') sendOtp();
  };

  // ── OTP handling (6 individual boxes) ───────────────────────────
  const otpValue = otp.join('');
  const isOtpComplete = otpValue.length === 6;

  const handleOtpChange = (index: number, value: string) => {
    // Only accept digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);

    // Auto-advance to next box
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 filled
    const full = next.join('');
    if (full.length === 6) {
      verifyOtpValue(full);
    }
  };

  const handleOtpKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter' && isOtpComplete) {
      verifyOtpValue(otpValue);
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 0) return;
    const next = [...otp];
    for (let i = 0; i < 6; i++) next[i] = pasted[i] || '';
    setOtp(next);
    // Focus last filled or the next empty
    const focusIdx = Math.min(pasted.length, 5);
    otpRefs.current[focusIdx]?.focus();
    if (pasted.length === 6) verifyOtpValue(pasted);
  };

  const verifyOtpValue = async (code: string) => {
    setError('');
    setLoading(true);
    try {
      const fullPhone = `+91${rawDigits}`;
      await login(fullPhone, code);
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Invalid OTP. Please try again.');
      // Clear OTP and refocus first box on error
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white mb-4 shadow-lg shadow-blue-600/25">
            <Printer className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold">PrintDrop</h1>
          <p className="text-sm text-gray-500 mt-1">
            {step === 'phone' ? 'Sign in with your phone number' : 'Enter the 6-digit code'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">

          {/* ── Phone Step ── */}
          {step === 'phone' && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none">
                    <span className="text-gray-400 text-sm font-medium">+91</span>
                  </div>
                  <input
                    ref={phoneRef}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    value={formatPhone(phone)}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={phoneKeyDown}
                    className={`block w-full rounded-xl border pl-12 pr-10 py-3 text-base shadow-sm
                      placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                      ${error ? 'border-red-400 focus:ring-red-500' : 'border-gray-200'}`}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3.5">
                    <Phone className="w-4 h-4 text-gray-300" />
                  </div>
                </div>
                {error && <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">{error}</p>}
              </div>

              <Button
                onClick={sendOtp}
                disabled={loading || !isPhoneValid}
                className="w-full py-3 text-base rounded-xl"
                size="lg"
              >
                {loading ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Sending…</span>
                ) : (
                  'Send OTP'
                )}
              </Button>

              <p className="text-xs text-center text-gray-400">
                We&apos;ll send a 6-digit code via SMS to verify your number
              </p>
            </div>
          )}

          {/* ── OTP Step ── */}
          {step === 'otp' && (
            <div className="space-y-5">
              {/* Sent confirmation */}
              <div className="flex items-center gap-2 bg-green-50 text-green-700 text-sm font-medium px-3 py-2.5 rounded-xl">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>OTP sent to +91 {formatPhone(rawDigits)}</span>
              </div>

              {/* Dev OTP hint */}
              {devOtp && (
                <div className="text-center text-xs bg-blue-50 text-blue-600 font-mono py-1.5 rounded-lg">
                  Dev OTP: <span className="font-bold tracking-widest">{devOtp}</span>
                </div>
              )}

              {/* 6 individual OTP boxes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Verification Code</label>
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
                      className={`w-full aspect-square max-w-[52px] text-center text-xl font-bold rounded-xl border shadow-sm
                        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all
                        ${digit ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'}
                        ${error ? 'border-red-400 focus:ring-red-500' : ''}
                      `}
                    />
                  ))}
                </div>
                {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
              </div>

              {/* Verify button (backup — auto-submits on last digit) */}
              <Button
                onClick={() => verifyOtpValue(otpValue)}
                disabled={loading || !isOtpComplete}
                className="w-full py-3 text-base rounded-xl"
                size="lg"
              >
                {loading ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</span>
                ) : (
                  'Verify & Continue'
                )}
              </Button>

              {/* Change number */}
              <button
                onClick={changeNumber}
                className="flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 w-full transition-colors"
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
