import { useState, useEffect } from 'react';
import AdminSidebar from '@/components/admin-sidebar';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';

export default function AdminSettings() {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<string>('');
  const [tpl, setTpl] = useState<any>({ onboarding: { subject: '', html: '', text: '' }});

  useEffect(()=>{
    if (user?.tenantId) {
      setTenantId(user.tenantId);
      apiRequest('GET', `/api/admin/email-templates/${user.tenantId}`)
        .then((res) => res.json())
        .then((d) => setTpl(d || { onboarding: {} }))
        .catch(() => {});
    }
  }, [user]);

  const save = async () => {
    await apiRequest('PUT', `/api/admin/email-templates/${tenantId}`, tpl);
    alert('Templates gespeichert');
  };

  return (
    <div className="flex">
      <AdminSidebar />
      <div className="ml-72 p-8 space-y-6 max-w-3xl">
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <p className="text-muted-foreground">
          Checkout/Onboarding-Mail bearbeiten. Platzhalter: <code>{'{TENANT_NAME}'}</code>, <code>{'{CHECKOUT_URL}'}</code>, <code>{'{PLAN_NAME}'}</code>
        </p>

        <div className="space-y-2">
          <Label>Betreff</Label>
          <Input value={tpl?.onboarding?.subject || ''} onChange={e=> setTpl({ ...tpl, onboarding: { ...(tpl.onboarding||{}), subject: e.target.value }})} />
        </div>
        <div className="space-y-2">
          <Label>Text (Plain)</Label>
          <Textarea rows={6} value={tpl?.onboarding?.text || ''} onChange={e=> setTpl({ ...tpl, onboarding: { ...(tpl.onboarding||{}), text: e.target.value }})}/>
        </div>
        <div className="space-y-2">
          <Label>HTML</Label>
          <Textarea rows={12} value={tpl?.onboarding?.html || ''} onChange={e=> setTpl({ ...tpl, onboarding: { ...(tpl.onboarding||{}), html: e.target.value }})}/>
        </div>

        <div className="flex gap-3">
          <Button onClick={save}>Speichern</Button>
        </div>
      </div>
    </div>
  );
}
