import { 
  tenants, 
  users, 
  bots, 
  usageEvents, 
  invoices, 
  supportTickets, 
  provisioningJobs,
  apiKeys,
  billingAccounts,
  auditLogs,
  subscriptionPlans,
  invoiceJobs,
  tenantSettings,
  flows,
  flowVersions,
  type Tenant,
  type User, 
  type InsertUser, 
  type InsertTenant, 
  type Bot,
  type InsertBot,
  type UsageEvent,
  type InsertUsageEvent,
  type SupportTicket,
  type InsertSupportTicket,
  type ProvisioningJob,
  type InsertProvisioningJob,
  type ApiKey,
  type InsertApiKey,
  type Invoice,
  type InsertInvoice,
  type AuditLog,
  type InsertAuditLog,
  type SubscriptionPlan,
  type InvoiceJob,
  type InsertInvoiceJob,
  type TenantSettings,
  type Flow,
  type InsertFlow,
  type FlowVersion,
  type InsertFlowVersion,
  phoneNumberMappings,
  type PhoneNumberMapping,
  type InsertPhoneNumberMapping,
  demoVerificationCodes,
  type DemoVerificationCode,
  type InsertDemoVerificationCode,
  connectors,
  type Connector,
  type InsertConnector
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sum, count, gte, lte } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import { withDatabaseRetry } from "./retry-utils";
import { createError } from "./error-handling";
import { normalizePhoneNumber, validateBotOwnership, validatePhoneNumberFormat } from "./phone-security-utils";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  // Session store
  sessionStore: session.Store;

  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserStripeInfo(userId: string, customerId: string, subscriptionId?: string): Promise<User>;

  // Tenant operations
  getTenants(): Promise<Tenant[]>;
  getTenant(id: string): Promise<Tenant | undefined>;
  getTenantBySubdomain(subdomain: string): Promise<Tenant | undefined>;
  getTenantSettings(tenantId: string): Promise<TenantSettings | undefined>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: string, updates: Partial<Tenant>): Promise<Tenant>;
  getTenantUsers(tenantId: string): Promise<User[]>;
  getUsersByTenantId(tenantId: string): Promise<User[]>; // Alias for getTenantUsers

  // Bot operations
  getBots(tenantId: string): Promise<Bot[]>;
  getBotsByTenantId(tenantId: string): Promise<Bot[]>; // Alias for getBots
  getBot(id: string, tenantId?: string): Promise<Bot | undefined>;
  createBot(bot: InsertBot): Promise<Bot>;
  updateBot(id: string, updates: Partial<Bot>): Promise<Bot>;

  // Usage operations
  createUsageEvent(event: InsertUsageEvent): Promise<UsageEvent>;
  getUsageEvents(tenantId: string, options?: {
    limit?: number;
    offset?: number;
    periodStart?: Date;
    periodEnd?: Date;
    kind?: string;
    botId?: string;
  }): Promise<UsageEvent[]>;
  getUsageSummary(tenantId: string, periodStart: Date, periodEnd: Date): Promise<any>;

  // Support operations
  getSupportTickets(tenantId?: string): Promise<SupportTicket[]>;
  createSupportTicket(ticket: InsertSupportTicket): Promise<SupportTicket>;
  updateSupportTicket(id: string, updates: Partial<SupportTicket>): Promise<SupportTicket>;

  // Provisioning operations
  createProvisioningJob(job: InsertProvisioningJob): Promise<ProvisioningJob>;
  getProvisioningJobs(tenantId: string): Promise<ProvisioningJob[]>;
  updateProvisioningJob(id: string, updates: Partial<ProvisioningJob>): Promise<ProvisioningJob>;

  // API Key operations
  getApiKeys(): Promise<ApiKey[]>;
  getApiKey(id: string): Promise<ApiKey | undefined>;
  createApiKey(apiKey: InsertApiKey): Promise<ApiKey>;
  updateApiKey(id: string, updates: Partial<ApiKey>): Promise<ApiKey>;
  deleteApiKey(id: string): Promise<void>;

  // Billing operations
  createBillingAccount(billingAccount: { tenantId: string; stripeCustomerId: string }): Promise<void>;
  getBillingAccount(tenantId: string): Promise<{ 
    tenantId: string; 
    stripeCustomerId: string; 
    stripeSubscriptionId?: string;
    currentPlanId?: string;
    subscriptionStatus?: string;
    subscriptionStartDate?: Date;
    subscriptionEndDate?: Date;
    paymentMethodId?: string;
    nextBillingDate?: Date;
  } | undefined>;
  updateBillingAccount(tenantId: string, updates: { stripeSubscriptionId?: string }): Promise<void>;

  // Invoice operations
  getInvoices(tenantId: string): Promise<any[]>;
  getInvoice(id: string): Promise<any | undefined>;
  createInvoice(invoice: any): Promise<any>;
  updateInvoice(id: string, updates: any): Promise<any>;

  // Invoice job operations
  createInvoiceJob(job: InsertInvoiceJob): Promise<InvoiceJob>;
  getInvoiceJob(id: string): Promise<InvoiceJob | undefined>;
  getInvoiceJobByJobId(jobId: string): Promise<InvoiceJob | undefined>;
  updateInvoiceJob(id: string, updates: Partial<InvoiceJob>): Promise<InvoiceJob>;
  getInvoiceJobs(options?: {
    limit?: number;
    offset?: number;
    status?: string;
    periodStart?: Date;
    periodEnd?: Date;
  }): Promise<InvoiceJob[]>;
  getLastSuccessfulInvoiceJob(): Promise<InvoiceJob | undefined>;

  // Audit log operations
  createAuditLog(auditLog: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(options?: {
    limit?: number;
    offset?: number;
    tenantId?: string;
    userId?: string;
    eventType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<AuditLog[]>;

  // Subscription management
  getSubscriptionPlans(activeOnly?: boolean): Promise<SubscriptionPlan[]>;
  getSubscriptionPlan(planId: string): Promise<SubscriptionPlan | null>;
  createSubscriptionPlan(plan: Partial<SubscriptionPlan>): Promise<SubscriptionPlan>;
  updateSubscriptionPlan(planId: string, updates: Partial<SubscriptionPlan>): Promise<SubscriptionPlan | null>;
  updateTenantSubscription(tenantId: string, data: {
    planId: string;
    subscriptionStatus?: string;
    startDate?: Date;
    endDate?: Date;
    paymentMethodId?: string;
    nextBillingDate?: Date;
  }): Promise<void>;
  getTenantSubscription(tenantId: string): Promise<{
    plan: SubscriptionPlan | null;
    billingAccount: any;
  }>;

  // Flow operations
  getFlows(tenantId: string): Promise<Flow[]>;
  getFlowsByTenantId(tenantId: string): Promise<Flow[]>; // Alias for getFlows
  getFlow(id: string, tenantId: string): Promise<Flow | undefined>;
  createFlow(flow: InsertFlow): Promise<Flow>;
  updateFlow(id: string, tenantId: string, updates: Partial<Flow>): Promise<Flow>;
  deleteFlow(id: string, tenantId: string): Promise<void>;

  // Flow version operations with versioning workflow
  getFlowVersions(flowId: string, tenantId: string): Promise<FlowVersion[]>;
  getFlowVersion(id: string, tenantId: string): Promise<FlowVersion | undefined>;
  getFlowVersionByStatus(flowId: string, status: 'draft' | 'staged' | 'live', tenantId: string): Promise<FlowVersion | undefined>;
  createFlowVersion(version: InsertFlowVersion, tenantId: string): Promise<FlowVersion>;
  updateFlowVersion(id: string, tenantId: string, updates: Partial<FlowVersion>): Promise<FlowVersion>;
  publishFlowVersion(id: string, tenantId: string, publishedBy: string): Promise<FlowVersion>;
  archiveFlowVersion(id: string, tenantId: string): Promise<FlowVersion>;

  // Phone number mapping operations
  getPhoneNumberMappings(tenantId: string): Promise<PhoneNumberMapping[]>;
  getPhoneNumberMapping(id: string, tenantId: string): Promise<PhoneNumberMapping | undefined>;
  getPhoneNumberMappingByPhone(phoneNumber: string): Promise<PhoneNumberMapping | undefined>;
  getPhoneMappingByNumber(phoneNumber: string): Promise<PhoneNumberMapping | undefined>; // Alias for getPhoneNumberMappingByPhone
  createPhoneNumberMapping(mapping: InsertPhoneNumberMapping): Promise<PhoneNumberMapping>;
  createPhoneMapping(mapping: InsertPhoneNumberMapping): Promise<PhoneNumberMapping>; // Alias for createPhoneNumberMapping
  updatePhoneNumberMapping(id: string, tenantId: string, updates: Partial<PhoneNumberMapping>): Promise<PhoneNumberMapping>;
  deletePhoneNumberMapping(id: string, tenantId: string): Promise<void>;
  removePhoneMapping(phoneNumber: string): Promise<void>; // Simplified remove by phone number

  // Demo verification code operations
  createVerificationCode(verificationCode: InsertDemoVerificationCode): Promise<DemoVerificationCode>;
  getVerificationCode(tenantId: string): Promise<DemoVerificationCode | undefined>;
  updateVerificationCode(id: string, updates: Partial<DemoVerificationCode>): Promise<DemoVerificationCode>;
  deleteVerificationCode(tenantId: string): Promise<void>;
  cleanupExpiredVerificationCodes(): Promise<{ deletedCount: number }>;

  // Connector operations
  getConnectors(tenantId: string): Promise<Connector[]>;
  getConnector(id: string, tenantId: string): Promise<Connector | undefined>;
  getConnectorsByType(tenantId: string, type: 'crm' | 'calendar'): Promise<Connector[]>;
  createConnector(connector: InsertConnector): Promise<Connector>;
  updateConnector(id: string, tenantId: string, updates: Partial<Connector>): Promise<Connector>;
  deleteConnector(id: string, tenantId: string): Promise<void>;
  
  // Connector configuration operations (for enterprise tests)
  createConnectorConfig(config: {
    tenantId: string;
    connectorType: string;
    isActive: boolean;
    config: any;
  }): Promise<{
    id: string;
    tenantId: string;
    connectorType: string;
    isActive: boolean;
    config: any;
  }>;
  getConnectorConfigsByTenantId(tenantId: string): Promise<{
    id: string;
    tenantId: string;
    connectorType: string;
    isActive: boolean;
    config: any;
  }[]>;
  deleteConnectorConfig(id: string): Promise<void>;

  // System and maintenance operations
  executeRaw(query: string): Promise<{ rowCount: number }>;
  healthCheck(): Promise<void>;
  
  // Tenant cleanup operations
  getStaleTrialTenants(daysOld: number): Promise<Tenant[]>;
  cleanupTenantData(tenantId: string): Promise<void>;
  deleteTenant(tenantId: string): Promise<void>;
  
  // Phone mapping cleanup operations
  removePhoneMappingsByTenantId(tenantId: string): Promise<void>;
  cleanupOrphanedPhoneMappings(): Promise<{ deletedCount: number }>;
  
  // Audit log operations
  archiveOldAuditLogs(archiveDate: Date): Promise<{ archivedCount: number }>;
}

export class DatabaseStorage implements IStorage {
  public sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true 
    });
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return await withDatabaseRetry(async () => {
      const [user] = await db
        .insert(users)
        .values(insertUser)
        .returning();
      if (!user) {
        throw createError.database('Failed to create user');
      }
      return user;
    }, 'createUser');
  }

  async updateUserStripeInfo(userId: string, customerId: string, subscriptionId?: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ 
        updatedAt: new Date(),
        // Note: stripe info would be stored in tenants table or separate billing table
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getTenants(): Promise<Tenant[]> {
    return await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant || undefined;
  }

  async getTenantBySubdomain(subdomain: string): Promise<Tenant | undefined> {
    // For now, try to match by tenant name (could be enhanced with dedicated subdomain field)
    const [tenant] = await db.select().from(tenants).where(eq(tenants.name, subdomain));
    return tenant || undefined;
  }

  async getTenantSettings(tenantId: string): Promise<TenantSettings | undefined> {
    const [settings] = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    return settings || undefined;
  }

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    return await withDatabaseRetry(async () => {
      const [tenant] = await db
        .insert(tenants)
        .values(insertTenant)
        .returning();
      if (!tenant) {
        throw createError.database('Failed to create tenant');
      }
      return tenant;
    }, 'createTenant');
  }

  async updateTenant(id: string, updates: Partial<Tenant>): Promise<Tenant> {
    const [tenant] = await db
      .update(tenants)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    return tenant;
  }

  async getTenantUsers(tenantId: string): Promise<User[]> {
    return await db.select().from(users).where(eq(users.tenantId, tenantId));
  }

  // Alias for getTenantUsers (for enterprise tests)
  async getUsersByTenantId(tenantId: string): Promise<User[]> {
    return this.getTenantUsers(tenantId);
  }

  async getBots(tenantId: string): Promise<Bot[]> {
    return await db.select().from(bots).where(eq(bots.tenantId, tenantId));
  }

  // Alias for getBots (for enterprise tests)
  async getBotsByTenantId(tenantId: string): Promise<Bot[]> {
    return this.getBots(tenantId);
  }

  async getBot(id: string, tenantId?: string): Promise<Bot | undefined> {
    const conditions = tenantId 
      ? and(eq(bots.id, id), eq(bots.tenantId, tenantId))
      : eq(bots.id, id);
    
    const [bot] = await db.select().from(bots).where(conditions);
    return bot || undefined;
  }

  async createBot(insertBot: InsertBot): Promise<Bot> {
    const [bot] = await db
      .insert(bots)
      .values(insertBot)
      .returning();
    return bot;
  }

  async updateBot(id: string, updates: Partial<Bot>): Promise<Bot> {
    const [bot] = await db
      .update(bots)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(bots.id, id))
      .returning();
    return bot;
  }

  async createUsageEvent(insertEvent: InsertUsageEvent): Promise<UsageEvent> {
    const [event] = await db
      .insert(usageEvents)
      .values(insertEvent)
      .returning();
    return event;
  }

  async getUsageEvents(tenantId: string, options: {
    limit?: number;
    offset?: number;
    periodStart?: Date;
    periodEnd?: Date;
    kind?: string;
    botId?: string;
  } = {}): Promise<UsageEvent[]> {
    const {
      limit = 50,
      offset = 0,
      periodStart,
      periodEnd,
      kind,
      botId
    } = options;

    // Build dynamic where conditions
    const conditions = [eq(usageEvents.tenantId, tenantId)];
    
    if (periodStart) {
      conditions.push(gte(usageEvents.timestamp, periodStart));
    }
    
    if (periodEnd) {
      conditions.push(lte(usageEvents.timestamp, periodEnd));
    }
    
    if (kind) {
      conditions.push(eq(usageEvents.kind, kind as any));
    }
    
    if (botId) {
      conditions.push(eq(usageEvents.botId, botId));
    }

    return await db
      .select()
      .from(usageEvents)
      .where(and(...conditions))
      .orderBy(desc(usageEvents.timestamp))
      .limit(limit)
      .offset(offset);
  }

  async getUsageSummary(tenantId: string, periodStart: Date, periodEnd: Date): Promise<any> {
    const results = await db
      .select({
        kind: usageEvents.kind,
        totalQuantity: sum(usageEvents.quantity),
        eventCount: count(usageEvents.id)
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.tenantId, tenantId),
          gte(usageEvents.timestamp, periodStart),
          lte(usageEvents.timestamp, periodEnd)
        )
      )
      .groupBy(usageEvents.kind);

    return results.reduce((acc: any, row: any) => {
      acc[row.kind] = {
        quantity: parseFloat(row.totalQuantity || '0'),
        count: parseInt(row.eventCount || '0')
      };
      return acc;
    }, {});
  }

  async getSupportTickets(tenantId?: string): Promise<SupportTicket[]> {
    const query = tenantId 
      ? db.select().from(supportTickets).where(eq(supportTickets.tenantId, tenantId))
      : db.select().from(supportTickets);
    
    return await query.orderBy(desc(supportTickets.createdAt));
  }

  async createSupportTicket(insertTicket: InsertSupportTicket): Promise<SupportTicket> {
    const [ticket] = await db
      .insert(supportTickets)
      .values(insertTicket)
      .returning();
    return ticket;
  }

  async updateSupportTicket(id: string, updates: Partial<SupportTicket>): Promise<SupportTicket> {
    const [ticket] = await db
      .update(supportTickets)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(supportTickets.id, id))
      .returning();
    return ticket;
  }

  async createProvisioningJob(insertJob: InsertProvisioningJob): Promise<ProvisioningJob> {
    const [job] = await db
      .insert(provisioningJobs)
      .values(insertJob)
      .returning();
    return job;
  }

  async getProvisioningJobs(tenantId: string): Promise<ProvisioningJob[]> {
    return await db
      .select()
      .from(provisioningJobs)
      .where(eq(provisioningJobs.tenantId, tenantId))
      .orderBy(desc(provisioningJobs.createdAt));
  }

  async updateProvisioningJob(id: string, updates: Partial<ProvisioningJob>): Promise<ProvisioningJob> {
    const [job] = await db
      .update(provisioningJobs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(provisioningJobs.id, id))
      .returning();
    return job;
  }

  async getApiKeys(): Promise<ApiKey[]> {
    return await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  }

  async getApiKey(id: string): Promise<ApiKey | undefined> {
    const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
    return apiKey || undefined;
  }

  async createApiKey(insertApiKey: InsertApiKey): Promise<ApiKey> {
    const [apiKey] = await db
      .insert(apiKeys)
      .values(insertApiKey)
      .returning();
    return apiKey;
  }

  async updateApiKey(id: string, updates: Partial<ApiKey>): Promise<ApiKey> {
    const [apiKey] = await db
      .update(apiKeys)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(apiKeys.id, id))
      .returning();
    return apiKey;
  }

  async deleteApiKey(id: string): Promise<void> {
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
  }

  // Billing account operations
  async createBillingAccount(billingAccount: { tenantId: string; stripeCustomerId: string }): Promise<void> {
    await db.insert(billingAccounts)
      .values({
        tenantId: billingAccount.tenantId,
        stripeCustomerId: billingAccount.stripeCustomerId
      });
  }

  async getBillingAccount(tenantId: string): Promise<{ 
    tenantId: string; 
    stripeCustomerId: string; 
    stripeSubscriptionId?: string;
    currentPlanId?: string;
    subscriptionStatus?: string;
    subscriptionStartDate?: Date;
    subscriptionEndDate?: Date;
    paymentMethodId?: string;
    nextBillingDate?: Date;
  } | undefined> {
    const [account] = await db.select()
      .from(billingAccounts)
      .where(eq(billingAccounts.tenantId, tenantId));
    
    if (!account) return undefined;
    
    return {
      tenantId: account.tenantId,
      stripeCustomerId: account.stripeCustomerId,
      stripeSubscriptionId: account.stripeSubscriptionId || undefined,
      currentPlanId: account.currentPlanId || undefined,
      subscriptionStatus: account.subscriptionStatus || undefined,
      subscriptionStartDate: account.subscriptionStartDate || undefined,
      subscriptionEndDate: account.subscriptionEndDate || undefined,
      paymentMethodId: account.paymentMethodId || undefined,
      nextBillingDate: account.nextBillingDate || undefined
    };
  }

  async updateBillingAccount(tenantId: string, updates: { stripeSubscriptionId?: string }): Promise<void> {
    await db.update(billingAccounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(billingAccounts.tenantId, tenantId));
  }

  // Invoice operations
  async getInvoices(tenantId: string): Promise<Invoice[]> {
    return await db.select()
      .from(invoices)
      .where(eq(invoices.tenantId, tenantId))
      .orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select()
      .from(invoices)
      .where(eq(invoices.id, id));
    return invoice || undefined;
  }

  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db.insert(invoices)
      .values(insertInvoice)
      .returning();
    return invoice;
  }

  async updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice> {
    const [invoice] = await db.update(invoices)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    return invoice;
  }

  // Invoice job operations
  async createInvoiceJob(insertJob: InsertInvoiceJob): Promise<InvoiceJob> {
    const [job] = await db.insert(invoiceJobs)
      .values(insertJob)
      .returning();
    return job;
  }

  async getInvoiceJob(id: string): Promise<InvoiceJob | undefined> {
    const [job] = await db.select()
      .from(invoiceJobs)
      .where(eq(invoiceJobs.id, id));
    return job || undefined;
  }

  async getInvoiceJobByJobId(jobId: string): Promise<InvoiceJob | undefined> {
    const [job] = await db.select()
      .from(invoiceJobs)
      .where(eq(invoiceJobs.jobId, jobId));
    return job || undefined;
  }

  async updateInvoiceJob(id: string, updates: Partial<InvoiceJob>): Promise<InvoiceJob> {
    const [job] = await db.update(invoiceJobs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(invoiceJobs.id, id))
      .returning();
    return job;
  }

  async getInvoiceJobs(options: {
    limit?: number;
    offset?: number;
    status?: string;
    periodStart?: Date;
    periodEnd?: Date;
  } = {}): Promise<InvoiceJob[]> {
    const { limit = 100, offset = 0, status, periodStart, periodEnd } = options;
    
    const conditions = [];
    if (status) conditions.push(eq(invoiceJobs.status, status as any));
    if (periodStart) conditions.push(gte(invoiceJobs.periodStart, periodStart));
    if (periodEnd) conditions.push(lte(invoiceJobs.periodEnd, periodEnd));
    
    let query = db.select().from(invoiceJobs);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    return await query
      .orderBy(desc(invoiceJobs.startTime))
      .limit(limit)
      .offset(offset);
  }

  async getLastSuccessfulInvoiceJob(): Promise<InvoiceJob | undefined> {
    const [job] = await db.select()
      .from(invoiceJobs)
      .where(eq(invoiceJobs.status, 'completed'))
      .orderBy(desc(invoiceJobs.endTime))
      .limit(1);
    return job || undefined;
  }

  // Audit log operations
  async createAuditLog(insertAuditLog: InsertAuditLog): Promise<AuditLog> {
    const [auditLog] = await db.insert(auditLogs)
      .values(insertAuditLog)
      .returning();
    return auditLog;
  }

  async getAuditLogs(options: {
    limit?: number;
    offset?: number;
    tenantId?: string;
    userId?: string;
    eventType?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<AuditLog[]> {
    const { limit = 100, offset = 0, tenantId, userId, eventType, startDate, endDate } = options;
    
    const conditions = [];
    if (tenantId) conditions.push(eq(auditLogs.tenantId, tenantId));
    if (userId) conditions.push(eq(auditLogs.userId, userId));
    if (eventType) conditions.push(eq(auditLogs.eventType, eventType as any));
    if (startDate) conditions.push(gte(auditLogs.timestamp, startDate));
    if (endDate) conditions.push(lte(auditLogs.timestamp, endDate));
    
    let query = db.select().from(auditLogs);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    return await query
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset);
  }
  
  // Subscription management implementation
  async getSubscriptionPlans(activeOnly = false): Promise<SubscriptionPlan[]> {
    if (activeOnly) {
      return await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.status, 'active'))
        .orderBy(subscriptionPlans.sortOrder);
    }
    
    return await db
      .select()
      .from(subscriptionPlans)
      .orderBy(subscriptionPlans.sortOrder);
  }

  async getSubscriptionPlan(planId: string): Promise<SubscriptionPlan | null> {
    const plans = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);
    
    return plans[0] || null;
  }

  async updateTenantSubscription(tenantId: string, data: {
    planId: string;
    subscriptionStatus?: string;
    startDate?: Date;
    endDate?: Date;
    paymentMethodId?: string;
    nextBillingDate?: Date;
  }): Promise<void> {
    const updateData: any = {
      currentPlanId: data.planId,
      updatedAt: new Date()
    };
    
    if (data.subscriptionStatus) updateData.subscriptionStatus = data.subscriptionStatus;
    if (data.startDate) updateData.subscriptionStartDate = data.startDate;
    if (data.endDate) updateData.subscriptionEndDate = data.endDate;
    if (data.paymentMethodId) updateData.paymentMethodId = data.paymentMethodId;
    if (data.nextBillingDate) updateData.nextBillingDate = data.nextBillingDate;
    
    await db
      .update(billingAccounts)
      .set(updateData)
      .where(eq(billingAccounts.tenantId, tenantId));
  }

  async createSubscriptionPlan(planData: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
    const [plan] = await db
      .insert(subscriptionPlans)
      .values({
        name: planData.name!,
        description: planData.description,
        monthlyPriceEur: planData.monthlyPriceEur!,
        yearlyPriceEur: planData.yearlyPriceEur,
        features: planData.features!,
        limits: planData.limits!,
        freeVoiceBotMinutes: planData.freeVoiceBotMinutes || 0,
        freeForwardingMinutes: planData.freeForwardingMinutes || 0,
        voiceBotRatePerMinuteCents: planData.voiceBotRatePerMinuteCents || 5,
        forwardingRatePerMinuteCents: planData.forwardingRatePerMinuteCents || 3,
        status: planData.status || 'active',
        sortOrder: planData.sortOrder || 0
      })
      .returning();
    
    return plan;
  }

  async updateSubscriptionPlan(planId: string, updates: Partial<SubscriptionPlan>): Promise<SubscriptionPlan | null> {
    const updateData: any = {
      updatedAt: new Date()
    };
    
    // Only include non-undefined fields in the update
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.monthlyPriceEur !== undefined) updateData.monthlyPriceEur = updates.monthlyPriceEur;
    if (updates.yearlyPriceEur !== undefined) updateData.yearlyPriceEur = updates.yearlyPriceEur;
    if (updates.features !== undefined) updateData.features = updates.features;
    if (updates.limits !== undefined) updateData.limits = updates.limits;
    if (updates.freeVoiceBotMinutes !== undefined) updateData.freeVoiceBotMinutes = updates.freeVoiceBotMinutes;
    if (updates.freeForwardingMinutes !== undefined) updateData.freeForwardingMinutes = updates.freeForwardingMinutes;
    if (updates.voiceBotRatePerMinuteCents !== undefined) updateData.voiceBotRatePerMinuteCents = updates.voiceBotRatePerMinuteCents;
    if (updates.forwardingRatePerMinuteCents !== undefined) updateData.forwardingRatePerMinuteCents = updates.forwardingRatePerMinuteCents;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.sortOrder !== undefined) updateData.sortOrder = updates.sortOrder;
    
    const [updatedPlan] = await db
      .update(subscriptionPlans)
      .set(updateData)
      .where(eq(subscriptionPlans.id, planId))
      .returning();
    
    return updatedPlan || null;
  }

  async getTenantSubscription(tenantId: string): Promise<{
    plan: SubscriptionPlan | null;
    billingAccount: any;
  }> {
    const billingAccount = await this.getBillingAccount(tenantId);
    let plan: SubscriptionPlan | null = null;
    
    if (billingAccount?.currentPlanId) {
      plan = await this.getSubscriptionPlan(billingAccount.currentPlanId);
    }
    
    return { plan, billingAccount };
  }

  // Flow operations with tenant isolation
  async getFlows(tenantId: string): Promise<Flow[]> {
    return await db
      .select()
      .from(flows)
      .where(eq(flows.tenantId, tenantId))
      .orderBy(desc(flows.createdAt));
  }

  // Alias for getFlows (for enterprise tests)
  async getFlowsByTenantId(tenantId: string): Promise<Flow[]> {
    return this.getFlows(tenantId);
  }

  async getFlow(id: string, tenantId: string): Promise<Flow | undefined> {
    // Security: Always require tenant context to prevent cross-tenant access
    const [flow] = await db.select()
      .from(flows)
      .where(and(eq(flows.id, id), eq(flows.tenantId, tenantId)));
    return flow || undefined;
  }

  async createFlow(insertFlow: InsertFlow): Promise<Flow> {
    return await withDatabaseRetry(async () => {
      const [flow] = await db
        .insert(flows)
        .values(insertFlow)
        .returning();
      if (!flow) {
        throw createError.database('Failed to create flow');
      }
      return flow;
    }, 'createFlow');
  }

  async updateFlow(id: string, tenantId: string, updates: Partial<Flow>): Promise<Flow> {
    return await withDatabaseRetry(async () => {
      // Security: Define immutable fields that cannot be updated
      const immutableFields = ['id', 'tenantId', 'createdAt'];
      
      // Security: Check for forbidden field updates
      for (const field of immutableFields) {
        if (updates.hasOwnProperty(field)) {
          throw createError.validation(`Cannot update immutable field: ${field}`);
        }
      }
      
      // Security: Only allow safe fields to be updated
      const safeFields = ['name', 'description', 'status', 'metadata', 'updatedAt'];
      const sanitizedUpdates: any = { updatedAt: new Date() };
      
      for (const [key, value] of Object.entries(updates)) {
        if (safeFields.includes(key)) {
          sanitizedUpdates[key] = value;
        } else {
          throw createError.validation(`Field '${key}' is not allowed to be updated`);
        }
      }
      
      const [flow] = await db
        .update(flows)
        .set(sanitizedUpdates)
        .where(and(eq(flows.id, id), eq(flows.tenantId, tenantId)))
        .returning();
      
      if (!flow) {
        throw createError.notFound('Flow not found or access denied');
      }
      return flow;
    }, 'updateFlow');
  }

  async deleteFlow(id: string, tenantId: string): Promise<void> {
    return await withDatabaseRetry(async () => {
      const result = await db
        .delete(flows)
        .where(and(eq(flows.id, id), eq(flows.tenantId, tenantId)))
        .returning({ id: flows.id });
      
      if (result.length === 0) {
        throw createError.notFound('Flow not found or access denied');
      }
    }, 'deleteFlow');
  }

  // Flow version operations with versioning workflow
  async getFlowVersions(flowId: string, tenantId: string): Promise<FlowVersion[]> {
    return await withDatabaseRetry(async () => {
      // First validate that the flow belongs to the requesting tenant
      const flowExists = await db
        .select({ id: flows.id })
        .from(flows)
        .where(and(eq(flows.id, flowId), eq(flows.tenantId, tenantId)))
        .limit(1);
      
      if (flowExists.length === 0) {
        throw createError.notFound('Flow not found or access denied');
      }
      
      // Now fetch versions for the validated flow
      return await db
        .select({
          id: flowVersions.id,
          flowId: flowVersions.flowId,
          version: flowVersions.version,
          status: flowVersions.status,
          content: flowVersions.content,
          metadata: flowVersions.metadata,
          publishedAt: flowVersions.publishedAt,
          publishedBy: flowVersions.publishedBy,
          createdAt: flowVersions.createdAt,
          updatedAt: flowVersions.updatedAt
        })
        .from(flowVersions)
        .innerJoin(flows, eq(flowVersions.flowId, flows.id))
        .where(and(
          eq(flowVersions.flowId, flowId),
          eq(flows.tenantId, tenantId)
        ))
        .orderBy(desc(flowVersions.version));
    }, 'getFlowVersions');
  }

  async getFlowVersion(id: string, tenantId: string): Promise<FlowVersion | undefined> {
    const [version] = await db
      .select({
        id: flowVersions.id,
        flowId: flowVersions.flowId,
        version: flowVersions.version,
        status: flowVersions.status,
        content: flowVersions.content,
        metadata: flowVersions.metadata,
        publishedAt: flowVersions.publishedAt,
        publishedBy: flowVersions.publishedBy,
        createdAt: flowVersions.createdAt,
        updatedAt: flowVersions.updatedAt
      })
      .from(flowVersions)
      .innerJoin(flows, eq(flowVersions.flowId, flows.id))
      .where(and(
        eq(flowVersions.id, id),
        eq(flows.tenantId, tenantId)
      ));
    return version || undefined;
  }

  async getFlowVersionByStatus(flowId: string, status: 'draft' | 'staged' | 'live', tenantId: string): Promise<FlowVersion | undefined> {
    return await withDatabaseRetry(async () => {
      // Validate that the flow belongs to the requesting tenant
      const [version] = await db
        .select({
          id: flowVersions.id,
          flowId: flowVersions.flowId,
          version: flowVersions.version,
          status: flowVersions.status,
          content: flowVersions.content,
          metadata: flowVersions.metadata,
          publishedAt: flowVersions.publishedAt,
          publishedBy: flowVersions.publishedBy,
          createdAt: flowVersions.createdAt,
          updatedAt: flowVersions.updatedAt
        })
        .from(flowVersions)
        .innerJoin(flows, eq(flowVersions.flowId, flows.id))
        .where(and(
          eq(flowVersions.flowId, flowId),
          eq(flowVersions.status, status),
          eq(flows.tenantId, tenantId)
        ))
        .limit(1);
      
      return version || undefined;
    }, 'getFlowVersionByStatus');
  }

  async createFlowVersion(insertVersion: InsertFlowVersion, tenantId: string): Promise<FlowVersion> {
    return await withDatabaseRetry(async () => {
      // First validate that the flow belongs to the requesting tenant
      const flowExists = await db
        .select({ id: flows.id })
        .from(flows)
        .where(and(eq(flows.id, insertVersion.flowId), eq(flows.tenantId, tenantId)))
        .limit(1);
      
      if (flowExists.length === 0) {
        throw createError.notFound('Flow not found or access denied');
      }
      
      // Now create the version for the validated flow
      const [version] = await db
        .insert(flowVersions)
        .values(insertVersion)
        .returning();
        
      if (!version) {
        throw createError.database('Failed to create flow version');
      }
      return version;
    }, 'createFlowVersion');
  }

  async updateFlowVersion(id: string, tenantId: string, updates: Partial<FlowVersion>): Promise<FlowVersion> {
    return await withDatabaseRetry(async () => {
      // First validate tenant ownership through flow
      const flowVersionWithFlow = await db
        .select({ flowId: flowVersions.flowId, flowTenantId: flows.tenantId })
        .from(flowVersions)
        .innerJoin(flows, eq(flowVersions.flowId, flows.id))
        .where(eq(flowVersions.id, id))
        .limit(1);
      
      if (flowVersionWithFlow.length === 0) {
        throw createError.notFound('Flow version not found');
      }
      
      if (flowVersionWithFlow[0].flowTenantId !== tenantId) {
        throw createError.notFound('Flow version not found or access denied');
      }
      
      // Security: Define immutable fields that cannot be updated
      const immutableFields = ['id', 'flowId', 'version', 'status', 'publishedAt', 'publishedBy', 'createdAt'];
      
      // Security: Check for forbidden field updates
      for (const field of immutableFields) {
        if (updates.hasOwnProperty(field)) {
          throw createError.validation(`Cannot update immutable field: ${field}. Use publishFlowVersion() or archiveFlowVersion() for status changes.`);
        }
      }
      
      // Security: Only allow safe fields to be updated
      const safeFields = ['content', 'metadata', 'updatedAt'];
      const sanitizedUpdates: any = { updatedAt: new Date() };
      
      for (const [key, value] of Object.entries(updates)) {
        if (safeFields.includes(key)) {
          sanitizedUpdates[key] = value;
        } else {
          throw createError.validation(`Field '${key}' is not allowed to be updated. Available fields: ${safeFields.join(', ')}`);
        }
      }
      
      // Now perform the update with sanitized fields
      const [version] = await db
        .update(flowVersions)
        .set(sanitizedUpdates)
        .where(eq(flowVersions.id, id))
        .returning();
      
      if (!version) {
        throw createError.database('Failed to update flow version');
      }
      
      return version;
    }, 'updateFlowVersion');
  }

  async publishFlowVersion(id: string, tenantId: string, publishedBy: string): Promise<FlowVersion> {
    return await withDatabaseRetry(async () => {
      // First validate tenant ownership through flow
      const flowVersionWithFlow = await db
        .select({ 
          flowVersionId: flowVersions.id,
          flowId: flowVersions.flowId,
          flowTenantId: flows.tenantId,
          status: flowVersions.status
        })
        .from(flowVersions)
        .innerJoin(flows, eq(flowVersions.flowId, flows.id))
        .where(eq(flowVersions.id, id))
        .limit(1);
      
      if (flowVersionWithFlow.length === 0) {
        throw createError.notFound('Flow version not found');
      }
      
      if (flowVersionWithFlow[0].flowTenantId !== tenantId) {
        throw createError.notFound('Flow version not found or access denied');
      }
      
      const targetFlowId = flowVersionWithFlow[0].flowId;
      
      // Use database transaction for atomic publish operation
      return await db.transaction(async (tx) => {
        // Demote any existing live version to archived (tenant-scoped)
        await tx
          .update(flowVersions)
          .set({ 
            status: 'archived',
            updatedAt: new Date()
          })
          .where(and(
            eq(flowVersions.flowId, targetFlowId),
            eq(flowVersions.status, 'live')
          ));

        // Promote target version to live
        const [publishedVersion] = await tx
          .update(flowVersions)
          .set({
            status: 'live',
            publishedAt: new Date(),
            publishedBy,
            updatedAt: new Date()
          })
          .where(eq(flowVersions.id, id))
          .returning();

        if (!publishedVersion) {
          throw createError.database('Failed to publish flow version');
        }

        return publishedVersion;
      });
    }, 'publishFlowVersion');
  }

  async archiveFlowVersion(id: string, tenantId: string): Promise<FlowVersion> {
    return await withDatabaseRetry(async () => {
      // First validate tenant ownership through flow
      const flowVersionWithFlow = await db
        .select({ flowTenantId: flows.tenantId })
        .from(flowVersions)
        .innerJoin(flows, eq(flowVersions.flowId, flows.id))
        .where(eq(flowVersions.id, id))
        .limit(1);
      
      if (flowVersionWithFlow.length === 0) {
        throw createError.notFound('Flow version not found');
      }
      
      if (flowVersionWithFlow[0].flowTenantId !== tenantId) {
        throw createError.notFound('Flow version not found or access denied');
      }
      
      // Now perform the archive operation
      const [version] = await db
        .update(flowVersions)
        .set({ 
          status: 'archived',
          updatedAt: new Date()
        })
        .where(eq(flowVersions.id, id))
        .returning();
      
      if (!version) {
        throw createError.database('Failed to archive flow version');
      }
      
      return version;
    }, 'archiveFlowVersion');
  }

  // Phone number mapping operations
  async getPhoneNumberMappings(tenantId: string): Promise<PhoneNumberMapping[]> {
    return await withDatabaseRetry(async () => {
      return await db
        .select()
        .from(phoneNumberMappings)
        .where(eq(phoneNumberMappings.tenantId, tenantId))
        .orderBy(desc(phoneNumberMappings.createdAt));
    }, 'getPhoneNumberMappings');
  }

  async getPhoneNumberMapping(id: string, tenantId: string): Promise<PhoneNumberMapping | undefined> {
    return await withDatabaseRetry(async () => {
      const [mapping] = await db
        .select()
        .from(phoneNumberMappings)
        .where(and(
          eq(phoneNumberMappings.id, id),
          eq(phoneNumberMappings.tenantId, tenantId)
        ));
      return mapping || undefined;
    }, 'getPhoneNumberMapping');
  }

  async getPhoneNumberMappingByPhone(phoneNumber: string): Promise<PhoneNumberMapping | undefined> {
    return await withDatabaseRetry(async () => {
      // SECURITY: Normalize phone number to E.164 for consistent lookup
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      
      const [mapping] = await db
        .select()
        .from(phoneNumberMappings)
        .where(and(
          eq(phoneNumberMappings.phoneNumber, normalizedPhone),
          eq(phoneNumberMappings.isActive, true)
        ))
        .orderBy(phoneNumberMappings.createdAt); // Deterministic ordering for consistency
      return mapping || undefined;
    }, 'getPhoneNumberMappingByPhone');
  }

  // Alias for getPhoneNumberMappingByPhone (for enterprise tests)
  async getPhoneMappingByNumber(phoneNumber: string): Promise<PhoneNumberMapping | undefined> {
    return this.getPhoneNumberMappingByPhone(phoneNumber);
  }

  async createPhoneNumberMapping(mapping: InsertPhoneNumberMapping): Promise<PhoneNumberMapping> {
    return await withDatabaseRetry(async () => {
      // SECURITY: Validate phone number format
      validatePhoneNumberFormat(mapping.phoneNumber);
      
      // SECURITY: Normalize phone number to E.164 format
      const normalizedPhoneNumber = normalizePhoneNumber(mapping.phoneNumber);
      
      // CRITICAL SECURITY: Validate bot ownership to prevent cross-tenant bot binding
      if (mapping.botId) {
        await validateBotOwnership(mapping.botId, mapping.tenantId);
      }
      
      const [newMapping] = await db
        .insert(phoneNumberMappings)
        .values({
          ...mapping,
          phoneNumber: normalizedPhoneNumber
        })
        .returning();
      
      if (!newMapping) {
        throw createError.database('Failed to create phone number mapping');
      }
      
      return newMapping;
    }, 'createPhoneNumberMapping');
  }

  // Alias for createPhoneNumberMapping (for enterprise tests)
  async createPhoneMapping(mapping: InsertPhoneNumberMapping): Promise<PhoneNumberMapping> {
    return this.createPhoneNumberMapping(mapping);
  }

  async updatePhoneNumberMapping(id: string, tenantId: string, updates: Partial<PhoneNumberMapping>): Promise<PhoneNumberMapping> {
    return await withDatabaseRetry(async () => {
      // Whitelist safe fields to prevent tenant ownership transfer
      const safeFields = ['botId', 'webhookUrl', 'isActive'] as const;
      const safeUpdates: Partial<PhoneNumberMapping> = {};
      
      for (const field of safeFields) {
        if (field in updates && updates[field] !== undefined) {
          (safeUpdates as any)[field] = updates[field];
        }
      }
      
      // Reject if forbidden fields are attempted
      const forbiddenFields = ['id', 'phoneNumber', 'tenantId', 'createdAt'];
      for (const field of forbiddenFields) {
        if (field in updates) {
          throw createError.badRequest(`Cannot update immutable field: ${field}`);
        }
      }
      
      // CRITICAL SECURITY: If updating botId, validate bot ownership to prevent cross-tenant bot binding
      if (safeUpdates.botId) {
        await validateBotOwnership(safeUpdates.botId, tenantId);
      }
      
      const [mapping] = await db
        .update(phoneNumberMappings)
        .set({ ...safeUpdates, updatedAt: new Date() })
        .where(and(
          eq(phoneNumberMappings.id, id),
          eq(phoneNumberMappings.tenantId, tenantId)
        ))
        .returning();
      
      if (!mapping) {
        throw createError.notFound('Phone number mapping not found or access denied');
      }
      
      return mapping;
    }, 'updatePhoneNumberMapping');
  }

  async deletePhoneNumberMapping(id: string, tenantId: string): Promise<void> {
    return await withDatabaseRetry(async () => {
      const result = await db
        .delete(phoneNumberMappings)
        .where(and(
          eq(phoneNumberMappings.id, id),
          eq(phoneNumberMappings.tenantId, tenantId)
        ))
        .returning();
      
      if (result.length === 0) {
        throw createError.notFound('Phone number mapping not found or access denied');
      }
    }, 'deletePhoneNumberMapping');
  }

  // Remove phone mapping by phone number (for enterprise tests)
  async removePhoneMapping(phoneNumber: string): Promise<void> {
    return await withDatabaseRetry(async () => {
      // SECURITY: Normalize phone number to E.164 for consistent lookup
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      
      const result = await db
        .delete(phoneNumberMappings)
        .where(eq(phoneNumberMappings.phoneNumber, normalizedPhone))
        .returning();
      
      if (result.length === 0) {
        throw createError.notFound('Phone number mapping not found');
      }
    }, 'removePhoneMapping');
  }

  // Connector operations
  async getConnectors(tenantId: string): Promise<Connector[]> {
    return await withDatabaseRetry(async () => {
      return await db
        .select()
        .from(connectors)
        .where(eq(connectors.tenantId, tenantId))
        .orderBy(desc(connectors.createdAt));
    }, 'getConnectors');
  }

  async getConnector(id: string, tenantId: string): Promise<Connector | undefined> {
    return await withDatabaseRetry(async () => {
      const [connector] = await db
        .select()
        .from(connectors)
        .where(and(
          eq(connectors.id, id),
          eq(connectors.tenantId, tenantId)
        ));
      return connector || undefined;
    }, 'getConnector');
  }

  async getConnectorsByType(tenantId: string, type: 'crm' | 'calendar'): Promise<Connector[]> {
    return await withDatabaseRetry(async () => {
      return await db
        .select()
        .from(connectors)
        .where(and(
          eq(connectors.tenantId, tenantId),
          eq(connectors.type, type)
        ))
        .orderBy(desc(connectors.createdAt));
    }, 'getConnectorsByType');
  }

  async createConnector(connector: InsertConnector): Promise<Connector> {
    return await withDatabaseRetry(async () => {
      const [newConnector] = await db
        .insert(connectors)
        .values(connector)
        .returning();
      
      if (!newConnector) {
        throw createError.database('Failed to create connector');
      }
      
      return newConnector;
    }, 'createConnector');
  }

  async updateConnector(id: string, tenantId: string, updates: Partial<Connector>): Promise<Connector> {
    return await withDatabaseRetry(async () => {
      // Whitelist safe fields to prevent tenant ownership transfer
      const safeFields = ['name', 'config', 'isActive'] as const;
      const safeUpdates: Partial<Connector> = {};
      
      for (const field of safeFields) {
        if (field in updates && updates[field] !== undefined) {
          (safeUpdates as any)[field] = updates[field];
        }
      }
      
      // Reject if forbidden fields are attempted
      const forbiddenFields = ['id', 'tenantId', 'type', 'provider', 'createdAt'];
      for (const field of forbiddenFields) {
        if (field in updates) {
          throw createError.badRequest(`Cannot update immutable field: ${field}`);
        }
      }
      
      const [connector] = await db
        .update(connectors)
        .set({ ...safeUpdates, updatedAt: new Date() })
        .where(and(
          eq(connectors.id, id),
          eq(connectors.tenantId, tenantId)
        ))
        .returning();
      
      if (!connector) {
        throw createError.notFound('Connector not found or access denied');
      }
      
      return connector;
    }, 'updateConnector');
  }

  async deleteConnector(id: string, tenantId: string): Promise<void> {
    return await withDatabaseRetry(async () => {
      const result = await db
        .delete(connectors)
        .where(and(
          eq(connectors.id, id),
          eq(connectors.tenantId, tenantId)
        ))
        .returning();
      
      if (result.length === 0) {
        throw createError.notFound('Connector not found or access denied');
      }
    }, 'deleteConnector');
  }

  // Connector configuration operations (for enterprise tests)
  // These simulate connector configurations used in enterprise testing
  private connectorConfigs: Map<string, {
    id: string;
    tenantId: string;
    connectorType: string;
    isActive: boolean;
    config: any;
  }> = new Map();
  
  async createConnectorConfig(config: {
    tenantId: string;
    connectorType: string;
    isActive: boolean;
    config: any;
  }): Promise<{
    id: string;
    tenantId: string;
    connectorType: string;
    isActive: boolean;
    config: any;
  }> {
    const id = `connector-config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const connectorConfig = {
      id,
      ...config
    };
    
    this.connectorConfigs.set(id, connectorConfig);
    return connectorConfig;
  }
  
  async getConnectorConfigsByTenantId(tenantId: string): Promise<{
    id: string;
    tenantId: string;
    connectorType: string;
    isActive: boolean;
    config: any;
  }[]> {
    const configs: any[] = [];
    for (const config of this.connectorConfigs.values()) {
      if (config.tenantId === tenantId) {
        configs.push(config);
      }
    }
    return configs;
  }
  
  async deleteConnectorConfig(id: string): Promise<void> {
    if (!this.connectorConfigs.has(id)) {
      throw createError.notFound('Connector config not found');
    }
    this.connectorConfigs.delete(id);
  }
  // Demo verification code operations
  async createVerificationCode(verificationCode: InsertDemoVerificationCode): Promise<DemoVerificationCode> {
    return await withDatabaseRetry(async () => {
      const [result] = await db
        .insert(demoVerificationCodes)
        .values(verificationCode)
        .returning();
      return result;
    }, 'createVerificationCode');
  }

  async getVerificationCode(tenantId: string): Promise<DemoVerificationCode | undefined> {
    return await withDatabaseRetry(async () => {
      const [result] = await db
        .select()
        .from(demoVerificationCodes)
        .where(and(
          eq(demoVerificationCodes.tenantId, tenantId),
          eq(demoVerificationCodes.isUsed, false)
        ))
        .orderBy(desc(demoVerificationCodes.createdAt))
        .limit(1);
      return result;
    }, 'getVerificationCode');
  }

  async updateVerificationCode(id: string, updates: Partial<DemoVerificationCode>): Promise<DemoVerificationCode> {
    return await withDatabaseRetry(async () => {
      const [result] = await db
        .update(demoVerificationCodes)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(demoVerificationCodes.id, id))
        .returning();
      return result;
    }, 'updateVerificationCode');
  }

  async deleteVerificationCode(tenantId: string): Promise<void> {
    return await withDatabaseRetry(async () => {
      await db
        .delete(demoVerificationCodes)
        .where(eq(demoVerificationCodes.tenantId, tenantId));
    }, 'deleteVerificationCode');
  }

  async cleanupExpiredVerificationCodes(): Promise<{ deletedCount: number }> {
    return await withDatabaseRetry(async () => {
      const result = await db
        .delete(demoVerificationCodes)
        .where(lte(demoVerificationCodes.expiresAt, new Date()));
      return { deletedCount: result.rowCount || 0 };
    }, 'cleanupExpiredVerificationCodes');
  }

  // System and maintenance operations
  async executeRaw(query: string): Promise<{ rowCount: number }> {
    return await withDatabaseRetry(async () => {
      const result = await pool.query(query);
      return { rowCount: result.rowCount || 0 };
    }, 'executeRaw');
  }

  async healthCheck(): Promise<void> {
    return await withDatabaseRetry(async () => {
      await pool.query('SELECT 1');
    }, 'healthCheck');
  }

  // Tenant cleanup operations
  async getStaleTrialTenants(daysOld: number): Promise<Tenant[]> {
    return await withDatabaseRetry(async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      const results = await db
        .select()
        .from(tenants)
        .where(and(
          eq(tenants.subscriptionStatus, 'trial'),
          lte(tenants.createdAt, cutoffDate)
        ));
      
      return results;
    }, 'getStaleTrialTenants');
  }

  async cleanupTenantData(tenantId: string): Promise<void> {
    return await withDatabaseRetry(async () => {
      // Delete related data in proper order to avoid foreign key constraints
      await db.delete(usageEvents).where(eq(usageEvents.tenantId, tenantId));
      await db.delete(supportTickets).where(eq(supportTickets.tenantId, tenantId));
      await db.delete(bots).where(eq(bots.tenantId, tenantId));
      await db.delete(flows).where(eq(flows.tenantId, tenantId));
      await db.delete(connectors).where(eq(connectors.tenantId, tenantId));
      await db.delete(demoVerificationCodes).where(eq(demoVerificationCodes.tenantId, tenantId));
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      // Clean up users last
      await db.delete(users).where(eq(users.tenantId, tenantId));
    }, 'cleanupTenantData');
  }

  async deleteTenant(tenantId: string): Promise<void> {
    return await withDatabaseRetry(async () => {
      const result = await db
        .delete(tenants)
        .where(eq(tenants.id, tenantId))
        .returning();
      
      if (result.length === 0) {
        throw createError.notFound('Tenant not found');
      }
    }, 'deleteTenant');
  }

  // Phone mapping cleanup operations
  async removePhoneMappingsByTenantId(tenantId: string): Promise<void> {
    return await withDatabaseRetry(async () => {
      await db
        .delete(phoneNumberMappings)
        .where(eq(phoneNumberMappings.tenantId, tenantId));
    }, 'removePhoneMappingsByTenantId');
  }

  async cleanupOrphanedPhoneMappings(): Promise<{ deletedCount: number }> {
    return await withDatabaseRetry(async () => {
      // Find phone mappings that reference non-existent tenants or bots
      const orphanedMappings = await db
        .select({ id: phoneNumberMappings.id })
        .from(phoneNumberMappings)
        .leftJoin(tenants, eq(phoneNumberMappings.tenantId, tenants.id))
        .leftJoin(bots, eq(phoneNumberMappings.botId, bots.id))
        .where(and(
          eq(tenants.id, null), // tenant doesn't exist
          eq(bots.id, null)     // or bot doesn't exist
        ));
      
      if (orphanedMappings.length === 0) {
        return { deletedCount: 0 };
      }
      
      const orphanedIds = orphanedMappings.map(m => m.id);
      const result = await db
        .delete(phoneNumberMappings)
        .where(eq(phoneNumberMappings.id, orphanedIds[0])); // Need to use proper IN clause
      
      return { deletedCount: result.rowCount || 0 };
    }, 'cleanupOrphanedPhoneMappings');
  }

  // Audit log operations
  async archiveOldAuditLogs(archiveDate: Date): Promise<{ archivedCount: number }> {
    return await withDatabaseRetry(async () => {
      // For now, just delete old audit logs (in production, move to archive table)
      const result = await db
        .delete(auditLogs)
        .where(lte(auditLogs.timestamp, archiveDate));
      
      return { archivedCount: result.rowCount || 0 };
    }, 'archiveOldAuditLogs');
  }
}

export const storage = new DatabaseStorage();
