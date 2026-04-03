'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  Printer, LogOut, LayoutDashboard, Settings, BarChart3,
  Shield, Users, Store, FileText, Menu, X, User, Plus,
} from 'lucide-react';

export function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  const isAdmin      = user.role === 'admin';
  const isShopkeeper = user.role === 'shopkeeper';
  const isCustomer   = !isAdmin && !isShopkeeper;

  const links: { href: string; label: string; icon: React.ReactNode; show: boolean }[] = [
    // Customer links
    { href: '/print',   label: 'New Print',   icon: <Plus className="w-4 h-4" />,            show: isCustomer },
    { href: '/profile',  label: 'My Orders',   icon: <FileText className="w-4 h-4" />,        show: isCustomer },

    // Shopkeeper links
    { href: '/dashboard',           label: 'Queue',     icon: <LayoutDashboard className="w-4 h-4" />, show: isShopkeeper || isAdmin },
    { href: '/dashboard/settings',  label: 'Settings',  icon: <Settings className="w-4 h-4" />,        show: isShopkeeper || isAdmin },
    { href: '/dashboard/analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" />,       show: isShopkeeper || isAdmin },

    // Admin links
    { href: '/admin',       label: 'Admin',  icon: <Shield className="w-4 h-4" />,  show: isAdmin },
    { href: '/admin/shops', label: 'Shops',  icon: <Store className="w-4 h-4" />,   show: isAdmin },
    { href: '/admin/users', label: 'Users',  icon: <Users className="w-4 h-4" />,   show: isAdmin },
    { href: '/admin/jobs',  label: 'Jobs',   icon: <FileText className="w-4 h-4" />,show: isAdmin },
  ];

  const visibleLinks = links.filter(l => l.show);

  const isActive = (href: string) => {
    if (href === '/dashboard' && pathname === '/dashboard') return true;
    if (href === '/admin' && pathname === '/admin') return true;
    if (href !== '/dashboard' && href !== '/admin' && pathname.startsWith(href)) return true;
    return false;
  };

  return (
    <nav className="bg-white border-b border-gray-200 relative z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14">
          {/* Left: Logo + desktop links */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 text-blue-600 font-bold text-lg shrink-0">
              <Printer className="w-5 h-5" />
              <span className="hidden sm:inline">PrintDrop</span>
            </Link>

            <div className="hidden md:flex items-center gap-0.5">
              {visibleLinks.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(link.href)
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {link.icon}
                  <span>{link.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Right: user info + mobile toggle */}
          <div className="flex items-center gap-3">
            {/* Customer: prominent Print CTA (desktop) */}
            {isCustomer && (
              <Link
                href="/print"
                className="hidden sm:flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                <Printer className="w-4 h-4" />
                Print a File
              </Link>
            )}

            {/* User badge */}
            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-500">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-gray-500" />
              </div>
              <span className="max-w-[120px] truncate">{user.name || user.phone}</span>
            </div>

            <button
              onClick={logout}
              className="hidden sm:flex text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-50"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 shadow-lg absolute inset-x-0 top-14 z-50">
          <div className="px-4 py-3 space-y-1">
            {visibleLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive(link.href)
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {link.icon}
                {link.label}
              </Link>
            ))}

            <div className="border-t border-gray-100 my-2" />

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm text-gray-500 truncate">{user.name || user.phone}</span>
              <button
                onClick={() => { setMobileOpen(false); logout(); }}
                className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-600 font-medium"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
