'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Navbar } from '@/components/navbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'shopkeeper' && user.role !== 'admin'))) {
      window.location.assign('/login');
    }
  }, [loading, user]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
      Loading…
    </div>
  );

  if (!user || (user.role !== 'shopkeeper' && user.role !== 'admin')) {
    return null;
  }

  // KDS queue page is full-bleed — no navbar wrapper
  if (pathname === '/dashboard') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}
