import { useEffect, useState } from 'react';
import AdminSidebar from '@/components/admin-sidebar';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiRequest } from '@/lib/queryClient';

export default function Adjustments() {
  const { user } = useAuth();
  const [adjs, setAdjs] = useState<any[]>([]);
  const [type, setType] = useState('discount_percent');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState('both');
  const [appliesToPeriod, setAppliesToPeriod] = useState(''); // YYYY-MM

  const load = () =>
    apiRequest('GET', `/api/admin/billing/adjustments/${user?.tenantId}`)
      .then((res) => res.json())
      .then(setAdjs);
  useEffect(()=>{ if(user?.tenantId) load(); }, [user]);

  const add = async () => {
    const body:any = { tenantId: user?.tenantId, type };
    if (type === 'discount_percent') body.valuePercent = parseInt(value || '0', 10);
    if (type === 'discount_fixed_cents') body.valueCents = parseInt(value || '0', 10);
    if (type === 'extra_free_minutes') {
      body.valueMinutes = parseInt(value || '0', 10);
      body.minuteScope = scope;
      body.appliesToPeriod = appliesToPeriod || undefined;
    }
    await apiRequest('POST', '/api/admin/billing/adjustments', body);
    setValue(''); setAppliesToPeriod(''); load();
  };

  const del = async (id:string) => {
    await apiRequest('DELETE', `/api/admin/billing/adjustments/${user?.tenantId}/${id}`);
    load();
  };

  return (
    <div className="flex">
      <AdminSidebar />
      <div className="ml-72 p-8 max-w-4xl w-full">
        <h1 className="text-2xl font-semibold mb-6">Rabatte & Freiminuten</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <Label>Typ</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="discount_percent">Rabatt (%)</SelectItem>
                <SelectItem value="discount_fixed_cents">Rabatt (Cent fix)</SelectItem>
                <SelectItem value="extra_free_minutes">Freiminuten (einmalig)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Wert</Label>
            <Input value={value} onChange={e=> setValue(e.target.value)} placeholder="z. B. 10 oder 500" />
          </div>
          {type === 'extra_free_minutes' && (
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="voice">Voice</SelectItem>
                  <SelectItem value="forwarding">Weiterleitung</SelectItem>
                  <SelectItem value="both">Beide</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {type === 'extra_free_minutes' && (
            <div className="space-y-2">
              <Label>Gilt für Monat (YYYY-MM)</Label>
              <Input value={appliesToPeriod} onChange={e=> setAppliesToPeriod(e.target.value)} placeholder="2025-09" />
            </div>
          )}
          <div><Button onClick={add}>Hinzufügen</Button></div>
        </div>

        <div className="mt-8">
          <h2 className="font-semibold mb-2">Aktive Anpassungen</h2>
          <div className="space-y-2">
            {adjs.map(a => (
              <div key={a.id} className="border rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm">{a.type}</div>
                  <div className="text-sm text-muted-foreground">
                    Wert: {a.valuePercent ?? a.valueCents ?? a.valueMinutes}
                    {a.minuteScope ? ` (${a.minuteScope})` : ''} {a.appliesToPeriod ? ` → ${a.appliesToPeriod}` : ''}
                  </div>
                </div>
                <Button variant="destructive" onClick={()=> del(a.id)}>Entfernen</Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
