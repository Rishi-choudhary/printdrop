'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { Navbar } from '@/components/navbar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      window.location.assign('/login');
    }
  }, [loading, user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  if (!user || user.role !== 'admin') {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
