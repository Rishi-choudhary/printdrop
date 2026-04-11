'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, RefreshCw, CheckCircle, Printer, Plus, Pencil, Trash2, X } from 'lucide-react';

// ─── Printer types ────────────────────────────────────────────────────────────
interface ShopPrinter {
  id: string;
  shopId: string;
  name: string;
  systemName: string;
  isDefault: boolean;
  supportsColor: boolean;
  supportsDuplex: boolean;
  supportsA3: boolean;
  isOnline: boolean;
  lastSeen?: string;
}

const defaultPrinterForm = {
  name: '',
  systemName: '',
  isDefault: false,
  supportsColor: true,
  supportsDuplex: false,
  supportsA3: false,
};

// ─── Printers Section ─────────────────────────────────────────────────────────
function PrintersSection({ shopId }: { shopId: string }) {
  const [printers, setPrinters] = useState<ShopPrinter[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...defaultPrinterForm });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadPrinters = useCallback(async () => {
    try {
      const data = await api.get(`/printers/shop/${shopId}`);
      setPrinters(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  }, [shopId]);

  useEffect(() => {
    loadPrinters();
    const id = setInterval(loadPrinters, 10000);
    return () => clearInterval(id);
  }, [loadPrinters]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...defaultPrinterForm });
    setError('');
    setShowForm(true);
  };

  const openEdit = (p: ShopPrinter) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      systemName: p.systemName,
      isDefault: p.isDefault,
      supportsColor: p.supportsColor,
      supportsDuplex: p.supportsDuplex,
      supportsA3: p.supportsA3,
    });
    setError('');
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...defaultPrinterForm });
    setError('');
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.systemName.trim()) {
      setError('Name and System Printer Name are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.patch(`/printers/${editingId}`, form);
      } else {
        await api.post('/printers', { ...form, shopId });
      }
      await loadPrinters();
      cancelForm();
    } catch (e: any) {
      setError(e.message || 'Failed to save printer.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this printer? Jobs assigned to it will keep their printer name for records.')) return;
    setDeletingId(id);
    try {
      await api.delete(`/printers/${id}`);
      await loadPrinters();
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold">Printers</h2>
          </div>
          {!showForm && (
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Printer
            </button>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Printer list */}
        {printers.length === 0 && !showForm && (
          <p className="text-sm text-gray-400 text-center py-4">
            No printers configured yet. Add one to enable multi-printer routing.
          </p>
        )}

        {printers.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between p-3 rounded-xl border border-gray-200 bg-white gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Online dot */}
              <span
                title={p.isOnline ? 'Online' : 'Offline'}
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${p.isOnline ? 'bg-green-500' : 'bg-gray-300'}`}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-gray-800 truncate">{p.name}</span>
                  {p.isDefault && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 font-mono truncate">{p.systemName}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {p.supportsColor && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">Color</span>
                  )}
                  {p.supportsDuplex && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700">Duplex</span>
                  )}
                  {p.supportsA3 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 border border-green-200 text-green-700">A3</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => openEdit(p)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(p.id)}
                disabled={deletingId === p.id}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}

        {/* Add/Edit form */}
        {showForm && (
          <div className="border border-blue-200 rounded-xl p-4 bg-blue-50/50 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-700">{editingId ? 'Edit Printer' : 'Add Printer'}</h3>
              <button onClick={cancelForm} className="p-1 rounded hover:bg-gray-200 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <Input
              label="Friendly Name"
              placeholder="e.g. Epson Color, HP LaserJet"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />

            <div>
              <Input
                label="System Printer Name"
                placeholder="e.g. EPSON_L3150_Series"
                value={form.systemName}
                onChange={(e) => setForm({ ...form, systemName: e.target.value })}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Run <code className="bg-gray-100 px-1 rounded">lpstat -a</code> on your shop computer to find the system printer name (macOS/Linux).
                On Windows, use <code className="bg-gray-100 px-1 rounded">wmic printer get name</code>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              {[
                { key: 'isDefault',      label: 'Default printer' },
                { key: 'supportsColor',  label: 'Supports color' },
                { key: 'supportsDuplex', label: 'Supports duplex' },
                { key: 'supportsA3',     label: 'Supports A3' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!(form as any)[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Printer'}
              </Button>
              <Button variant="secondary" size="sm" onClick={cancelForm}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {printers.length > 0 && (
          <p className="text-[11px] text-gray-400 pt-1">
            Online status refreshes every 10 seconds when the print agent sends a heartbeat.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const shopId = user?.shop?.id;
  const [shop, setShop] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [rateError, setRateError] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (shopId) {
      api.get(`/shops/${shopId}`).then(setShop);
    }
  }, [shopId]);

  if (!shop) return <p className="text-center py-8 text-gray-500">Loading shop settings...</p>;

  const updateField = (key: string, value: any) => {
    setShop({ ...shop, [key]: value });
  };

  const saveDetails = async () => {
    setSaving(true);
    try {
      await api.patch(`/shops/${shopId}`, {
        name: shop.name,
        address: shop.address,
        opensAt: shop.opensAt,
        closesAt: shop.closesAt,
        closedDays: shop.closedDays,
        isActive: shop.isActive,
        autoPrint: shop.autoPrint,
      });
      setMsg('Settings saved!');
      setTimeout(() => setMsg(''), 3000);
    } finally {
      setSaving(false);
    }
  };

  const saveRates = async () => {
    const rateFields = [
      shop.ratesBwSingle, shop.ratesBwDouble,
      shop.ratesColorSingle, shop.ratesColorDouble,
      shop.bindingCharge, shop.spiralCharge,
    ];
    if (rateFields.some((v) => isNaN(v) || v < 0)) {
      setMsg('');
      setRateError('Rates cannot be negative');
      setTimeout(() => setRateError(''), 4000);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/shops/${shopId}/rates`, {
        ratesBwSingle: shop.ratesBwSingle,
        ratesBwDouble: shop.ratesBwDouble,
        ratesColorSingle: shop.ratesColorSingle,
        ratesColorDouble: shop.ratesColorDouble,
        bindingCharge: shop.bindingCharge,
        spiralCharge: shop.spiralCharge,
      });
      setMsg('Rates saved!');
      setTimeout(() => setMsg(''), 3000);
    } finally {
      setSaving(false);
    }
  };

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const closedDays: number[] = (() => {
    try { return JSON.parse(shop.closedDays || '[]'); } catch { return []; }
  })();

  const toggleDay = (day: number) => {
    const updated = closedDays.includes(day) ? closedDays.filter((d) => d !== day) : [...closedDays, day];
    updateField('closedDays', JSON.stringify(updated));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Shop Settings</h1>
      {msg && <div className="bg-green-50 text-green-700 px-4 py-2 rounded-lg text-sm">{msg}</div>}

      {/* Shop Details */}
      <Card>
        <CardHeader><h2 className="font-semibold">Shop Details</h2></CardHeader>
        <CardBody className="space-y-4">
          <Input label="Shop Name" value={shop.name} onChange={(e) => updateField('name', e.target.value)} />
          <Input label="Address" value={shop.address || ''} onChange={(e) => updateField('address', e.target.value)} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Opens At" type="time" value={shop.opensAt} onChange={(e) => updateField('opensAt', e.target.value)} />
            <Input label="Closes At" type="time" value={shop.closesAt} onChange={(e) => updateField('closesAt', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Closed Days</label>
            <div className="flex gap-2">
              {days.map((d, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className={`px-3 py-1.5 text-xs rounded-lg border ${closedDays.includes(i) ? 'bg-red-100 border-red-300 text-red-700' : 'bg-white border-gray-200 text-gray-600'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={shop.isActive}
                onChange={(e) => updateField('isActive', e.target.checked)}
                className="rounded border-gray-300"
              />
              <label className="text-sm">Shop is active (accepting orders)</label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={shop.autoPrint || false}
                onChange={(e) => updateField('autoPrint', e.target.checked)}
                className="rounded border-blue-500 text-blue-600"
              />
              <label className="text-sm font-medium text-blue-700">
                Auto-Print Mode — automatically send all paid jobs to the printer agent
              </label>
            </div>
          </div>
          <Button onClick={saveDetails} disabled={saving}>{saving ? 'Saving...' : 'Save Details'}</Button>
        </CardBody>
      </Card>

      {/* Rates */}
      <Card>
        <CardHeader><h2 className="font-semibold">Pricing</h2></CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="B&W Single-sided (₹/page)" type="number" step="0.5" min="0" value={shop.ratesBwSingle} onChange={(e) => updateField('ratesBwSingle', parseFloat(e.target.value))} />
            <Input label="B&W Double-sided (₹/page)" type="number" step="0.5" min="0" value={shop.ratesBwDouble} onChange={(e) => updateField('ratesBwDouble', parseFloat(e.target.value))} />
            <Input label="Color Single-sided (₹/page)" type="number" step="0.5" min="0" value={shop.ratesColorSingle} onChange={(e) => updateField('ratesColorSingle', parseFloat(e.target.value))} />
            <Input label="Color Double-sided (₹/page)" type="number" step="0.5" min="0" value={shop.ratesColorDouble} onChange={(e) => updateField('ratesColorDouble', parseFloat(e.target.value))} />
            <Input label="Staple Binding (₹)" type="number" step="1" min="0" value={shop.bindingCharge} onChange={(e) => updateField('bindingCharge', parseFloat(e.target.value))} />
            <Input label="Spiral Binding (₹)" type="number" step="1" min="0" value={shop.spiralCharge} onChange={(e) => updateField('spiralCharge', parseFloat(e.target.value))} />
          </div>
          {rateError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{rateError}</p>}
          <Button onClick={saveRates} disabled={saving}>{saving ? 'Saving...' : 'Save Rates'}</Button>
        </CardBody>
      </Card>

      {/* Agent Key */}
      <Card>
        <CardHeader><h2 className="font-semibold">Print Agent</h2></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-gray-500">
            Copy this key and set it as <code className="bg-gray-100 px-1 rounded">AGENT_KEY</code> on
            the machine where the print agent runs.
          </p>

          {shop.agentKey ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 block bg-gray-100 px-3 py-2 rounded text-sm font-mono break-all select-all">
                {shop.agentKey}
              </code>
              <button
                title="Copy key"
                onClick={() => {
                  navigator.clipboard.writeText(shop.agentKey);
                  setKeyCopied(true);
                  setTimeout(() => setKeyCopied(false), 2000);
                }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors"
              >
                {keyCopied ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded">
              No agent key yet. Click Generate to create one.
            </p>
          )}

          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1 text-gray-600">
            <p className="font-medium text-gray-800 mb-2">Setup on the shop machine:</p>
            <code className="block text-xs bg-white border border-gray-200 rounded px-3 py-2 font-mono">
              AGENT_KEY={shop.agentKey || 'your_key_here'} node src/index.js
            </code>
          </div>

          <Button
            variant="secondary"
            size="sm"
            disabled={regenerating}
            onClick={async () => {
              if (shop.agentKey && !confirm('Regenerating will invalidate the current key. Continue?')) return;
              setRegenerating(true);
              try {
                const data = await api.post(`/shops/${shopId}/agent-key`, {});
                setShop({ ...shop, agentKey: data.agentKey });
                setMsg('New agent key generated!');
                setTimeout(() => setMsg(''), 3000);
              } finally {
                setRegenerating(false);
              }
            }}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${regenerating ? 'animate-spin' : ''}`} />
            {shop.agentKey ? 'Regenerate Key' : 'Generate Key'}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
