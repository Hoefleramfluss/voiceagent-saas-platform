import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Enhanced Security Controls for Sensitive Operations
 * Provides additional authentication and access controls for critical API key operations
 */

// Extend session data to include authentication tracking
declare module 'express-session' {
  interface SessionData {
    lastAuthTime?: string;
  }
}

interface ExtendedRequest extends Request {
  user?: any;
  rateLimitInfo?: any;
}

/**
 * Rate limiter for API key operations
 * Prevents brute force attacks on sensitive endpoints
 */
export const apiKeyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs for API key operations
  message: {
    error: 'Too many API key operations from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for platform admins (you can extend this logic)
  skip: (req: ExtendedRequest) => {
    return req.user?.role === 'platform_admin' && process.env.NODE_ENV === 'development';
  }
});

/**
 * Strict rate limiter for key creation/deletion operations
 * More restrictive limits for the most sensitive operations
 */
export const criticalKeyOperationsRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit to 5 create/delete operations per hour
  message: {
    error: 'Too many critical key operations from this IP, please try again in an hour.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Apply to create, update with keyValue, and delete operations
});

/**
 * Rate limiter for login attempts
 * Prevents brute force attacks on authentication endpoints
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per 15 minutes
  message: {
    error: 'Too many login attempts from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // More aggressive rate limiting for failed attempts
  skipSuccessfulRequests: true, // Don't count successful requests
  skipFailedRequests: false, // Count failed requests
});

/**
 * Enhanced authentication middleware for sensitive operations
 * Requires recent authentication (within last 30 minutes) for critical operations
 */
export function requireRecentAuth(req: ExtendedRequest, res: Response, next: NextFunction): Response | void {
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({ 
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  // Check if session has recent authentication timestamp
  const lastAuth = req.session?.lastAuthTime;
  if (!lastAuth) {
    return res.status(401).json({ 
      message: 'Recent authentication required for this operation',
      code: 'RECENT_AUTH_REQUIRED',
      requiresReAuth: true
    });
  }

  const timeSinceAuth = Date.now() - new Date(lastAuth).getTime();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  if (timeSinceAuth > maxAge) {
    return res.status(401).json({ 
      message: 'Recent authentication required for this operation. Please re-authenticate.',
      code: 'RECENT_AUTH_REQUIRED',
      requiresReAuth: true,
      lastAuth: lastAuth
    });
  }

  next();
}

/**
 * Middleware to require explicit confirmation for destructive operations
 * Checks for confirmation parameter in request
 */
export function requireExplicitConfirmation(req: ExtendedRequest, res: Response, next: NextFunction): Response | void {
  const confirmation = req.body.confirmAction || req.query.confirm;
  
  if (!confirmation || confirmation !== 'true') {
    return res.status(400).json({
      message: 'Explicit confirmation required for this operation',
      code: 'CONFIRMATION_REQUIRED',
      instruction: 'Include confirmAction: true in request body or confirm=true in query params'
    });
  }

  next();
}

/**
 * Audit logging middleware for sensitive operations
 * Logs detailed information about API key operations using response events for complete coverage
 */
export function auditSensitiveOperation(operation: string) {
  return (req: ExtendedRequest, res: Response, next: NextFunction): void => {
    const user = req.user;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || 'unknown';
    
    // Import audit service dynamically to avoid circular dependencies
    const auditServicePromise = import('./audit-service').then(m => m.auditService);
    
    // Track if we've already logged to prevent duplicate entries
    let hasLogged = false;
    
    // Log when response finishes (covers all response methods)
    const logAuditEvent = () => {
      if (hasLogged) return;
      hasLogged = true;
      
      const statusCode = res.statusCode;
      const success = statusCode >= 200 && statusCode < 400;
      
      // Only log general middleware audit if the route doesn't handle specific audit logging
      // This prevents double logging for API key operations that have their own audit calls
      if (!req.route?.path?.includes('/api-keys')) {
        auditServicePromise.then(auditService => {
          auditService.logSensitiveOperation(
            user || {},
            operation,
            success,
            statusCode,
            ip,
            userAgent,
            { 
              method: req.method,
              path: req.path,
              queryParams: req.query,
              // Exclude request body to prevent secret leakage - it's already redacted in AuditService
              requestSummary: { method: req.method, path: req.path }
            }
          ).catch(error => {
            console.error('[AUDIT ERROR] Failed to log sensitive operation:', error);
          });
        });
      }
    };
    
    // Listen for response finish and close events to ensure we capture all response types
    res.on('finish', logAuditEvent);
    res.on('close', logAuditEvent);
    
    next();
  };
}

/**
 * IP allowlist middleware for ultra-sensitive operations
 * Can be configured via environment variables
 */
export function requireAllowedIP(req: ExtendedRequest, res: Response, next: NextFunction): Response | void {
  const allowedIPs = process.env.ADMIN_ALLOWED_IPS?.split(',') || [];
  
  if (allowedIPs.length === 0) {
    // No IP restrictions configured, allow all
    return next();
  }
  
  const clientIP = req.ip || req.connection.remoteAddress;
  
  if (!clientIP || !allowedIPs.includes(clientIP)) {
    console.warn(`[SECURITY] Blocked admin access from unauthorized IP: ${clientIP}`);
    return res.status(403).json({
      message: 'Access denied from this IP address',
      code: 'IP_NOT_ALLOWED'
    });
  }
  
  next();
}

/**
 * Session security enhancement
 * Updates last authentication time for re-authentication tracking
 */
export function updateAuthTime(req: ExtendedRequest, res: Response, next: NextFunction): void {
  if (req.session && req.user) {
    req.session.lastAuthTime = new Date().toISOString();
  }
  next();
}

/**
 * Enhanced logging for all API key access attempts
 * Creates detailed audit trail
 */
export function logApiKeyAccess(req: ExtendedRequest, res: Response, next: NextFunction): void {
  const user = req.user;
  const operation = `${req.method} ${req.path}`;
  const ip = req.ip || req.connection.remoteAddress;
  
  console.log(`[API KEY ACCESS] Operation: ${operation}, User: ${user?.email || 'anonymous'}, Role: ${user?.role || 'none'}, IP: ${ip}, Time: ${new Date().toISOString()}`);
  
  next();
}

/**
 * Validate that user has necessary permissions for the requested operation
 */
export function validateOperationPermissions(allowedRoles: string[] = ['platform_admin']) {
  return (req: ExtendedRequest, res: Response, next: NextFunction): Response | void => {
    const user = req.user;
    
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({
        message: 'Insufficient permissions for this operation',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles: allowedRoles
      });
    }
    
    next();
  };
}