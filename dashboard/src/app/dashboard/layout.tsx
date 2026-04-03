'use client';

import { useAuth } from '@/lib/auth';
import { Navbar } from '@/components/navbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  if (!user || (user.role !== 'shopkeeper' && user.role !== 'admin')) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return null;
  }

  // KDS queue page gets full-bleed dark layout; other dashboard pages use the navbar + container
  const isQueuePage = typeof window !== 'undefined' && window.location.pathname === '/dashboard';

  if (isQueuePage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
