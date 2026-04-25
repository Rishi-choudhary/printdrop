'use client';

import { useState } from 'react';
import { useAdminUsers } from '@/lib/hooks';
import { api } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { encodePathSegment } from '@/lib/security';

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const { data, mutate } = useAdminUsers(search ? { search } : undefined);
  const { toast } = useToast();
  const [pendingChange, setPendingChange] = useState<{ userId: string; name: string; role: string } | null>(null);

  const changeRole = async (userId: string, role: string) => {
    try {
      await api.patch(`/admin/users/${encodePathSegment(userId)}`, { role });
      mutate();
      toast(`Role updated to ${role}`, 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to change role', 'error');
    }
    setPendingChange(null);
  };

  const handleRoleSelect = (userId: string, name: string, newRole: string, currentRole: string) => {
    if (newRole === currentRole) return;
    if (newRole === 'admin' || currentRole === 'admin') {
      setPendingChange({ userId, name: name || 'this user', role: newRole });
    } else {
      changeRole(userId, newRole);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Users</h1>

      <Input
        placeholder="Search by name, phone, or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Confirmation dialog */}
      {pendingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="font-bold text-lg mb-2">Confirm Role Change</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to change <strong>{pendingChange.name}</strong> to <strong>{pendingChange.role}</strong>?
              {pendingChange.role === 'admin' && (
                <span className="block mt-1 text-red-600 font-medium">Admins have full access to all shops, users, and jobs.</span>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setPendingChange(null)}>Cancel</Button>
              <Button variant={pendingChange.role === 'admin' ? 'danger' : 'primary'} size="sm"
                onClick={() => changeRole(pendingChange.userId, pendingChange.role)}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Jobs</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Joined</th>
                  <th className="px-4 py-3 text-right">Change Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data?.users || []).map((user: any) => (
                  <tr key={user.id}>
                    <td className="px-4 py-3 font-medium">{user.name || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono">{user.phone}</td>
                    <td className="px-4 py-3 text-xs">{user.email || '—'}</td>
                    <td className="px-4 py-3">{user._count?.jobs || 0}</td>
                    <td className="px-4 py-3"><Badge status={user.role} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleSelect(user.id, user.name, e.target.value, user.role)}
                        className="text-xs border rounded px-2 py-1"
                      >
                        <option value="customer">Customer</option>
                        <option value="shopkeeper">Shopkeeper</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && <p className="text-xs text-gray-400 px-4 py-2">Showing {data.users?.length || 0} of {data.total || 0} users</p>}
        </CardBody>
      </Card>
    </div>
  );
}
