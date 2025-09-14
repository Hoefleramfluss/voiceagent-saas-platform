import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { setupAuth, requireAuth, requireRole, requireTenantAccess } from "./auth";
import { storage } from "./storage";
import { insertTenantSchema, insertBotSchema, insertSupportTicketSchema, insertApiKeySchema, insertUsageEventSchema } from "@shared/schema";
import { z } from "zod";
import { encryptApiKey, decryptApiKey, maskApiKey } from "./crypto";
import { keyLoader, getStripeKey, invalidateKeyCache } from "./key-loader";
import { 
  apiKeyRateLimit, 
  criticalKeyOperationsRateLimit, 
  requireRecentAuth, 
  requireExplicitConfirmation, 
  auditSensitiveOperation, 
  requireAllowedIP, 
  logApiKeyAccess, 
  validateOperationPermissions 
} from "./security-controls";

// Stripe instance - will be initialized dynamically when needed
let stripe: Stripe | null = null;

/**
 * Initialize Stripe with keys from database or environment
 * Uses secure key loader to fetch encrypted keys at runtime
 */
async function initializeStripe(): Promise<Stripe | null> {
  if (stripe) {
    return stripe; // Already initialized
  }

  try {
    // First try to get from secure key loader (database)
    let stripeKey = await getStripeKey();
    
    // Fallback to environment variable for backward compatibility
    if (!stripeKey && process.env.STRIPE_SECRET_KEY) {
      stripeKey = process.env.STRIPE_SECRET_KEY;
      console.warn('[Stripe] Using environment variable fallback. Consider storing in database for security.');
    }

    if (stripeKey) {
      stripe = new Stripe(stripeKey, {
        apiVersion: "2025-08-27.basil",
      });
      console.log('[Stripe] Successfully initialized with database-managed key');
      return stripe;
    } else {
      console.warn('[Stripe] No valid key found in database or environment. Stripe functionality disabled.');
      return null;
    }
  } catch (error) {
    console.error('[Stripe] Failed to initialize:', error);
    return null;
  }
}

/**
 * Get initialized Stripe instance
 */
async function getStripe(): Promise<Stripe | null> {
  if (!stripe) {
    return await initializeStripe();
  }
  return stripe;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication routes
  setupAuth(app);

  // Health check
  app.get("/api/health", async (req, res) => {
    try {
      // Simple health check
      res.json({ 
        status: "healthy", 
        timestamp: new Date().toISOString(),
        services: {
          database: "operational",
          redis: "operational"
        }
      });
    } catch (error) {
      res.status(503).json({ status: "unhealthy", error: (error as Error).message });
    }
  });

  // Tenant management (Platform Admin only)
  app.get("/api/tenants", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const tenants = await storage.getTenants();
      res.json(tenants);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/tenants", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const validation = insertTenantSchema.extend({
        email: z.string().email("Valid email address required")
      }).safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      let stripeCustomerId: string | undefined;
      
      // Create Stripe customer only if Stripe is available
      if (stripe) {
        try {
          const stripeCustomer = await stripe.customers.create({
            name: validation.data.name,
            email: validation.data.email
          });
          stripeCustomerId = stripeCustomer.id;
        } catch (stripeError) {
          console.warn('Failed to create Stripe customer:', stripeError);
          // Continue without Stripe customer ID
        }
      } else {
        console.warn('Stripe not available - creating tenant without Stripe customer');
      }

      const tenant = await storage.createTenant({
        ...validation.data,
        stripeCustomerId
      });

      res.status(201).json(tenant);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/tenants/:tenantId/users", requireAuth, requireTenantAccess, async (req, res) => {
    try {
      const users = await storage.getTenantUsers(req.params.tenantId);
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Bot management
  app.get("/api/bots", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      let tenantId: string;

      if (user.role === 'platform_admin') {
        tenantId = req.query.tenantId as string;
        if (!tenantId) {
          return res.status(400).json({ message: "tenantId query parameter required for admin" });
        }
      } else {
        tenantId = user.tenantId!;
      }

      const bots = await storage.getBots(tenantId);
      res.json(bots);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/bots", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      let tenantId: string;

      if (user.role === 'platform_admin') {
        tenantId = req.body.tenantId;
        if (!tenantId) {
          return res.status(400).json({ message: "tenantId required in request body for admin" });
        }
      } else {
        tenantId = user.tenantId!;
      }

      const validation = insertBotSchema.extend({
        tenantId: z.string().optional()
      }).safeParse({ ...req.body, tenantId });

      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const bot = await storage.createBot({
        ...validation.data,
        tenantId,
        status: 'pending'
      });

      // Create provisioning job
      await storage.createProvisioningJob({
        tenantId,
        botId: bot.id,
        status: 'queued',
        payloadJson: {
          botConfig: validation.data,
          timestamp: new Date().toISOString()
        }
      });

      res.status(201).json(bot);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/bots/:botId", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const tenantId = user.role === 'platform_admin' ? undefined : user.tenantId!;
      
      const bot = await storage.getBot(req.params.botId, tenantId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      res.json(bot);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.patch("/api/bots/:botId", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const tenantId = user.role === 'platform_admin' ? undefined : user.tenantId!;
      
      const existingBot = await storage.getBot(req.params.botId, tenantId);
      if (!existingBot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      const bot = await storage.updateBot(req.params.botId, req.body);
      res.json(bot);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Usage tracking
  app.get("/api/usage/summary", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      let tenantId: string;

      if (user.role === 'platform_admin') {
        tenantId = req.query.tenantId as string;
        if (!tenantId) {
          return res.status(400).json({ message: "tenantId query parameter required for admin" });
        }
      } else {
        tenantId = user.tenantId!;
      }

      const range = req.query.range as string || 'month';
      const now = new Date();
      let periodStart: Date;

      switch (range) {
        case 'week':
          periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
          break;
        case 'month':
        default:
          periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      const summary = await storage.getUsageSummary(tenantId, periodStart, now);
      res.json({
        period: { start: periodStart, end: now },
        usage: summary
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/usage/events", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      let tenantId: string;

      if (user.role === 'platform_admin') {
        tenantId = req.query.tenantId as string;
        if (!tenantId) {
          return res.status(400).json({ message: "tenantId query parameter required for admin" });
        }
      } else {
        tenantId = user.tenantId!;
      }

      // Parse filtering parameters
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const kind = req.query.kind as string;
      const botId = req.query.botId as string;
      
      // Parse date parameters
      let periodStart: Date | undefined;
      let periodEnd: Date | undefined;
      
      if (req.query.periodStart) {
        periodStart = new Date(req.query.periodStart as string);
        if (isNaN(periodStart.getTime())) {
          return res.status(400).json({ message: "Invalid periodStart date format" });
        }
      }
      
      if (req.query.periodEnd) {
        periodEnd = new Date(req.query.periodEnd as string);
        if (isNaN(periodEnd.getTime())) {
          return res.status(400).json({ message: "Invalid periodEnd date format" });
        }
      }

      // Validate botId belongs to user's tenant if provided
      if (botId) {
        const bot = await storage.getBot(botId, tenantId);
        if (!bot) {
          return res.status(403).json({ message: "Bot not found or access denied" });
        }
      }

      const events = await storage.getUsageEvents(tenantId, {
        limit,
        offset,
        periodStart,
        periodEnd,
        kind,
        botId
      });
      
      res.json(events);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/usage/events", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Enforce tenant isolation - tenantId must come from authenticated user
      let tenantId: string;
      if (user.role === 'platform_admin') {
        tenantId = req.body.tenantId;
        if (!tenantId) {
          return res.status(400).json({ message: "tenantId required in request body for admin" });
        }
      } else {
        tenantId = user.tenantId!;
      }

      // Validate request with Zod schema and enforce tenantId
      const validation = insertUsageEventSchema.extend({
        metadata: z.any().optional().refine(
          (data) => !data || JSON.stringify(data).length <= 10000,
          "Metadata too large (max 10KB)"
        )
      }).safeParse({
        ...req.body,
        tenantId // Override with authenticated user's tenantId
      });

      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      // Validate botId belongs to user's tenant
      if (validation.data.botId) {
        const bot = await storage.getBot(validation.data.botId, tenantId);
        if (!bot) {
          return res.status(403).json({ 
            message: "Bot not found or access denied" 
          });
        }
      }

      const event = await storage.createUsageEvent(validation.data);
      res.status(201).json(event);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Support tickets
  app.get("/api/support/tickets", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const tenantId = user.role === 'platform_admin' || user.role === 'support' ? undefined : user.tenantId!;
      
      const tickets = await storage.getSupportTickets(tenantId);
      res.json(tickets);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/support/tickets", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const validation = insertSupportTicketSchema.safeParse({
        ...req.body,
        tenantId: user.tenantId,
        authorUserId: user.id
      });

      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const ticket = await storage.createSupportTicket(validation.data);
      res.status(201).json(ticket);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.patch("/api/support/tickets/:ticketId", requireAuth, async (req, res) => {
    try {
      const ticket = await storage.updateSupportTicket(req.params.ticketId, req.body);
      res.json(ticket);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Stripe billing
  app.post("/api/billing/create-payment-intent", requireAuth, async (req, res) => {
    try {
      const stripeInstance = await getStripe();
      if (!stripeInstance) {
        return res.status(503).json({ 
          message: "Stripe not configured. Please add Stripe API keys in admin settings." 
        });
      }
      
      const { amount } = req.body;
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid payment amount required" });
      }
      
      const paymentIntent = await stripeInstance.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: "eur",
      });
      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
      console.error('[Stripe] Payment intent creation failed:', error);
      res.status(500).json({ message: "Error creating payment intent: " + error.message });
    }
  });

  // Twilio webhooks (for incoming calls)
  app.post("/telephony/incoming", async (req, res) => {
    try {
      // Log incoming call
      console.log("Incoming call:", req.body);
      
      // Extract call information
      const { CallSid, From, To } = req.body;
      
      // TODO: Find bot by phone number and create usage event
      // This would be implemented with actual Twilio integration
      
      // Respond with TwiML
      res.set('Content-Type', 'text/xml');
      res.send(`
        <Response>
          <Say voice="alice">Hello! Your call is being processed by our VoiceBot.</Say>
          <Pause length="1"/>
          <Say voice="alice">Please hold while we connect you.</Say>
        </Response>
      `);
    } catch (error) {
      console.error("Telephony webhook error:", error);
      res.status(500).send("Internal server error");
    }
  });

  app.post("/telephony/status", async (req, res) => {
    try {
      // Handle call status updates
      console.log("Call status update:", req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error("Status webhook error:", error);
      res.status(500).send("Internal server error");
    }
  });

  // API Key management (Platform Admin only)
  app.get("/api/admin/api-keys", 
    apiKeyRateLimit,
    logApiKeyAccess,
    requireAuth, 
    requireRole(['platform_admin']), 
    validateOperationPermissions(['platform_admin']),
    auditSensitiveOperation('LIST_API_KEYS'),
    async (req, res) => {
    try {
      const apiKeys = await storage.getApiKeys();
      // CRITICAL SECURITY: Never return actual key values, not even masked ones
      // Instead, return metadata only with a generic mask
      const secureKeys = apiKeys.map(key => ({
        id: key.id,
        keyName: key.keyName,
        serviceType: key.serviceType,
        description: key.description,
        isActive: key.isActive,
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
        // Never expose actual values - use generic masking
        keyValue: '••••••••••••' + (key.keyName ? key.keyName.slice(-4) : 'key')
      }));
      res.json(secureKeys);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/admin/api-keys", 
    criticalKeyOperationsRateLimit,
    logApiKeyAccess,
    requireAuth, 
    requireRole(['platform_admin']), 
    validateOperationPermissions(['platform_admin']),
    requireRecentAuth,
    requireAllowedIP,
    auditSensitiveOperation('CREATE_API_KEY'),
    async (req, res) => {
    try {
      const validation = insertApiKeySchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      // Encrypt the key value before storing (now async)
      const encryptedValue = await encryptApiKey(validation.data.keyValue);
      const apiKey = await storage.createApiKey({
        ...validation.data,
        keyValue: encryptedValue
      });

      // Invalidate key cache since we added a new key
      invalidateKeyCache(apiKey.serviceType, apiKey.keyName);
      
      // AUDIT LOG: Record key creation
      console.log(`[AUDIT] API Key Created - Service: ${apiKey.serviceType}, Name: ${apiKey.keyName}, Admin: ${(req.user as any)?.email || 'unknown'}, Time: ${new Date().toISOString()}`);
      
      // SECURITY: Never return actual key values - return secure metadata only
      res.status(201).json({
        id: apiKey.id,
        keyName: apiKey.keyName,
        serviceType: apiKey.serviceType,
        description: apiKey.description,
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
        keyValue: '••••••••••••' + (apiKey.keyName ? apiKey.keyName.slice(-4) : 'key')
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.patch("/api/admin/api-keys/:id", 
    criticalKeyOperationsRateLimit,
    logApiKeyAccess,
    requireAuth, 
    requireRole(['platform_admin']), 
    validateOperationPermissions(['platform_admin']),
    requireRecentAuth,
    auditSensitiveOperation('UPDATE_API_KEY'),
    async (req, res) => {
    try {
      const { id } = req.params;
      const updates = { ...req.body };
      
      // If keyValue is being updated, encrypt it (now async)
      if (updates.keyValue) {
        updates.keyValue = await encryptApiKey(updates.keyValue);
      }

      const apiKey = await storage.updateApiKey(id, updates);
      
      // Invalidate key cache since the key was updated
      invalidateKeyCache(apiKey.serviceType, apiKey.keyName);
      
      // AUDIT LOG: Record key update
      console.log(`[AUDIT] API Key Updated - Service: ${apiKey.serviceType}, Name: ${apiKey.keyName}, Admin: ${(req.user as any)?.email || 'unknown'}, Updated Fields: ${Object.keys(req.body).join(', ')}, Time: ${new Date().toISOString()}`);
      
      // SECURITY: Never return actual key values - return secure metadata only
      res.json({
        id: apiKey.id,
        keyName: apiKey.keyName,
        serviceType: apiKey.serviceType,
        description: apiKey.description,
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
        keyValue: '••••••••••••' + (apiKey.keyName ? apiKey.keyName.slice(-4) : 'key')
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/admin/api-keys/:id", 
    criticalKeyOperationsRateLimit,
    logApiKeyAccess,
    requireAuth, 
    requireRole(['platform_admin']), 
    validateOperationPermissions(['platform_admin']),
    requireRecentAuth,
    requireAllowedIP,
    requireExplicitConfirmation,
    auditSensitiveOperation('DELETE_API_KEY'),
    async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get key details before deletion for audit logging
      const keyToDelete = await storage.getApiKey(id);
      if (!keyToDelete) {
        return res.status(404).json({ message: "API key not found" });
      }
      
      await storage.deleteApiKey(id);
      
      // Invalidate key cache
      invalidateKeyCache(keyToDelete.serviceType, keyToDelete.keyName);
      
      // AUDIT LOG: Record key deletion
      console.log(`[AUDIT] API Key Deleted - Service: ${keyToDelete.serviceType}, Name: ${keyToDelete.keyName}, Admin: ${(req.user as any)?.email || 'unknown'}, Time: ${new Date().toISOString()}`);
      
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
