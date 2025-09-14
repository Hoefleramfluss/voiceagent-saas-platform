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
  uuid
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum('user_role', ['platform_admin', 'customer_admin', 'customer_user', 'support']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'trial']);
export const botStatusEnum = pgEnum('bot_status', ['pending', 'provisioning', 'ready', 'failed', 'suspended']);
export const usageEventKindEnum = pgEnum('usage_event_kind', ['call', 'minute', 'stt_req', 'tts_char', 'gpt_tokens']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['pending', 'paid', 'failed', 'cancelled']);
export const supportTicketStatusEnum = pgEnum('support_ticket_status', ['open', 'in_progress', 'resolved', 'closed']);
export const provisioningJobStatusEnum = pgEnum('provisioning_job_status', ['queued', 'in_progress', 'done', 'error']);
export const apiKeyServiceTypeEnum = pgEnum('api_key_service_type', ['stripe', 'openai', 'twilio', 'google', 'elevenlabs', 'heroku']);
export const auditEventTypeEnum = pgEnum('audit_event_type', ['api_key_created', 'api_key_deleted', 'user_login', 'user_logout', 'password_change', 'role_change', 'sensitive_operation']);
export const subscriptionPlanStatusEnum = pgEnum('subscription_plan_status', ['active', 'inactive', 'deprecated']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'paused', 'canceled', 'expired']);

// Tenants table
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  status: tenantStatusEnum("status").notNull().default('active'),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Users table
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default('customer_user'),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
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
  twilioNumber: varchar("twilio_number", { length: 50 }),
  herokuAppName: varchar("heroku_app_name", { length: 255 }),
  locale: varchar("locale", { length: 10 }).notNull().default('en-US'),
  sttProvider: varchar("stt_provider", { length: 50 }).notNull().default('google'),
  ttsProvider: varchar("tts_provider", { length: 50 }).notNull().default('elevenlabs'),
  configJson: jsonb("config_json"),
  greetingMessage: text("greeting_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Usage events table
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  kind: usageEventKindEnum("kind").notNull(),
  quantity: integer("quantity").notNull(), // Store as integer for precise calculations
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").defaultNow().notNull()
});

// Subscription plans table
export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  monthlyPriceEur: decimal("monthly_price_eur").notNull(),
  yearlyPriceEur: decimal("yearly_price_eur"),
  features: jsonb("features").notNull(), // Array of feature strings
  limits: jsonb("limits").notNull(), // Usage limits object
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

// Relations
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  bots: many(bots),
  usageEvents: many(usageEvents),
  invoices: many(invoices),
  supportTickets: many(supportTickets)
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
  usageEvents: many(usageEvents),
  provisioningJobs: many(provisioningJobs)
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

// Types
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Bot = typeof bots.$inferSelect;
export type InsertBot = z.infer<typeof insertBotSchema>;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = z.infer<typeof insertUsageEventSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type ProvisioningJob = typeof provisioningJobs.$inferSelect;
export type InsertProvisioningJob = z.infer<typeof insertProvisioningJobSchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
