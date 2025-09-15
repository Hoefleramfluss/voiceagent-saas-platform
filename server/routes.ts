import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { setupAuth, requireAuth, requireRole, requireTenantAccess } from "./auth";
import { hashPassword } from "./auth";
import { storage } from "./storage";
import { insertTenantSchema, insertBotSchema, insertSupportTicketSchema, insertApiKeySchema, insertUsageEventSchema, insertPhoneNumberMappingSchema, updatePhoneNumberMappingSchema, insertFlowSchema } from "@shared/schema";
import { z } from "zod";
import { encryptApiKey, decryptApiKey, maskApiKey } from "./crypto";
import { keyLoader, getStripeKey, getStripeWebhookSecret, invalidateKeyCache } from "./key-loader";
import { billingCalculator } from "./billing-calculator";
import { enhancedBillingCalculator } from "./enhanced-billing-calculator";
import { stripeInvoiceService } from "./stripe-invoice-service";
import { stripeWebhookService } from "./stripe-webhook-service";
import { automatedInvoiceService } from "./automated-invoice-service";
import { getSystemHealth, ErrorMonitor } from "./error-handling";
import { getResilienceHealth } from "./retry-utils";
import { runEnterpriseTestsEndpoint } from "./enterprise-tests";
import { 
  apiKeyRateLimit, 
  criticalKeyOperationsRateLimit, 
  requireRecentAuth, 
  requireExplicitConfirmation, 
  auditSensitiveOperation, 
  requireAllowedIP, 
  logApiKeyAccess, 
  validateOperationPermissions,
  demoTenantRateLimit,
  phoneVerificationRateLimit,
  resendCodeRateLimit,
  oauthAuthorizationRateLimit,
  oauthCallbackRateLimit
} from "./security-controls";
import rateLimit from "express-rate-limit";
import { normalizePhoneNumber, validateBotOwnership } from "./phone-security-utils";
import { createTwilioValidationMiddleware } from "./twilio-verification";
import { 
  enterpriseDemoRateLimit, 
  enterprisePhoneVerificationRateLimit, 
  enterpriseAuthRateLimit,
  enterpriseTwilioWebhookRateLimit
} from "./enterprise-security";
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
        // Using latest stable API version by omitting apiVersion parameter
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

  // Apply enterprise hardening security controls
  const { 
    enforceHTTPS, 
    setEnterpriseSecurityHeaders, 
    applyWAFRules, 
    detectTenantScopeViolations,
    getSecurityMetrics,
    resetSecurityMetrics
  } = await import('./enterprise-hardening');
  
  // Global security middleware (order matters!)
  app.use(enforceHTTPS);                    // HTTPS enforcement first
  app.use(setEnterpriseSecurityHeaders);    // Security headers
  app.use(applyWAFRules);                   // WAF rules before other processing
  
  // Apply tenant scope detection to authenticated routes
  app.use('/api', detectTenantScopeViolations);

  // Enterprise security metrics endpoints
  app.get("/api/admin/security/metrics", 
    requireAuth, 
    requireRole(['platform_admin']),
    getSecurityMetrics
  );
  
  app.post("/api/admin/security/reset-metrics", 
    requireAuth, 
    requireRole(['platform_admin']),
    requireAllowedIP,
    auditSensitiveOperation('RESET_SECURITY_METRICS'),
    resetSecurityMetrics
  );
  
  // Enterprise Tests Endpoint (Admin Only)
  app.post("/api/admin/security/tests", 
    requireAuth, 
    requireRole(['platform_admin']),
    runEnterpriseTestsEndpoint
  );

  // Demo tenant setup endpoints (no auth required for demo)
  app.post("/api/demo/create-tenant", demoTenantRateLimit, async (req, res) => {
    try {
      const { demoTenantService } = await import("./demo-tenant-service");
      const { validatePhoneNumber } = await import("./phone-security-utils");
      
      const validation = z.object({
        companyName: z.string().min(1, "Company name is required"),
        contactEmail: z.string().email("Valid email address required"),
        contactPhone: z.string().refine((phone) => {
          const result = validatePhoneNumber(phone, { allowTestNumbers: true });
          return result.isValid;
        }, "Valid phone number in E.164 format required"),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        industry: z.string().min(1, "Industry is required"),
        useCase: z.string().min(1, "Use case is required")
      }).safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          success: false,
          error: "Validation failed",
          details: validation.error.flatten() 
        });
      }
      
      const result = await demoTenantService.createDemoTenant(validation.data);
      res.json(result);
      
    } catch (error) {
      console.error('[Demo API] Create tenant error:', error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });
  
  app.post("/api/demo/verify-phone", phoneVerificationRateLimit, async (req, res) => {
    try {
      const { demoTenantService } = await import("./demo-tenant-service");
      
      const validation = z.object({
        tenantId: z.string().min(1, "Tenant ID is required"),
        code: z.string().length(6, "Verification code must be 6 digits")
      }).safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          success: false,
          error: "Validation failed" 
        });
      }
      
      const result = await demoTenantService.verifyPhoneNumber(
        validation.data.tenantId, 
        validation.data.code
      );
      res.json(result);
      
    } catch (error) {
      console.error('[Demo API] Verify phone error:', error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });
  
  app.post("/api/demo/resend-code", resendCodeRateLimit, async (req, res) => {
    try {
      const { demoTenantService } = await import("./demo-tenant-service");
      
      const validation = z.object({
        tenantId: z.string().min(1, "Tenant ID is required")
      }).safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          success: false,
          error: "Validation failed" 
        });
      }
      
      const result = await demoTenantService.resendVerificationCode(validation.data.tenantId);
      res.json(result);
      
    } catch (error) {
      console.error('[Demo API] Resend code error:', error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

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
        // Handle Stripe configuration issues gracefully
        const errorMessage = stripeError instanceof Error ? stripeError.message : 'Unknown error';
        console.warn(`[Health Check] Stripe unavailable: ${errorMessage}`);
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

  // Enhanced system health check with error monitoring (Admin only)
  app.get("/api/health/detailed", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const systemHealth = getSystemHealth();
      const resilienceHealth = getResilienceHealth();
      
      // Get additional system metrics
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      
      res.json({
        ...systemHealth,
        resilience: resilienceHealth,
        system: {
          uptime: Math.floor(uptime),
          memory: {
            rss: Math.floor(memoryUsage.rss / 1024 / 1024) + 'MB',
            heapTotal: Math.floor(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
            heapUsed: Math.floor(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
            external: Math.floor(memoryUsage.external / 1024 / 1024) + 'MB'
          },
          nodeVersion: process.version,
          pid: process.pid
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 📋 AUDIT LOGS API - Admin audit trail viewing
  app.get("/api/audit-logs", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const {
        limit = '50',
        offset = '0',
        tenantId,
        userId,
        eventType,
        startDate,
        endDate
      } = req.query;

      const options: Parameters<typeof storage.getAuditLogs>[0] = {
        limit: Math.min(parseInt(limit as string, 10), 1000), // Max 1000 logs
        offset: parseInt(offset as string, 10),
        tenantId: tenantId as string,
        userId: userId as string,
        eventType: eventType as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined
      };

      const auditLogs = await storage.getAuditLogs(options);
      
      res.json({
        logs: auditLogs,
        pagination: {
          limit: options.limit,
          offset: options.offset,
          hasMore: auditLogs.length === options.limit
        }
      });
    } catch (error) {
      console.error('[Audit Logs API] Get audit logs error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Error monitoring endpoint (Admin only)
  app.get("/api/monitoring/errors", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const errorStats = ErrorMonitor.getErrorStats();
      res.json(errorStats);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Circuit breaker status endpoint (Admin only)
  app.get("/api/monitoring/circuit-breakers", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const resilienceHealth = getResilienceHealth();
      res.json(resilienceHealth);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
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

  // Admin tenant management endpoints (aliases for admin UI consistency)
  app.get("/api/admin/tenants", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const tenants = await storage.getTenants();
      res.json(tenants);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/admin/tenants", requireAuth, requireRole(['platform_admin']), async (req, res) => {
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

  app.get("/api/admin/tenants/:tenantId", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const tenant = await storage.getTenant(req.params.tenantId);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }
      res.json(tenant);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.put("/api/admin/tenants/:tenantId", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const validation = insertTenantSchema.partial().safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const tenant = await storage.updateTenant(req.params.tenantId, validation.data);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }
      
      res.json(tenant);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/admin/tenants/:tenantId", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      await storage.deleteTenant(req.params.tenantId);
      res.json({ message: "Tenant deleted successfully" });
    } catch (error) {
      if ((error as Error).message.includes('not found') || (error as Error).message.includes('Not found')) {
        return res.status(404).json({ message: "Tenant not found" });
      }
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/admin/tenants/:tenantId/users", requireAuth, requireRole(['platform_admin']), async (req, res) => {
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
        tenantId: z.string().optional(),
        systemPrompt: z.string()
          .min(1, "System prompt is required")
          .max(10000, "System prompt must be less than 10,000 characters")
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

      // Create partial validation schema for updates (all fields optional)
      const updateBotSchema = insertBotSchema.partial().extend({
        systemPrompt: z.string()
          .min(1, "System prompt is required")
          .max(10000, "System prompt must be less than 10,000 characters")
          .optional()
      });

      const validation = updateBotSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const bot = await storage.updateBot(req.params.botId, validation.data);
      res.json(bot);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Flow Builder System - Comprehensive Flow API
  const { FlowJsonSchema, FlowValidator, FlowTemplates } = await import("@shared/flow-schema");

  // Rate limiting for flow operations
  const flowOperationsRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 flow operations per windowMs
    message: 'Too many flow operations, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  const flowCreationRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // limit each IP to 20 flow creations per hour
    message: 'Too many flow creations, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  const flowVersionRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // limit each IP to 50 version operations per windowMs
    message: 'Too many flow version operations, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Flow CRUD API - Customer Admin/User access with tenant isolation
  app.get("/api/flows", requireAuth, flowOperationsRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { limit = 50, offset = 0, includeTemplates = false } = req.query;
      const pageSize = Math.min(parseInt(limit as string), 100);
      const startIndex = parseInt(offset as string);

      const flows = await storage.getFlows(user.tenantId);
      
      // Filter templates if not requested
      const filteredFlows = includeTemplates === 'true' 
        ? flows 
        : flows.filter(flow => !flow.isTemplate);

      // Apply pagination
      const paginatedFlows = filteredFlows.slice(startIndex, startIndex + pageSize);

      // Enrich with version information
      const flowsWithVersions = await Promise.all(
        paginatedFlows.map(async (flow) => {
          const versions = await storage.getFlowVersions(flow.id, user.tenantId!);
          const liveVersion = versions.find(v => v.status === 'live');
          const stagedVersion = versions.find(v => v.status === 'staged');
          const draftVersion = versions.find(v => v.status === 'draft');
          
          return {
            ...flow,
            versionInfo: {
              total: versions.length,
              hasLive: !!liveVersion,
              hasStaged: !!stagedVersion,
              hasDraft: !!draftVersion,
              latestVersion: Math.max(...versions.map(v => v.version), 0)
            }
          };
        })
      );

      res.json({
        flows: flowsWithVersions,
        total: filteredFlows.length,
        limit: pageSize,
        offset: startIndex
      });
    } catch (error) {
      console.error('[Flow API] Get flows error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/flows", requireAuth, flowCreationRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      // Validate flow data - omit tenantId to prevent user-supplied tenant scoping
      const validation = insertFlowSchema.omit({ tenantId: true }).extend({
        initialFlowJson: FlowJsonSchema.optional()
      }).safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({
          message: "Validation failed",
          errors: validation.error.flatten()
        });
      }

      const flowData = validation.data;
      const { initialFlowJson, ...flowMetadata } = flowData;

      // Create flow
      const flow = await storage.createFlow({
        ...flowMetadata,
        tenantId: user.tenantId
      });

      // Create initial draft version if flowJson provided
      if (initialFlowJson) {
        const flowValidation = FlowValidator.validateFlow(initialFlowJson);
        
        const version = await storage.createFlowVersion({
          flowId: flow.id,
          version: 1,
          status: 'draft',
          flowJson: initialFlowJson
        }, user.tenantId);

        // Create audit log
        await storage.createAuditLog({
          tenantId: user.tenantId,
          userId: user.id,
          eventType: 'sensitive_operation',
          operation: 'FLOW_CREATE_WITH_VERSION',
          success: true,
          metadata: {
            flowId: flow.id,
            versionId: version.id,
            flowName: flow.name,
            isValid: flowValidation.isValid,
            errors: flowValidation.errors
          }
        });

        res.status(201).json({
          ...flow,
          currentVersion: version,
          validation: flowValidation
        });
      } else {
        // Create audit log for flow creation
        await storage.createAuditLog({
          tenantId: user.tenantId,
          userId: user.id,
          eventType: 'sensitive_operation',
          operation: 'FLOW_CREATE',
          success: true,
          metadata: {
            flowId: flow.id,
            flowName: flow.name
          }
        });

        res.status(201).json(flow);
      }
    } catch (error) {
      console.error('[Flow API] Create flow error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/flows/:id", requireAuth, flowOperationsRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id } = req.params;
      const { includeVersions = 'true' } = req.query;

      const flow = await storage.getFlow(id, user.tenantId);
      if (!flow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      if (includeVersions === 'true') {
        const versions = await storage.getFlowVersions(id, user.tenantId);
        const liveVersion = await storage.getFlowVersionByStatus(id, 'live', user.tenantId);
        const stagedVersion = await storage.getFlowVersionByStatus(id, 'staged', user.tenantId);
        const draftVersion = await storage.getFlowVersionByStatus(id, 'draft', user.tenantId);

        res.json({
          ...flow,
          versions: versions.map(v => ({
            ...v,
            flowJson: undefined // Don't include full JSON in list
          })),
          currentVersions: {
            live: liveVersion,
            staged: stagedVersion,
            draft: draftVersion
          }
        });
      } else {
        res.json(flow);
      }
    } catch (error) {
      console.error('[Flow API] Get flow error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.patch("/api/flows/:id", requireAuth, flowOperationsRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id } = req.params;
      
      // Check if flow exists and user has access
      const existingFlow = await storage.getFlow(id, user.tenantId);
      if (!existingFlow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      // Validate update data (only allow certain fields to be updated)
      const updateFlowSchema = z.object({
        name: z.string().min(1).max(255).optional(),
        description: z.string().max(1000).optional(),
        isTemplate: z.boolean().optional(),
        templateVariables: z.record(z.any()).optional()
      });

      const validation = updateFlowSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: "Validation failed",
          errors: validation.error.flatten()
        });
      }

      const updatedFlow = await storage.updateFlow(id, user.tenantId, validation.data);

      // Create audit log
      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        eventType: 'sensitive_operation',
        operation: 'FLOW_UPDATE',
        success: true,
        metadata: {
          flowId: id,
          flowName: updatedFlow.name,
          updates: validation.data
        }
      });

      res.json(updatedFlow);
    } catch (error) {
      console.error('[Flow API] Update flow error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/flows/:id", requireAuth, flowOperationsRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id } = req.params;
      
      // Check if flow exists and user has access
      const existingFlow = await storage.getFlow(id, user.tenantId);
      if (!existingFlow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      // Check if flow is being used by any bots
      const bots = await storage.getBots(user.tenantId);
      const botsUsingFlow = bots.filter(bot => bot.currentFlowId === id);
      
      if (botsUsingFlow.length > 0) {
        return res.status(400).json({
          message: "Cannot delete flow - it is currently being used by active bots",
          usedBy: botsUsingFlow.map(bot => ({ id: bot.id, name: bot.name }))
        });
      }

      await storage.deleteFlow(id, user.tenantId);

      // Create audit log
      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        eventType: 'sensitive_operation',
        operation: 'FLOW_DELETE',
        success: true,
        metadata: {
          flowId: id,
          flowName: existingFlow.name
        }
      });

      res.json({ message: "Flow deleted successfully" });
    } catch (error) {
      console.error('[Flow API] Delete flow error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Flow Version API - Complete versioning workflow
  app.get("/api/flows/:id/versions", requireAuth, flowVersionRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id } = req.params;
      const { includeFlowJson = 'false' } = req.query;

      // Verify flow access
      const flow = await storage.getFlow(id, user.tenantId);
      if (!flow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      const versions = await storage.getFlowVersions(id, user.tenantId);

      // Optionally exclude flowJson for performance
      const responseVersions = versions.map(version => {
        if (includeFlowJson === 'false') {
          const { flowJson, ...versionWithoutJson } = version;
          return {
            ...versionWithoutJson,
            hasFlowJson: !!flowJson,
            validation: flowJson ? FlowValidator.validateFlow(flowJson) : null
          };
        }
        return {
          ...version,
          validation: FlowValidator.validateFlow(version.flowJson)
        };
      });

      res.json({
        flowId: id,
        flowName: flow.name,
        versions: responseVersions
      });
    } catch (error) {
      console.error('[Flow API] Get flow versions error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/flows/:id/versions", requireAuth, flowVersionRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id } = req.params;

      // Verify flow access
      const flow = await storage.getFlow(id, user.tenantId);
      if (!flow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      // Validate flow JSON
      const { flowJson } = req.body;
      if (!flowJson) {
        return res.status(400).json({ message: "flowJson is required" });
      }

      const flowValidation = FlowValidator.validateFlow(flowJson);
      if (!flowValidation.isValid) {
        return res.status(400).json({
          message: "Invalid flow JSON",
          validation: flowValidation
        });
      }

      // Get next version number
      const existingVersions = await storage.getFlowVersions(id, user.tenantId);
      const nextVersion = Math.max(...existingVersions.map(v => v.version), 0) + 1;

      // Check if there's already a draft version
      const existingDraft = await storage.getFlowVersionByStatus(id, 'draft', user.tenantId);
      if (existingDraft) {
        return res.status(400).json({
          message: "A draft version already exists. Please update the existing draft or promote it first.",
          existingDraft: { id: existingDraft.id, version: existingDraft.version }
        });
      }

      const version = await storage.createFlowVersion({
        flowId: id,
        version: nextVersion,
        status: 'draft',
        flowJson
      }, user.tenantId);

      // Create audit log
      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        eventType: 'sensitive_operation',
        operation: 'FLOW_VERSION_CREATE',
        success: true,
        metadata: {
          flowId: id,
          versionId: version.id,
          version: version.version,
          flowName: flow.name,
          validation: flowValidation
        }
      });

      res.status(201).json({
        ...version,
        validation: flowValidation
      });
    } catch (error) {
      console.error('[Flow API] Create flow version error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/flows/:id/versions/:versionId", requireAuth, flowVersionRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id, versionId } = req.params;

      // Verify flow access
      const flow = await storage.getFlow(id, user.tenantId);
      if (!flow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      const version = await storage.getFlowVersion(versionId, user.tenantId);
      if (!version || version.flowId !== id) {
        return res.status(404).json({ message: "Flow version not found" });
      }

      const validation = FlowValidator.validateFlow(version.flowJson);

      res.json({
        ...version,
        validation
      });
    } catch (error) {
      console.error('[Flow API] Get flow version error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.patch("/api/flows/:id/versions/:versionId", requireAuth, flowVersionRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id, versionId } = req.params;

      // Verify flow and version access
      const flow = await storage.getFlow(id, user.tenantId);
      if (!flow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      const version = await storage.getFlowVersion(versionId, user.tenantId);
      if (!version || version.flowId !== id) {
        return res.status(404).json({ message: "Flow version not found" });
      }

      // Only draft versions can be updated
      if (version.status !== 'draft') {
        return res.status(400).json({
          message: "Only draft versions can be updated. Create a new version to modify staged or live flows."
        });
      }

      const { flowJson } = req.body;
      if (!flowJson) {
        return res.status(400).json({ message: "flowJson is required" });
      }

      const flowValidation = FlowValidator.validateFlow(flowJson);
      if (!flowValidation.isValid) {
        return res.status(400).json({
          message: "Invalid flow JSON",
          validation: flowValidation
        });
      }

      const updatedVersion = await storage.updateFlowVersion(versionId, user.tenantId, {
        flowJson,
        updatedAt: new Date()
      });

      // Create audit log
      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        eventType: 'sensitive_operation',
        operation: 'FLOW_VERSION_UPDATE',
        success: true,
        metadata: {
          flowId: id,
          versionId,
          version: version.version,
          flowName: flow.name,
          validation: flowValidation
        }
      });

      res.json({
        ...updatedVersion,
        validation: flowValidation
      });
    } catch (error) {
      console.error('[Flow API] Update flow version error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/flows/:id/versions/:versionId/promote", requireAuth, flowVersionRateLimit, auditSensitiveOperation('FLOW_VERSION_PROMOTE'), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id, versionId } = req.params;
      const { targetStatus } = req.body;

      if (!targetStatus || !['staged', 'live'].includes(targetStatus)) {
        return res.status(400).json({
          message: "targetStatus must be 'staged' or 'live'"
        });
      }

      // Verify flow and version access
      const flow = await storage.getFlow(id, user.tenantId);
      if (!flow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      const version = await storage.getFlowVersion(versionId, user.tenantId);
      if (!version || version.flowId !== id) {
        return res.status(404).json({ message: "Flow version not found" });
      }

      // Validate promotion workflow
      if (targetStatus === 'staged' && version.status !== 'draft') {
        return res.status(400).json({
          message: "Only draft versions can be promoted to staged"
        });
      }

      if (targetStatus === 'live' && !['draft', 'staged'].includes(version.status)) {
        return res.status(400).json({
          message: "Only draft or staged versions can be promoted to live"
        });
      }

      // Validate flow JSON before promotion
      const flowValidation = FlowValidator.validateFlow(version.flowJson);
      if (!flowValidation.isValid) {
        return res.status(400).json({
          message: "Cannot promote invalid flow",
          validation: flowValidation
        });
      }

      // Get all bots using this flow (needed for audit metadata)
      const bots = await storage.getBots(user.tenantId);
      const botsUsingFlow = bots.filter(bot => bot.currentFlowId === id);

      // For live promotion, demote current live version if exists
      if (targetStatus === 'live') {
        const currentLive = await storage.getFlowVersionByStatus(id, 'live', user.tenantId);
        if (currentLive && currentLive.id !== versionId) {
          await storage.archiveFlowVersion(currentLive.id, user.tenantId);
        }

        // Update all bots using this flow to the new live version
        for (const bot of botsUsingFlow) {
          // The currentFlowId stays the same, but the live version changes
          // This could trigger bot redeployment in a real system
        }
      }

      const promotedVersion = await storage.publishFlowVersion(versionId, user.tenantId, user.id);

      // Create audit log
      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        eventType: 'sensitive_operation',
        operation: 'FLOW_VERSION_PROMOTE',
        success: true,
        metadata: {
          flowId: id,
          versionId,
          version: version.version,
          flowName: flow.name,
          fromStatus: version.status,
          toStatus: targetStatus,
          affectedBots: targetStatus === 'live' ? (botsUsingFlow?.length || 0) : 0
        }
      });

      res.json({
        ...promotedVersion,
        validation: flowValidation,
        message: `Flow version promoted to ${targetStatus} successfully`
      });
    } catch (error) {
      console.error('[Flow API] Promote flow version error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/flows/:id/versions/:versionId/archive", requireAuth, flowVersionRateLimit, auditSensitiveOperation('FLOW_VERSION_ARCHIVE'), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { id, versionId } = req.params;

      // Verify flow and version access
      const flow = await storage.getFlow(id, user.tenantId);
      if (!flow) {
        return res.status(404).json({ message: "Flow not found" });
      }

      const version = await storage.getFlowVersion(versionId, user.tenantId);
      if (!version || version.flowId !== id) {
        return res.status(404).json({ message: "Flow version not found" });
      }

      // Cannot archive live versions
      if (version.status === 'live') {
        return res.status(400).json({
          message: "Cannot archive live version. Promote another version to live first."
        });
      }

      const archivedVersion = await storage.archiveFlowVersion(versionId, user.tenantId);

      // Create audit log
      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        eventType: 'sensitive_operation',
        operation: 'FLOW_VERSION_ARCHIVE',
        success: true,
        metadata: {
          flowId: id,
          versionId,
          version: version.version,
          flowName: flow.name,
          previousStatus: version.status
        }
      });

      res.json({
        ...archivedVersion,
        message: "Flow version archived successfully"
      });
    } catch (error) {
      console.error('[Flow API] Archive flow version error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Flow Templates API - Utility endpoints for flow creation
  app.get("/api/flows/templates/basic-greeting", requireAuth, flowOperationsRateLimit, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { companyName, greetingMessage, systemPrompt } = req.query;
      
      if (!companyName) {
        return res.status(400).json({ message: "companyName query parameter is required" });
      }

      const template = FlowTemplates.createBasicGreetingFlow({
        companyName: companyName as string,
        greetingMessage: greetingMessage as string,
        systemPrompt: systemPrompt as string
      });

      const validation = FlowValidator.validateFlow(template);

      res.json({
        template,
        validation
      });
    } catch (error) {
      console.error('[Flow API] Get template error:', error);
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
      const { validatePhoneNumber, validateBotOwnership } = await import("./phone-security-utils");
      const { phoneNumber, tenantId, botId, friendlyName } = req.body;
      
      if (!phoneNumber || !tenantId || !botId) {
        return res.status(400).json({ message: "phoneNumber, tenantId, and botId are required" });
      }
      
      // SECURITY: Validate phone number format
      const phoneValidation = validatePhoneNumber(phoneNumber, { allowTestNumbers: false, strictMode: true });
      if (!phoneValidation.isValid) {
        return res.status(400).json({ message: `Invalid phone number: ${phoneValidation.error}` });
      }
      
      // SECURITY: Validate bot ownership
      try {
        await validateBotOwnership(botId, tenantId);
      } catch (error) {
        return res.status(403).json({ message: "Bot does not belong to this tenant" });
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
      const { validatePhoneNumber, validateBotOwnership, checkPhoneSecurityViolations } = await import("./phone-security-utils");
      const { numberSid, phoneNumber, tenantId, botId } = req.body;
      
      if (!numberSid || !phoneNumber || !tenantId || !botId) {
        return res.status(400).json({ 
          message: "numberSid, phoneNumber, tenantId, and botId are required" 
        });
      }
      
      // SECURITY: Validate phone number format
      const phoneValidation = validatePhoneNumber(phoneNumber, { allowTestNumbers: false, strictMode: true });
      if (!phoneValidation.isValid) {
        return res.status(400).json({ message: `Invalid phone number: ${phoneValidation.error}` });
      }
      
      // SECURITY: Check for cross-tenant violations
      const securityCheck = await checkPhoneSecurityViolations(phoneNumber, tenantId, botId);
      if (securityCheck.hasViolations) {
        return res.status(403).json({ 
          message: `Security violation: ${securityCheck.details}`,
          violations: securityCheck.violations
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

      // Use enhanced billing calculator for subscription-aware billing
      const result = await enhancedBillingCalculator.getEnhancedCurrentUsageAndCosts(user.tenantId);
      
      // Transform the result to match expected API format with enhanced data
      const response = {
        totalCostCents: result.totalCostCents,
        lineItems: result.billing.lineItems.map(item => ({
          kind: item.kind,
          quantity: item.quantity,
          totalAmountCents: item.totalAmountCents,
          name: item.name,
          description: item.description,
          freeAllowance: item.freeAllowance,
          usedFromFree: item.usedFromFree
        })),
        periodStart: result.billing.periodStart.toISOString(),
        periodEnd: result.billing.periodEnd.toISOString(),
        subscriptionPlan: result.billing.subscriptionPlan,
        minuteBreakdown: result.billing.minuteBreakdown
      };
      
      res.json(response);
    } catch (error) {
      console.error('[Billing] Enhanced usage error:', error);
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

  // 🎯 BILLING ACCOUNTS API - Manage billing account details
  app.get("/api/billing/accounts", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const billingAccount = await storage.getBillingAccount(user.tenantId);
      if (!billingAccount) {
        return res.status(404).json({ message: "No billing account found" });
      }

      res.json(billingAccount);
    } catch (error) {
      console.error('[Billing] Get billing account error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/billing/accounts", requireAuth, auditSensitiveOperation('CREATE_BILLING_ACCOUNT'), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      // SECURITY: No client input validation needed - we create customer server-side
      // Check if billing account already exists
      const existingAccount = await storage.getBillingAccount(user.tenantId);
      if (existingAccount) {
        return res.status(400).json({ message: "Billing account already exists" });
      }

      // Get tenant information for Stripe customer creation
      const tenant = await storage.getTenant(user.tenantId);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }

      // SECURITY FIX: Create Stripe customer server-side only
      const stripeInstance = await getStripe();
      if (!stripeInstance) {
        return res.status(503).json({ 
          message: "Stripe not configured. Contact administrator to configure payment processing." 
        });
      }

      let stripeCustomerId: string;
      try {
        // Generate idempotency key to prevent duplicate customers
        const customerIdempotencyKey = crypto.createHash('sha256')
          .update(`customer:${tenant.id}:${tenant.name}`)
          .digest('hex').substring(0, 32);

        const stripeCustomer = await stripeInstance.customers.create({
          name: tenant.name,
          email: user.email,
          description: `VoiceAgent customer for tenant: ${tenant.name}`,
          metadata: {
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            created_by: user.id,
            created_via: 'billing_account_api'
          }
        }, {
          idempotencyKey: customerIdempotencyKey
        });
        
        stripeCustomerId = stripeCustomer.id;
        console.log(`[Billing Security] Created Stripe customer ${stripeCustomerId} for tenant ${tenant.name}`);
      } catch (stripeError) {
        console.error('[Billing Security] Failed to create Stripe customer:', stripeError);
        
        // Audit log the failure
        await storage.createAuditLog({
          tenantId: user.tenantId,
          userId: user.id,
          eventType: 'sensitive_operation',
          operation: 'CREATE_BILLING_ACCOUNT_STRIPE_FAILED',
          resourceId: user.tenantId,
          details: {
            error: (stripeError as Error).message,
            tenantName: tenant.name
          }
        });
        
        return res.status(500).json({ 
          message: "Failed to create payment processing account. Please try again.",
          error: (stripeError as Error).message
        });
      }
      
      // Create billing account with server-created Stripe customer ID
      await storage.createBillingAccount({
        tenantId: user.tenantId,
        stripeCustomerId
      });

      // Audit log successful creation
      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        eventType: 'sensitive_operation',
        operation: 'CREATE_BILLING_ACCOUNT_SUCCESS',
        resourceId: user.tenantId,
        details: {
          stripeCustomerId,
          tenantName: tenant.name
        }
      });

      const newAccount = await storage.getBillingAccount(user.tenantId);
      res.status(201).json(newAccount);
    } catch (error) {
      console.error('[Billing Security] Create billing account error:', error);
      
      // Audit log the error
      try {
        await storage.createAuditLog({
          tenantId: user?.tenantId || 'unknown',
          userId: user?.id || 'unknown',
          eventType: 'sensitive_operation',
          operation: 'CREATE_BILLING_ACCOUNT_ERROR',
          resourceId: user?.tenantId || 'unknown',
          details: {
            error: (error as Error).message
          }
        });
      } catch (auditError) {
        console.error('[Billing Security] Audit logging failed:', auditError);
      }
      
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.put("/api/billing/accounts", requireAuth, auditSensitiveOperation('UPDATE_BILLING_ACCOUNT'), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      // SECURITY FIX: Strict validation with enum and plan ID checking
      const validation = z.object({
        stripeSubscriptionId: z.string().optional(),
        currentPlanId: z.string().uuid("Invalid plan ID format").optional(),
        subscriptionStatus: z.enum(['active', 'paused', 'canceled', 'expired'], {
          errorMap: () => ({ message: "Subscription status must be: active, paused, canceled, or expired" })
        }).optional(),
        paymentMethodId: z.string().optional(),
        subscriptionStartDate: z.string().datetime().optional(),
        subscriptionEndDate: z.string().datetime().optional(),
        nextBillingDate: z.string().datetime().optional()
      }).safeParse(req.body);

      if (!validation.success) {
        console.warn('[Billing Security] Invalid update data:', validation.error.flatten());
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      // Check if billing account exists
      const existingAccount = await storage.getBillingAccount(user.tenantId);
      if (!existingAccount) {
        return res.status(404).json({ message: "No billing account found" });
      }

      const updates = validation.data;
      const auditDetails: any = { originalValues: {}, newValues: updates };

      // SECURITY FIX: Validate currentPlanId against actual subscription plans
      if (updates.currentPlanId) {
        const subscriptionPlans = await storage.getSubscriptionPlans(true); // Only active plans
        const planExists = subscriptionPlans.some(plan => plan.id === updates.currentPlanId);
        
        if (!planExists) {
          console.warn(`[Billing Security] Invalid plan ID attempted: ${updates.currentPlanId} by user ${user.id}`);
          
          await storage.createAuditLog({
            tenantId: user.tenantId,
            userId: user.id,
            eventType: 'sensitive_operation',
            operation: 'UPDATE_BILLING_ACCOUNT_INVALID_PLAN',
            resourceId: user.tenantId,
            details: {
              attemptedPlanId: updates.currentPlanId,
              reason: 'Plan ID not found or inactive'
            }
          });
          
          return res.status(400).json({ message: "Invalid subscription plan ID" });
        }
        auditDetails.originalValues.currentPlanId = existingAccount.currentPlanId;
      }

      // SECURITY FIX: Verify Stripe subscription belongs to tenant's customer
      if (updates.stripeSubscriptionId) {
        const stripeInstance = await getStripe();
        if (!stripeInstance) {
          return res.status(503).json({ 
            message: "Stripe not configured. Cannot verify subscription." 
          });
        }

        try {
          // Verify the subscription belongs to this tenant's Stripe customer
          const stripeSubscription = await stripeInstance.subscriptions.retrieve(updates.stripeSubscriptionId);
          
          if (stripeSubscription.customer !== existingAccount.stripeCustomerId) {
            console.error(`[Billing Security] Subscription ${updates.stripeSubscriptionId} does not belong to customer ${existingAccount.stripeCustomerId}`);
            
            await storage.createAuditLog({
              tenantId: user.tenantId,
              userId: user.id,
              eventType: 'sensitive_operation',
              operation: 'UPDATE_BILLING_ACCOUNT_SUBSCRIPTION_MISMATCH',
              resourceId: user.tenantId,
              details: {
                attemptedSubscriptionId: updates.stripeSubscriptionId,
                tenantCustomerId: existingAccount.stripeCustomerId,
                actualCustomerId: stripeSubscription.customer
              }
            });
            
            return res.status(403).json({ message: "Subscription does not belong to this account" });
          }
          
          auditDetails.originalValues.stripeSubscriptionId = existingAccount.stripeSubscriptionId;
          auditDetails.stripeVerified = true;
          
        } catch (stripeError: any) {
          console.error('[Billing Security] Stripe subscription verification failed:', stripeError);
          
          await storage.createAuditLog({
            tenantId: user.tenantId,
            userId: user.id,
            eventType: 'sensitive_operation',
            operation: 'UPDATE_BILLING_ACCOUNT_STRIPE_VERIFICATION_FAILED',
            resourceId: user.tenantId,
            details: {
              subscriptionId: updates.stripeSubscriptionId,
              error: stripeError.message
            }
          });
          
          return res.status(400).json({ message: "Invalid or inaccessible Stripe subscription" });
        }
      }

      // Convert date strings to Date objects if provided
      const processedUpdates: any = { ...updates };
      if (updates.subscriptionStartDate) {
        processedUpdates.subscriptionStartDate = new Date(updates.subscriptionStartDate);
      }
      if (updates.subscriptionEndDate) {
        processedUpdates.subscriptionEndDate = new Date(updates.subscriptionEndDate);
      }
      if (updates.nextBillingDate) {
        processedUpdates.nextBillingDate = new Date(updates.nextBillingDate);
      }

      // Store original values for audit
      if (updates.subscriptionStatus) {
        auditDetails.originalValues.subscriptionStatus = existingAccount.subscriptionStatus;
      }
      if (updates.paymentMethodId) {
        auditDetails.originalValues.paymentMethodId = existingAccount.paymentMethodId;
      }

      // Apply the validated updates
      await storage.updateBillingAccount(user.tenantId, processedUpdates);

      // Audit log successful update
      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        eventType: 'sensitive_operation',
        operation: 'UPDATE_BILLING_ACCOUNT_SUCCESS',
        resourceId: user.tenantId,
        details: auditDetails
      });

      const updatedAccount = await storage.getBillingAccount(user.tenantId);
      console.log(`[Billing Security] Successfully updated billing account for tenant ${user.tenantId}`);
      res.json(updatedAccount);
      
    } catch (error) {
      console.error('[Billing Security] Update billing account error:', error);
      
      // Audit log the error
      try {
        await storage.createAuditLog({
          tenantId: user?.tenantId || 'unknown',
          userId: user?.id || 'unknown',
          eventType: 'sensitive_operation',
          operation: 'UPDATE_BILLING_ACCOUNT_ERROR',
          resourceId: user?.tenantId || 'unknown',
          details: {
            error: (error as Error).message,
            requestData: req.body
          }
        });
      } catch (auditError) {
        console.error('[Billing Security] Audit logging failed:', auditError);
      }
      
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Admin Package Management Routes
  app.get("/api/admin/packages", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const plans = await storage.getSubscriptionPlans(false); // Get all plans including inactive
      res.json(plans);
    } catch (error) {
      console.error('[Admin] Get packages error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/admin/packages", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      // Validate input using Zod
      const createPackageSchema = z.object({
        name: z.string().min(2),
        description: z.string().optional(),
        monthlyPriceEur: z.string(),
        yearlyPriceEur: z.string().optional(),
        features: z.array(z.string()),
        limits: z.object({}).optional(),
        freeVoiceBotMinutes: z.number().min(0),
        freeForwardingMinutes: z.number().min(0),
        voiceBotRatePerMinuteCents: z.number().min(1),
        forwardingRatePerMinuteCents: z.number().min(1),
        status: z.enum(['active', 'inactive', 'deprecated'])
      });
      
      const validation = createPackageSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid input", 
          errors: validation.error.issues 
        });
      }
      
      const packageData = validation.data;
      
      // Create package using storage
      const newPackage = await storage.createSubscriptionPlan({
        name: packageData.name,
        description: packageData.description || null,
        monthlyPriceEur: packageData.monthlyPriceEur,
        yearlyPriceEur: packageData.yearlyPriceEur || null,
        features: packageData.features,
        limits: packageData.limits || {},
        freeVoiceBotMinutes: packageData.freeVoiceBotMinutes,
        freeForwardingMinutes: packageData.freeForwardingMinutes,
        voiceBotRatePerMinuteCents: packageData.voiceBotRatePerMinuteCents,
        forwardingRatePerMinuteCents: packageData.forwardingRatePerMinuteCents,
        status: packageData.status,
        sortOrder: 0
      });
      
      res.json(newPackage);
    } catch (error) {
      console.error('[Admin] Create package error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.put("/api/admin/packages/:id", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Validate input
      const updatePackageSchema = z.object({
        name: z.string().min(2).optional(),
        description: z.string().optional(),
        monthlyPriceEur: z.string().optional(),
        yearlyPriceEur: z.string().optional(),
        features: z.array(z.string()).optional(),
        limits: z.object({}).optional(),
        freeVoiceBotMinutes: z.number().min(0).optional(),
        freeForwardingMinutes: z.number().min(0).optional(),
        voiceBotRatePerMinuteCents: z.number().min(1).optional(),
        forwardingRatePerMinuteCents: z.number().min(1).optional(),
        status: z.enum(['active', 'inactive', 'deprecated']).optional()
      });
      
      const validation = updatePackageSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid input", 
          errors: validation.error.issues 
        });
      }
      
      // Update package
      const updatedPackage = await storage.updateSubscriptionPlan(id, validation.data);
      
      if (!updatedPackage) {
        return res.status(404).json({ message: "Package not found" });
      }
      
      res.json(updatedPackage);
    } catch (error) {
      console.error('[Admin] Update package error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/admin/packages/:id", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if package exists and can be deleted
      const existingPackage = await storage.getSubscriptionPlan(id);
      if (!existingPackage) {
        return res.status(404).json({ message: "Package not found" });
      }
      
      // For safety, set to deprecated instead of actual deletion
      await storage.updateSubscriptionPlan(id, { status: 'deprecated' });
      
      res.json({ message: "Package deprecated successfully" });
    } catch (error) {
      console.error('[Admin] Delete package error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Phone Mapping CRUD API - Platform Admin Only
  app.get("/api/admin/phone-mappings", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { tenantId, limit = 50, offset = 0 } = req.query;
      const pageSize = parseInt(limit as string);
      const startIndex = parseInt(offset as string);
      
      // If tenantId is provided, get mappings for specific tenant, otherwise get all
      if (tenantId) {
        // Validate tenant exists
        const tenant = await storage.getTenant(tenantId as string);
        if (!tenant) {
          return res.status(404).json({ message: "Tenant not found" });
        }
        
        const allMappings = await storage.getPhoneNumberMappings(tenantId as string);
        
        // Add tenant name annotation and apply pagination
        const mappingsWithTenantInfo = allMappings.map(mapping => ({
          ...mapping,
          tenantName: tenant.name
        }));
        
        const paginatedMappings = mappingsWithTenantInfo.slice(startIndex, startIndex + pageSize);
        
        // FIXED: Consistent response format with pagination
        res.json({
          mappings: paginatedMappings,
          total: allMappings.length,
          limit: pageSize,
          offset: startIndex
        });
      } else {
        // Get all phone mappings with tenant info (admin view)
        const allTenants = await storage.getTenants();
        const mappingsWithTenantInfo = [];
        
        for (const tenant of allTenants) {
          const mappings = await storage.getPhoneNumberMappings(tenant.id);
          for (const mapping of mappings) {
            mappingsWithTenantInfo.push({
              ...mapping,
              tenantName: tenant.name
            });
          }
        }
        
        // Apply pagination
        const paginatedMappings = mappingsWithTenantInfo.slice(startIndex, startIndex + pageSize);
        
        res.json({
          mappings: paginatedMappings,
          total: mappingsWithTenantInfo.length,
          limit: pageSize,
          offset: startIndex
        });
      }
    } catch (error) {
      console.error('[Admin] Get phone mappings error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/admin/phone-mappings", requireAuth, requireRole(['platform_admin']), auditSensitiveOperation('CREATE_PHONE_MAPPING'), async (req, res) => {
    try {
      // FIXED: Use shared validation schema from insertPhoneNumberMappingSchema
      
      const validation = insertPhoneNumberMappingSchema.safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const data = validation.data;

      // SECURITY: Normalize phone number to E.164 format
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizePhoneNumber(data.phoneNumber);
      } catch (error) {
        return res.status(400).json({ 
          message: "Invalid phone number format",
          details: error instanceof Error ? error.message : "Phone normalization failed"
        });
      }

      // SECURITY: Validate tenant exists
      const tenant = await storage.getTenant(data.tenantId);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }

      // SECURITY: Validate bot ownership if botId is provided
      if (data.botId) {
        try {
          await validateBotOwnership(data.botId, data.tenantId);
        } catch (error) {
          return res.status(403).json({ 
            message: "Bot does not belong to this tenant or does not exist" 
          });
        }
      }

      // Check for existing active mapping with same phone number
      const existingMapping = await storage.getPhoneNumberMappingByPhone(normalizedPhone);
      if (existingMapping && existingMapping.isActive) {
        return res.status(409).json({ 
          message: "Phone number already has an active mapping",
          existingMapping: {
            id: existingMapping.id,
            tenantId: existingMapping.tenantId,
            phoneNumber: existingMapping.phoneNumber
          }
        });
      }

      // Create the mapping with normalized phone number
      const mapping = await storage.createPhoneNumberMapping({
        ...data,
        phoneNumber: normalizedPhone
      });

      res.status(201).json(mapping);
    } catch (error) {
      console.error('[Admin] Create phone mapping error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.patch("/api/admin/phone-mappings/:id", requireAuth, requireRole(['platform_admin']), auditSensitiveOperation('UPDATE_PHONE_MAPPING'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // FIXED: Use shared validation schema for partial updates
      const validation = updatePhoneNumberMappingSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const updates = validation.data;

      // First, get the existing mapping to validate tenant access and get current tenantId
      // We need to try different tenants since we don't know which tenant this mapping belongs to
      const allTenants = await storage.getTenants();
      let existingMapping = null;
      let tenantId = null;

      for (const tenant of allTenants) {
        const mapping = await storage.getPhoneNumberMapping(id, tenant.id);
        if (mapping) {
          existingMapping = mapping;
          tenantId = tenant.id;
          break;
        }
      }

      if (!existingMapping || !tenantId) {
        return res.status(404).json({ message: "Phone mapping not found" });
      }

      // Process phone number normalization if provided
      if (updates.phoneNumber) {
        try {
          updates.phoneNumber = normalizePhoneNumber(updates.phoneNumber);
          
          // Check for conflicts with other active mappings
          const existingWithPhone = await storage.getPhoneNumberMappingByPhone(updates.phoneNumber);
          if (existingWithPhone && existingWithPhone.id !== id && existingWithPhone.isActive) {
            return res.status(409).json({ 
              message: "Phone number already has an active mapping",
              conflictingMapping: {
                id: existingWithPhone.id,
                tenantId: existingWithPhone.tenantId
              }
            });
          }
        } catch (error) {
          return res.status(400).json({ 
            message: "Invalid phone number format",
            details: error instanceof Error ? error.message : "Phone normalization failed"
          });
        }
      }

      // SECURITY: Validate bot ownership if botId is being changed
      if (updates.botId) {
        try {
          await validateBotOwnership(updates.botId, tenantId);
        } catch (error) {
          return res.status(403).json({ 
            message: "Bot does not belong to this tenant or does not exist" 
          });
        }
      }

      // Update the mapping
      const updatedMapping = await storage.updatePhoneNumberMapping(id, tenantId, updates);
      res.json(updatedMapping);
    } catch (error) {
      console.error('[Admin] Update phone mapping error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/admin/phone-mappings/:id", requireAuth, requireRole(['platform_admin']), auditSensitiveOperation('DELETE_PHONE_MAPPING'), async (req, res) => {
    try {
      const { id } = req.params;

      // Find the mapping across all tenants to ensure we can delete it
      const allTenants = await storage.getTenants();
      let foundMapping = false;
      let tenantId = null;

      for (const tenant of allTenants) {
        const mapping = await storage.getPhoneNumberMapping(id, tenant.id);
        if (mapping) {
          foundMapping = true;
          tenantId = tenant.id;
          break;
        }
      }

      if (!foundMapping || !tenantId) {
        return res.status(404).json({ message: "Phone mapping not found" });
      }

      // Delete the mapping
      await storage.deletePhoneNumberMapping(id, tenantId);
      
      res.json({ message: "Phone mapping deleted successfully" });
    } catch (error) {
      console.error('[Admin] Delete phone mapping error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Subscription Management Routes
  app.get("/api/subscription/plans", requireAuth, requireTenantAccess, async (req, res) => {
    try {
      const plans = await storage.getSubscriptionPlans(true); // Only active plans
      res.json(plans);
    } catch (error) {
      console.error('[Subscription] Get plans error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/subscription/current", requireAuth, requireTenantAccess, async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const subscription = await storage.getTenantSubscription(user.tenantId);
      res.json(subscription);
    } catch (error) {
      console.error('[Subscription] Get current error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/subscription/change", requireAuth, requireTenantAccess, requireRole(['customer_admin', 'platform_admin']), async (req, res) => {
    try {
      const user = req.user;
      
      // Validate input using Zod
      const subscriptionChangeSchema = z.object({
        planId: z.string().uuid("Plan ID must be a valid UUID"),
        billingCycle: z.enum(['monthly', 'yearly'], { 
          errorMap: () => ({ message: "Billing cycle must be 'monthly' or 'yearly'" })
        })
      });
      
      const validation = subscriptionChangeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid input", 
          errors: validation.error.issues 
        });
      }
      
      const { planId, billingCycle } = validation.data;
      
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      // Verify the plan exists and is active
      const plan = await storage.getSubscriptionPlan(planId);
      if (!plan || plan.status !== 'active') {
        return res.status(404).json({ message: "Subscription plan not found or inactive" });
      }

      // Calculate subscription dates
      const startDate = new Date();
      const endDate = new Date();
      if (billingCycle === 'yearly') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      // Update tenant subscription
      await storage.updateTenantSubscription(user.tenantId, {
        planId,
        subscriptionStatus: 'active',
        startDate,
        endDate,
        nextBillingDate: endDate
      });

      res.json({ 
        message: "Subscription updated successfully",
        plan: plan.name,
        billingCycle,
        nextBillingDate: endDate
      });
    } catch (error) {
      console.error('[Subscription] Change plan error:', error);
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
          const amount = parseFloat(invoice.totalAmount); // Already decimal
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

  // Automated Invoice Generation Admin Routes
  app.post("/api/admin/invoices/generate-all", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { periodStart, periodEnd } = req.body;
      
      // Parse dates if provided
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      
      if (periodStart) {
        startDate = new Date(periodStart);
        if (isNaN(startDate.getTime())) {
          return res.status(400).json({ message: "Invalid periodStart date" });
        }
      }
      
      if (periodEnd) {
        endDate = new Date(periodEnd);
        if (isNaN(endDate.getTime())) {
          return res.status(400).json({ message: "Invalid periodEnd date" });
        }
      }
      
      // Trigger automated invoice generation
      const job = await automatedInvoiceService.forceRunMonthlyInvoicing(startDate, endDate);
      
      res.json({
        message: "Automated invoice generation started",
        jobId: job.id,
        status: job.status,
        totalTenants: job.totalTenants
      });
    } catch (error) {
      console.error('[Admin] Force invoice generation error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/admin/invoices/jobs", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const jobs = automatedInvoiceService.getAllJobs();
      res.json(jobs);
    } catch (error) {
      console.error('[Admin] Get invoice jobs error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/admin/invoices/jobs/:jobId", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = automatedInvoiceService.getJobStatus(jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      res.json(job);
    } catch (error) {
      console.error('[Admin] Get invoice job status error:', error);
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

  // Connector OAuth Routes
  const {
    initiateOAuth,
    handleOAuthCallback,
    getConnectorConfigs,
    testConnectorConnection,
    disconnectConnector
  } = await import('./connector-oauth-service');

  // Feature flag middleware and utilities
  const { 
    injectFeatureFlags, 
    createContextFromRequest, 
    getAvailableConnectors 
  } = await import('./feature-flag-service');

  // Apply feature flag middleware globally to API routes
  app.use('/api', injectFeatureFlags());

  // 🏁 FEATURE FLAGS API - Admin feature flag management
  app.get("/api/admin/feature-flags", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { featureFlagService } = await import('./feature-flag-service');
      const context = createContextFromRequest(req);
      const allFlags = await featureFlagService.getEnabledFlags(context);
      
      res.json({
        flags: allFlags,
        context: {
          environment: context.environment,
          userRole: context.userRole
        }
      });
    } catch (error) {
      console.error('[Feature Flags] Get flags error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // 🏁 FEATURE FLAGS API - Customer-accessible feature flags (all users)
  app.get("/api/feature-flags", requireAuth, async (req, res) => {
    try {
      const { featureFlagService } = await import('./feature-flag-service');
      const context = createContextFromRequest(req);
      const enabledFlags = await featureFlagService.getEnabledFlags(context);
      
      res.json({
        flags: enabledFlags,
        context: {
          environment: context.environment,
          tenantId: context.tenantId,
          userRole: context.userRole
        }
      });
    } catch (error) {
      console.error('[Feature Flags] Get customer flags error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Get available connectors based on feature flags
  app.get("/api/connectors/available", requireAuth, requireRole(['customer_admin', 'customer_user']), async (req, res) => {
    try {
      const context = createContextFromRequest(req);
      const availableConnectors = await getAvailableConnectors(context);
      
      res.json(availableConnectors);
    } catch (error) {
      console.error('[Connectors] Get available connectors error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // 🔗 CONNECTOR FEATURE FLAG ENFORCEMENT MIDDLEWARE
  const checkConnectorFeatureFlag = async (req: any, res: any, next: any) => {
    try {
      const provider = req.params.provider || req.body.provider;
      
      if (!provider) {
        return next(); // No provider specified, continue
      }

      const { featureFlagService } = await import('./feature-flag-service');
      const context = createContextFromRequest(req);
      const flagKey = `connectors.${provider}` as FeatureFlagKey;
      const isEnabled = await featureFlagService.isEnabled(flagKey, context);
      
      if (!isEnabled) {
        return res.status(403).json({ 
          message: `Provider '${provider}' is not available`,
          reason: "Feature disabled"
        });
      }
      
      next();
    } catch (error) {
      console.error('[Connector Feature Flag Check] Error:', error);
      res.status(500).json({ message: "Feature flag check failed" });
    }
  };

  // 🔗 CONNECTOR ENDPOINTS - Fixed routing order: literal routes BEFORE parameterized routes
  
  // Provider-type validation mapping
  const providerTypeMap: Record<string, 'crm' | 'calendar'> = {
    google_calendar: 'calendar',
    microsoft_graph: 'calendar',
    hubspot: 'crm',
    salesforce: 'crm',
    pipedrive: 'crm'
  };

  // LITERAL ROUTES FIRST (to prevent shadowing by parameterized routes)
  
  // Get connector configurations (Customer Admin/User)
  app.get("/api/connectors/config", 
    requireAuth, 
    requireRole(['customer_admin', 'customer_user']), 
    getConnectorConfigs
  );

  // Initiate OAuth flow (Customer Admin only) - with rate limiting
  app.get("/api/connectors/oauth/authorize/:provider", 
    oauthAuthorizationRateLimit,
    requireAuth, 
    requireRole(['customer_admin']),
    checkConnectorFeatureFlag,
    initiateOAuth
  );

  // Handle OAuth callback (Public endpoint) - with rate limiting for security
  app.get("/api/connectors/oauth/callback/:provider", 
    oauthCallbackRateLimit,
    checkConnectorFeatureFlag,
    handleOAuthCallback
  );

  // Test connector connection (Customer Admin/User)
  app.post("/api/connectors/test/:provider", 
    requireAuth, 
    requireRole(['customer_admin', 'customer_user']),
    checkConnectorFeatureFlag,
    testConnectorConnection
  );

  // Disconnect connector (Customer Admin only) - provider-specific OAuth cleanup
  app.delete("/api/connectors/:provider", 
    requireAuth, 
    requireRole(['customer_admin']),
    checkConnectorFeatureFlag,
    disconnectConnector
  );

  // CONNECTOR CRUD ENDPOINTS - Basic connector management (parameterized routes LAST)
  
  app.get("/api/connectors", requireAuth, requireRole(['customer_admin', 'customer_user']), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const { type } = req.query;
      let connectors;
      
      if (type && (type === 'crm' || type === 'calendar')) {
        connectors = await storage.getConnectorsByType(user.tenantId, type as 'crm' | 'calendar');
      } else {
        connectors = await storage.getConnectors(user.tenantId);
      }

      res.json(connectors);
    } catch (error) {
      console.error('[Connectors] Get connectors error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/connectors/:id", requireAuth, requireRole(['customer_admin', 'customer_user']), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const connector = await storage.getConnector(req.params.id, user.tenantId);
      if (!connector) {
        return res.status(404).json({ message: "Connector not found" });
      }

      res.json(connector);
    } catch (error) {
      console.error('[Connectors] Get connector error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.post("/api/connectors", requireAuth, requireRole(['customer_admin']), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const validation = z.object({
        name: z.string().min(1, "Name is required"),
        type: z.enum(['crm', 'calendar'], { errorMap: () => ({ message: "Type must be 'crm' or 'calendar'" }) }),
        provider: z.enum(['google_calendar', 'microsoft_graph', 'hubspot', 'salesforce', 'pipedrive'], {
          errorMap: () => ({ message: "Invalid provider" })
        }),
        config: z.object({}).passthrough() // Allow any config object structure
      }).safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const { name, type, provider, config } = validation.data;

      // CRITICAL FIX: Validate provider matches type
      if (providerTypeMap[provider] !== type) {
        return res.status(400).json({ 
          message: `Provider '${provider}' does not match type '${type}'. Expected type: '${providerTypeMap[provider]}'` 
        });
      }

      // Feature flag enforcement for connector creation
      const context = createContextFromRequest(req);
      const flagKey = `connectors.${provider}` as FeatureFlagKey;
      const isEnabled = await featureFlagService.isEnabled(flagKey, context);
      
      if (!isEnabled) {
        return res.status(403).json({ 
          message: `Provider '${provider}' is not available`,
          reason: "Feature disabled"
        });
      }

      const connector = await storage.createConnector({
        tenantId: user.tenantId,
        name,
        type,
        provider,
        config,
        isActive: true
      });

      res.status(201).json(connector);
    } catch (error) {
      console.error('[Connectors] Create connector error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.put("/api/connectors/:id", requireAuth, requireRole(['customer_admin']), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      const validation = z.object({
        name: z.string().min(1).optional(),
        config: z.object({}).passthrough().optional(),
        isActive: z.boolean().optional()
      }).safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      // Check if connector exists and belongs to tenant
      const existingConnector = await storage.getConnector(req.params.id, user.tenantId);
      if (!existingConnector) {
        return res.status(404).json({ message: "Connector not found" });
      }

      const updates = validation.data;
      const updatedConnector = await storage.updateConnector(req.params.id, user.tenantId, updates);

      res.json(updatedConnector);
    } catch (error) {
      console.error('[Connectors] Update connector error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // CRITICAL FIX: Renamed CRUD DELETE route to avoid conflict with provider disconnect
  app.delete("/api/connectors/id/:id", requireAuth, requireRole(['customer_admin']), async (req, res) => {
    try {
      const user = req.user;
      if (!user?.tenantId) {
        return res.status(401).json({ message: "Tenant ID required" });
      }

      // Check if connector exists and belongs to tenant
      const existingConnector = await storage.getConnector(req.params.id, user.tenantId);
      if (!existingConnector) {
        return res.status(404).json({ message: "Connector not found" });
      }

      await storage.deleteConnector(req.params.id, user.tenantId);
      res.json({ message: "Connector deleted successfully" });
    } catch (error) {
      console.error('[Connectors] Delete connector error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Raw body is now properly captured in server/index.ts BEFORE global body parsing
  // This ensures Twilio signature verification works without hanging requests

  // Twilio webhooks (for incoming calls) - PRODUCTION HARDENED
  app.post("/telephony/incoming", 
    createTwilioValidationMiddleware(), // SECURITY: Webhook signature verification
    enterpriseTwilioWebhookRateLimit, // SECURITY: Twilio-specific rate limiting protection
    async (req, res) => {
    try {
      // Extract and validate call information
      const { CallSid, From, To, CallStatus = 'initiated' } = req.body;
      
      if (!CallSid || !From || !To) {
        console.warn('[TwilioWebhook] Missing required call parameters:', { CallSid, From, To });
        return res.status(400).set('Content-Type', 'text/xml').send(
          '<Response><Say voice="alice">Call cannot be processed. Please try again.</Say></Response>'
        );
      }
      
      // SECURITY: Normalize and validate phone numbers
      let normalizedTo: string;
      let normalizedFrom: string;
      try {
        normalizedTo = normalizePhoneNumber(To);
        normalizedFrom = normalizePhoneNumber(From);
      } catch (error) {
        console.warn('[TwilioWebhook] Phone number validation failed:', { From, To, error: error instanceof Error ? error.message : 'Unknown' });
        return res.status(400).set('Content-Type', 'text/xml').send(
          '<Response><Say voice="alice">Invalid phone number format. Please check and try again.</Say></Response>'
        );
      }
      
      // TENANT ROUTING: Find bot by phone number mapping
      let phoneMapping, bot, tenant;
      try {
        phoneMapping = await storage.getPhoneNumberMappingByPhone(normalizedTo);
        if (!phoneMapping) {
          console.warn('[TwilioWebhook] No bot mapping found for phone number:', normalizedTo);
          // AUDIT: Log unmapped phone number attempts
          try {
            await storage.createAuditLog({
              eventType: 'sensitive_operation',
              operation: 'UNMAPPED_PHONE_CALL',
              success: false,
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              metadata: {
                callSid: CallSid,
                from: normalizedFrom,
                to: normalizedTo,
                reason: 'No bot mapping found'
              }
            });
          } catch (auditError) {
            console.warn('[TwilioWebhook] Audit logging failed:', auditError);
          }
          
          return res.status(404).set('Content-Type', 'text/xml').send(
            '<Response><Say voice="alice">This number is not currently available. Please contact support.</Say></Response>'
          );
        }
        
        // Get bot and tenant information for tenant isolation
        if (!phoneMapping.tenantId) {
          console.error('[TwilioWebhook] Phone mapping missing tenantId:', phoneMapping);
          return res.status(500).set('Content-Type', 'text/xml').send(
            '<Response><Say voice="alice">Service temporarily unavailable. Please try again later.</Say></Response>'
          );
        }
        const tenantId = phoneMapping.tenantId;
        if (!tenantId) {
          console.error('[TwilioWebhook] Phone mapping missing tenantId:', phoneMapping);
          return res.status(500).set('Content-Type', 'text/xml').send(
            '<Response><Say voice="alice">Service temporarily unavailable. Please try again later.</Say></Response>'
          );
        }
        bot = await storage.getBot(phoneMapping.botId, tenantId!);
        tenant = await storage.getTenant(tenantId!);
        
        if (!bot || !tenant) {
          console.error('[TwilioWebhook] Bot or tenant not found:', { botId: phoneMapping.botId, tenantId: phoneMapping.tenantId });
          return res.status(500).set('Content-Type', 'text/xml').send(
            '<Response><Say voice="alice">Service temporarily unavailable. Please try again later.</Say></Response>'
          );
        }
      } catch (error) {
        console.error('[TwilioWebhook] Database lookup error:', error);
        return res.status(500).set('Content-Type', 'text/xml').send(
          '<Response><Say voice="alice">Service temporarily unavailable. Please try again later.</Say></Response>'
        );
      }
      
      // AUDIT LOGGING: Track incoming call with full context
      try {
        await storage.createAuditLog({
          eventType: 'sensitive_operation',
          operation: 'INCOMING_CALL_RECEIVED',
          success: true,
          tenantId: tenant.id,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          metadata: {
            callSid: CallSid,
            from: normalizedFrom,
            to: normalizedTo,
            botId: bot.id,
            callStatus: CallStatus,
            timestamp: new Date().toISOString()
          }
        });
      } catch (auditError) {
        console.warn('[TwilioWebhook] Audit logging failed:', auditError);
        // Continue processing even if audit fails
      }
      
      // USAGE EVENT CREATION: Track for billing
      try {
        await storage.createUsageEvent({
          tenantId: tenant.id,
          botId: bot.id,
          kind: 'call',
          quantity: '1',
          metadata: {
            callSid: CallSid,
            from: normalizedFrom,
            to: normalizedTo,
            callStatus: CallStatus,
            direction: 'inbound'
          }
        });
      } catch (usageError) {
        console.warn('[TwilioWebhook] Usage event creation failed:', usageError);
        // Continue processing even if usage tracking fails
      }
      
      // Generate tenant-specific TwiML response
      const botName = bot.name || 'VoiceBot';
      const greeting = bot.greetingMessage || `Hello! Welcome to ${tenant.name}. Your call is being processed by ${botName}.`;
      
      // Respond with TwiML
      res.set('Content-Type', 'text/xml');
      res.send(`
        <Response>
          <Say voice="alice">${greeting}</Say>
          <Pause length="1"/>
          <Say voice="alice">Please hold while we connect you to our system.</Say>
        </Response>
      `);
      
      console.log(`[TwilioWebhook] Successfully processed incoming call: ${CallSid} for tenant ${tenant.name}`);
      
    } catch (error) {
      console.error('[TwilioWebhook] Unhandled error in incoming webhook:', error);
      // SECURITY: Don't leak error details to external callers
      res.status(500).set('Content-Type', 'text/xml').send(
        '<Response><Say voice="alice">Service temporarily unavailable. Please try again later.</Say></Response>'
      );
    }
  });

  app.post("/telephony/status", 
    createTwilioValidationMiddleware(), // SECURITY: Webhook signature verification
    enterpriseTwilioWebhookRateLimit, // SECURITY: Twilio-specific rate limiting protection
    async (req, res) => {
    try {
      // Extract status update information
      const { 
        CallSid, 
        CallStatus, 
        From, 
        To, 
        CallDuration, 
        Direction,
        AnsweredBy,
        Timestamp 
      } = req.body;
      
      if (!CallSid || !CallStatus) {
        console.warn('[TwilioWebhook] Missing required status parameters:', { CallSid, CallStatus });
        return res.sendStatus(400);
      }
      
      // Find tenant and bot information for proper context
      let phoneMapping, bot, tenant;
      if (To) {
        try {
          const normalizedTo = normalizePhoneNumber(To);
          phoneMapping = await storage.getPhoneNumberMappingByPhone(normalizedTo);
          if (phoneMapping) {
            if (!phoneMapping.tenantId) {
              console.warn('[TwilioWebhook] Phone mapping missing tenantId for status update');
              // Continue without bot/tenant context
            } else {
              const tenantId = phoneMapping.tenantId;
              if (tenantId) {
                bot = await storage.getBot(phoneMapping.botId, tenantId!);
                tenant = await storage.getTenant(tenantId!);
              }
            }
          }
        } catch (error) {
          console.warn('[TwilioWebhook] Could not resolve phone mapping for status update:', error);
          // Continue processing even without mapping
        }
      }
      
      // AUDIT LOGGING: Track call status changes with context
      try {
        await storage.createAuditLog({
          eventType: 'sensitive_operation',
          operation: 'CALL_STATUS_UPDATE',
          success: true,
          tenantId: tenant?.id,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          metadata: {
            callSid: CallSid,
            callStatus: CallStatus,
            from: From,
            to: To,
            direction: Direction,
            duration: CallDuration,
            answeredBy: AnsweredBy,
            botId: bot?.id,
            timestamp: Timestamp || new Date().toISOString()
          }
        });
      } catch (auditError) {
        console.warn('[TwilioWebhook] Status audit logging failed:', auditError);
      }
      
      // USAGE EVENT CREATION: Track billable events
      if (tenant && bot && CallDuration && parseInt(CallDuration) > 0) {
        try {
          // Create usage event for completed calls with duration
          await storage.createUsageEvent({
            tenantId: tenant.id,
            botId: bot.id,
            kind: 'voice_bot_minute',
            quantity: Math.ceil(parseInt(CallDuration) / 60).toString(), // Convert to minutes as string
            metadata: {
              callSid: CallSid,
              callStatus: CallStatus,
              from: From,
              to: To,
              direction: Direction || 'inbound',
              duration: CallDuration,
              answeredBy: AnsweredBy,
              finalStatus: CallStatus
            }
          });
          
          console.log(`[TwilioWebhook] Created usage event for call ${CallSid}: ${CallDuration}s`);
        } catch (usageError) {
          console.warn('[TwilioWebhook] Usage event creation failed for status update:', usageError);
        }
      }
      
      // Log status update with context
      const logContext = {
        callSid: CallSid,
        status: CallStatus,
        duration: CallDuration,
        tenant: tenant?.name,
        bot: bot?.name
      };
      console.log('[TwilioWebhook] Call status update processed:', logContext);
      
      res.sendStatus(200);
      
    } catch (error) {
      console.error('[TwilioWebhook] Unhandled error in status webhook:', error);
      // SECURITY: Don't leak error details to external services
      res.sendStatus(500);
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

  // 🎯 ADMIN USER MANAGEMENT - Complete CRUD operations
  app.get("/api/admin/users", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const { limit = 50, offset = 0, tenantId } = req.query;
      
      const users = await storage.getAllUsers({
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        tenantId: tenantId as string
      });
      
      // Return safe user data (without passwords)
      const safeUsers = users.map(user => ({
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }));
      
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.get("/api/admin/users/:userId", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const user = await storage.getUser(req.params.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Return safe user data (without password)
      const safeUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      };
      
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.put("/api/admin/users/:userId", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    try {
      const validation = z.object({
        email: z.string().email().optional(),
        role: z.enum(['customer_admin', 'customer_user', 'support']).optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        status: z.enum(['active', 'inactive', 'suspended']).optional()
      }).safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.flatten() 
        });
      }

      const updates = validation.data;
      
      // Check if user exists before updating
      const existingUser = await storage.getUser(req.params.userId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // If email is being updated, check for conflicts
      if (updates.email && updates.email !== existingUser.email) {
        const emailConflict = await storage.getUserByEmail(updates.email);
        if (emailConflict) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }
      
      const updatedUser = await storage.updateUser(req.params.userId, updates);
      
      // Return safe user data (without password)
      const safeUser = {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        tenantId: updatedUser.tenantId,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        status: updatedUser.status,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      };
      
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  app.delete("/api/admin/users/:userId", requireAuth, requireRole(['platform_admin']), async (req, res) => {
    const targetUserId = req.params.userId;
    const currentUserId = req.user?.id;
    const currentUserEmail = req.user?.email;
    const ipAddress = req.ip;
    const userAgent = req.get('user-agent') || '';

    try {
      // Get the target user to check their role
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        // Log failed attempt for non-existent user
        await storage.createAuditLog({
          eventType: 'sensitive_operation',
          operation: 'DELETE_USER_NOT_FOUND',
          userId: currentUserId,
          userEmail: currentUserEmail,
          tenantId: req.user?.tenantId,
          ipAddress,
          userAgent,
          success: false,
          statusCode: 404,
          metadata: {
            targetUserId,
            reason: 'Target user not found'
          }
        });
        return res.status(404).json({ message: "User not found" });
      }

      // Security Check 1: Prevent self-deletion
      if (targetUserId === currentUserId) {
        await storage.createAuditLog({
          eventType: 'sensitive_operation',
          operation: 'DELETE_USER_BLOCKED_SELF',
          userId: currentUserId,
          userEmail: currentUserEmail,
          tenantId: req.user?.tenantId,
          ipAddress,
          userAgent,
          success: false,
          statusCode: 403,
          metadata: {
            targetUserId,
            targetUserEmail: targetUser.email,
            reason: 'Self-deletion attempt blocked'
          }
        });
        return res.status(403).json({ 
          message: "Cannot delete your own account. Please ask another administrator to perform this action." 
        });
      }

      // Security Check 2: Prevent deletion of last platform admin
      if (targetUser.role === 'platform_admin') {
        const allUsers = await storage.getAllUsers();
        const platformAdminCount = allUsers.filter(user => user.role === 'platform_admin' && user.status === 'active').length;
        
        if (platformAdminCount <= 1) {
          await storage.createAuditLog({
            eventType: 'sensitive_operation',
            operation: 'DELETE_USER_BLOCKED_LAST_ADMIN',
            userId: currentUserId,
            userEmail: currentUserEmail,
            tenantId: req.user?.tenantId,
            ipAddress,
            userAgent,
            success: false,
            statusCode: 403,
            metadata: {
              targetUserId,
              targetUserEmail: targetUser.email,
              targetUserRole: targetUser.role,
              platformAdminCount,
              reason: 'Prevented deletion of last platform administrator'
            }
          });
          return res.status(403).json({ 
            message: "Cannot delete the last platform administrator. System requires at least one active platform admin." 
          });
        }
      }

      // All security checks passed - proceed with deletion
      await storage.deleteUser(targetUserId);
      
      // Log successful deletion
      await storage.createAuditLog({
        eventType: 'sensitive_operation',
        operation: 'DELETE_USER_SUCCESS',
        userId: currentUserId,
        userEmail: currentUserEmail,
        tenantId: req.user?.tenantId,
        ipAddress,
        userAgent,
        success: true,
        statusCode: 200,
        metadata: {
          targetUserId,
          targetUserEmail: targetUser.email,
          targetUserRole: targetUser.role,
          targetUserTenant: targetUser.tenantId,
          deletedAt: new Date().toISOString()
        }
      });

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      // Log unexpected errors
      await storage.createAuditLog({
        eventType: 'sensitive_operation',
        operation: 'DELETE_USER_ERROR',
        userId: currentUserId,
        userEmail: currentUserEmail,
        tenantId: req.user?.tenantId,
        ipAddress,
        userAgent,
        success: false,
        statusCode: 500,
        metadata: {
          targetUserId,
          error: (error as Error).message,
          reason: 'Unexpected error during user deletion'
        }
      });

      if ((error as Error).message.includes('not found') || (error as Error).message.includes('Not found')) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // API 404 fallback handler - return JSON instead of HTML for unknown API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({ 
      message: "API endpoint not found",
      error: "ENDPOINT_NOT_FOUND",
      path: req.path,
      method: req.method
    });
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
