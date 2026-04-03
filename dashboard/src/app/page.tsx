'use client';

import Link from 'next/link';
import { Printer, MessageCircle, CreditCard, Ticket, Upload, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/navbar';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { user, loading } = useAuth();

  const isAdmin      = user?.role === 'admin';
  const isShopkeeper = user?.role === 'shopkeeper';
  const isCustomer   = user && !isAdmin && !isShopkeeper;

  // Role-based redirect destination
  const dashHref = isAdmin ? '/admin' : isShopkeeper ? '/dashboard' : '/print';

  return (
    <div className="min-h-screen">
      {user && <Navbar />}

      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white">
        <div className="max-w-5xl mx-auto px-4 py-16 sm:py-20 text-center">
          {!user && (
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center">
                <Printer className="w-9 h-9" />
              </div>
            </div>
          )}
          <h1 className="text-3xl sm:text-5xl font-bold mb-4">
            {isCustomer ? 'Ready to print?' : isShopkeeper ? 'Your shop dashboard' : 'PrintDrop'}
          </h1>
          <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
            {isCustomer
              ? 'Upload your file, choose a nearby shop, pay online, and pick up with a token. No waiting.'
              : isShopkeeper
                ? 'View your print queue, manage orders, and track revenue.'
                : 'Skip the queue. Send your file via WhatsApp, Telegram, or the web — pay online and pick up with a token.'}
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            {!user && !loading && (
              <Link href="/login">
                <Button size="lg" variant="white" className="rounded-xl px-6">
                  Get Started
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            )}

            {isCustomer && (
              <Link href="/print">
                <Button size="lg" variant="white" className="rounded-xl px-6">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload & Print
                </Button>
              </Link>
            )}

            {(isShopkeeper || isAdmin) && (
              <Link href={dashHref}>
                <Button size="lg" variant="white" className="rounded-xl px-6">
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            )}

            {isCustomer && (
              <Link href="/profile">
                <Button size="lg" variant="ghost-white" className="rounded-xl px-6">
                  My Orders
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* How it works — only show to non-logged-in or customers */}
      {(!user || isCustomer) && (
        <div className="max-w-5xl mx-auto px-4 py-14">
          <h2 className="text-2xl font-bold text-center mb-10">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: <Upload className="w-7 h-7" />,        title: 'Upload File',         desc: 'Upload a PDF, image, or document — from the web, WhatsApp, or Telegram.' },
              { icon: <Printer className="w-7 h-7" />,       title: 'Choose Options',      desc: 'Pick color/BW, copies, paper size, sides, and select a nearby shop.' },
              { icon: <CreditCard className="w-7 h-7" />,    title: 'Pay Online',          desc: 'Pay securely via UPI, card, or wallet. Instant confirmation.' },
              { icon: <Ticket className="w-7 h-7" />,        title: 'Pick Up with Token',  desc: 'Get a token number. Walk in, show the token, grab your prints.' },
            ].map((step, i) => (
              <div key={i} className="text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 mb-4">
                  {step.icon}
                </div>
                <h3 className="font-semibold mb-1.5">{step.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>

          {/* Bottom CTA for non-logged-in */}
          {!user && !loading && (
            <div className="text-center mt-10">
              <Link href="/login">
                <Button size="lg" className="rounded-xl px-8">
                  Start Printing
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
