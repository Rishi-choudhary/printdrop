'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  Printer, LogOut, LayoutDashboard, Settings, BarChart3,
  Shield, Users, Store, FileText, Menu, X, User, Plus, History,
} from 'lucide-react';

export function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  if (!user) return null;

  const isAdmin      = user.role === 'admin';
  const isShopkeeper = user.role === 'shopkeeper';
  const isCustomer   = !isAdmin && !isShopkeeper;

  const links: { href: string; label: string; icon: React.ReactNode; show: boolean }[] = [
    { href: '/print',               label: 'New Print',  icon: <Plus className="w-4 h-4" />,           show: isCustomer },
    { href: '/profile',             label: 'My Orders',  icon: <FileText className="w-4 h-4" />,        show: isCustomer },
    { href: '/register-shop',       label: 'Register',   icon: <Store className="w-4 h-4" />,           show: isCustomer },
    { href: '/dashboard',           label: 'Queue',      icon: <LayoutDashboard className="w-4 h-4" />, show: isShopkeeper || isAdmin },
    { href: '/dashboard/settings',  label: 'Settings',   icon: <Settings className="w-4 h-4" />,        show: isShopkeeper || isAdmin },
    { href: '/dashboard/analytics', label: 'Analytics',  icon: <BarChart3 className="w-4 h-4" />,       show: isShopkeeper || isAdmin },
    { href: '/dashboard/history',  label: 'History',    icon: <History className="w-4 h-4" />,          show: isShopkeeper },
    { href: '/admin',               label: 'Admin',      icon: <Shield className="w-4 h-4" />,          show: isAdmin },
    { href: '/admin/shops',         label: 'Shops',      icon: <Store className="w-4 h-4" />,           show: isAdmin },
    { href: '/admin/users',         label: 'Users',      icon: <Users className="w-4 h-4" />,           show: isAdmin },
    { href: '/admin/jobs',          label: 'History',    icon: <History className="w-4 h-4" />,         show: isAdmin },
  ];

  const visibleLinks = links.filter(l => l.show);

  const isActive = (href: string) => {
    if (href === '/dashboard' && pathname === '/dashboard') return true;
    if (href === '/admin' && pathname === '/admin') return true;
    if (href !== '/dashboard' && href !== '/admin' && pathname.startsWith(href)) return true;
    return false;
  };

  return (
    <nav
      className={[
        'sticky top-0 z-40 transition-all duration-200',
        scrolled
          ? 'bg-background/80 backdrop-blur-md border-b border-border/60 shadow-sm'
          : 'bg-background border-b border-border',
      ].join(' ')}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex justify-between h-14">
          {/* Logo + desktop nav */}
          <div className="flex items-center gap-5">
            <Link href="/" className="flex items-center gap-2 font-semibold text-[15px] shrink-0">
              <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <Printer className="w-3.5 h-3.5 text-white" />
              </span>
              <span className="hidden sm:inline text-foreground">PrintDrop</span>
            </Link>

            <div className="hidden md:flex items-center gap-0.5">
              {visibleLinks.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                    isActive(link.href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  ].join(' ')}
                >
                  {link.icon}
                  <span>{link.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            {isCustomer && (
              <Link
                href="/print"
                className="hidden sm:flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Print a file
              </Link>
            )}

            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                <User className="w-3.5 h-3.5" />
              </div>
              <span className="max-w-[110px] truncate text-xs">{user.name || user.phone}</span>
            </div>

            <button
              onClick={logout}
              className="hidden sm:flex items-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-accent transition-colors"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden bg-background/95 backdrop-blur border-t border-border shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-3 space-y-0.5">
            {visibleLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive(link.href)
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                ].join(' ')}
              >
                {link.icon}
                {link.label}
              </Link>
            ))}

            <div className="h-px bg-border my-2" />

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm text-muted-foreground truncate max-w-[160px]">{user.name || user.phone}</span>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 text-sm text-destructive hover:text-destructive/80 font-medium transition-colors"
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
