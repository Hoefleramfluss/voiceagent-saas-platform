import { sql, relations } from "drizzle-orm";
import { 
  pgTable, 
  text, 
  varchar, 
  integer, 
  decimal, 
  timestamp, 
  boolean, 
  pgEnum,
  jsonb,
  uuid,
  uniqueIndex,
  index
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum('user_role', ['platform_admin', 'customer_admin', 'customer_user', 'support']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'trial']);
export const botStatusEnum = pgEnum('bot_status', ['pending', 'provisioning', 'ready', 'failed', 'suspended']);
export const usageEventKindEnum = pgEnum('usage_event_kind', ['call', 'voice_bot_minute', 'forwarding_minute', 'stt_req', 'tts_char', 'gpt_tokens']);
export const minuteTypeEnum = pgEnum('minute_type', ['voice_bot', 'forwarding']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['pending', 'paid', 'failed', 'cancelled']);
export const supportTicketStatusEnum = pgEnum('support_ticket_status', ['open', 'in_progress', 'resolved', 'closed']);
export const provisioningJobStatusEnum = pgEnum('provisioning_job_status', ['queued', 'in_progress', 'done', 'error']);
export const apiKeyServiceTypeEnum = pgEnum('api_key_service_type', ['stripe', 'openai', 'twilio', 'google', 'elevenlabs', 'heroku', 'retell']);
export const auditEventTypeEnum = pgEnum('audit_event_type', ['api_key_created', 'api_key_deleted', 'user_login', 'user_logout', 'password_change', 'role_change', 'sensitive_operation']);
export const subscriptionPlanStatusEnum = pgEnum('subscription_plan_status', ['active', 'inactive', 'deprecated']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'paused', 'canceled', 'expired']);
export const invoiceJobStatusEnum = pgEnum('invoice_job_status', ['pending', 'running', 'completed', 'failed']);
export const flowVersionStatusEnum = pgEnum('flow_version_status', ['draft', 'staged', 'live', 'archived']);
export const connectorTypeEnum = pgEnum('connector_type', ['crm', 'calendar']);
export const connectorProviderEnum = pgEnum('connector_provider', ['google_calendar', 'microsoft_graph', 'hubspot', 'salesforce', 'pipedrive']);

// Tenants table (Customer Entity in API terms)
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  status: tenantStatusEnum("status").notNull().default('active'),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  // Tenant Operations Dashboard - Billing
  billingRunningBalanceCents: integer("billing_running_balance_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Session storage table - Required for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table - Updated for Replit Auth compatibility
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).unique(),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  profileImageUrl: varchar("profile_image_url", { length: 500 }),
  // VoiceAgent SaaS specific fields
  role: userRoleEnum("role").notNull().default('customer_user'),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// VoiceBots table
export const bots = pgTable("bots", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: varchar("name", { length: 255 }).notNull(),
  status: botStatusEnum("status").notNull().default('pending'),
  // Retell AI Integration - tenant-scoped agent ID
  retellAgentId: varchar("retell_agent_id", { length: 255 }),
  twilioNumber: varchar("twilio_number", { length: 50 }),
  herokuAppName: varchar("heroku_app_name", { length: 255 }),
  locale: varchar("locale", { length: 10 }).notNull().default('de-AT'),
  sttProvider: varchar("stt_provider", { length: 50 }).notNull().default('google'),
  ttsProvider: varchar("tts_provider", { length: 50 }).notNull().default('elevenlabs'),
  systemPrompt: text("system_prompt").notNull(), // REQUIRED system prompt
  configJson: jsonb("config_json"),
  greetingMessage: text("greeting_message"),
  currentFlowId: uuid("current_flow_id").references(() => flows.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Usage events table
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  kind: usageEventKindEnum("kind").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(), // Store as decimal for precise minute calculations
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").defaultNow().notNull()
});

// Usage minutes table - specific minute tracking for Tenant Ops Dashboard
export const usageMinutes = pgTable("usage_minutes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  agentId: varchar("agent_id", { length: 255 }), // retellAgentId for correlation
  minuteType: minuteTypeEnum("minute_type").notNull(), // voice_bot vs forwarding for billing
  minutesDecimal: decimal("minutes_decimal", { precision: 10, scale: 2 }).notNull(),
  source: varchar("source", { length: 50 }).notNull().default('call'), // 'call', 'chat', etc.
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
}, (table) => [
  index("idx_usage_minutes_tenant_type").on(table.tenantId, table.minuteType),
  index("idx_usage_minutes_bot").on(table.botId),
  index("idx_usage_minutes_agent").on(table.agentId),
  index("idx_usage_minutes_period").on(table.tenantId, table.periodStart),
  uniqueIndex("idx_usage_minutes_unique").on(table.tenantId, table.botId, table.agentId, table.minuteType, table.periodStart, table.periodEnd)
]);

// Subscription plans table
export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  monthlyPriceEur: decimal("monthly_price_eur").notNull(),
  yearlyPriceEur: decimal("yearly_price_eur"),
  features: jsonb("features").notNull(), // Array of feature strings
  limits: jsonb("limits").notNull(), // Usage limits object
  // Minute allowances and rates
  freeVoiceBotMinutes: integer("free_voice_bot_minutes").notNull().default(0),
  freeForwardingMinutes: integer("free_forwarding_minutes").notNull().default(0),
  voiceBotRatePerMinuteCents: integer("voice_bot_rate_per_minute_cents").notNull().default(5), // 5 cents = €0.05
  forwardingRatePerMinuteCents: integer("forwarding_rate_per_minute_cents").notNull().default(3), // 3 cents = €0.03
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  stripeProductId: varchar("stripe_product_id", { length: 255 }),
  status: subscriptionPlanStatusEnum("status").notNull().default('active'),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Billing accounts table
export const billingAccounts = pgTable("billing_accounts", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  currentPlanId: uuid("current_plan_id").references(() => subscriptionPlans.id),
  subscriptionStatus: subscriptionStatusEnum("subscription_status").default('active'),
  subscriptionStartDate: timestamp("subscription_start_date"),
  subscriptionEndDate: timestamp("subscription_end_date"),
  paymentMethodId: varchar("payment_method_id", { length: 255 }),
  nextBillingDate: timestamp("next_billing_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Invoices table
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),
  status: invoiceStatusEnum("status").notNull().default('pending'),
  totalAmount: decimal("total_amount").notNull(), // Match existing database column
  currency: varchar("currency", { length: 3 }).notNull().default('EUR'),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Billing adjustments (discounts, extra minutes)
export const billingAdjustmentTypeEnum = pgEnum('billing_adjustment_type', [
  'discount_percent',
  'discount_fixed_cents',
  'extra_free_minutes'
]);

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

// Support tickets table
export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  subject: varchar("subject", { length: 255 }).notNull(),
  body: text("body").notNull(),
  status: supportTicketStatusEnum("status").notNull().default('open'),
  priority: varchar("priority", { length: 20 }).notNull().default('medium'),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Provisioning jobs table
export const provisioningJobs = pgTable("provisioning_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  status: provisioningJobStatusEnum("status").notNull().default('queued'),
  payloadJson: jsonb("payload_json"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// API keys table
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  keyName: varchar("key_name", { length: 100 }).notNull().unique(),
  keyValue: text("key_value").notNull(),
  serviceType: apiKeyServiceTypeEnum("service_type").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Audit logs table
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: auditEventTypeEnum("event_type").notNull(),
  operation: varchar("operation", { length: 255 }).notNull(),
  userId: uuid("user_id").references(() => users.id),
  userEmail: varchar("user_email", { length: 255 }),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  statusCode: integer("status_code"),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").defaultNow().notNull()
});

// Automated invoice jobs table (for persistent tracking and recovery)
export const invoiceJobs = pgTable("invoice_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id", { length: 100 }).notNull().unique(),
  status: invoiceJobStatusEnum("status").notNull().default('pending'),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  processedTenants: integer("processed_tenants").notNull().default(0),
  totalTenants: integer("total_tenants").notNull().default(0),
  successfulInvoices: jsonb("successful_invoices").default([]),
  failedInvoices: jsonb("failed_invoices").default([]),
  errors: jsonb("errors").default([]),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Flows table
export const flows = pgTable("flows", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isTemplate: boolean("is_template").notNull().default(false),
  templateVariables: jsonb("template_variables"), // {brand, opening_hours, language}
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Flow versions table (draft/staged/live workflow)
export const flowVersions = pgTable("flow_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  flowId: uuid("flow_id").notNull().references(() => flows.id),
  version: integer("version").notNull(),
  status: flowVersionStatusEnum("status").notNull().default('draft'),
  flowJson: jsonb("flow_json").notNull(), // Complete flow definition
  publishedAt: timestamp("published_at"),
  publishedBy: uuid("published_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Tenant settings table
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  // Twilio settings (auth token stored in tenant_secrets for security)
  twilioAccountSid: varchar("twilio_account_sid", { length: 255 }),
  // STT/TTS configuration
  sttProvider: varchar("stt_provider", { length: 50 }).notNull().default('google'),
  sttConfig: jsonb("stt_config"),
  ttsProvider: varchar("tts_provider", { length: 50 }).notNull().default('elevenlabs'),
  ttsConfig: jsonb("tts_config"),
  // OpenAI configuration (API key stored in tenant_secrets for security)
  openaiModel: varchar("openai_model", { length: 100 }).notNull().default('gpt-4'),
  // Localization
  defaultLocale: varchar("default_locale", { length: 10 }).notNull().default('de-AT'),
  // Template variables for dynamic content
  templateVariables: jsonb("template_variables"),
  emailTemplates: jsonb("email_templates"),
  // Billing package
  billingPackageId: uuid("billing_package_id").references(() => subscriptionPlans.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Connectors table (CRM/Calendar integrations)
export const connectors = pgTable("connectors", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: varchar("name", { length: 255 }).notNull(),
  type: connectorTypeEnum("type").notNull(),
  provider: connectorProviderEnum("provider").notNull(),
  config: jsonb("config").notNull(), // Provider-specific configuration
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Tenant secrets table (encrypted secrets)
export const tenantSecrets = pgTable("tenant_secrets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  secretKey: varchar("secret_key", { length: 100 }).notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Phone number mappings table
export const phoneNumberMappings = pgTable("phone_number_mappings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number", { length: 50 }).notNull(),
  numberSid: varchar("number_sid", { length: 64 }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  botId: uuid("bot_id").references(() => bots.id),
  webhookUrl: varchar("webhook_url", { length: 500 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
}, (table) => ({
  // CRITICAL SECURITY: Partial unique index - only one active mapping per phone number
  // This prevents phone number hijacking while allowing inactive mappings for history
  activePhoneUniqueIdx: uniqueIndex('active_phone_unique_idx').on(table.phoneNumber).where(sql`${table.isActive} = true`)
}));

// Demo verification codes table (for persistent SMS verification)
export const demoVerificationCodes = pgTable("demo_verification_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  code: varchar("code", { length: 6 }).notNull(),
  phoneNumber: varchar("phone_number", { length: 50 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").notNull().default(false),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Relations
export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  users: many(users),
  bots: many(bots),
  usageEvents: many(usageEvents),
  invoices: many(invoices),
  supportTickets: many(supportTickets),
  flows: many(flows),
  settings: one(tenantSettings),
  connectors: many(connectors),
  secrets: many(tenantSecrets),
  phoneNumbers: many(phoneNumberMappings),
  verificationCodes: many(demoVerificationCodes)
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id]
  }),
  authoredTickets: many(supportTickets, { relationName: "authored_tickets" }),
  assignedTickets: many(supportTickets, { relationName: "assigned_tickets" }),
  auditLogs: many(auditLogs)
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id]
  }),
  tenant: one(tenants, {
    fields: [auditLogs.tenantId],
    references: [tenants.id]
  })
}));

export const botsRelations = relations(bots, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [bots.tenantId],
    references: [tenants.id]
  }),
  currentFlow: one(flows, {
    fields: [bots.currentFlowId],
    references: [flows.id]
  }),
  usageEvents: many(usageEvents),
  provisioningJobs: many(provisioningJobs),
  phoneNumberMappings: many(phoneNumberMappings)
}));

export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [usageEvents.tenantId],
    references: [tenants.id]
  }),
  bot: one(bots, {
    fields: [usageEvents.botId],
    references: [bots.id]
  })
}));

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  tenant: one(tenants, {
    fields: [supportTickets.tenantId],
    references: [tenants.id]
  }),
  author: one(users, {
    fields: [supportTickets.authorUserId],
    references: [users.id],
    relationName: "authored_tickets"
  }),
  assignedTo: one(users, {
    fields: [supportTickets.assignedToUserId],
    references: [users.id],
    relationName: "assigned_tickets"
  })
}));

// New table relations
export const flowsRelations = relations(flows, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [flows.tenantId],
    references: [tenants.id]
  }),
  versions: many(flowVersions),
  bots: many(bots)
}));

export const flowVersionsRelations = relations(flowVersions, ({ one }) => ({
  flow: one(flows, {
    fields: [flowVersions.flowId],
    references: [flows.id]
  }),
  publishedBy: one(users, {
    fields: [flowVersions.publishedBy],
    references: [users.id]
  })
}));

export const tenantSettingsRelations = relations(tenantSettings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSettings.tenantId],
    references: [tenants.id]
  }),
  billingPackage: one(subscriptionPlans, {
    fields: [tenantSettings.billingPackageId],
    references: [subscriptionPlans.id]
  })
}));

export const connectorsRelations = relations(connectors, ({ one }) => ({
  tenant: one(tenants, {
    fields: [connectors.tenantId],
    references: [tenants.id]
  })
}));

export const tenantSecretsRelations = relations(tenantSecrets, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSecrets.tenantId],
    references: [tenants.id]
  })
}));

export const phoneNumberMappingsRelations = relations(phoneNumberMappings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [phoneNumberMappings.tenantId],
    references: [tenants.id]
  }),
  bot: one(bots, {
    fields: [phoneNumberMappings.botId],
    references: [bots.id]
  })
}));

export const demoVerificationCodesRelations = relations(demoVerificationCodes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [demoVerificationCodes.tenantId],
    references: [tenants.id]
  })
}));

// Insert schemas
export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true
}).refine(data => {
  // SECURITY: Customer roles must always have a tenantId
  const customerRoles = ['customer_user', 'customer_admin'];
  if (data.role && customerRoles.includes(data.role) && !data.tenantId) {
    return false;
  }
  return true;
}, {
  message: "Customer roles must have a valid tenantId",
  path: ["tenantId"]
});

export const insertBotSchema = createInsertSchema(bots).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertUsageEventSchema = createInsertSchema(usageEvents).omit({
  id: true,
  timestamp: true
});

export const insertUsageMinutesSchema = createInsertSchema(usageMinutes).omit({
  id: true,
  createdAt: true
});

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertProvisioningJobSchema = createInsertSchema(provisioningJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  timestamp: true
});

export const insertInvoiceJobSchema = createInsertSchema(invoiceJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

// New table insert schemas
export const insertFlowSchema = createInsertSchema(flows).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertFlowVersionSchema = createInsertSchema(flowVersions).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertTenantSettingsSchema = createInsertSchema(tenantSettings).omit({
  createdAt: true,
  updatedAt: true
});

export const insertConnectorSchema = createInsertSchema(connectors).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertTenantSecretSchema = createInsertSchema(tenantSecrets).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertPhoneNumberMappingSchema = createInsertSchema(phoneNumberMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true
}).refine(data => {
  // SECURITY: Validate phone number format before normalization
  if (!data.phoneNumber) {
    return false;
  }
  const digitsOnly = data.phoneNumber.replace(/\D/g, '');
  return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}, {
  message: "Phone number must be between 10 and 15 digits",
  path: ["phoneNumber"]
}).refine(data => {
  // SECURITY: Phone number can only contain valid characters
  if (!data.phoneNumber) {
    return false;
  }
  return /^[\+\-\s\(\)\d]+$/.test(data.phoneNumber);
}, {
  message: "Phone number contains invalid characters",
  path: ["phoneNumber"]
}).refine(data => {
  // SECURITY: tenantId is required for proper isolation
  return !!data.tenantId;
}, {
  message: "Tenant ID is required for phone number mapping",
  path: ["tenantId"]
});

// Update schema for phone number mappings (partial updates)
export const updatePhoneNumberMappingSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required").optional()
    .refine(value => {
      if (!value) return true; // Allow undefined for optional fields
      const digitsOnly = value.replace(/\D/g, '');
      return digitsOnly.length >= 10 && digitsOnly.length <= 15;
    }, {
      message: "Phone number must be between 10 and 15 digits"
    })
    .refine(value => {
      if (!value) return true; // Allow undefined for optional fields
      return /^[\+\-\s\(\)\d]+$/.test(value);
    }, {
      message: "Phone number contains invalid characters"
    }),
  botId: z.string().uuid("Valid bot ID required").optional().nullable(),
  webhookUrl: z.string().url("Valid URL required").optional().nullable(),
  isActive: z.boolean().optional()
});

export const insertDemoVerificationCodeSchema = createInsertSchema(demoVerificationCodes).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

// Types
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert;
export type Bot = typeof bots.$inferSelect;
export type InsertBot = z.infer<typeof insertBotSchema>;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = z.infer<typeof insertUsageEventSchema>;
export type UsageMinutes = typeof usageMinutes.$inferSelect;
export type InsertUsageMinutes = z.infer<typeof insertUsageMinutesSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type ProvisioningJob = typeof provisioningJobs.$inferSelect;
export type InsertProvisioningJob = z.infer<typeof insertProvisioningJobSchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type InvoiceJob = typeof invoiceJobs.$inferSelect;
export type InsertInvoiceJob = z.infer<typeof insertInvoiceJobSchema>;

// New table types
export type Flow = typeof flows.$inferSelect;
export type InsertFlow = z.infer<typeof insertFlowSchema>;
export type FlowVersion = typeof flowVersions.$inferSelect;
export type InsertFlowVersion = z.infer<typeof insertFlowVersionSchema>;
export type TenantSettings = typeof tenantSettings.$inferSelect;
export type InsertTenantSettings = z.infer<typeof insertTenantSettingsSchema>;
export type Connector = typeof connectors.$inferSelect;
export type InsertConnector = z.infer<typeof insertConnectorSchema>;
export type TenantSecret = typeof tenantSecrets.$inferSelect;
export type InsertTenantSecret = z.infer<typeof insertTenantSecretSchema>;
export type PhoneNumberMapping = typeof phoneNumberMappings.$inferSelect;
export type InsertPhoneNumberMapping = z.infer<typeof insertPhoneNumberMappingSchema>;
export type UpdatePhoneNumberMapping = z.infer<typeof updatePhoneNumberMappingSchema>;
export type DemoVerificationCode = typeof demoVerificationCodes.$inferSelect;
export type InsertDemoVerificationCode = z.infer<typeof insertDemoVerificationCodeSchema>;
export type BillingAdjustment = typeof billingAdjustments.$inferSelect;
export type InsertBillingAdjustment = typeof billingAdjustments.$inferInsert;
