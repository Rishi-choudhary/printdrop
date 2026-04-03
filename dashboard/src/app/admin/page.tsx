'use client';

import { useAdminStats } from '@/lib/hooks';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Users, Store, FileText, IndianRupee, TrendingUp, Activity } from 'lucide-react';
import Link from 'next/link';

export default function AdminPage() {
  const { data: stats } = useAdminStats();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      {/* Platform Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Users" value={stats?.totalUsers || 0} icon={<Users className="w-6 h-6" />} />
        <StatCard label="Active Shops" value={stats?.activeShops || 0} icon={<Store className="w-6 h-6" />} />
        <StatCard label="Total Jobs" value={stats?.totalJobs || 0} icon={<FileText className="w-6 h-6" />} />
        <StatCard label="Jobs Today" value={stats?.todayJobs || 0} icon={<Activity className="w-6 h-6" />} />
        <StatCard label="Total Revenue" value={`₹${(stats?.totalRevenue || 0).toFixed(0)}`} icon={<IndianRupee className="w-6 h-6" />} />
        <StatCard label="Platform Earnings" value={`₹${(stats?.platformEarnings || 0).toFixed(0)}`} icon={<TrendingUp className="w-6 h-6" />} />
      </div>

      {/* Status Breakdown */}
      <Card>
        <CardHeader><h2 className="font-semibold">Jobs by Status</h2></CardHeader>
        <CardBody>
          {stats?.jobsByStatus ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(stats.jobsByStatus).map(([status, count]) => (
                <div key={status} className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold">{count as number}</p>
                  <p className="text-xs text-gray-500 capitalize">{status.replace(/_/g, ' ')}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Loading...</p>
          )}
        </CardBody>
      </Card>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { href: '/admin/shops', label: 'Manage Shops', icon: <Store className="w-5 h-5" />, desc: 'Add, edit, or deactivate shops' },
          { href: '/admin/users', label: 'Manage Users', icon: <Users className="w-5 h-5" />, desc: 'View users, change roles' },
          { href: '/admin/jobs', label: 'All Jobs', icon: <FileText className="w-5 h-5" />, desc: 'View and manage all print jobs' },
        ].map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="hover:border-blue-300 transition-colors cursor-pointer h-full">
              <CardBody className="flex items-start space-x-3">
                <div className="text-blue-600 mt-0.5">{link.icon}</div>
                <div>
                  <p className="font-medium">{link.label}</p>
                  <p className="text-xs text-gray-500">{link.desc}</p>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
