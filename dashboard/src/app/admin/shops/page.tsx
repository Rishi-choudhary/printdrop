'use client';

import { useState } from 'react';
import { useAdminShops } from '@/lib/hooks';
import { api } from '@/lib/api';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Store, Plus, Power, MapPin, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

export default function AdminShopsPage() {
  const { data: shops, mutate, error } = useAdminShops();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', address: '', ownerPhone: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleActive = async (shopId: string, isActive: boolean) => {
    try {
      await api.patch(`/admin/shops/${shopId}`, { isActive: !isActive });
      mutate();
    } catch (err: any) {
      toast(err.message || 'Action failed', 'error');
    }
  };

  const toggleAutoPrint = async (shopId: string, autoPrint: boolean) => {
    try {
      await api.patch(`/admin/shops/${shopId}`, { autoPrint: !autoPrint });
      mutate();
    } catch (err: any) {
      toast(err.message || 'Action failed', 'error');
    }
  };

  const addShop = async () => {
    setFormError('');
    setSaving(true);
    try {
      const fullShopPhone = form.phone.startsWith('+') ? form.phone : `+91${form.phone}`;
      const fullOwnerPhone = form.ownerPhone.startsWith('+') ? form.ownerPhone : `+91${form.ownerPhone}`;

      // Look up owner in existing users
      const usersData = await api.get<{ users: any[]; total: number }>(`/admin/users?search=${form.ownerPhone}`);
      let owner = usersData.users?.find((u: any) => u.phone === fullOwnerPhone || u.phone.includes(form.ownerPhone));

      if (!owner) {
        setFormError(`No user found with phone ${fullOwnerPhone}. They must login first via the bot or dashboard.`);
        setSaving(false);
        return;
      }

      await api.post('/shops', {
        name: form.name,
        phone: fullShopPhone,
        address: form.address,
        ownerId: owner.id,
      });

      setShowAdd(false);
      setForm({ name: '', phone: '', address: '', ownerPhone: '' });
      mutate();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Shops</h1>
        <Card>
          <CardBody>
            <p className="text-red-600">Failed to load shops: {error.message}</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => mutate()}>Retry</Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Shops</h1>
        <Button onClick={() => setShowAdd(!showAdd)}>
          <Plus className="w-4 h-4 mr-1.5" />
          {showAdd ? 'Cancel' : 'Add Shop'}
        </Button>
      </div>

      {showAdd && (
        <Card className="border-blue-200">
          <CardHeader><h2 className="font-semibold text-sm">New Shop</h2></CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Shop Name" placeholder="Sharma Print & Xerox" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="Shop Phone" placeholder="9876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <Input label="Address" placeholder="Near IIT Gate, New Delhi" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              <Input label="Owner Phone (must be registered)" placeholder="9876543210" value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} />
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <Button onClick={addShop} disabled={saving || !form.name || !form.phone || !form.ownerPhone}>
              {saving ? 'Creating...' : 'Create Shop'}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Shop Cards */}
      {!shops ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardBody><div className="h-24 bg-gray-100 rounded" /></CardBody>
            </Card>
          ))}
        </div>
      ) : shops.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <Store className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No shops yet. Add your first shop above.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(shops as any[]).map((shop: any) => (
            <Card key={shop.id} className={`transition-all ${shop.isActive ? 'border-green-200' : 'border-gray-200 opacity-70'}`}>
              <CardBody>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">{shop.name}</h3>
                    <div className="flex items-center text-xs text-gray-500 mt-1">
                      <MapPin className="w-3 h-3 mr-1" />
                      {shop.address || 'No address'}
                    </div>
                  </div>
                  <Badge status={shop.isActive ? 'active' : 'inactive'} />
                </div>

                <div className="text-xs text-gray-500 space-y-1 mb-4">
                  <div className="flex items-center"><Clock className="w-3 h-3 mr-1" /> {shop.opensAt} - {shop.closesAt}</div>
                  <div>Owner: {shop.owner?.name || shop.owner?.phone || '—'}</div>
                  <div>Jobs: {shop._count?.jobs || 0} total</div>
                  <div>B&W: ₹{shop.ratesBwSingle}/pg | Color: ₹{shop.ratesColorSingle}/pg</div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant={shop.isActive ? 'danger' : 'success'}
                    size="sm"
                    onClick={() => toggleActive(shop.id, shop.isActive)}
                  >
                    <Power className="w-3.5 h-3.5 mr-1" />
                    {shop.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    variant={shop.autoPrint ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => toggleAutoPrint(shop.id, shop.autoPrint)}
                  >
                    {shop.autoPrint ? 'Auto-Print ON' : 'Auto-Print OFF'}
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
