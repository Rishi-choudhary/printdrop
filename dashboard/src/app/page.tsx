'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  Printer, ArrowRight, Store, Upload, CreditCard, Ticket,
  CheckCircle2, LayoutDashboard, TrendingUp, Zap, Menu, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

/* ─── WhatsApp order CTA ────────────────────────────────────────────────── */
function WhatsAppOrderButton() {
  const url = process.env.NEXT_PUBLIC_WHATSAPP_ORDER_URL;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Button size="xl" className="rounded-full">
          <Upload className="w-4 h-4" />
          Print on WhatsApp
        </Button>
      </a>
    );
  }
  return (
    <Button size="xl" className="rounded-full" disabled title="WhatsApp ordering link coming soon">
      <Upload className="w-4 h-4" />
      Print on WhatsApp
    </Button>
  );
}

/* ─── Marketing Navbar ──────────────────────────────────────────────────── */
function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={[
        'fixed top-0 inset-x-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-white/80 backdrop-blur-md border-b border-border/60 shadow-sm'
          : 'bg-transparent',
      ].join(' ')}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-semibold text-lg tracking-tight">
          <span className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Printer className="w-4 h-4 text-white" />
          </span>
          <span className={scrolled ? 'text-foreground' : 'text-white'}>PrintDrop</span>
        </Link>

        {/* Desktop links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {(['How it works', 'For Shops', 'Pricing'] as const).map(label => (
            <a
              key={label}
              href={`#${label.toLowerCase().replace(/ /g, '-')}`}
              className={[
                'transition-colors',
                scrolled ? 'text-muted-foreground hover:text-foreground' : 'text-white/80 hover:text-white',
              ].join(' ')}
            >
              {label}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className={[
              'text-sm font-medium transition-colors',
              scrolled ? 'text-muted-foreground hover:text-foreground' : 'text-white/80 hover:text-white',
            ].join(' ')}
          >
            Shopkeeper Login
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className={['md:hidden p-2 rounded-lg transition-colors', scrolled ? 'text-foreground' : 'text-white'].join(' ')}
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-white/95 backdrop-blur border-b border-border shadow-lg">
          <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-4">
            {['How it works', 'For Shops', 'Pricing'].map(label => (
              <a
                key={label}
                href={`#${label.toLowerCase().replace(/ /g, '-')}`}
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {label}
              </a>
            ))}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
              <Link href="/login" onClick={() => setOpen(false)}>
                <Button variant="outline" size="sm" className="w-full">Shopkeeper Login</Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#0f1629]">
      {/* Mesh gradient layers */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] -translate-y-1/2" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-blue-400/10 rounded-full blur-[100px] translate-y-1/3" />
        {/* Dot grid */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.3) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 lg:px-6 pt-24 pb-20 w-full">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left — copy */}
          <div className="animate-fade-in-up">
            <div className="inline-flex items-center gap-2 bg-white/10 text-white/70 text-xs font-medium rounded-full px-3 py-1.5 mb-6 border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Available in your city
            </div>

            <h1 className="font-serif italic text-5xl sm:text-6xl lg:text-[4.5rem] text-white leading-[1.08] tracking-tight mb-6">
              Print anything.<br />
              <span className="text-blue-300">Walk in.</span><br />
              Walk out.
            </h1>

            <p className="text-lg text-white/60 leading-relaxed mb-8 max-w-md">
              Send a PDF on WhatsApp. We handle the queue, the payment, and the token.
              No standing in line. No haggling over the price.
            </p>

            <div className="flex flex-wrap gap-3">
              <WhatsAppOrderButton />
              <Link href="/login">
                <Button size="xl" variant="ghost-white" className="rounded-full border border-white/20">
                  <Store className="w-4 h-4" />
                  Shopkeeper Login
                </Button>
              </Link>
            </div>
          </div>

          {/* Right — product mock */}
          <div className="animate-fade-in-up-delay-2 hidden lg:block">
            <HeroMock />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMock() {
  return (
    <div className="relative">
      {/* KDS card mock */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <span className="text-white/40 text-xs font-medium uppercase tracking-wider">Live Queue</span>
          <span className="flex items-center gap-1.5 text-green-400 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            3 active
          </span>
        </div>

        {/* Job cards */}
        {[
          { token: '042', status: 'Printing', file: 'Resume_Final.pdf', specs: '4 pages · B&W · A4', color: 'amber' },
          { token: '043', status: 'Queued',   file: 'Assignment_3.docx', specs: '12 pages · Color · A4', color: 'blue'  },
          { token: '044', status: 'Ready',    file: 'Passport_photo.jpg', specs: '1 page · Color · 4×6', color: 'green' },
        ].map(job => (
          <div
            key={job.token}
            className={[
              'flex items-center gap-3 rounded-xl p-3 mb-2 border',
              job.color === 'amber' ? 'bg-amber-500/10 border-amber-500/20' :
              job.color === 'green' ? 'bg-green-500/10 border-green-500/20' :
              'bg-blue-500/10 border-blue-500/20',
            ].join(' ')}
          >
            <span className={[
              'font-mono text-2xl font-bold tabular-nums w-12',
              job.color === 'amber' ? 'text-amber-300' :
              job.color === 'green' ? 'text-green-300' : 'text-blue-300',
            ].join(' ')}>
              {job.token}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-white/80 text-sm font-medium truncate">{job.file}</p>
              <p className="text-white/40 text-xs">{job.specs}</p>
            </div>
            <span className={[
              'text-xs font-semibold px-2 py-0.5 rounded-full',
              job.color === 'amber' ? 'bg-amber-500/20 text-amber-300' :
              job.color === 'green' ? 'bg-green-500/20 text-green-300' :
              'bg-blue-500/20 text-blue-300',
            ].join(' ')}>
              {job.status}
            </span>
          </div>
        ))}
      </div>

      {/* WhatsApp chat bubble */}
      <div className="absolute -bottom-6 -left-8 bg-[#25D366] text-white text-xs font-medium rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-xl max-w-[180px]">
        📎 Sent: marksheet.pdf
        <div className="text-[10px] text-white/70 mt-0.5">Tap to choose print options →</div>
      </div>
    </div>
  );
}

/* ─── Trust bar ─────────────────────────────────────────────────────────── */
function TrustBar() {
  return (
    <div className="border-y border-border bg-muted/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Trusted by print shops across India</span>
        <span className="hidden sm:block text-border">|</span>
        <span>✓ No setup fees</span>
        <span className="hidden sm:block text-border">|</span>
        <span>✓ Works on WhatsApp &amp; Telegram</span>
        <span className="hidden sm:block text-border">|</span>
        <span>✓ Razorpay-secured payments</span>
      </div>
    </div>
  );
}

/* ─── Before / After ────────────────────────────────────────────────────── */
function ProblemSolution() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-12">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">The Problem</p>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Getting something printed shouldn&apos;t<br className="hidden sm:block" /> take 20 minutes.
        </h2>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Before */}
        <div className="rounded-2xl border border-red-100 bg-red-50/50 p-7">
          <p className="text-xs font-semibold uppercase tracking-widest text-red-400 mb-5">Before PrintDrop</p>
          <ul className="space-y-3">
            {[
              'Wait at the counter while 3 people argue over copies',
              'Carry a USB drive or hope their email works',
              'No one knows how much it costs until the end',
              'Cash only. No bill. No receipt.',
              'Come back later — printer is busy',
            ].map(t => (
              <li key={t} className="flex gap-3 text-sm text-gray-700">
                <span className="mt-0.5 text-red-400">✕</span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* After */}
        <div className="rounded-2xl border border-green-100 bg-green-50/50 p-7">
          <p className="text-xs font-semibold uppercase tracking-widest text-green-600 mb-5">With PrintDrop</p>
          <ul className="space-y-3">
            {[
              'Send file on WhatsApp from wherever you are',
              'Pick options and pay in under 2 minutes',
              'See the price before you commit',
              'UPI / card / wallet. Instant receipt.',
              'Token in hand. Walk in when it\'s ready.',
            ].map(t => (
              <li key={t} className="flex gap-3 text-sm text-gray-700">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ─── How it works ──────────────────────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    {
      icon: <Upload className="w-6 h-6" />,
      step: '01',
      title: 'Send your file',
      desc: 'WhatsApp, Telegram, or upload here. PDF, Word, image — anything works.',
    },
    {
      icon: <Printer className="w-6 h-6" />,
      step: '02',
      title: 'Choose options',
      desc: 'Color or B&W. Single or double-sided. A4 or A3. Pick the nearest shop.',
    },
    {
      icon: <CreditCard className="w-6 h-6" />,
      step: '03',
      title: 'Pay online',
      desc: 'UPI, card, or wallet. The price is shown upfront — no surprises.',
    },
    {
      icon: <Ticket className="w-6 h-6" />,
      step: '04',
      title: 'Walk in with your token',
      desc: "You get a token number. The shop sees it. Hand it over and you're done.",
    },
  ];

  return (
    <section id="how-it-works" className="bg-muted/30 border-y border-border py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">How it works</p>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">Four steps. Two minutes.</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 relative">
          {/* Connecting line on desktop */}
          <div className="hidden lg:block absolute top-8 left-[12.5%] right-[12.5%] h-px bg-border" />

          {steps.map((s, i) => (
            <div key={i} className="relative flex flex-col items-start gap-4">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center ring-4 ring-background z-10 relative">
                  {s.icon}
                </div>
                <span className="absolute -top-2 -right-2 text-[10px] font-bold text-primary/50 font-mono">{s.step}</span>
              </div>
              <div>
                <h3 className="font-semibold text-base mb-1.5">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── For shopkeepers ───────────────────────────────────────────────────── */
function ForShops() {
  const perks = [
    { icon: <LayoutDashboard className="w-5 h-5" />, title: 'Live job queue', desc: 'Every order appears instantly. Token number, file, specs — everything on one screen.' },
    { icon: <Zap className="w-5 h-5" />, title: 'Auto-print mode', desc: 'Turn it on and jobs go straight to the printer. You just manage pickup.' },
    { icon: <TrendingUp className="w-5 h-5" />, title: 'Revenue dashboard', desc: 'Daily totals, hourly breakdown, per-job margins. Know your numbers.' },
  ];

  return (
    <section id="for-shops" className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
      <div className="grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">For shopkeepers</p>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5">
            Run your print shop<br />from one screen.
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-8">
            No more managing WhatsApp chats, cash payments, and a messy handwritten queue
            at the same time. PrintDrop puts it all in one place.
          </p>
          <ul className="space-y-5 mb-8">
            {perks.map(p => (
              <li key={p.title} className="flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  {p.icon}
                </div>
                <div>
                  <p className="font-semibold text-sm mb-0.5">{p.title}</p>
                  <p className="text-sm text-muted-foreground">{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/login">
            <Button size="lg" className="rounded-full">
              Already a partner? Sign in
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <p className="text-sm text-muted-foreground mt-3">
            Want to join? Contact us to onboard your shop.
          </p>
        </div>

        {/* Dashboard preview */}
        <div className="bg-muted/40 rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
            <span className="ml-2 text-xs text-muted-foreground font-mono">printdrop.app/dashboard</span>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Queued', n: '3', color: 'blue' },
                { label: 'Printing', n: '1', color: 'amber' },
                { label: 'Ready', n: '2', color: 'green' },
                { label: "Today's ₹", n: '840', color: 'purple' },
              ].map(s => (
                <div key={s.label} className={[
                  'rounded-xl p-2.5 text-center',
                  s.color === 'blue'   ? 'bg-blue-50 text-blue-700' :
                  s.color === 'amber'  ? 'bg-amber-50 text-amber-700' :
                  s.color === 'green'  ? 'bg-green-50 text-green-700' :
                  'bg-purple-50 text-purple-700',
                ].join(' ')}>
                  <p className="text-lg font-bold tabular-nums">{s.n}</p>
                  <p className="text-[10px] font-medium">{s.label}</p>
                </div>
              ))}
            </div>
            {[
              { token: '042', file: 'Resume.pdf', status: 'Printing', color: 'amber' },
              { token: '043', file: 'Report.docx', status: 'Queued', color: 'blue' },
              { token: '044', file: 'Photo.jpg', status: 'Ready', color: 'green' },
            ].map(j => (
              <div key={j.token} className={[
                'flex items-center gap-3 rounded-xl p-3 border',
                j.color === 'amber' ? 'bg-amber-50/60 border-amber-100' :
                j.color === 'green' ? 'bg-green-50/60 border-green-100' :
                'bg-blue-50/60 border-blue-100',
              ].join(' ')}>
                <span className="font-mono font-bold text-xl tabular-nums w-10">{j.token}</span>
                <span className="flex-1 text-sm truncate text-muted-foreground">{j.file}</span>
                <span className={[
                  'text-xs font-semibold px-2 py-0.5 rounded-full',
                  j.color === 'amber' ? 'bg-amber-100 text-amber-700' :
                  j.color === 'green' ? 'bg-green-100 text-green-700' :
                  'bg-blue-100 text-blue-700',
                ].join(' ')}>
                  {j.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Pricing ───────────────────────────────────────────────────────────── */
function Pricing() {
  return (
    <section id="pricing" className="bg-muted/30 border-y border-border py-20">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Pricing</p>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">Simple. No surprises.</h2>
        <p className="text-muted-foreground mb-10 max-w-md mx-auto">
          Shops join free. Customers pay the shop&apos;s print rate plus a small convenience fee that covers secure payments and delivery of the order.
        </p>

        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto text-left">
          <div className="bg-primary rounded-2xl p-7 text-white shadow-md">
            <p className="text-sm font-semibold text-white/60 mb-2">For shops</p>
            <p className="text-4xl font-bold tracking-tight mb-1">Free</p>
            <p className="text-sm text-white/60 mb-5">No setup fee. No monthly cost.</p>
            <ul className="space-y-2 text-sm text-white/80">
              {[
                'Live job queue dashboard',
                'Auto-print mode',
                'Revenue analytics',
                'WhatsApp + Telegram integration',
                'Online payments — no cash hassle',
              ].map(t => (
                <li key={t} className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-white/60 shrink-0 mt-0.5" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-background rounded-2xl border border-border p-7 shadow-sm">
            <p className="text-sm font-semibold text-muted-foreground mb-2">For customers</p>
            <p className="text-4xl font-bold tracking-tight mb-1">Print rate</p>
            <p className="text-sm text-muted-foreground mb-5">+ small convenience fee</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {[
                'Print from WhatsApp, Telegram, or web',
                'Secure online payment',
                'Real-time token tracking',
                'No account required to start',
              ].map(t => (
                <li key={t} className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground/70 mt-5 leading-relaxed">
              The convenience fee covers payment processing and platform operations. You always see the total before paying.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <div>
            <div className="flex items-center gap-2 font-semibold mb-4">
              <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <Printer className="w-3.5 h-3.5 text-white" />
              </span>
              PrintDrop
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Smart print shop automation for India.
            </p>
          </div>
          {[
            {
              heading: 'Product',
              items: [
                { label: 'How it works', href: '#how-it-works' },
                { label: 'For shops', href: '#for-shops' },
                { label: 'Pricing', href: '#pricing' },
              ],
            },
            {
              heading: 'Company',
              items: [
                { label: 'About', href: '/about' },
                { label: 'Contact', href: '/contact' },
              ],
            },
            {
              heading: 'Legal',
              items: [
                { label: 'Privacy Policy', href: '#' },
                { label: 'Terms of Service', href: '#' },
                { label: 'Refund Policy', href: '#' },
              ],
            },
          ].map(col => (
            <div key={col.heading}>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">{col.heading}</p>
              <ul className="space-y-2.5">
                {col.items.map(item => (
                  <li key={item.label}>
                    <Link href={item.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} PrintDrop. All rights reserved.</span>
          <span>Made with care for print shop owners.</span>
        </div>
      </div>
    </footer>
  );
}

/* ─── Authenticated views (unchanged logic) ─────────────────────────────── */
function AuthenticatedHome({ user }: { user: { role: string; name?: string | null; phone?: string | null } }) {
  const isAdmin      = user.role === 'admin';
  const isShopkeeper = user.role === 'shopkeeper';
  const dashHref     = isAdmin ? '/admin' : isShopkeeper ? '/dashboard' : '/print';

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-6 shadow-md">
          <Printer className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          {isShopkeeper ? 'Your shop dashboard' : isAdmin ? 'Admin panel' : 'Ready to print?'}
        </h1>
        <p className="text-muted-foreground mb-8">
          {isShopkeeper
            ? 'View your print queue, manage orders, and track revenue.'
            : isAdmin
            ? 'Manage shops, users, and all jobs across PrintDrop.'
            : 'Upload your file, choose a nearby shop, and pay online.'}
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link href={dashHref}>
            <Button size="lg" className="rounded-full">
              {isShopkeeper ? 'View Queue' : isAdmin ? 'Go to Admin' : 'Upload & Print'}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          {!isAdmin && !isShopkeeper && (
            <Link href="/profile">
              <Button size="lg" variant="outline" className="rounded-full">My Orders</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function Home() {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (user) return <AuthenticatedHome user={user} />;

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />
      <Hero />
      <TrustBar />
      <ProblemSolution />
      <HowItWorks />
      <ForShops />
      <Pricing />
      <Footer />
    </div>
  );
}
