import { 
  FeatureFlagKey, 
  FeatureFlag, 
  FeatureFlagContext, 
  FeatureFlagResult,
  DEFAULT_FEATURE_FLAGS 
} from '@shared/feature-flags';
import { createHash } from 'crypto';

/**
 * Feature Flag Service
 * 
 * Provides server-side feature flag evaluation with:
 * - Environment-based filtering
 * - Role-based access control
 * - Tenant-specific overrides
 * - Gradual rollout support
 * - Caching and performance optimization
 */
class FeatureFlagService {
  private flagCache = new Map<string, FeatureFlagResult>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
  private lastCacheUpdate = 0;

  /**
   * Evaluate a feature flag for given context
   */
  async isEnabled(
    flagKey: FeatureFlagKey, 
    context: FeatureFlagContext
  ): Promise<boolean> {
    const result = await this.evaluate(flagKey, context);
    return result.enabled;
  }

  /**
   * Get feature flag value with evaluation
   */
  async getValue<T = any>(
    flagKey: FeatureFlagKey,
    context: FeatureFlagContext, 
    defaultValue?: T
  ): Promise<T> {
    const result = await this.evaluate(flagKey, context);
    if (!result.enabled) {
      return defaultValue as T;
    }
    return (result.value !== undefined ? result.value : defaultValue) as T;
  }

  /**
   * Evaluate feature flag with full context
   */
  async evaluate(
    flagKey: FeatureFlagKey,
    context: FeatureFlagContext
  ): Promise<FeatureFlagResult> {
    const cacheKey = this.getCacheKey(flagKey, context);
    
    // Check cache first (with TTL)
    if (this.isCacheValid() && this.flagCache.has(cacheKey)) {
      return this.flagCache.get(cacheKey)!;
    }

    // Get flag configuration
    const flag = await this.getFlag(flagKey);
    if (!flag) {
      const result: FeatureFlagResult = {
        enabled: false,
        reason: 'Flag not found'
      };
      this.flagCache.set(cacheKey, result);
      this.lastCacheUpdate = Date.now();
      return result;
    }

    // Evaluate flag
    const result = this.evaluateFlag(flag, context);
    
    // Cache result
    this.flagCache.set(cacheKey, result);
    this.lastCacheUpdate = Date.now();
    return result;
  }

  /**
   * Get all enabled flags for context
   */
  async getEnabledFlags(context: FeatureFlagContext): Promise<Record<string, FeatureFlagResult>> {
    const results: Record<string, FeatureFlagResult> = {};
    
    for (const flagKey of Object.keys(DEFAULT_FEATURE_FLAGS) as FeatureFlagKey[]) {
      const result = await this.evaluate(flagKey, context);
      if (result.enabled) {
        results[flagKey] = result;
      }
    }
    
    return results;
  }

  /**
   * Bulk evaluate multiple flags
   */
  async evaluateMultiple(
    flagKeys: FeatureFlagKey[],
    context: FeatureFlagContext
  ): Promise<Record<string, FeatureFlagResult>> {
    const results: Record<string, FeatureFlagResult> = {};
    
    for (const flagKey of flagKeys) {
      results[flagKey] = await this.evaluate(flagKey, context);
    }
    
    return results;
  }

  /**
   * Check if user is in rollout percentage
   */
  private isInRollout(
    rolloutPercentage: number, 
    flagKey: string, 
    userId?: string, 
    sessionId?: string
  ): boolean {
    if (rolloutPercentage >= 100) return true;
    if (rolloutPercentage <= 0) return false;
    
    // Use consistent hashing for rollout determination
    const identifier = userId || sessionId || 'anonymous';
    const hash = createHash('sha256')
      .update(`${flagKey}:${identifier}`)
      .digest('hex');
    
    // Convert first 8 hex chars to number and get percentage
    const hashNum = parseInt(hash.substring(0, 8), 16);
    const percentage = (hashNum % 100) + 1;
    
    return percentage <= rolloutPercentage;
  }

  /**
   * Evaluate individual flag against context
   */
  private evaluateFlag(flag: FeatureFlag, context: FeatureFlagContext): FeatureFlagResult {
    // Check if flag is globally disabled
    if (!flag.enabled) {
      return {
        enabled: false,
        reason: 'Flag globally disabled'
      };
    }

    // Check environment restrictions
    if (flag.environments && !flag.environments.includes(context.environment)) {
      return {
        enabled: false,
        reason: `Not enabled in ${context.environment} environment`
      };
    }

    // Check role restrictions
    if (flag.userRoles && context.userRole && !flag.userRoles.includes(context.userRole)) {
      return {
        enabled: false,
        reason: `Not enabled for role: ${context.userRole}`
      };
    }

    // Check tenant restrictions
    if (flag.tenantIds && context.tenantId && !flag.tenantIds.includes(context.tenantId)) {
      return {
        enabled: false,
        reason: `Not enabled for tenant: ${context.tenantId}`
      };
    }

    // Check expiry
    if (flag.expiry && flag.expiry < new Date()) {
      return {
        enabled: false,
        reason: 'Flag expired'
      };
    }

    // Check rollout percentage
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const inRollout = this.isInRollout(
        flag.rolloutPercentage,
        flag.key,
        context.userId,
        context.sessionId
      );
      
      if (!inRollout) {
        return {
          enabled: false,
          reason: `Not in rollout (${flag.rolloutPercentage}%)`
        };
      }
    }

    // Flag is enabled
    return {
      enabled: true,
      value: flag.value,
      reason: 'All conditions met'
    };
  }

  /**
   * Get flag configuration (with potential database override)
   */
  private async getFlag(flagKey: FeatureFlagKey): Promise<FeatureFlag | null> {
    // For now, use defaults. In future, could load from database
    return DEFAULT_FEATURE_FLAGS[flagKey] || null;
  }

  /**
   * Generate cache key for flag + context
   */
  private getCacheKey(flagKey: FeatureFlagKey, context: FeatureFlagContext): string {
    return `${flagKey}:${context.environment}:${context.tenantId || 'global'}:${context.userRole || 'none'}:${context.userId || 'anon'}`;
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    return (Date.now() - this.lastCacheUpdate) < this.CACHE_TTL;
  }

  /**
   * Clear cache (for testing or manual refresh)
   */
  clearCache(): void {
    this.flagCache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number; lastUpdate: number } {
    return {
      size: this.flagCache.size,
      hits: 0, // Could implement hit counting
      lastUpdate: this.lastCacheUpdate
    };
  }
}

// Singleton instance
export const featureFlagService = new FeatureFlagService();

/**
 * Convenience functions for common use cases
 */

/**
 * Create feature flag context from Express request
 */
export function createContextFromRequest(req: any): FeatureFlagContext {
  return {
    environment: (process.env.NODE_ENV as any) || 'development',
    tenantId: req.user?.tenantId,
    userId: req.user?.id,
    userRole: req.user?.role,
    sessionId: req.session?.id || req.sessionID
  };
}

/**
 * Express middleware to inject feature flags into request
 */
export function injectFeatureFlags() {
  return async (req: any, res: any, next: any) => {
    const context = createContextFromRequest(req);
    
    // Add feature flag utilities to request
    req.featureFlags = {
      isEnabled: (flagKey: FeatureFlagKey) => featureFlagService.isEnabled(flagKey, context),
      getValue: (flagKey: FeatureFlagKey, defaultValue?: any) => 
        featureFlagService.getValue(flagKey, context, defaultValue),
      evaluate: (flagKey: FeatureFlagKey) => featureFlagService.evaluate(flagKey, context),
      getAll: () => featureFlagService.getEnabledFlags(context)
    };
    
    next();
  };
}

/**
 * Connector availability helper
 */
export async function getAvailableConnectors(context: FeatureFlagContext): Promise<{
  calendar: string[];
  crm: string[];
}> {
  const calendarConnectors = [];
  const crmConnectors = [];
  
  // Check each connector flag
  if (await featureFlagService.isEnabled('connectors.google_calendar', context)) {
    calendarConnectors.push('google_calendar');
  }
  if (await featureFlagService.isEnabled('connectors.microsoft_graph', context)) {
    calendarConnectors.push('microsoft_graph');
  }
  if (await featureFlagService.isEnabled('connectors.hubspot', context)) {
    crmConnectors.push('hubspot');
  }
  if (await featureFlagService.isEnabled('connectors.salesforce', context)) {
    crmConnectors.push('salesforce');
  }
  if (await featureFlagService.isEnabled('connectors.pipedrive', context)) {
    crmConnectors.push('pipedrive');
  }
  
  return {
    calendar: calendarConnectors,
    crm: crmConnectors
  };
}