'use client';

import { useState } from 'react';
import { useAdminUsers } from '@/lib/hooks';
import { api } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const { data, mutate } = useAdminUsers(search ? { search } : undefined);

  const changeRole = async (userId: string, role: string) => {
    await api.patch(`/admin/users/${userId}`, { role });
    mutate();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Users</h1>

      <Input
        placeholder="Search by name, phone, or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

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
                        onChange={(e) => changeRole(user.id, e.target.value)}
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
