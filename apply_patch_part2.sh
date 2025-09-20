#!/usr/bin/env bash
set -euo pipefail
say() { printf "\n\033[1;34m[patch]\033[0m %s\n" "$*"; }
warn() { printf "\n\033[1;33m[warn]\033[0m %s\n" "$*"; }

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

# kleine Helper zum Patchen mit Node (robuster als sed)
patch_file() {
  local file="$1"; shift
  node - "$file" "$@" <<'NODE'
const fs=require('fs'); const path=process.argv[2]; let s=fs.readFileSync(path,'utf8');
for(let i=3;i<process.argv.length;i++){
  const [pat,rep]=process.argv[i].split(':::');
  const re=new RegExp(pat,'s');
  if(re.test(s)){ s=s.replace(re, rep); console.log('patched:',pat); }
  else { console.log('no-match:',pat); }
}
fs.writeFileSync(path,s);
NODE
}

# 1) retell-api.ts → listAgents + getRetellKey import
RETELL="$ROOT/server/retell-api.ts"
if [ -f "$RETELL" ]; then
  grep -q "getRetellKey" "$RETELL" || sed -i'' -e '1i import { getRetellKey } from "./key-loader";' "$RETELL"
  if ! grep -q "listAgents" "$RETELL"; then
cat >> "$RETELL" <<'TS'
export const retellApi = Object.assign({}, (typeof retellApi!=="undefined"?retellApi:{}), {
  async listAgents() {
    const key = await getRetellKey();
    if (!key) throw new Error("RETELL_API_KEY missing");
    const resp = await fetch("https://api.retellai.com/v1/agents", { headers: { Authorization: `Bearer ${key}` } } );
    if (!resp.ok) throw new Error(`Retell list agents failed: ${resp.status}`);
    return await resp.json();
  }
});
TS
  fi
  say "retell-api.ts OK"
else warn "retell-api.ts nicht gefunden – überspringe."
fi

# 2) key-loader.ts → getRetellKey
KEY="$ROOT/server/key-loader.ts"
if [ -f "$KEY" ] && ! grep -q "export async function getRetellKey" "$KEY"; then
cat >> "$KEY" <<'TS'
export async function getRetellKey(): Promise<string | null> {
  const dbKey = await keyLoader.getApiKey('retell');
  if (dbKey) return dbKey;
  if (process.env.RETELL_API_KEY) return process.env.RETELL_API_KEY;
  return null;
}
TS
  say "key-loader.ts erweitert"
fi

# 3) twilio-service.ts → fetchForwardingMinutes + importForwardingForTenantPeriod
TWI="$ROOT/server/twilio-service.ts"
if [ -f "$TWI" ]; then
  grep -q 'from "./storage"' "$TWI" || sed -i'' -e '1i import { storage } from "./storage";' "$TWI"
  if ! grep -q "fetchForwardingMinutes" "$TWI"; then
cat >> "$TWI" <<'TS'

// Summe der weitergeleiteten Minuten für eine Nummer im Zeitraum
export async function fetchForwardingMinutes(options: { numberSid: string; periodStart: Date; periodEnd: Date }): Promise<{ totalSeconds: number; calls: any[] }> {
  // @ts-ignore
  const client = await this.getTwilioClient ? this.getTwilioClient() : (await (await import('twilio')).default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN));
  const calls = await client.calls.list({ startTimeAfter: options.periodStart, endTimeBefore: options.periodEnd, status: 'completed', limit: 500 });
  const related = calls.filter((c: any) => c.phoneNumberSid === options.numberSid);
  const totalSeconds = related.reduce((s: number, c: any) => s + (c.duration ? parseInt(c.duration) : 0), 0);
  return { totalSeconds, calls: related };
}

// Monatsimport (idempotent) für alle zugeordneten Nummern eines Tenants
export async function importForwardingForTenantPeriod(tenantId: string, periodStart: Date, periodEnd: Date): Promise<{ minutes: number }> {
  const mappings = await storage.getPhoneNumberMappings(tenantId);
  let totalSec = 0;
  for (const m of mappings) {
    if (!m.numberSid) continue;
    const res = await fetchForwardingMinutes({ numberSid: m.numberSid, periodStart, periodEnd });
    totalSec += res.totalSeconds;
  }
  const periodKey = periodStart.toISOString().slice(0,7);
  const events = await storage.getUsageEvents(tenantId, { periodStart, periodEnd });
  for (const ev of events) {
    if (ev.kind === 'forwarding_minute' && ev.metadata?.source === 'twilio_import' && ev.metadata?.period === periodKey) {
      await storage.deleteUsageEvent(ev.id);
    }
  }
  const minutes = Math.round(totalSec/60);
  const bots = await storage.getBots(tenantId);
  const botId = bots[0]?.id;
  if (minutes > 0 && botId) {
    await storage.createUsageEvent({
      tenantId, botId, kind: 'forwarding_minute' as any, quantity: minutes as any,
      metadata: { source: 'twilio_import', period: periodKey }, timestamp: new Date()
    });
  }
  return { minutes };
}
TS
  fi
  say "twilio-service.ts OK"
else warn "twilio-service.ts nicht gefunden – überspringe."
fi

# 4) storage.ts – fehlende Methoden (EmailTemplates/Adjustments/deleteUsageEvent)
STO="$ROOT/server/storage.ts"
if [ -f "$STO" ]; then
  # Import der Tabelle billingAdjustments im Zweifelsfall ergänzen
  grep -q "billingAdjustments" "$STO" || sed -i'' -e "1,/from/s/from \"..\/shared\/schema\";/from \"..\/shared\/schema\";\nimport { billingAdjustments } from \"..\/shared\/schema\";/" "$STO" || true

  # Methoden am Ende ins storage-Objekt injizieren
  node - "$STO" <<'NODE'
const fs=require('fs'); const p=process.argv[1]; let s=fs.readFileSync(p,'utf8');
const anchor = s.lastIndexOf('export const storage');
if(anchor<0){ console.log('WARN no storage export found'); process.exit(0); }
if(!/getBillingAdjustments\s*\(/.test(s)){
  s = s.replace(/export const storage\s*=\s*\{/, `export const storage = {\n  async getBillingAdjustments(tenantId, period){ const rows = await db.select().from(billingAdjustments).where(eq(billingAdjustments.tenantId, tenantId)); if(!period) return rows; const from=period.from.getTime(), to=period.to.getTime(); return rows.filter(a=>{ const ef=a.effectiveFrom?new Date(a.effectiveFrom).getTime():-Infinity; const et=a.effectiveTo?new Date(a.effectiveTo).getTime():Infinity; return et>=from && ef<=to; }); },\n  async createBillingAdjustment(adj){ const [row]=await db.insert(billingAdjustments).values({ tenantId: adj.tenantId, type: adj.type, valuePercent: adj.valuePercent ?? null, valueCents: adj.valueCents ?? null, valueMinutes: adj.valueMinutes ?? null, minuteScope: adj.minuteScope ?? null, effectiveFrom: adj.effectiveFrom ?? null, effectiveTo: adj.effectiveTo ?? null, appliesToPeriod: adj.appliesToPeriod ?? null }).returning(); return row; },\n  async deleteBillingAdjustment(id, tenantId){ await db.delete(billingAdjustments).where(and(eq(billingAdjustments.id,id), eq(billingAdjustments.tenantId,tenantId))); },\n  async getEmailTemplates(tenantId){ const [row]=await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)); return row?.emailTemplates ?? null; },\n  async updateEmailTemplates(tenantId, templates){ const now=new Date(); const [existing]=await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)); if(existing){ await db.update(tenantSettings).set({ emailTemplates: templates, updatedAt: now }).where(eq(tenantSettings.tenantId, tenantId)); } else { await db.insert(tenantSettings).values({ tenantId, emailTemplates: templates, createdAt: now, updatedAt: now }); } },\n  async deleteUsageEvent(id){ await db.delete(usageEvents).where(eq(usageEvents.id,id)); },`);
}
fs.writeFileSync(p,s);
console.log('storage.ts OK');
NODE
else warn "storage.ts nicht gefunden – überspringe."
fi

# 5) enhanced-billing-calculator.ts – extra Freiminuten berücksichtigen
CALC="$ROOT/server/enhanced-billing-calculator.ts"
if [ -f "$CALC" ]; then
  node - "$CALC" <<'NODE'
const fs=require('fs'); const p=process.argv[1]; let s=fs.readFileSync(p,'utf8'); let changed=false;
if(!s.includes('extraVoiceFree')){
  s=s.replace(/if\s*\(plan\)\s*\{/, `if (plan) {\n      const adjustments = await storage.getBillingAdjustments(tenantId, { from: periodStart, to: periodEnd });\n      let extraVoiceFree = 0, extraFwdFree = 0;\n      for (const a of adjustments) {\n        if (a.type === 'extra_free_minutes') {\n          if (a.minuteScope === 'voice') extraVoiceFree += a.valueMinutes || 0;\n          else if (a.minuteScope === 'forwarding') extraFwdFree += a.valueMinutes || 0;\n          else { extraVoiceFree += a.valueMinutes || 0; extraFwdFree += a.valueMinutes || 0; }\n        }\n      }\n`);
  changed=true;
}
s=s.replace(/const freeVoiceMinutes = .*?;/, 'const freeVoiceMinutes = (plan.freeVoiceBotMinutes || 0) + (extraVoiceFree || 0);');
s=s.replace(/const freeForwardingMinutes = .*?;/, 'const freeForwardingMinutes = (plan.freeForwardingMinutes || 0) + (extraFwdFree || 0);');
if(changed) fs.writeFileSync(p,s);
console.log('enhanced-billing-calculator.ts OK');
NODE
else warn "enhanced-billing-calculator.ts nicht gefunden – überspringe."
fi

# 6) stripe-invoice-service.ts – Rabatt als negative InvoiceItems
INV="$ROOT/server/stripe-invoice-service.ts"
if [ -f "$INV" ]; then
  node - "$INV" <<'NODE'
const fs=require('fs'); const p=process.argv[1]; let s=fs.readFileSync(p,'utf8');
if(!s.includes('APPLY_DISCOUNTS')){
  s=s.replace(/\/\/ Create payment intent/,'// APPLY_DISCOUNTS\n      const adjustments = await storage.getBillingAdjustments(tenantId, { from: periodStart, to: periodEnd });\n      const totalBefore = lineItems.reduce((s, li) => s + li.totalAmountCents, 0);\n      let discountCents = 0;\n      for (const a of adjustments) {\n        if (a.type === "discount_percent" && a.valuePercent) discountCents += Math.round(totalBefore * (a.valuePercent / 100));\n        else if (a.type === "discount_fixed_cents" && a.valueCents) discountCents += a.valueCents;\n      }\n      if (discountCents > 0) {\n        const itemIdempotencyKey = this.generateIdempotencyKey("invoice_item_discount", tenantId, periodStart.toISOString(), periodEnd.toISOString());\n        const discountItem = await stripe.invoiceItems.create({ customer: billingAccount.stripeCustomerId, currency: "eur", amount: -1 * discountCents, description: `Rabatt für ${periodStart.toISOString().slice(0,7)}` }, { idempotencyKey: itemIdempotencyKey });\n        invoiceItems.push(discountItem);\n      }\n\n      // Create payment intent');
  fs.writeFileSync(p,s);
}
console.log('stripe-invoice-service.ts OK');
NODE
else warn "stripe-invoice-service.ts nicht gefunden – überspringe."
fi

# 7) background-jobs.ts – Monatsletzter-Abrechnung (Europe/Vienna)
JOB="$ROOT/server/background-jobs.ts"
if [ -f "$JOB" ]; then
  if ! grep -q "MONTHLY_BILLING" "$JOB"; then
cat >> "$JOB" <<'TS'

// MONTHLY_BILLING: jeden Tag 23:55 prüfen -> wenn morgen neuer Monat, Monatsabschluss starten
const monthlyCheck = new CronJob('0 55 23 * * *', async () => {
  try {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24*60*60*1000);
    const isMonthEnd = now.getMonth() !== tomorrow.getMonth();
    if (!isMonthEnd) return;

    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const periodEnd = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59);
    const tenants = await storage.getTenants();

    for (const t of tenants) {
      try {
        const twilio = await import('./twilio-service');
        await twilio.importForwardingForTenantPeriod(t.id, periodStart, periodEnd);
      } catch (e) { console.error('[Monthly Billing] Twilio import failed for', t.id, e); }

      try {
        await stripeInvoiceService.generateMonthlyInvoice(t.id, periodStart, periodEnd);
      } catch (e) { console.error('[Monthly Billing] Invoice failed for', t.id, e); }
    }
    console.log('[Monthly Billing] Completed for', tenants.length, 'tenants');
  } catch (e) { console.error('[Monthly Billing] Error', e); }
}, null, true, 'Europe/Vienna');
monthlyCheck.start();
TS
  fi
  say "background-jobs.ts OK"
else warn "background-jobs.ts nicht gefunden – überspringe."
fi

# 8) routes.ts – Endpunkte: Checkout, Monthly run, Adjustments, Retell list, Twilio import
ROUTES="$ROOT/server/routes.ts"
if [ -f "$ROUTES" ]; then
  grep -q "getStripeKey" "$ROUTES" || sed -i'' -e '1,/Stripe/s/import Stripe from "stripe";/import Stripe from "stripe";\nimport { getStripeKey } from ".\/key-loader";/' "$ROUTES" || true

  # Checkout endpoint
  if ! grep -q '/api/customers/:id/stripe/checkout' "$ROUTES"; then
cat >> "$ROUTES" <<'TS'
app.post("/api/customers/:id/stripe/checkout", requireAuth, requireRole(['platform_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { planId, successUrl, cancelUrl } = req.body as { planId: string; successUrl?: string; cancelUrl?: string };
    if (!planId) return res.status(400).json({ message: "planId required" });

    const tenant = await storage.getTenant(id);
    if (!tenant) return res.status(404).json({ message: "Customer not found" });

    const plan = await storage.getSubscriptionPlan(planId);
    if (!plan || plan.status !== 'active') return res.status(404).json({ message: "Subscription plan not found or inactive" });
    if (!plan.stripePriceId) return res.status(400).json({ message: "stripePriceId missing (monthly price)" });

    const stripeKey = await getStripeKey();
    if (!stripeKey) return res.status(500).json({ message: "Stripe not configured" });
    const StripeLib = (await import('stripe')).default;
    const stripe = new StripeLib(stripeKey, { apiVersion: '2023-10-16' });

    let stripeCustomerId = tenant.stripeCustomerId;
    if (!stripeCustomerId) {
      const sc = await stripe.customers.create({ name: tenant.name, email: tenant.email, metadata: { tenant_id: tenant.id } });
      stripeCustomerId = sc.id;
      await storage.updateTenant(tenant.id, { stripeCustomerId });
    }

    const baseUrl = process.env.FRONTEND_URL || (req.headers.origin as string) || 'https://localhost:5000';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [ { price: plan.stripePriceId, quantity: 1 } ],
      success_url: successUrl || baseUrl + "/admin/customers?checkout=success",
      cancel_url: cancelUrl || baseUrl + "/admin/customers?checkout=cancel",
      allow_promotion_codes: false,
      subscription_data: {
        metadata: { tenant_id: tenant.id, plan_id: plan.id, min_term_months: '12' }
      }
    }, { idempotencyKey: `${tenant.id}:${plan.id}:checkout` });

    await storage.updateTenantSubscription(tenant.id, { planId: plan.id, subscriptionStatus: 'pending', startDate: new Date() });

    const { EmailService } = await import('./email-service');
    const svc = new EmailService();
    await svc.sendCheckoutEmail({ to: tenant.email, tenantName: tenant.name, planName: plan.name, checkoutUrl: session.url!, tenantId: tenant.id });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('[Stripe] Checkout error:', error?.message || error);
    res.status(500).json({ message: error?.message || 'Unknown error' });
  }
});
TS
  fi

  # Monthly manual run
  if ! grep -q '/api/admin/billing/run-monthly' "$ROUTES"; then
cat >> "$ROUTES" <<'TS'
app.post("/api/admin/billing/run-monthly", requireAuth, requireRole(['platform_admin']), async (req, res) => {
  try {
    const { tenantId, month, year } = req.body as { tenantId: string; month?: number; year?: number };
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    const now = new Date();
    const m = (month ?? now.getMonth());
    const y = (year ?? now.getFullYear());
    const periodStart = new Date(y, m, 1);
    const periodEnd = new Date(y, m + 1, 0, 23, 59, 59);

    const twilio = await import("./twilio-service");
    await twilio.importForwardingForTenantPeriod(tenantId, periodStart, periodEnd);

    const result = await stripeInvoiceService.generateMonthlyInvoice(tenantId, periodStart, periodEnd);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "Unknown error" });
  }
});
TS
  fi

  # Adjustments CRUD
  if ! grep -q '/api/admin/billing/adjustments' "$ROUTES"; then
cat >> "$ROUTES" <<'TS'
app.post("/api/admin/billing/adjustments", requireAuth, requireRole(['platform_admin']), async (req, res) => {
  try {
    const { tenantId, type, valuePercent, valueCents, valueMinutes, minuteScope, effectiveFrom, effectiveTo, appliesToPeriod } = req.body;
    if (!tenantId || !type) return res.status(400).json({ message: "tenantId and type required" });
    const adj = await storage.createBillingAdjustment({
      tenantId, type, valuePercent, valueCents, valueMinutes, minuteScope,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
      appliesToPeriod
    });
    res.json(adj);
  } catch (e: any) { res.status(500).json({ message: e?.message || 'Unknown error' }); }
});

app.get("/api/admin/billing/adjustments/:tenantId", requireAuth, requireRole(['platform_admin']), async (req, res) => {
  try { res.json(await storage.getBillingAdjustments(req.params.tenantId)); }
  catch (e:any) { res.status(500).json({ message: e?.message || 'Unknown error' }); }
});

app.delete("/api/admin/billing/adjustments/:tenantId/:id", requireAuth, requireRole(['platform_admin']), async (req, res) => {
  try { await storage.deleteBillingAdjustment(req.params.id, req.params.tenantId); res.json({ success: true }); }
  catch (e:any) { res.status(500).json({ message: e?.message || 'Unknown error' }); }
});
TS
  fi

  # Retell agents list
  if ! grep -q '/api/retell/agents"' "$ROUTES"; then
cat >> "$ROUTES" <<'TS'
app.get("/api/retell/agents", requireAuth, requireRole(['platform_admin']), async (req, res) => {
  try {
    const { retellApi } = await import("./retell-api");
    const agents = await retellApi.listAgents();
    res.json(agents);
  } catch (e:any) {
    res.status(500).json({ message: e?.message || 'Failed to list Retell agents' });
  }
});
TS
  fi

  # Twilio usage import single number
  if ! grep -q '/api/twilio/usage/import' "$ROUTES"; then
cat >> "$ROUTES" <<'TS'
app.post("/api/twilio/usage/import", requireAuth, requireRole(['platform_admin']), async (req, res) => {
  try {
    const { tenantId, numberSid, periodStart, periodEnd, botId } = req.body as { tenantId: string; numberSid: string; periodStart: string; periodEnd: string; botId?: string };
    if (!tenantId || !numberSid || !periodStart || !periodEnd) return res.status(400).json({ message: "tenantId, numberSid, periodStart, periodEnd required" });

    const twilio = await import("./twilio-service");
    const start = new Date(periodStart), end = new Date(periodEnd);
    const result = await twilio.fetchForwardingMinutes({ numberSid, periodStart: start, periodEnd: end });

    const minutes = Math.round((result.totalSeconds / 60) * 100) / 100;
    const bots = await storage.getBots(tenantId);
    const chosenBotId = botId || (bots[0]?.id);
    if (!chosenBotId) return res.status(400).json({ message: "No bot found for tenant; provide botId" });

    await storage.createUsageEvent({
      tenantId, botId: chosenBotId, kind: 'forwarding_minute' as any, quantity: minutes as any,
      metadata: { numberSid, source: 'twilio_import' }, timestamp: new Date()
    });

    res.json({ importedSeconds: result.totalSeconds, importedMinutes: minutes, callCount: result.calls.length });
  } catch (error: any) {
    console.error('[Twilio] Import usage error:', error?.message || error);
    res.status(500).json({ message: error?.message || 'Unknown error' });
  }
});
TS
  fi

  say "routes.ts OK"
else warn "routes.ts nicht gefunden – überspringe."
fi

# 9) stripe-webhook-service.ts – checkout.session.completed Handler
WH="$ROOT/server/stripe-webhook-service.ts"
if [ -f "$WH" ]; then
  if ! grep -q "checkout.session.completed" "$WH"; then
    # Fall in switch hinzufügen
    patch_file "$WH" "switch \\(event.type\\) \\{"$':::'"switch (event.type) {\n      case 'checkout.session.completed':\n        await this.handleCheckoutCompleted(event.data.object as any);\n        break;"
    # Handler anhängen
    cat >> "$WH" <<'TS'
private async handleCheckoutCompleted(session: any): Promise<void> {
  try {
    const tenantId = session?.metadata?.tenant_id;
    const subscriptionId = typeof session?.subscription === 'string' ? session.subscription : undefined;
    if (tenantId && subscriptionId) {
      await storage.updateTenantSubscription(tenantId, { subscriptionStatus: 'active', startDate: new Date() });
    }
  } catch (e) { console.error('[Webhook] checkout.session.completed failed:', e); }
}
TS
  fi
  say "stripe-webhook-service.ts OK"
else warn "stripe-webhook-service.ts nicht gefunden – überspringe."
fi

# 10) shared/schema.ts – Tabelle billing_adjustments + email_templates Feld
SCH="$ROOT/shared/schema.ts"
if [ -f "$SCH" ]; then
  if ! grep -q "billing_adjustments" "$SCH"; then
cat >> "$SCH" <<'TS'
// Billing adjustments: discounts and one-time extra free minutes
export const billingAdjustmentTypeEnum = pgEnum('billing_adjustment_type', ['discount_percent','discount_fixed_cents','extra_free_minutes']);
export const billingAdjustments = pgTable("billing_adjustments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  type: billingAdjustmentTypeEnum("type").notNull(),
  valuePercent: integer("value_percent"),
  valueCents: integer("value_cents"),
  valueMinutes: integer("value_minutes"),
  minuteScope: varchar("minute_scope", { length: 20 }),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  appliesToPeriod: varchar("applies_to_period", { length: 7 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
TS
  fi
  # email_templates Feld in tenant_settings ergänzen (best effort)
  grep -q "email_templates" "$SCH" || patch_file "$SCH" "tenantSettings\\)[\\s\\S]*?\\{([\\s\\S]*?)\\}"$':::'"$&\n// Hinweis: Stelle sicher, dass tenantSettings das Feld emailTemplates: jsonb('email_templates') enthält."
  say "schema.ts OK (prüfe Migration aus Teil 1!)"
else warn "schema.ts nicht gefunden – bitte manuell ergänzen."
fi

# 11) email-service.ts – sendCheckoutEmail mit Templates (best effort)
EM="$ROOT/server/email-service.ts"
if [ -f "$EM" ] && ! grep -q "sendCheckoutEmail" "$EM"; then
cat >> "$EM" <<'TS'
export class EmailService {
  // ... ggf. vorhandene Methoden/Init

  generateCheckoutEmailTemplate(data: { to: string; tenantName: string; planName: string; checkoutUrl: string }) {
    const subject = `Bitte Zahlungsdaten hinterlegen & Paket bestätigen (${data.planName})`;
    const text = `Hallo ${data.tenantName},

bitte hinterlegen Sie Ihre Zahlungsdaten und bestätigen Sie Ihr Paket (${data.planName}):
${data.checkoutUrl}

Vielen Dank!`;
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;padding:20px">
        <h2>Willkommen, ${data.tenantName}!</h2>
        <p>Bitte bestätigen Sie Ihr Paket <b>${data.planName}</b> und hinterlegen Sie Ihre Zahlungsdaten.</p>
        <p><a href="${data.checkoutUrl}" style="display:inline-block;padding:12px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Stripe Checkout öffnen</a></p>
        <p>Fallback-Link: <a href="${data.checkoutUrl}">${data.checkoutUrl}</a></p>
      </div></body></html>`;
    return { to: data.to, subject, text, html };
  }

  async sendCheckoutEmail(data: { to: string; tenantName: string; planName: string; checkoutUrl: string; tenantId?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      // @ts-ignore
      if (!this.initialized && this.initialize) await this.initialize();
      let tpl = this.generateCheckoutEmailTemplate(data);

      try {
        if (data.tenantId) {
          const { storage } = await import('./storage');
          const t = await storage.getEmailTemplates(data.tenantId);
          const ob = t?.onboarding || {};
          const rep = (s:string) => (s||'')
            .replaceAll('{TENANT_NAME}', data.tenantName)
            .replaceAll('{CHECKOUT_URL}', data.checkoutUrl)
            .replaceAll('{PLAN_NAME}', data.planName);
          tpl = {
            to: tpl.to,
            subject: ob.subject ? rep(ob.subject) : tpl.subject,
            text: ob.text ? rep(ob.text) : tpl.text,
            html: ob.html ? rep(ob.html) : tpl.html
          };
        }
      } catch {}

      if (!this.sgMail) { console.log('[EMAIL] (no SendGrid) would send:', tpl); return { success: true }; }
      await this.sgMail.send({ to: tpl.to, from: process.env.SENDGRID_FROM_EMAIL || 'billing@voiceagent.com', subject: tpl.subject, text: tpl.text, html: tpl.html });
      return { success: true };
    } catch (err:any) { console.error('[EMAIL] Failed:', err?.message || err); return { success: false, error: err?.message || 'Unknown error' }; }
  }
}
TS
  say "email-service.ts erweitert"
fi

say "TEIL 2 fertig ✅"
