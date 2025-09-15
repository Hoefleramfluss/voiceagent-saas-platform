import { Request, Response, NextFunction } from 'express';
import { rateLimitMetrics } from './enterprise-security';

/**
 * Enterprise Hardening Security Controls
 * Advanced security measures including HTTPS enforcement, WAF rules, and monitoring alerts
 */

interface ExtendedRequest extends Request {
  user?: any;
  tenant?: any;
  security?: {
    ip: string;
    country?: string;
    asn?: string;
    userAgent: string;
    isBot: boolean;
    riskScore: number;
  };
}

/**
 * Security Configuration and Constants
 */
export const SECURITY_CONFIG = {
  // HTTPS enforcement
  httpsOnly: process.env.NODE_ENV === 'production',
  trustProxy: true,

  // IP Allowlist/Blocklist Configuration
  allowedCountries: process.env.ALLOWED_COUNTRIES?.split(',') || [], // ISO 2-letter codes
  blockedCountries: process.env.BLOCKED_COUNTRIES?.split(',') || ['CN', 'RU', 'KP'], // Default high-risk countries
  allowedASNs: process.env.ALLOWED_ASNS?.split(',') || [], // Autonomous System Numbers
  blockedASNs: process.env.BLOCKED_ASNS?.split(',') || [],
  
  // IP ranges to block (CIDR notation)
  blockedIPRanges: [
    '10.0.0.0/8',     // Private network
    '172.16.0.0/12',  // Private network  
    '192.168.0.0/16', // Private network
    '127.0.0.0/8',    // Loopback
    '169.254.0.0/16', // Link-local
    '224.0.0.0/4',    // Multicast
    '240.0.0.0/4'     // Reserved
  ],

  // Monitoring thresholds for alerts
  alertThresholds: {
    abuseBlockRate: 0.15,        // >15% of requests blocked
    rapidRequests: 50,           // >50 requests per minute from single IP
    tenantScopeViolations: 5,    // >5 cross-tenant access attempts
    failedAuthAttempts: 10,      // >10 failed auth attempts per hour
    suspiciousUserAgents: 3,     // >3 requests from suspicious UAs
    geoAnomalies: 5             // >5 requests from unusual countries
  },

  // Bot detection patterns
  botPatterns: [
    /bot|crawler|spider|scraper/i,
    /curl|wget|python|go-http|apache-httpclient/i,
    /postman|insomnia|httpie/i,
    /scanner|exploit|injection/i
  ]
};

/**
 * HTTPS Enforcement Middleware
 * Redirects HTTP requests to HTTPS in production
 */
export function enforceHTTPS(req: ExtendedRequest, res: Response, next: NextFunction): Response | void {
  // Skip enforcement in development
  if (!SECURITY_CONFIG.httpsOnly) {
    return next();
  }

  // Check for HTTPS
  const isSecure = req.secure || 
                  req.headers['x-forwarded-proto'] === 'https' ||
                  req.headers['x-forwarded-ssl'] === 'on';

  if (!isSecure) {
    const httpsUrl = `https://${req.get('host')}${req.url}`;
    
    console.warn(`[HTTPS ENFORCEMENT] Redirecting HTTP request to HTTPS: ${req.ip} -> ${httpsUrl}`);
    
    return res.redirect(301, httpsUrl);
  }

  // Add security headers for HTTPS
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  next();
}

/**
 * Enhanced security headers middleware
 * Adds comprehensive security headers for enterprise protection
 */
export function setEnterpriseSecurityHeaders(req: ExtendedRequest, res: Response, next: NextFunction): void {
  // HTTPS Transport Security
  if (SECURITY_CONFIG.httpsOnly) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // Content Security Policy (enhanced for VoiceAgent features)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.stripe.com https://*.twilio.com wss://*.twilio.com",
    "media-src 'self' blob: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join('; ');
  
  res.setHeader('Content-Security-Policy', csp);

  // Cross-Origin Policies
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  // Additional Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Feature Policy (Permissions Policy)
  const permissions = [
    'camera=(),',
    'microphone=(self)',
    'geolocation=()',
    'payment=(self)',
    'usb=()',
    'magnetometer=()',
    'accelerometer=()',
    'gyroscope=()'
  ].join(' ');
  
  res.setHeader('Permissions-Policy', permissions);

  next();
}

/**
 * IP-based geolocation and security analysis
 * Mock implementation - in production, integrate with MaxMind or similar service
 */
export function analyzeRequestSecurity(req: ExtendedRequest): void {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  
  // Bot detection
  const isBot = SECURITY_CONFIG.botPatterns.some(pattern => pattern.test(userAgent));
  
  // Risk scoring (mock implementation)
  let riskScore = 0;
  
  if (isBot) riskScore += 30;
  if (ip.includes('127.0.0.1') || ip.includes('::1')) riskScore += 10; // Localhost
  if (!userAgent || userAgent === 'unknown') riskScore += 20;
  
  // Mock geolocation (in production, use real IP geolocation service)
  const mockCountry = ip.startsWith('192.168.') ? 'US' : 'XX';
  const mockASN = 'AS12345';
  
  req.security = {
    ip,
    country: mockCountry,
    asn: mockASN,
    userAgent,
    isBot,
    riskScore
  };
}

/**
 * WAF (Web Application Firewall) Rules Implementation
 * Blocks malicious requests based on IP, country, ASN, and behavioral patterns
 */
export function applyWAFRules(req: ExtendedRequest, res: Response, next: NextFunction): Response | void {
  analyzeRequestSecurity(req);
  
  const security = req.security!;
  const blockedReasons: string[] = [];

  // Country-based blocking
  if (SECURITY_CONFIG.blockedCountries.includes(security.country || '')) {
    blockedReasons.push(`Blocked country: ${security.country}`);
  }

  // ASN-based blocking
  if (SECURITY_CONFIG.blockedASNs.includes(security.asn || '')) {
    blockedReasons.push(`Blocked ASN: ${security.asn}`);
  }

  // High risk score blocking
  if (security.riskScore > 50) {
    blockedReasons.push(`High risk score: ${security.riskScore}`);
  }

  // Block known malicious patterns in URL/User-Agent
  const maliciousPatterns = [
    /phpmyadmin|wp-admin|login\.php|admin\.php|admin\/index\.php/i, // Specific admin exploits, not legitimate /admin routes
    /\.\.|\/etc\/|\/proc\/|\/sys\//,
    /<script|javascript:|onload=|onerror=/i,
    /union.*select|drop.*table|exec.*xp_/i
  ];

  const url = req.url.toLowerCase();
  const userAgent = security.userAgent.toLowerCase();
  
  if (maliciousPatterns.some(pattern => pattern.test(url) || pattern.test(userAgent))) {
    blockedReasons.push('Malicious pattern detected');
  }

  // Apply allowlist if configured (overrides blocklist)
  if (SECURITY_CONFIG.allowedCountries.length > 0) {
    if (!SECURITY_CONFIG.allowedCountries.includes(security.country || '')) {
      blockedReasons.push(`Country not in allowlist: ${security.country}`);
    }
  }

  if (SECURITY_CONFIG.allowedASNs.length > 0) {
    if (!SECURITY_CONFIG.allowedASNs.includes(security.asn || '')) {
      blockedReasons.push(`ASN not in allowlist: ${security.asn}`);
    }
  }

  // Block the request if any rules triggered
  if (blockedReasons.length > 0) {
    console.warn(`[WAF BLOCKED] IP: ${security.ip}, Reasons: ${blockedReasons.join(', ')}, URL: ${req.url}, UA: ${security.userAgent.slice(0, 100)}`);
    
    // Log to security monitoring
    securityMonitor.recordSecurityEvent('waf_blocked', {
      ip: security.ip,
      country: security.country,
      asn: security.asn,
      reasons: blockedReasons,
      url: req.url,
      userAgent: security.userAgent.slice(0, 200),
      timestamp: new Date()
    });

    return res.status(403).json({
      error: 'Access denied',
      code: 'WAF_BLOCKED',
      reference: `WAF-${Date.now()}`
    });
  }

  next();
}

/**
 * Security Monitoring and Alerting System
 */
class SecurityMonitor {
  private events = new Map<string, Array<{ timestamp: Date; details: any }>>();
  private alertCooldowns = new Map<string, Date>();

  recordSecurityEvent(type: string, details: any): void {
    if (!this.events.has(type)) {
      this.events.set(type, []);
    }
    
    const eventLog = this.events.get(type)!;
    eventLog.push({ timestamp: new Date(), details });
    
    // Keep only last 1000 events per type
    if (eventLog.length > 1000) {
      eventLog.shift();
    }
    
    // Check for alert conditions
    this.checkAlertConditions(type);
  }

  private checkAlertConditions(eventType: string): void {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const minuteAgo = new Date(now.getTime() - 60 * 1000);
    
    // Check cooldown
    const lastAlert = this.alertCooldowns.get(eventType);
    if (lastAlert && (now.getTime() - lastAlert.getTime()) < 300000) { // 5 minute cooldown
      return;
    }

    const events = this.events.get(eventType) || [];
    const recentEvents = events.filter(e => e.timestamp > hourAgo);
    const rapidEvents = events.filter(e => e.timestamp > minuteAgo);

    let shouldAlert = false;
    let alertReason = '';

    switch (eventType) {
      case 'waf_blocked':
        if (recentEvents.length > SECURITY_CONFIG.alertThresholds.abuseBlockRate * 100) {
          shouldAlert = true;
          alertReason = `High WAF block rate: ${recentEvents.length} blocks in last hour`;
        }
        break;
        
      case 'rate_limit_exceeded':
        if (rapidEvents.length > SECURITY_CONFIG.alertThresholds.rapidRequests) {
          shouldAlert = true;
          alertReason = `Rapid rate limit violations: ${rapidEvents.length} in last minute`;
        }
        break;
        
      case 'tenant_scope_violation':
        if (recentEvents.length > SECURITY_CONFIG.alertThresholds.tenantScopeViolations) {
          shouldAlert = true;
          alertReason = `Tenant scope violations detected: ${recentEvents.length} in last hour`;
        }
        break;
        
      case 'auth_failure':
        if (recentEvents.length > SECURITY_CONFIG.alertThresholds.failedAuthAttempts) {
          shouldAlert = true;
          alertReason = `High authentication failure rate: ${recentEvents.length} in last hour`;
        }
        break;
    }

    if (shouldAlert) {
      this.generateAlert(eventType, alertReason, recentEvents);
      this.alertCooldowns.set(eventType, now);
    }
  }

  private generateAlert(type: string, reason: string, events: Array<{ timestamp: Date; details: any }>): void {
    const alert = {
      type: 'SECURITY_ALERT',
      eventType: type,
      reason,
      timestamp: new Date(),
      eventCount: events.length,
      affectedIPs: Array.from(new Set(events.map(e => e.details.ip).filter(Boolean))),
      summary: this.generateAlertSummary(events)
    };

    console.error('[SECURITY ALERT]', JSON.stringify(alert, null, 2));
    
    // In production, integrate with your alerting system:
    // - Send to PagerDuty/OpsGenie
    // - Post to Slack/Teams  
    // - Send email notifications
    // - Create incident tickets
    
    this.notifySecurityTeam(alert);
  }

  private generateAlertSummary(events: Array<{ timestamp: Date; details: any }>): any {
    const ips = events.map(e => e.details.ip).filter(Boolean);
    const countries = events.map(e => e.details.country).filter(Boolean);
    const userAgents = events.map(e => e.details.userAgent).filter(Boolean);

    return {
      uniqueIPs: Array.from(new Set(ips)).length,
      topIPs: this.getTopItems(ips, 5),
      topCountries: this.getTopItems(countries, 3),
      suspiciousUserAgents: this.getTopItems(userAgents, 3),
      timeSpan: {
        earliest: Math.min(...events.map(e => e.timestamp.getTime())),
        latest: Math.max(...events.map(e => e.timestamp.getTime()))
      }
    };
  }

  private getTopItems(items: string[], count: number): Array<{ item: string; count: number }> {
    const counts = new Map<string, number>();
    items.forEach(item => counts.set(item, (counts.get(item) || 0) + 1));
    
    return Array.from(counts.entries())
      .map(([item, count]) => ({ item, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, count);
  }

  private notifySecurityTeam(alert: any): void {
    // Mock notification - in production, implement real alerting
    console.log(`[SECURITY NOTIFICATION] Alert sent to security team: ${alert.reason}`);
    
    // Example integrations:
    // await this.sendToSlack(alert);
    // await this.createPagerDutyIncident(alert);
    // await this.sendEmail(alert);
  }

  getSecurityMetrics(): any {
    const metrics = {
      totalEvents: 0,
      eventsByType: {} as Record<string, number>,
      recentAlerts: [] as any[],
      topThreats: [] as any[]
    };

    this.events.forEach((events, type) => {
      metrics.totalEvents += events.length;
      metrics.eventsByType[type] = events.length;
    });

    return metrics;
  }

  clearEvents(): void {
    this.events.clear();
    this.alertCooldowns.clear();
    console.log('[SECURITY MONITOR] Event history cleared');
  }
}

export const securityMonitor = new SecurityMonitor();

/**
 * Tenant Scope Violation Detection
 * Monitors for attempts to access resources outside of tenant boundaries
 */
export function detectTenantScopeViolations(req: ExtendedRequest, res: Response, next: NextFunction): Response | void {
  // Skip for non-authenticated requests or admin operations
  if (!req.user || req.user.role === 'platform_admin') {
    return next();
  }

  const requestedTenantId = req.params?.tenantId || req.body?.tenantId || req.query?.tenantId;
  const userTenantId = req.user.tenantId;

  // If a tenant ID is specified in the request, verify it matches the user's tenant
  if (requestedTenantId && requestedTenantId !== userTenantId) {
    console.warn(`[TENANT SCOPE VIOLATION] User ${req.user.email} (tenant: ${userTenantId}) attempted to access tenant ${requestedTenantId} from IP: ${req.ip}`);
    
    securityMonitor.recordSecurityEvent('tenant_scope_violation', {
      userId: req.user.id,
      userEmail: req.user.email,
      userTenantId,
      requestedTenantId,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method,
      timestamp: new Date()
    });

    return res.status(403).json({
      error: 'Access denied: Tenant scope violation',
      code: 'TENANT_SCOPE_VIOLATION'
    });
  }

  next();
}

/**
 * Security Metrics Endpoint (Admin Only)
 */
export function getSecurityMetrics(req: ExtendedRequest, res: Response): Response {
  try {
    const rateLimitingMetrics = rateLimitMetrics.getMetrics();
    const securityMetrics = securityMonitor.getSecurityMetrics();
    
    const combinedMetrics = {
      timestamp: new Date(),
      rateLimiting: rateLimitingMetrics,
      security: securityMetrics,
      wafStatus: {
        enabled: true,
        blockedCountries: SECURITY_CONFIG.blockedCountries,
        allowedCountries: SECURITY_CONFIG.allowedCountries,
        httpsEnforced: SECURITY_CONFIG.httpsOnly
      },
      systemHealth: {
        alertsActive: securityMetrics.recentAlerts.length > 0,
        threatLevel: securityMetrics.totalEvents > 100 ? 'HIGH' : securityMetrics.totalEvents > 10 ? 'MEDIUM' : 'LOW'
      }
    };

    return res.json(combinedMetrics);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve security metrics',
      message: (error as Error).message
    });
  }
}

/**
 * Reset Security Metrics (Admin Only)
 */
export function resetSecurityMetrics(req: ExtendedRequest, res: Response): Response {
  try {
    securityMonitor.clearEvents();
    rateLimitMetrics.resetMetrics();
    
    console.log(`[SECURITY] Metrics reset by admin user: ${req.user?.email}, IP: ${req.ip}`);
    
    return res.json({
      success: true,
      message: 'Security metrics reset successfully',
      timestamp: new Date()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to reset security metrics',
      message: (error as Error).message
    });
  }
}