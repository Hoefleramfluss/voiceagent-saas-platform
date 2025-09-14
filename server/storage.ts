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
  type InsertInvoice
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sum, count, gte, lte } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

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
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: string, updates: Partial<Tenant>): Promise<Tenant>;
  getTenantUsers(tenantId: string): Promise<User[]>;

  // Bot operations
  getBots(tenantId: string): Promise<Bot[]>;
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
  getBillingAccount(tenantId: string): Promise<{ tenantId: string; stripeCustomerId: string; stripeSubscriptionId?: string } | undefined>;
  updateBillingAccount(tenantId: string, updates: { stripeSubscriptionId?: string }): Promise<void>;

  // Invoice operations
  getInvoices(tenantId: string): Promise<any[]>;
  getInvoice(id: string): Promise<any | undefined>;
  createInvoice(invoice: any): Promise<any>;
  updateInvoice(id: string, updates: any): Promise<any>;
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
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
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

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    const [tenant] = await db
      .insert(tenants)
      .values(insertTenant)
      .returning();
    return tenant;
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

  async getBots(tenantId: string): Promise<Bot[]> {
    return await db.select().from(bots).where(eq(bots.tenantId, tenantId));
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

  async getBillingAccount(tenantId: string): Promise<{ tenantId: string; stripeCustomerId: string; stripeSubscriptionId?: string } | undefined> {
    const [account] = await db.select()
      .from(billingAccounts)
      .where(eq(billingAccounts.tenantId, tenantId));
    
    if (!account) return undefined;
    
    return {
      tenantId: account.tenantId,
      stripeCustomerId: account.stripeCustomerId,
      stripeSubscriptionId: account.stripeSubscriptionId || undefined
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
}

export const storage = new DatabaseStorage();
