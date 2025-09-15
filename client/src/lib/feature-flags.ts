import { FeatureFlagKey } from '@shared/feature-flags';

/**
 * Frontend Feature Flag Service
 * 
 * Provides client-side feature flag evaluation with caching
 * and automatic updates for the VoiceAgent SaaS platform.
 */

interface FeatureFlagResponse {
  flags: Record<string, any>;
  context: {
    environment: string;
    userRole?: string;
  };
}

class ClientFeatureFlagService {
  private cache = new Map<string, any>();
  private lastFetch = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Check if a feature flag is enabled
   */
  async isEnabled(flagKey: FeatureFlagKey): Promise<boolean> {
    const flags = await this.getFlags();
    return flags[flagKey]?.enabled || false;
  }

  /**
   * Get feature flag value with default
   */
  async getValue<T = any>(
    flagKey: FeatureFlagKey, 
    defaultValue?: T
  ): Promise<T> {
    const flags = await this.getFlags();
    const flag = flags[flagKey];
    
    if (!flag?.enabled) {
      return defaultValue as T;
    }
    
    return (flag.value !== undefined ? flag.value : defaultValue) as T;
  }

  /**
   * Get all feature flags
   */
  async getFlags(): Promise<Record<string, any>> {
    if (this.isCacheValid()) {
      return this.cache.get('flags') || {};
    }

    try {
      const response = await fetch('/api/feature-flags', {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: FeatureFlagResponse = await response.json();
      
      this.cache.set('flags', data.flags);
      this.cache.set('context', data.context);
      this.lastFetch = Date.now();
      
      return data.flags;
    } catch (error) {
      console.warn('[Feature Flags] Failed to fetch flags:', error);
      return this.cache.get('flags') || {};
    }
  }

  /**
   * Get available connectors based on feature flags
   */
  async getAvailableConnectors(): Promise<{
    calendar: string[];
    crm: string[];
  }> {
    try {
      const response = await fetch('/api/connectors/available', {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.warn('[Feature Flags] Failed to fetch available connectors:', error);
      return { calendar: [], crm: [] };
    }
  }

  /**
   * Check multiple flags at once
   */
  async checkMultiple(flagKeys: FeatureFlagKey[]): Promise<Record<string, boolean>> {
    const flags = await this.getFlags();
    const results: Record<string, boolean> = {};
    
    for (const key of flagKeys) {
      results[key] = flags[key]?.enabled || false;
    }
    
    return results;
  }

  /**
   * Preload flags in background
   */
  async preload(): Promise<void> {
    try {
      await this.getFlags();
    } catch (error) {
      // Silent failure for preload
    }
  }

  /**
   * Clear cache and force refresh
   */
  async refresh(): Promise<void> {
    this.cache.clear();
    this.lastFetch = 0;
    await this.getFlags();
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    return (Date.now() - this.lastFetch) < this.CACHE_TTL;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      lastFetch: this.lastFetch,
      age: Date.now() - this.lastFetch
    };
  }
}

// Singleton instance
export const featureFlags = new ClientFeatureFlagService();

/**
 * React hook for feature flags
 */
import { useState, useEffect } from 'react';

export function useFeatureFlag(flagKey: FeatureFlagKey): boolean {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkFlag = async () => {
      try {
        const isEnabled = await featureFlags.isEnabled(flagKey);
        if (mounted) {
          setEnabled(isEnabled);
        }
      } catch (error) {
        console.warn(`[Feature Flag] Error checking ${flagKey}:`, error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    checkFlag();

    return () => {
      mounted = false;
    };
  }, [flagKey]);

  return enabled;
}

/**
 * React hook for multiple feature flags
 */
export function useFeatureFlags(flagKeys: FeatureFlagKey[]): {
  flags: Record<string, boolean>;
  loading: boolean;
} {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkFlags = async () => {
      try {
        const results = await featureFlags.checkMultiple(flagKeys);
        if (mounted) {
          setFlags(results);
        }
      } catch (error) {
        console.warn('[Feature Flags] Error checking multiple flags:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    checkFlags();

    return () => {
      mounted = false;
    };
  }, [flagKeys.join(',')]);

  return { flags, loading };
}

/**
 * React hook for available connectors
 */
export function useAvailableConnectors(): {
  connectors: { calendar: string[]; crm: string[] };
  loading: boolean;
} {
  const [connectors, setConnectors] = useState<{ calendar: string[]; crm: string[] }>({
    calendar: [],
    crm: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchConnectors = async () => {
      try {
        const available = await featureFlags.getAvailableConnectors();
        if (mounted) {
          setConnectors(available);
        }
      } catch (error) {
        console.warn('[Feature Flags] Error fetching available connectors:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchConnectors();

    return () => {
      mounted = false;
    };
  }, []);

  return { connectors, loading };
}

/**
 * Helper function to check feature flags for connector providers
 */
export function isConnectorEnabled(provider: string): Promise<boolean> {
  const flagMap: Record<string, FeatureFlagKey> = {
    'google_calendar': 'connectors.google_calendar',
    'microsoft_graph': 'connectors.microsoft_graph',
    'hubspot': 'connectors.hubspot',
    'salesforce': 'connectors.salesforce',
    'pipedrive': 'connectors.pipedrive'
  };

  const flagKey = flagMap[provider];
  if (!flagKey) {
    return Promise.resolve(false);
  }

  return featureFlags.isEnabled(flagKey);
}

/**
 * Preload feature flags on app initialization
 */
export function initializeFeatureFlags(): void {
  featureFlags.preload();
}