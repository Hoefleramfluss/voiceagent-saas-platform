import { Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { storage } from './storage';

/**
 * Enterprise-Grade Security Controls
 * Advanced rate limiting with per-tenant, per-phone, and metrics tracking
 */

interface ExtendedRequest extends Request {
  user?: any;
  tenant?: any;
  rateLimitInfo?: any;
}

// Metrics tracking for rate limiting
export interface RateLimitMetrics {
  totalRequests: number;
  totalBlocked: number;
  blockedByType: {
    ip: number;
    tenant: number;
    phone: number;
    user: number;
  };
  topAbusers: Array<{
    key: string;
    type: string;
    requests: number;
    blocked: number;
  }>;
  lastReset: Date;
}

class EnterpriseRateLimitMetrics {
  private metrics: RateLimitMetrics = {
    totalRequests: 0,
    totalBlocked: 0,
    blockedByType: { ip: 0, tenant: 0, phone: 0, user: 0 },
    topAbusers: [],
    lastReset: new Date()
  };

  private abusers = new Map<string, { requests: number; blocked: number; type: string }>();

  recordRequest(key: string, type: string, wasBlocked: boolean): void {
    this.metrics.totalRequests++;
    
    if (wasBlocked) {
      this.metrics.totalBlocked++;
      this.metrics.blockedByType[type as keyof typeof this.metrics.blockedByType]++;
    }

    // Track abuser statistics
    if (!this.abusers.has(key)) {
      this.abusers.set(key, { requests: 0, blocked: 0, type });
    }
    
    const abuserStats = this.abusers.get(key)!;
    abuserStats.requests++;
    if (wasBlocked) abuserStats.blocked++;

    // Update top abusers (keep top 10)
    this.updateTopAbusers();
  }

  private updateTopAbusers(): void {
    this.metrics.topAbusers = Array.from(this.abusers.entries())
      .map(([key, stats]) => ({ key, ...stats }))
      .sort((a, b) => b.blocked - a.blocked)
      .slice(0, 10);
  }

  getMetrics(): RateLimitMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      totalBlocked: 0,
      blockedByType: { ip: 0, tenant: 0, phone: 0, user: 0 },
      topAbusers: [],
      lastReset: new Date()
    };
    this.abusers.clear();
  }
}

export const rateLimitMetrics = new EnterpriseRateLimitMetrics();

/**
 * Multi-dimensional key generator for enhanced rate limiting
 * Combines IP, tenant, phone, and user identifiers for granular control
 * Uses IPv6-safe IP key generation for security compliance
 */
export function enterpriseKeyGenerator(dimensions: Array<'ip' | 'tenant' | 'phone' | 'user'>) {
  return (req: ExtendedRequest): string => {
    const keyParts: string[] = [];
    
    if (dimensions.includes('ip')) {
      // SECURITY: Use IPv6-safe IP key generator for proper rate limiting
      const ipKey = ipKeyGenerator(req.ip || req.connection.remoteAddress || '127.0.0.1');
      keyParts.push(`ip:${ipKey}`);
    }
    
    if (dimensions.includes('tenant')) {
      const tenantId = req.tenant?.id || req.user?.tenantId || 'no-tenant';
      keyParts.push(`tenant:${tenantId}`);
    }
    
    if (dimensions.includes('phone')) {
      // Extract phone from body or query params
      const phone = req.body?.contactPhone || req.body?.phone || req.query?.phone || 'no-phone';
      keyParts.push(`phone:${phone}`);
    }
    
    if (dimensions.includes('user')) {
      const userId = req.user?.id || 'anonymous';
      keyParts.push(`user:${userId}`);
    }
    
    return keyParts.join('|');
  };
}

/**
 * Enhanced handler for rate limit events with metrics tracking
 */
export function createEnterpriseHandler(limitType: string, dimensions: Array<'ip' | 'tenant' | 'phone' | 'user'>) {
  return (req: ExtendedRequest, res: Response, next: NextFunction): void => {
    const key = enterpriseKeyGenerator(dimensions)(req);
    const primaryDimension = dimensions[0] || 'ip';
    
    // Record the blocked request in metrics
    rateLimitMetrics.recordRequest(key, primaryDimension, true);
    
    // Enhanced logging for enterprise monitoring
    console.warn(`[RATE LIMIT BLOCKED] Type: ${limitType}, Key: ${key}, IP: ${req.ip}, Time: ${new Date().toISOString()}`);
    
    // Store rate limit info for potential escalation
    req.rateLimitInfo = {
      type: limitType,
      key,
      dimensions,
      timestamp: new Date()
    };
    
    next();
  };
}

/**
 * Success handler to track allowed requests
 */
export function createSuccessHandler(limitType: string, dimensions: Array<'ip' | 'tenant' | 'phone' | 'user'>) {
  return (req: ExtendedRequest, res: Response, next: NextFunction): void => {
    const key = enterpriseKeyGenerator(dimensions)(req);
    const primaryDimension = dimensions[0] || 'ip';
    
    // Record the successful request in metrics
    rateLimitMetrics.recordRequest(key, primaryDimension, false);
    
    next();
  };
}

/**
 * Enterprise Demo Tenant Rate Limiting
 * Multi-dimensional protection against abuse
 * Uses IPv6-safe IP key generation
 */
export const enterpriseDemoRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit per key combination
  message: {
    success: false,
    error: 'Demo creation limit exceeded. Please contact support for assistance.',
    retryAfter: '1 hour',
    type: 'DEMO_RATE_LIMIT'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: ExtendedRequest): string => {
    // SECURITY: Use IPv6-safe IP key generator + phone for multi-dimensional limiting
    const ipKey = ipKeyGenerator(req.ip || req.connection.remoteAddress || '127.0.0.1');
    const phone = req.body?.contactPhone || req.body?.phone || req.query?.phone || 'no-phone';
    return `ip:${ipKey}|phone:${phone}`;
  },
  handler: createEnterpriseHandler('demo-creation', ['ip', 'phone']),
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

/**
 * Enterprise Phone Verification Rate Limiting
 * Per-phone and per-IP protection
 * Uses IPv6-safe IP key generation
 */
export const enterprisePhoneVerificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Stricter limit per phone/IP combination
  message: {
    success: false,
    error: 'Too many verification attempts. Please wait before trying again.',
    retryAfter: '15 minutes',
    type: 'PHONE_VERIFICATION_RATE_LIMIT'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: ExtendedRequest): string => {
    // SECURITY: Use IPv6-safe IP key generator + phone for multi-dimensional limiting
    const ipKey = ipKeyGenerator(req.ip || req.connection.remoteAddress || '127.0.0.1');
    const phone = req.body?.contactPhone || req.body?.phone || req.query?.phone || 'no-phone';
    return `phone:${phone}|ip:${ipKey}`;
  },
  handler: createEnterpriseHandler('phone-verification', ['phone', 'ip']),
  skipSuccessfulRequests: true, // Only count failed attempts
  skipFailedRequests: false
});

/**
 * Enterprise Auth Rate Limiting
 * Per-tenant and per-IP protection
 * Uses IPv6-safe IP key generation
 */
export const enterpriseAuthRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 20,
  message: {
    error: 'Too many authentication attempts. Please try again later.',
    retryAfter: '15 minutes',
    type: 'AUTH_RATE_LIMIT'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: ExtendedRequest): string => {
    // SECURITY: Use IPv6-safe IP key generator + tenant for multi-dimensional limiting
    const ipKey = ipKeyGenerator(req.ip || req.connection.remoteAddress || '127.0.0.1');
    const tenantId = req.tenant?.id || req.user?.tenantId || 'no-tenant';
    return `ip:${ipKey}|tenant:${tenantId}`;
  },
  handler: createEnterpriseHandler('authentication', ['ip', 'tenant']),
  skipSuccessfulRequests: true, // Only count failed attempts
  skipFailedRequests: false
});

/**
 * Enterprise Webhook Rate Limiting
 * Per-signature and per-IP protection with enhanced key generation
 */
export const enterpriseWebhookRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 200,
  message: {
    error: 'Webhook rate limit exceeded',
    retryAfter: '5 minutes',
    type: 'WEBHOOK_RATE_LIMIT'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: ExtendedRequest): string => {
    // SECURITY: Use IPv6-safe IP key generator for webhook rate limiting
    const ipKey = ipKeyGenerator(req.ip || req.connection.remoteAddress || '127.0.0.1');
    const signature = req.headers['stripe-signature'] || req.headers['x-twilio-signature'] || '';
    const tenantId = req.tenant?.id || 'no-tenant';
    return `webhook:${ipKey}:${tenantId}:${signature.slice(0, 10)}`;
  },
  handler: createEnterpriseHandler('webhook', ['ip', 'tenant']),
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

/**
 * Enterprise Admin Operations Rate Limiting
 * Per-tenant and per-user protection for administrative actions
 */
export const enterpriseAdminRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: process.env.NODE_ENV === 'production' ? 30 : 60,
  message: {
    error: 'Admin operation rate limit exceeded',
    retryAfter: '10 minutes',
    type: 'ADMIN_RATE_LIMIT'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: ExtendedRequest): string => {
    // SECURITY: Use IPv6-safe IP key generator + user for multi-dimensional limiting
    const ipKey = ipKeyGenerator(req.ip || req.connection.remoteAddress || '127.0.0.1');
    const userId = req.user?.id || 'anonymous';
    return `user:${userId}|ip:${ipKey}`;
  },
  handler: createEnterpriseHandler('admin-operations', ['user', 'ip']),
  skip: (req) => {
    // Skip GET requests, only limit state-changing operations
    return req.method === 'GET';
  }
});

/**
 * Enterprise Billing Operations Rate Limiting
 * Per-tenant protection for billing operations
 */
export const enterpriseBillingRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 20 : 50,
  message: {
    error: 'Billing operation rate limit exceeded',
    retryAfter: '15 minutes',
    type: 'BILLING_RATE_LIMIT'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: ExtendedRequest): string => {
    // SECURITY: Use IPv6-safe IP key generator + tenant/user for multi-dimensional limiting
    const ipKey = ipKeyGenerator(req.ip || req.connection.remoteAddress || '127.0.0.1');
    const tenantId = req.tenant?.id || req.user?.tenantId || 'no-tenant';
    const userId = req.user?.id || 'anonymous';
    return `tenant:${tenantId}|user:${userId}|ip:${ipKey}`;
  },
  handler: createEnterpriseHandler('billing-operations', ['tenant', 'user', 'ip']),
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

/**
 * Rate Limit Metrics Endpoint (Admin Only)
 * Provides insights into rate limiting effectiveness
 */
export function getRateLimitMetrics(req: ExtendedRequest, res: Response): Response {
  try {
    const metrics = rateLimitMetrics.getMetrics();
    
    // Add real-time statistics
    const stats = {
      ...metrics,
      blockRate: metrics.totalRequests > 0 ? (metrics.totalBlocked / metrics.totalRequests * 100) : 0,
      uptimeHours: (Date.now() - metrics.lastReset.getTime()) / (1000 * 60 * 60),
      alertThresholds: {
        highBlockRate: metrics.totalRequests > 100 && (metrics.totalBlocked / metrics.totalRequests) > 0.1, // >10% block rate
        suspiciousActivity: metrics.topAbusers.some(abuser => abuser.blocked > 50), // >50 blocks from single source
        volumeSpike: metrics.totalRequests > 1000 // >1000 requests in tracking period
      }
    };
    
    return res.json(stats);
  } catch (error) {
    return res.status(500).json({ 
      error: 'Failed to retrieve rate limit metrics',
      message: (error as Error).message 
    });
  }
}

/**
 * Reset Rate Limit Metrics (Admin Only)
 * Allows manual reset of metrics for testing/debugging
 */
export function resetRateLimitMetrics(req: ExtendedRequest, res: Response): Response {
  try {
    rateLimitMetrics.resetMetrics();
    
    console.log(`[METRICS] Rate limit metrics reset by admin user: ${req.user?.email}, IP: ${req.ip}`);
    
    return res.json({ 
      success: true,
      message: 'Rate limit metrics reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ 
      error: 'Failed to reset rate limit metrics',
      message: (error as Error).message 
    });
  }
}

/**
 * Tenant-aware rate limiting middleware
 * Ensures tenant context is available for rate limiting decisions
 */
export async function enhanceTenantContext(req: ExtendedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    // If user is authenticated and has tenant ID, load tenant context
    if (req.user?.tenantId && !req.tenant) {
      const tenant = await storage.getTenant(req.user.tenantId);
      if (tenant) {
        req.tenant = tenant;
      }
    }
    
    // For demo requests, extract tenant from phone or other identifiers
    if (!req.tenant && (req.body?.contactPhone || req.body?.tenantId)) {
      const tenantId = req.body?.tenantId;
      if (tenantId) {
        const tenant = await storage.getTenant(tenantId);
        if (tenant) {
          req.tenant = tenant;
        }
      }
    }
    
    next();
  } catch (error) {
    console.error('[TENANT CONTEXT] Error enhancing tenant context:', error);
    // Don't fail the request, continue without tenant context
    next();
  }
}

/**
 * Abuse Detection and Alerting
 * Monitors for suspicious patterns and generates alerts
 */
export class AbuseDetector {
  private static instance: AbuseDetector;
  private alertThresholds = {
    rapidRequests: 100, // >100 requests in 1 minute from single source
    highFailureRate: 0.8, // >80% failure rate
    multiTenantAbuse: 5, // Same IP hitting >5 different tenants
    phoneEnumeration: 10 // >10 different phone numbers from same IP
  };

  static getInstance(): AbuseDetector {
    if (!AbuseDetector.instance) {
      AbuseDetector.instance = new AbuseDetector();
    }
    return AbuseDetector.instance;
  }

  checkForAbuse(req: ExtendedRequest): { isAbusive: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    // Check metrics for abuse patterns
    const metrics = rateLimitMetrics.getMetrics();
    
    // High block rate indicates potential abuse
    if (metrics.totalRequests > 50) {
      const blockRate = metrics.totalBlocked / metrics.totalRequests;
      if (blockRate > this.alertThresholds.highFailureRate) {
        reasons.push(`High block rate: ${(blockRate * 100).toFixed(1)}%`);
      }
    }
    
    // Check for top abusers
    const ip = req.ip || req.connection.remoteAddress;
    const topAbuser = metrics.topAbusers.find(abuser => abuser.key.includes(`ip:${ip}`));
    if (topAbuser && topAbuser.blocked > 20) {
      reasons.push(`IP flagged as top abuser: ${topAbuser.blocked} blocks`);
    }
    
    return {
      isAbusive: reasons.length > 0,
      reasons
    };
  }

  generateAlert(req: ExtendedRequest, reasons: string[]): void {
    const alert = {
      timestamp: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
      reasons,
      tenant: req.tenant?.id || 'unknown',
      user: req.user?.id || 'anonymous'
    };
    
    console.warn('[ABUSE ALERT]', JSON.stringify(alert, null, 2));
    
    // In production, you would send this to your monitoring/alerting system
    // For now, we log it for visibility
  }
}

export const abuseDetector = AbuseDetector.getInstance();