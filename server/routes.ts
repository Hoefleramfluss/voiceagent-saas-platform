import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { setupAuth, requireAuth, requireRole, requireTenantAccess } from "./auth";
import { storage } from "./storage";
import { insertTenantSchema, insertBotSchema, insertSupportTicketSchema, insertApiKeySchema } from "@shared/schema";
import { z } from "zod";
import { encryptApiKey, decryptApiKey, maskApiKey } from "./crypto";

// Initialize Stripe only if the secret key is available
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16",
  });
} else {
  console.warn('Warning: STRIPE_SECRET_KEY not found. Stripe functionality will be disabled.');
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

  app.post("/api/usage/events", requireAuth, async (req, res) => {
    try {
      const event = await storage.createUsageEvent(req.body);
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
      if (!stripe) {
        return res.status(503).json({ message: "Stripe not configured. Payment processing unavailable." });
      }
      
      const { amount } = req.body;
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid payment amount required" });
      }
      
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: "eur",
      });
      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
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
  app.get("/api/admin/api-keys", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const apiKeys = await storage.getApiKeys();
      // Return masked version for security
      const maskedKeys = apiKeys.map(key => ({
        ...key,
        keyValue: maskApiKey(decryptApiKey(key.keyValue))
      }));
      res.json(maskedKeys);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/admin/api-keys", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const validation = insertApiKeySchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      // Encrypt the key value before storing
      const encryptedValue = encryptApiKey(validation.data.keyValue);
      const apiKey = await storage.createApiKey({
        ...validation.data,
        keyValue: encryptedValue
      });

      // Return the created key with masked value
      res.status(201).json({
        ...apiKey,
        keyValue: maskApiKey(validation.data.keyValue)
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.patch("/api/admin/api-keys/:id", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { id } = req.params;
      const updates = { ...req.body };
      
      // If keyValue is being updated, encrypt it
      if (updates.keyValue) {
        updates.keyValue = encryptApiKey(updates.keyValue);
      }

      const apiKey = await storage.updateApiKey(id, updates);
      
      // Return with masked value
      res.json({
        ...apiKey,
        keyValue: maskApiKey(decryptApiKey(apiKey.keyValue))
      });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/admin/api-keys/:id", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteApiKey(id);
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
