'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Printer, ArrowLeft, Mail, MessageCircle, Store, Send, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: 'general', message: '' });
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simulated submission — wire to your backend or email service
    await new Promise(r => setTimeout(r, 1000));
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold text-[15px]">
            <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Printer className="w-3.5 h-3.5 text-white" />
            </span>
            PrintDrop
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 sm:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-16">
          {/* Left */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Get in touch</p>
            <h1 className="font-serif italic text-4xl sm:text-5xl text-foreground leading-[1.1] tracking-tight mb-5">
              We&apos;d love to<br />hear from you.
            </h1>
            <p className="text-muted-foreground leading-relaxed mb-10">
              Whether you run a print shop, have a question about an order, or just want to learn more —
              drop us a message.
            </p>

            <div className="space-y-5">
              {[
                {
                  icon: <Mail className="w-4 h-4" />,
                  label: 'Email',
                  value: 'hello@printdrop.app',
                  href: 'mailto:hello@printdrop.app',
                },
                {
                  icon: <MessageCircle className="w-4 h-4" />,
                  label: 'WhatsApp',
                  value: 'Chat with us',
                  href: 'https://wa.me/919999999999',
                },
                {
                  icon: <Store className="w-4 h-4" />,
                  label: 'Register a shop',
                  value: 'Takes 2 minutes →',
                  href: '/login',
                },
              ].map(item => (
                <a
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-4 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
                    {item.icon}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {item.value}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* Right — form */}
          <div>
            {sent ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-12">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold tracking-tight">Message sent!</h2>
                <p className="text-sm text-muted-foreground max-w-xs">
                  We typically reply within one business day. Check your inbox.
                </p>
                <button
                  onClick={() => { setSent(false); setForm({ name: '', email: '', subject: 'general', message: '' }); }}
                  className="text-sm text-primary hover:underline"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5 bg-muted/20 border border-border rounded-2xl p-7">
                <h2 className="font-semibold text-lg tracking-tight mb-1">Send a message</h2>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label="Your name"
                    placeholder="Priya S."
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    required
                  />
                  <Input
                    label="Email"
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">I&apos;m reaching out about</label>
                  <select
                    value={form.subject}
                    onChange={e => setForm({ ...form, subject: e.target.value })}
                    className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-shadow"
                  >
                    <option value="general">General question</option>
                    <option value="shop">Registering my print shop</option>
                    <option value="order">An order or payment issue</option>
                    <option value="partnership">Partnership or integration</option>
                    <option value="other">Something else</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Message</label>
                  <textarea
                    value={form.message}
                    onChange={e => setForm({ ...form, message: e.target.value })}
                    rows={5}
                    placeholder="Tell us what's on your mind…"
                    required
                    className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-shadow resize-none"
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full rounded-xl">
                  {loading ? (
                    'Sending…'
                  ) : (
                    <><Send className="w-4 h-4" /> Send message</>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  We respond within one business day.
                </p>
              </form>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-16 py-8">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} PrintDrop. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
