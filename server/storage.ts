import { 
  tenants, 
  users, 
  bots, 
  usageEvents, 
  invoices, 
  supportTickets, 
  provisioningJobs, 
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
  type InsertProvisioningJob
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
  getTenantUsers(tenantId: string): Promise<User[]>;

  // Bot operations
  getBots(tenantId: string): Promise<Bot[]>;
  getBot(id: string, tenantId?: string): Promise<Bot | undefined>;
  createBot(bot: InsertBot): Promise<Bot>;
  updateBot(id: string, updates: Partial<Bot>): Promise<Bot>;

  // Usage operations
  createUsageEvent(event: InsertUsageEvent): Promise<UsageEvent>;
  getUsageSummary(tenantId: string, periodStart: Date, periodEnd: Date): Promise<any>;

  // Support operations
  getSupportTickets(tenantId?: string): Promise<SupportTicket[]>;
  createSupportTicket(ticket: InsertSupportTicket): Promise<SupportTicket>;
  updateSupportTicket(id: string, updates: Partial<SupportTicket>): Promise<SupportTicket>;

  // Provisioning operations
  createProvisioningJob(job: InsertProvisioningJob): Promise<ProvisioningJob>;
  getProvisioningJobs(tenantId: string): Promise<ProvisioningJob[]>;
  updateProvisioningJob(id: string, updates: Partial<ProvisioningJob>): Promise<ProvisioningJob>;
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
}

export const storage = new DatabaseStorage();
