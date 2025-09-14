import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { setupAuth, requireAuth, requireRole, requireTenantAccess } from "./auth";
import { hashPassword } from "./auth";
import { storage } from "./storage";
import { insertTenantSchema, insertBotSchema, insertSupportTicketSchema, insertApiKeySchema, insertUsageEventSchema } from "@shared/schema";
import { z } from "zod";
import { encryptApiKey, decryptApiKey, maskApiKey } from "./crypto";
import { keyLoader, getStripeKey, getStripeWebhookSecret, invalidateKeyCache } from "./key-loader";
import { billingCalculator } from "./billing-calculator";
import { stripeInvoiceService } from "./stripe-invoice-service";
import { stripeWebhookService } from "./stripe-webhook-service";
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
import crypto from "crypto";

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

  // Health check with Stripe validation
  app.get("/api/health", async (req, res) => {
    try {
      const services: Record<string, string> = {
        database: "operational",
        redis: "operational"
      };

      // Validate Stripe configuration
      try {
        const stripeInstance = await getStripe();
        if (stripeInstance) {
          // Test Stripe connection with lightweight API call
          await stripeInstance.products.list({ limit: 1 });
          services.stripe = "operational";
        } else {
          services.stripe = "not_configured";
        }
      } catch (stripeError) {
        console.error('[Health Check] Stripe validation failed:', stripeError);
        services.stripe = "error";
      }

      const overallStatus = Object.values(services).some(status => status === "error") ? "degraded" : "healthy";

      res.json({ 
        status: overallStatus, 
        timestamp: new Date().toISOString(),
        services
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
      
      // Create Stripe customer with idempotency - now properly checks if Stripe is available
      const stripeInstance = await getStripe();
      if (stripeInstance) {
        try {
          // Generate idempotency key for customer creation
          const customerIdempotencyKey = crypto.createHash('sha256')
            .update(`customer:${validation.data.name}:${validation.data.email}`)
            .digest('hex').substring(0, 32);

          const stripeCustomer = await stripeInstance.customers.create({
            name: validation.data.name,
            email: validation.data.email,
            description: `Customer for tenant: ${validation.data.name}`,
            metadata: {
              tenant_name: validation.data.name,
              created_by: req.user?.id || 'unknown'
            }
          }, {
            idempotencyKey: customerIdempotencyKey
          });
          stripeCustomerId = stripeCustomer.id;
          console.log(`[Stripe] Created customer ${stripeCustomerId} for tenant ${validation.data.name}`);
        } catch (stripeError) {
          console.error('[Stripe] Failed to create customer:', stripeError);
          return res.status(500).json({ 
            message: "Failed to create Stripe customer. Please check Stripe configuration.",
            error: (stripeError as Error).message
          });
        }
      } else {
        return res.status(503).json({ 
          message: "Stripe not configured. Please add Stripe API keys in admin settings." 
        });
      }

      // Create tenant with Stripe customer ID
      const tenant = await storage.createTenant({
        ...validation.data,
        stripeCustomerId
      });

      // Create billing account record
      if (stripeCustomerId) {
        try {
          await storage.createBillingAccount({
            tenantId: tenant.id,
            stripeCustomerId: stripeCustomerId
          });
        } catch (billingError) {
          console.warn('[Billing] Failed to create billing account:', billingError);
          // Continue - tenant is created, billing account can be created later
        }
      }

      res.status(201).json(tenant);
    } catch (error) {
      console.error('[Tenant Creation] Error:', error);
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

  // Twilio phone number management
  app.get("/api/twilio/numbers/available", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { twilioService } = await import("./twilio-service");
      const { countryCode = 'US', areaCode, limit = 10 } = req.query;
      
      const numbers = await twilioService.searchAvailableNumbers({
        countryCode: countryCode as string,
        areaCode: areaCode as string,
        voiceEnabled: true,
        smsEnabled: true,
        limit: parseInt(limit as string)
      });
      
      res.json(numbers);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });
  
  app.get("/api/twilio/numbers/existing", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { twilioService } = await import("./twilio-service");
      const numbers = await twilioService.listExistingNumbers();
      res.json(numbers);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });
  
  app.post("/api/twilio/numbers/purchase", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { twilioService } = await import("./twilio-service");
      const { phoneNumber, tenantId, botId, friendlyName } = req.body;
      
      if (!phoneNumber || !tenantId || !botId) {
        return res.status(400).json({ message: "phoneNumber, tenantId, and botId are required" });
      }
      
      const result = await twilioService.purchasePhoneNumber({
        phoneNumber,
        tenantId,
        botId,
        countryCode: 'US',
        capabilities: ['voice', 'sms'],
        friendlyName
      });
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json({ message: result.error });
      }
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });
  
  app.post("/api/twilio/numbers/assign", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { twilioService } = await import("./twilio-service");
      const { numberSid, phoneNumber, tenantId, botId } = req.body;
      
      if (!numberSid || !phoneNumber || !tenantId || !botId) {
        return res.status(400).json({ 
          message: "numberSid, phoneNumber, tenantId, and botId are required" 
        });
      }
      
      const result = await twilioService.assignExistingNumber({
        numberSid,
        phoneNumber,
        tenantId,
        botId
      });
      
      if (result.success) {
        res.json({ message: "Phone number assigned successfully" });
      } else {
        res.status(400).json({ message: result.error });
      }
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
      
      // Send email notification for new support ticket
      try {
        const { emailService } = await import('./email-service');
        await emailService.sendSupportTicketNotification({
          to: user.email,
          ticketId: ticket.id,
          subject: ticket.subject,
          message: ticket.body,
          priority: ticket.priority
        });
      } catch (emailError) {
        console.warn(`[SUPPORT] Failed to send email notification for ticket ${ticket.id}:`, emailError);
        // Don't fail the request if email sending fails
      }
      
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

  // Billing and invoice endpoints
  app.get("/api/billing/current-usage", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const usageAndCosts = await billingCalculator.getCurrentUsageAndCosts(user.tenantId);
      res.json(usageAndCosts);
    } catch (error) {
      console.error('[Billing] Current usage error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/billing/invoices", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const invoices = await storage.getInvoices(user.tenantId);
      res.json(invoices);
    } catch (error) {
      console.error('[Billing] Get invoices error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/billing/generate-invoice", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { tenantId, periodStart, periodEnd } = req.body;
      
      if (!tenantId) {
        return res.status(400).json({ message: "Tenant ID required" });
      }

      const startDate = periodStart ? new Date(periodStart) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const endDate = periodEnd ? new Date(periodEnd) : new Date();

      const result = await stripeInvoiceService.generateMonthlyInvoice(tenantId, startDate, endDate);
      
      if (result.success) {
        res.json({ 
          message: "Invoice generated successfully",
          invoice: {
            id: result.invoiceId,
            stripeInvoiceId: result.stripeInvoiceId,
            totalAmount: result.totalAmount
          }
        });
      } else {
        res.status(400).json({ message: result.error });
      }
    } catch (error) {
      console.error('[Billing] Generate invoice error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/billing/create-payment-intent", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { invoiceId } = req.body;
      
      if (invoiceId) {
        // Create payment intent for specific invoice
        const result = await stripeInvoiceService.createPaymentIntentForInvoice(invoiceId);
        if (result.success) {
          res.json({ 
            clientSecret: result.clientSecret,
            paymentIntentId: result.paymentIntentId
          });
        } else {
          res.status(400).json({ message: result.error });
        }
      } else {
        // Create payment intent for current usage
        const usageAndCosts = await billingCalculator.getCurrentUsageAndCosts(user.tenantId);
        
        if (usageAndCosts.totalCostCents <= 0) {
          return res.status(400).json({ message: "No outstanding charges" });
        }

        const stripeInstance = await getStripe();
        if (!stripeInstance) {
          return res.status(503).json({ 
            message: "Stripe not configured. Please add Stripe API keys in admin settings." 
          });
        }

        const billingAccount = await storage.getBillingAccount(user.tenantId);
        if (!billingAccount) {
          return res.status(400).json({ message: "No billing account found" });
        }
        
        const paymentIntent = await stripeInstance.paymentIntents.create({
          amount: usageAndCosts.totalCostCents,
          currency: "eur",
          customer: billingAccount.stripeCustomerId,
          metadata: {
            tenant_id: user.tenantId,
            usage_payment: 'true'
          }
        });
        
        res.json({ 
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          amount: usageAndCosts.totalCostCents / 100
        });
      }
    } catch (error: any) {
      console.error('[Stripe] Payment intent creation failed:', error);
      res.status(500).json({ message: "Error creating payment intent: " + error.message });
    }
  });

  app.get("/api/billing/pricing", requireAuth, async (req, res) => {
    try {
      const pricing = billingCalculator.getPricing();
      res.json(pricing);
    } catch (error) {
      console.error('[Billing] Get pricing error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Admin billing overview endpoint
  app.get("/api/admin/billing/overview", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { timeRange = 'month' } = req.query;
      
      // Get all tenants
      const tenants = await storage.getTenants();
      let totalRevenue = 0;
      let paidInvoices = 0;
      let failedPayments = 0;
      let pendingAmount = 0;
      
      const allInvoices = [];
      
      // Aggregate billing data from all tenants
      for (const tenant of tenants) {
        const invoices = await storage.getInvoices(tenant.id);
        allInvoices.push(...invoices.map(inv => ({ ...inv, tenantName: tenant.name })));
        
        for (const invoice of invoices) {
          const amount = invoice.totalAmountCents / 100; // Convert cents to decimal
          if (invoice.status === 'paid') {
            totalRevenue += amount;
            paidInvoices++;
          } else if (invoice.status === 'failed') {
            failedPayments++;
          } else if (invoice.status === 'pending') {
            pendingAmount += amount;
          }
        }
      }
      
      // Sort invoices by creation date
      allInvoices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      res.json({
        totalRevenue,
        pendingAmount,
        paidInvoices,
        failedPayments,
        invoices: allInvoices.slice(0, 100), // Limit to 100 recent invoices
        tenantCount: tenants.length
      });
    } catch (error) {
      console.error('[Admin Billing] Overview error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Stripe webhook endpoint with raw body parsing
  app.post("/api/stripe/webhook", async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        return res.status(400).json({ message: "Missing Stripe signature" });
      }

      // Get webhook secret securely from API key management
      const endpointSecret = await getStripeWebhookSecret();
      if (!endpointSecret) {
        console.error('[Stripe Webhook] No webhook secret found in database or environment');
        return res.status(500).json({ message: "Webhook secret not configured" });
      }

      const result = await stripeWebhookService.handleWebhook(
        req.body as Buffer, // Raw body from express.raw() middleware
        signature,
        endpointSecret
      );

      if (result.success) {
        res.json({ received: true, eventType: result.event?.type });
      } else {
        res.status(400).json({ message: result.error });
      }
    } catch (error) {
      console.error('[Stripe Webhook] Endpoint error:', error);
      res.status(500).json({ message: (error as Error).message });
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
      const { auditService } = await import('./audit-service');
      await auditService.logApiKeyOperation(
        req.user as any,
        'created',
        { serviceType: apiKey.serviceType, keyName: apiKey.keyName },
        req.ip,
        req.get('User-Agent')
      ).catch(error => console.error('[AUDIT ERROR] Failed to log API key creation:', error));
      
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
      const { auditService } = await import('./audit-service');
      await auditService.logApiKeyOperation(
        req.user as any,
        'deleted',
        { serviceType: keyToDelete.serviceType, keyName: keyToDelete.keyName },
        req.ip,
        req.get('User-Agent')
      ).catch(error => console.error('[AUDIT ERROR] Failed to log API key deletion:', error));
      
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // 🎯 ADMIN USER CREATION SYSTEM - Core admin functionality
  // Creates users for customers and sends welcome credentials
  app.post("/api/admin/users", 
    requireAuth, 
    requireRole(['platform_admin']), 
    async (req, res) => {
    try {
      const validation = z.object({
        email: z.string().email("Valid email address required"),
        tenantId: z.string().uuid("Valid tenant ID required"),
        role: z.enum(['customer_admin', 'customer_user', 'support']).default('customer_user'),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        sendEmail: z.boolean().default(true)
      }).safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const { email, tenantId, role, firstName, lastName, sendEmail } = validation.data;
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already exists" });
      }

      // Verify tenant exists and is active
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) {
        return res.status(400).json({ message: "Tenant not found" });
      }
      if (tenant.status !== 'active') {
        return res.status(400).json({ message: "Tenant is not active" });
      }

      // Generate secure temporary password
      const tempPassword = generateSecurePassword();
      const hashedPassword = await hashPassword(tempPassword);
      
      // Create user
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        tenantId,
        role,
        firstName,
        lastName
      });

      console.log(`[Admin] Created user ${user.email} for tenant ${tenant.name} by admin ${req.user?.email}`);

      // Send welcome email with credentials (if enabled)
      if (sendEmail) {
        try {
          await sendWelcomeEmail({
            email: user.email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            tempPassword,
            tenantName: tenant.name,
            loginUrl: process.env.FRONTEND_URL || req.headers.origin || 'https://localhost:5000'
          });
          console.log(`[Email] Welcome email sent to ${user.email}`);
        } catch (emailError) {
          console.error(`[Email] Failed to send welcome email to ${user.email}:`, emailError);
          // Don't fail the request if email fails - user was created successfully
        }
      }

      // For customer_admin users, trigger onboarding if this is the first admin user for the tenant
      if (role === 'customer_admin') {
        try {
          const tenantUsers = await storage.getTenantUsers(tenantId);
          const adminUsers = tenantUsers.filter(u => u.role === 'customer_admin');
          
          // If this is the first admin user, trigger onboarding
          if (adminUsers.length === 1) {
            const { customerOnboardingService } = await import("./customer-onboarding");
            
            customerOnboardingService.onboardNewCustomer({
              tenantId,
              email: user.email,
              firstName: user.firstName || undefined,
              lastName: user.lastName || undefined,
              organizationName: tenant.name
            }).then((result) => {
              if (result.success) {
                console.log(`[Admin Onboarding] Successfully onboarded customer: ${user.email}`, {
                  stripeCustomerId: result.stripeCustomerId,
                  botId: result.botId,
                  provisioningJobId: result.provisioningJobId
                });
              } else {
                console.warn(`[Admin Onboarding] Failed for customer: ${user.email}`, result.error);
              }
            }).catch((error) => {
              console.error(`[Admin Onboarding] Error for customer: ${user.email}`, error);
            });
          }
        } catch (onboardingError) {
          console.warn('[Admin] Could not trigger onboarding:', onboardingError);
        }
      }

      // Return user data (without password)
      const safeUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        createdAt: user.createdAt,
        tempPasswordSent: sendEmail
      };

      res.status(201).json(safeUser);
    } catch (error) {
      console.error('[Admin User Creation] Error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

/**
 * Generate a secure temporary password
 */
function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const specialChars = '!@#$%&*';
  let password = '';
  
  // Ensure at least one of each type
  password += chars.charAt(Math.floor(Math.random() * 26)); // Uppercase
  password += chars.charAt(Math.floor(Math.random() * 26) + 26); // Lowercase  
  password += chars.charAt(Math.floor(Math.random() * 8) + 52); // Number
  password += specialChars.charAt(Math.floor(Math.random() * specialChars.length)); // Special
  
  // Fill the rest randomly
  for (let i = 4; i < 12; i++) {
    const allChars = chars + specialChars;
    password += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Send welcome email with login credentials
 */
async function sendWelcomeEmail(data: {
  email: string;
  firstName?: string;
  lastName?: string;
  tempPassword: string;
  tenantName: string;
  loginUrl: string;
}): Promise<void> {
  const { emailService } = await import('./email-service');
  
  const result = await emailService.sendWelcomeEmail(data);
  
  if (!result.success) {
    console.warn(`[WELCOME EMAIL] Failed to send to ${data.email}: ${result.error}`);
    // Don't throw error - email failure shouldn't block user creation
    // The email service will fallback to console logging if SendGrid fails
  }
}
