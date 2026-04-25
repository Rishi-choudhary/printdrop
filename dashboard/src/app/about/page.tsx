import Link from 'next/link';
import { Printer, ArrowLeft, Zap, Heart, ShieldCheck, Users } from 'lucide-react';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About — PrintDrop',
  description: 'Learn how PrintDrop is modernising print shops across India.',
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Simple header */}
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
        {/* Hero */}
        <div className="mb-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">About</p>
          <h1 className="font-serif italic text-4xl sm:text-5xl text-foreground leading-[1.1] tracking-tight mb-6">
            We&apos;re fixing the<br />humble print shop.
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
            Walk into any print shop in India and you&apos;ll find the same scene: a queue, a USB drive argument,
            and a piece of paper with someone&apos;s price scrawled on it. PrintDrop is changing that —
            one shop at a time.
          </p>
        </div>

        {/* Story */}
        <div className="prose prose-gray max-w-none mb-16">
          <div className="grid md:grid-cols-2 gap-10">
            <div>
              <h2 className="text-xl font-semibold tracking-tight mb-3">The problem we saw</h2>
              <p className="text-muted-foreground leading-relaxed text-sm">
                Print shops are everywhere — colleges, hospitals, government offices, markets.
                They&apos;re essential. But they&apos;re stuck in 2005. Customers carry USB drives,
                shout across counters, and pay with whatever notes they have on them.
                Shop owners juggle files, cash, and a WhatsApp inbox full of send-me-your-file messages.
              </p>
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight mb-3">What we built</h2>
              <p className="text-muted-foreground leading-relaxed text-sm">
                A layer on top of what already works. Customers keep using WhatsApp —
                but now it routes to a structured queue, a payment link, and a token.
                Shop owners get a live dashboard on any screen, automatic job routing to
                their printer, and real-time revenue tracking.
              </p>
            </div>
          </div>
        </div>

        {/* Values */}
        <div className="mb-16">
          <h2 className="text-xl font-semibold tracking-tight mb-8">What we believe in</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                icon: <Zap className="w-5 h-5" />,
                title: 'Speed over ceremony',
                desc: 'A customer should be able to send a file and have a token in under two minutes. Anything slower is a failure.',
              },
              {
                icon: <Heart className="w-5 h-5" />,
                title: 'Built for India',
                desc: "UPI, WhatsApp, ₹ — not retrofitted. We design for how India actually pays and communicates.",
              },
              {
                icon: <ShieldCheck className="w-5 h-5" />,
                title: 'No surprises',
                desc: 'The price is shown before you pay. The platform fee is visible. No hidden charges, no fine print.',
              },
              {
                icon: <Users className="w-5 h-5" />,
                title: 'Shops first',
                desc: "We succeed only when shop owners succeed. The platform is free for shops by design — we grow when they grow.",
              },
            ].map(v => (
              <div key={v.title} className="flex gap-4 p-5 rounded-xl border border-border bg-muted/20">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  {v.icon}
                </div>
                <div>
                  <p className="font-semibold text-sm mb-1">{v.title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{v.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="rounded-2xl bg-primary p-8 text-white text-center">
          <h2 className="text-2xl font-semibold mb-3">Ready to print from the website?</h2>
          <p className="text-white/70 mb-6 text-sm max-w-md mx-auto">
            Upload your PDF, choose a nearby shop, pay online, and keep your token on this browser.
          </p>
          <Link
            href="/print"
            className="inline-flex items-center gap-2 bg-white text-primary px-6 py-3 rounded-full font-medium text-sm hover:bg-white/90 transition-colors"
          >
            Upload a PDF
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-20 py-8">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} PrintDrop. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
