import { Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import { createError } from './error-handling';
import { TenantSettings, Tenant } from '@shared/schema';

// Enhanced request interface with tenant context
declare global {
  namespace Express {
    interface Request {
      tenant?: TenantWithSettings;
      tenantId?: string;
    }
  }
}

export interface TenantWithSettings extends Tenant {
  settings?: TenantSettings;
}

// In-memory cache for tenant settings with TTL
class TenantCache {
  private cache = new Map<string, { tenant: TenantWithSettings; expires: number }>();
  private readonly TTL = 5 * 60 * 1000; // 5 minutes TTL

  get(tenantId: string): TenantWithSettings | null {
    const cached = this.cache.get(tenantId);
    if (!cached) return null;
    
    if (Date.now() > cached.expires) {
      this.cache.delete(tenantId);
      return null;
    }
    
    return cached.tenant;
  }

  set(tenantId: string, tenant: TenantWithSettings): void {
    this.cache.set(tenantId, {
      tenant,
      expires: Date.now() + this.TTL
    });
  }

  clear(tenantId?: string): void {
    if (tenantId) {
      this.cache.delete(tenantId);
    } else {
      this.cache.clear();
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

const tenantCache = new TenantCache();

/**
 * Enhanced tenant context loader that supports multiple identification methods:
 * 1. Subdomain-based tenant identification (e.g., customer1.voiceagent.app)
 * 2. X-Tenant-ID header
 * 3. JWT token with tenant claim
 * 4. Authenticated user's tenantId (fallback)
 */
export async function loadTenantContext(req: Request, res: Response, next: NextFunction) {
  try {
    let tenantId: string | null = null;
    let identificationMethod = 'unknown';

    // Method 1: Subdomain-based tenant identification
    if (req.headers.host) {
      const host = req.headers.host;
      const subdomain = host.split('.')[0];
      
      // Skip common subdomains (www, api, admin, etc.)
      if (subdomain && subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'admin' && subdomain !== 'localhost') {
        // Look up tenant by subdomain (assuming subdomain maps to tenant name/slug)
        try {
          const tenant = await storage.getTenantBySubdomain(subdomain);
          if (tenant) {
            tenantId = tenant.id;
            identificationMethod = 'subdomain';
          }
        } catch (error) {
          // Subdomain lookup failed, continue with other methods
        }
      }
    }

    // Method 2: X-Tenant-ID header
    if (!tenantId && req.headers['x-tenant-id']) {
      tenantId = req.headers['x-tenant-id'] as string;
      identificationMethod = 'header';
    }

    // Method 3: JWT token with tenant claim (if JWT auth is implemented)
    if (!tenantId && req.headers.authorization) {
      try {
        // TODO: Implement JWT parsing for tenant claim when JWT auth is added
        // const token = req.headers.authorization.replace('Bearer ', '');
        // const decoded = jwt.verify(token, process.env.JWT_SECRET!);
        // tenantId = decoded.tenantId;
        // identificationMethod = 'jwt';
      } catch (error) {
        // JWT parsing failed, continue with other methods
      }
    }

    // Method 4: Authenticated user's tenantId (current fallback)
    if (!tenantId && req.isAuthenticated && req.isAuthenticated()) {
      const user = req.user as any;
      if (user?.tenantId) {
        tenantId = user.tenantId;
        identificationMethod = 'user';
      }
    }

    // Method 5: URL parameter (for API routes like /api/tenants/:tenantId/*)
    if (!tenantId && req.params.tenantId) {
      tenantId = req.params.tenantId;
      identificationMethod = 'url_param';
    }

    // If no tenant identified, proceed without tenant context
    if (!tenantId) {
      req.tenantId = undefined;
      req.tenant = undefined;
      return next();
    }

    // Check cache first
    let tenantWithSettings = tenantCache.get(tenantId);
    
    if (!tenantWithSettings) {
      // Load tenant and settings from database
      const [tenant, settings] = await Promise.all([
        storage.getTenant(tenantId),
        storage.getTenantSettings(tenantId)
      ]);

      if (!tenant) {
        // Tenant not found
        req.tenantId = undefined;
        req.tenant = undefined;
        return next();
      }

      tenantWithSettings = {
        ...tenant,
        settings: settings || undefined
      };

      // Cache the result
      tenantCache.set(tenantId, tenantWithSettings);
    }

    // Attach tenant context to request
    req.tenantId = tenantId;
    req.tenant = tenantWithSettings;

    // Log tenant context for debugging (in development)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[TenantContext] Loaded tenant: ${tenantWithSettings.name} (${tenantId}) via ${identificationMethod}`);
    }

    next();
  } catch (error) {
    console.error('[TenantContext] Failed to load tenant context:', {
      error: (error as Error).message,
      url: req.url,
      method: req.method,
      headers: {
        host: req.headers.host,
        'x-tenant-id': req.headers['x-tenant-id']
      }
    });

    // Continue without tenant context on error
    req.tenantId = undefined;
    req.tenant = undefined;
    next();
  }
}

/**
 * Middleware to require tenant context - fails if no tenant is loaded
 */
export function requireTenantContext(req: Request, res: Response, next: NextFunction) {
  if (!req.tenant || !req.tenantId) {
    return res.status(400).json({ 
      message: "Tenant context required. Please ensure your request includes tenant identification.",
      error: "TENANT_CONTEXT_REQUIRED"
    });
  }
  
  next();
}

/**
 * Enhanced tenant access control that works with the new tenant context
 */
export function requireTenantAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const user = req.user as any;
  const requestedTenantId = req.tenantId || req.params.tenantId || req.body.tenantId;

  // Platform admins can access all tenants
  if (user.role === 'platform_admin') {
    return next();
  }

  // Other users can only access their own tenant
  if (!user.tenantId || user.tenantId !== requestedTenantId) {
    return res.status(403).json({ 
      message: "Access denied to this tenant",
      error: "TENANT_ACCESS_DENIED"
    });
  }

  next();
}

/**
 * Middleware to enforce tenant isolation in data operations
 * Automatically injects tenantId into request body for create operations
 */
export function enforceTenantIsolation(req: Request, res: Response, next: NextFunction) {
  if (!req.tenant || !req.tenantId) {
    return res.status(400).json({ 
      message: "Tenant context required for this operation",
      error: "TENANT_ISOLATION_REQUIRED"
    });
  }

  // For POST/PUT/PATCH operations, inject tenantId into request body
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    if (req.body && typeof req.body === 'object') {
      req.body.tenantId = req.tenantId;
    }
  }

  next();
}

/**
 * Get tenant settings with caching
 */
export async function getTenantSettings(tenantId: string): Promise<TenantSettings | null> {
  const cached = tenantCache.get(tenantId);
  if (cached?.settings) {
    return cached.settings;
  }

  const settings = await storage.getTenantSettings(tenantId);
  if (settings && cached) {
    // Update cache with settings
    cached.settings = settings;
    tenantCache.set(tenantId, cached);
  }

  return settings ? settings : null;
}

/**
 * Invalidate tenant cache (useful for settings updates)
 */
export function invalidateTenantCache(tenantId?: string) {
  tenantCache.clear(tenantId);
}

/**
 * Get tenant cache statistics (for monitoring)
 */
export function getTenantCacheStats() {
  return tenantCache.getStats();
}

/**
 * Template variable processor for tenant-specific content
 * Supports variables like {brand}, {opening_hours}, {language}
 */
export function processTemplateVariables(template: string, tenant: TenantWithSettings): string {
  if (!template || !tenant) return template;

  const variables: Record<string, string> = {
    brand: tenant.name || 'VoiceAgent',
    language: tenant.settings?.defaultLocale || 'de-AT',
    opening_hours: 'Mo-Fr 9:00-17:00', // TODO: Add to tenant settings
    tenant_name: tenant.name || 'Customer',
    ...tenant.settings?.templateVariables || {}
  };

  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    return variables[key] || match;
  });
}