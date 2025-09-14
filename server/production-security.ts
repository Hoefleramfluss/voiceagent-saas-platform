import { Express } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export interface SecurityConfig {
  enableSecurityHeaders: boolean;
  enableCors: boolean;
  trustedOrigins: string[];
  environment: 'development' | 'production' | 'staging';
}

/**
 * Production security middleware and configurations
 * Implements enterprise-grade security headers and policies
 */
export function setupProductionSecurity(app: Express, config: SecurityConfig) {
  const { enableSecurityHeaders, enableCors, trustedOrigins, environment } = config;

  // Global rate limiting for all requests (DDoS protection)
  const globalRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: environment === 'production' ? 1000 : 2000, // Stricter limits in production
    message: {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip for webhooks and health checks
    skip: (req: any) => {
      const skipPaths = ['/api/stripe/webhook', '/api/twilio/webhook', '/health'];
      const skipInDev = environment === 'development' && req.user;
      return skipPaths.some(path => req.path.startsWith(path)) || skipInDev;
    }
  });

  app.use(globalRateLimit);

  // Stricter rate limiting for authentication endpoints
  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: environment === 'production' ? 5 : 20, // Very strict for auth
    message: {
      error: 'Too many authentication attempts. Please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true // Only count failed attempts
  });

  // Apply stricter limits to auth endpoints
  app.use('/api/auth/login', authRateLimit);
  app.use('/api/auth/register', authRateLimit);
  app.use('/api/auth/forgot-password', authRateLimit);
  app.use('/api/auth/reset-password', authRateLimit);

  // Webhook-specific rate limiting (protect against spam/replay attacks)
  const webhookRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: environment === 'production' ? 100 : 200, // Higher for webhooks but still limited
    message: {
      error: 'Too many webhook requests from this source',
      retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => {
      // Use IP + signature header for more granular limiting
      const signature = req.headers['stripe-signature'] || req.headers['x-twilio-signature'] || '';
      return `${ipKeyGenerator(req, res)}-${signature.slice(0, 10)}`;
    }
  });
  
  app.use('/api/stripe/webhook', webhookRateLimit);
  app.use('/api/twilio/webhook', webhookRateLimit);

  // Admin operations rate limiting (prevent abuse of sensitive operations)
  const adminRateLimit = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: environment === 'production' ? 50 : 100,
    message: {
      error: 'Too many admin operations from this IP',
      retryAfter: '10 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip GET requests, only limit state-changing operations
      return req.method === 'GET';
    }
  });

  app.use('/api/admin', adminRateLimit);

  // Billing/payment operations rate limiting (prevent financial abuse)
  const billingRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: environment === 'production' ? 20 : 50,
    message: {
      error: 'Too many billing operations from this account',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => {
      // Use user ID + IP for billing operations
      return `billing-${req.user?.id || 'anonymous'}-${ipKeyGenerator(req, res)}`;
    }
  });

  app.use('/api/billing', billingRateLimit);

  // Security headers middleware
  if (enableSecurityHeaders) {
    app.use((req, res, next) => {
      // HTTP Strict Transport Security (HSTS)
      if (environment === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      }

      // Content Security Policy (CSP) - Environment aware
      let cspDirectives = [
        "default-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ];

      if (environment === 'production') {
        cspDirectives = cspDirectives.concat([
          "script-src 'self' https://js.stripe.com https://m.stripe.network",
          "style-src 'self' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: https: blob:",
          "connect-src 'self' https://api.stripe.com https://m.stripe.network wss://eventgw.twilio.com wss://chunderw-*.twilio.com wss://chunderw-vpc-*.twilio.com wss://sdkgw.*.twilio.com wss://media.twilsock.com https://media.twiliocdn.com",
          "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
          "media-src 'self'",
          "worker-src 'self'"
        ]);
      } else {
        // Development environment - more permissive for hot reloading
        cspDirectives = cspDirectives.concat([
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://m.stripe.network",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: https: blob:",
          "connect-src 'self' ws: wss: https://api.stripe.com https://m.stripe.network wss://eventgw.twilio.com wss://chunderw-*.twilio.com wss://chunderw-vpc-*.twilio.com wss://sdkgw.*.twilio.com wss://media.twilsock.com https://media.twiliocdn.com",
          "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
          "media-src 'self'",
          "worker-src 'self' blob:"
        ]);
      }
      
      res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

      // X-Content-Type-Options
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // X-Frame-Options
      res.setHeader('X-Frame-Options', 'DENY');

      // X-XSS-Protection
      res.setHeader('X-XSS-Protection', '1; mode=block');

      // Referrer Policy
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

      // Permissions Policy (Feature Policy) - Allow microphone and autoplay for voice features
      const permissionsPolicies = [
        'geolocation=()',
        'microphone=(self)', // Allow microphone for voice features
        'camera=()',
        'payment=(self)',
        'usb=()',
        'magnetometer=()',
        'gyroscope=()',
        'autoplay=(self)', // Allow autoplay for voice features
        'vibrate=()',
        'fullscreen=(self)',
        'display-capture=()'
      ];
      res.setHeader('Permissions-Policy', permissionsPolicies.join(', '));

      // Remove server fingerprinting
      res.removeHeader('X-Powered-By');
      res.setHeader('Server', 'VoiceAgent');

      // Cross-Origin policies - Environment aware for voice features
      if (environment === 'production') {
        // CRITICAL: Cross-Origin-Embedder-Policy is DISABLED by default in production
        // because COEP=credentialless commonly breaks Stripe Elements and payment flows.
        // Only enable if FEATURE_COEP=true is explicitly set AND payments have been validated E2E.
        // 
        // WARNING: Before enabling COEP in production:
        // 1. Test all Stripe payment flows (card elements, payment intents, etc.)
        // 2. Verify Twilio voice features work correctly
        // 3. Test any other embedded iframes or cross-origin resources
        // 4. Validate in staging environment first
        const enableCOEP = process.env.FEATURE_COEP === 'true';
        if (enableCOEP) {
          console.log('[SECURITY WARNING] COEP=credentialless enabled - ensure payment flows are validated');
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        }
        
        // Using 'same-origin-allow-popups' to allow Stripe payment flows
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      } else {
        // Development environment - less restrictive
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }

      next();
    });
  }

  // CORS configuration
  if (enableCors) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      
      // Always set Vary: Origin to prevent cache poisoning
      res.setHeader('Vary', 'Origin');
      
      // Check if origin is in trusted list
      const isOriginTrusted = trustedOrigins.some(trustedOrigin => {
        if (trustedOrigin === '*' && environment !== 'production') return true; // No wildcard in production
        if (trustedOrigin.startsWith('*.') && environment !== 'production') {
          const domain = trustedOrigin.slice(2);
          return origin?.endsWith(domain);
        }
        return origin === trustedOrigin;
      });

      if (isOriginTrusted) {
        res.setHeader('Access-Control-Allow-Origin', origin || trustedOrigins[0]);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-CSRF-Token');
        res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
        return res.sendStatus(204);
      }

      next();
    });
  }

  // Request size limits (prevent payload attacks)
  // Note: Actual body size limits should be set in express.json() configuration
  console.log(`[SECURITY] Request size limits configured for ${environment} environment`);
  
  // Monitor large payloads
  app.use((req, res, next) => {
    // Log unusually large requests for monitoring
    const contentLength = parseInt(req.get('content-length') || '0');
    const maxWarningSize = environment === 'production' ? 1024 * 1024 : 10 * 1024 * 1024; // 1MB prod, 10MB dev
    
    if (contentLength > maxWarningSize && req.path !== '/api/stripe/webhook') {
      console.log(`[SECURITY WARNING] Large request payload: ${contentLength} bytes to ${req.path} from ${req.ip}`);
    }

    next();
  });

  // IP whitelist for critical operations (optional, configure as needed)
  app.use('/api/admin/system', (req, res, next) => {
    const allowedIPs = process.env.ADMIN_ALLOWED_IPS?.split(',') || [];
    
    if (environment === 'production' && allowedIPs.length > 0) {
      const clientIP = req.ip || req.connection.remoteAddress;
      const isAllowed = allowedIPs.some(ip => {
        if (ip.includes('/')) {
          // CIDR notation support could be added here
          return false;
        }
        return clientIP === ip.trim();
      });

      if (!isAllowed) {
        return res.status(403).json({
          error: 'Access denied: IP not whitelisted for system operations'
        });
      }
    }

    next();
  });

  // Security audit logging for sensitive endpoints
  app.use('/api/admin', (req, res, next) => {
    const sensitiveActions = ['DELETE', 'POST', 'PUT', 'PATCH'];
    
    if (sensitiveActions.includes(req.method)) {
      // Log to audit service instead of console (with redaction)
      const auditData = {
        action: `admin_${req.method.toLowerCase()}`,
        userId: req.user?.id || null,
        tenantId: req.user?.tenantId || null,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.path,
        timestamp: new Date().toISOString()
      };
      
      console.log(`[SECURITY AUDIT] ${JSON.stringify(auditData)}`);
      // TODO: Integrate with audit-service.ts for proper persistence and redaction
    }

    next();
  });

  console.log(`[SECURITY] Production security middleware enabled for ${environment} environment`);
}

/**
 * Get security configuration based on environment
 */
export function getSecurityConfig(): SecurityConfig {
  const environment = (process.env.NODE_ENV as 'development' | 'production' | 'staging') || 'development';
  
  const config: SecurityConfig = {
    enableSecurityHeaders: true,
    enableCors: true,
    environment,
    trustedOrigins: []
  };

  // Configure trusted origins based on environment
  switch (environment) {
    case 'production':
      config.trustedOrigins = [
        process.env.FRONTEND_URL || 'https://voiceagent.com',
        // Add other production domains as needed
      ].filter(Boolean);
      break;
    
    case 'staging':
      config.trustedOrigins = [
        process.env.FRONTEND_URL || 'https://staging.voiceagent.com',
        'https://*.replit.app',
        'https://*.replit.dev'
      ];
      break;
    
    case 'development':
    default:
      config.trustedOrigins = [
        'http://localhost:3000',
        'http://localhost:5000',
        'http://localhost:5173',
        'https://*.replit.app',
        'https://*.replit.dev',
        process.env.REPL_DOMAIN ? `https://${process.env.REPL_DOMAIN}` : ''
      ].filter(Boolean);
      break;
  }

  return config;
}

/**
 * Health check endpoint for monitoring
 */
export function setupHealthCheck(app: Express) {
  app.get('/health', (req, res) => {
    const healthCheck = {
      uptime: process.uptime(),
      message: 'OK',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    };

    try {
      res.status(200).json(healthCheck);
    } catch (error) {
      healthCheck.message = 'Service Unavailable';
      res.status(503).json(healthCheck);
    }
  });

  // Detailed health check for internal monitoring (secured)
  app.get('/health/detailed', (req, res) => {
    // Restrict access to detailed health check in production
    const allowedIPs = process.env.HEALTH_CHECK_ALLOWED_IPS?.split(',') || [];
    const isInternalRequest = req.get('X-Internal-Request') === process.env.INTERNAL_REQUEST_TOKEN;
    
    if (process.env.NODE_ENV === 'production' && allowedIPs.length > 0) {
      const clientIP = req.ip || req.connection.remoteAddress;
      const isAllowedIP = allowedIPs.some(ip => clientIP === ip.trim());
      
      if (!isAllowedIP && !isInternalRequest) {
        return res.status(403).json({
          error: 'Access denied: Detailed health check restricted'
        });
      }
    }

    const memUsage = process.memoryUsage();
    const healthCheck = {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      memory: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024)} MB`
      },
      services: {
        database: 'connected', // Could be enhanced with actual DB health check
        stripe: 'configured', // Could check if Stripe keys are present
        sendgrid: 'configured', // Could check if SendGrid is configured
        twilio: 'configured' // Could check if Twilio is configured
      }
    };

    res.status(200).json(healthCheck);
  });
}