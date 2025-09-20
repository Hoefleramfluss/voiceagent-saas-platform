#!/usr/bin/env bash
set -euo pipefail

say() { printf "\n\033[1;34m[patch]\033[0m %s\n" "$*"; }
warn() { printf "\n\033[1;33m[warn]\033[0m %s\n" "$*"; }
err() { printf "\n\033[1;31m[err]\033[0m %s\n" "$*"; }

# 1) Projekt-Root autodetect
find_root() {
  local d="$PWD"
  for _ in {1..6}; do
    if [ -f "$d/package.json" ] && [ -d "$d/server" ] && [ -d "$d/client" ]; then
      echo "$d"; return 0
    fi
    d="$(dirname "$d")"
  done
  echo "$PWD"
}
ROOT="$(find_root)"
say "Projekt-Root: $ROOT"

# 2) Ordner anlegen
mkdir -p "$ROOT/client/src/pages/admin"
mkdir -p "$ROOT/scripts"

# 3) Neue Admin-Seiten: adjustments, settings, retell-editor
say "Erzeuge Admin-Seiten…"

cat > "$ROOT/client/src/pages/admin/adjustments.tsx" <<'TSX'
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

  const load = ()=> apiRequest(`/api/admin/billing/adjustments/${user?.tenantId}`).then(r=>r.json()).then(setAdjs);
  useEffect(()=>{ if(user?.tenantId) load(); }, [user]);

  const add = async () => {
    const body:any = { tenantId: user?.tenantId, type };
    if (type === 'discount_percent') body.valuePercent = parseInt(value||'0',10);
    if (type === 'discount_fixed_cents') body.valueCents = parseInt(value||'0',10);
    if (type === 'extra_free_minutes') { body.valueMinutes = parseInt(value||'0',10); body.minuteScope = scope; body.appliesToPeriod = appliesToPeriod || undefined; }
    await apiRequest('/api/admin/billing/adjustments', { method: 'POST', body: JSON.stringify(body) });
    setValue(''); setAppliesToPeriod(''); load();
  };

  const del = async (id:string) => {
    await apiRequest(`/api/admin/billing/adjustments/${user?.tenantId}/${id}`, { method: 'DELETE' });
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
TSX

cat > "$ROOT/client/src/pages/admin/settings.tsx" <<'TSX'
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
      apiRequest(`/api/admin/email-templates/${user.tenantId}`).then(r=>r.json()).then((d)=> setTpl(d || { onboarding: {} })).catch(()=>{});
    }
  }, [user]);

  const save = async () => {
    await apiRequest(`/api/admin/email-templates/${tenantId}`, { method: 'PUT', body: JSON.stringify(tpl) });
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
TSX

cat > "$ROOT/client/src/pages/admin/retell-editor.tsx" <<'TSX'
import { useEffect, useState } from 'react';
import AdminSidebar from '@/components/admin-sidebar';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function RetellEditor() {
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [agentJson, setAgentJson] = useState<string>('');

  useEffect(()=>{ apiRequest('/api/retell/agents').then(r=>r.json()).then(setAgents); }, []);
  useEffect(()=>{ if(agentId){ apiRequest(`/api/retell/agent/${agentId}`).then(r=>r.json()).then(d=> setAgentJson(JSON.stringify(d, null, 2))); } }, [agentId]);

  const save = async () => {
    const body = JSON.parse(agentJson || '{}');
    await apiRequest(`/api/retell/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(body) });
    alert('Agent aktualisiert');
  };

  return (
    <div className="flex">
      <AdminSidebar />
      <div className="ml-72 p-8 max-w-5xl w-full">
        <h1 className="text-2xl font-semibold mb-4">Retell Agent Editor</h1>
        <div className="space-y-2 mb-4">
          <Label>Agent wählen</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger><SelectValue placeholder="Agent auswählen" /></SelectTrigger>
            <SelectContent>
              {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name || a.id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Agent JSON (Tools, Kalender, Trigger, etc.)</Label>
          <Textarea rows={24} value={agentJson} onChange={e=> setAgentJson(e.target.value)} />
        </div>
        <div className="mt-4"><Button onClick={save} disabled={!agentId}>Speichern</Button></div>
      </div>
    </div>
  );
}
TSX

say "Admin-Seiten angelegt."

# 4) Sidebar-Links ergänzen
SIDEBAR="$ROOT/client/src/components/admin-sidebar.tsx"
if [ -f "$SIDEBAR" ]; then
  node - <<'NODE' "$SIDEBAR"
const fs=require('fs'); const p=process.argv[2]; let s=fs.readFileSync(p,'utf8');
const add = (href,label)=>{
  if(!s.includes(href)){
    s=s.replace(/<\/nav>\s*$/m, `  <a href="${href}" className="block px-4 py-2 hover:bg-accent rounded-lg">${label}</a>\n</nav>`);
  }
};
add('/admin/settings','Einstellungen');
add('/admin/adjustments','Rabatte & Freiminuten');
add('/admin/retell-editor','Retell Editor');
fs.writeFileSync(p,s); console.log('Sidebar aktualisiert');
NODE
else warn "Sidebar nicht gefunden: $SIDEBAR (überspringe)."
fi

# 5) SQL-Migration-Datei erzeugen
cat > "$ROOT/scripts/db_migration_billing_adjustments.sql" <<'SQL'
DO $$ BEGIN
  CREATE TYPE billing_adjustment_type AS ENUM ('discount_percent','discount_fixed_cents','extra_free_minutes');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS billing_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  type billing_adjustment_type NOT NULL,
  value_percent INT,
  value_cents INT,
  value_minutes INT,
  minute_scope VARCHAR(20),
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  applies_to_period VARCHAR(7),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS email_templates JSONB;
SQL
say "SQL-Migration geschrieben: scripts/db_migration_billing_adjustments.sql"

# 6) .env.example erweitern
ENVEX="$ROOT/.env.example"
if [ -f "$ENVEX" ]; then
  add_env () { grep -q "^$1=" "$ENVEX" || echo "$1=$2" >> "$ENVEX"; }
  add_env STRIPE_SECRET_KEY sk_live_or_test
  add_env STRIPE_WEBHOOK_SECRET whsec_xxx
  add_env RETELL_API_KEY retell_xxx
  add_env TWILIO_ACCOUNT_SID ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  add_env TWILIO_AUTH_TOKEN xxxxxxxxxxxxxxxx
  add_env SENDGRID_API_KEY SG.xxxxxxxxxxxxxxxxxxxxx
  add_env SENDGRID_FROM_EMAIL billing@deine-domain.tld
  add_env FRONTEND_URL https://<dein-repl>.replit.app
  say ".env.example ergänzt."
else
  warn ".env.example nicht gefunden – überspringe."
fi

say "TEIL 1 fertig ✅"
