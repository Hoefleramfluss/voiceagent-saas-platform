import { storage } from './storage';
import { decryptApiKey } from './crypto';
import type { ApiKey } from '@shared/schema';

/**
 * Secure Key Loader Service
 * Provides secure access to decrypted API keys for external service integration
 * with proper caching and access controls
 */

interface CachedKey {
  value: string;
  lastUpdated: Date;
  expires: Date;
}

class SecureKeyLoader {
  private keyCache = new Map<string, CachedKey>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

  /**
   * Get a decrypted API key by service type and name
   * Uses caching for performance but ensures keys are fresh
   */
  async getApiKey(serviceType: string, keyName?: string): Promise<string | null> {
    try {
      const cacheKey = `${serviceType}:${keyName || 'default'}`;
      
      // Check cache first
      const cached = this.keyCache.get(cacheKey);
      if (cached && cached.expires > new Date()) {
        console.log(`[KeyLoader] Using cached key for ${serviceType}`);
        return cached.value;
      }

      // Fetch from database
      console.log(`[KeyLoader] Fetching key from database for ${serviceType}`);
      const apiKeys = await storage.getApiKeys();
      
      let targetKey: ApiKey | undefined;
      
      if (keyName) {
        // Find specific key by name and service type
        targetKey = apiKeys.find(key => 
          key.serviceType === serviceType && 
          key.keyName === keyName && 
          key.isActive
        );
      } else {
        // Find any active key for the service type
        targetKey = apiKeys.find(key => 
          key.serviceType === serviceType && 
          key.isActive
        );
      }

      if (!targetKey) {
        console.warn(`[KeyLoader] No active key found for service: ${serviceType}, name: ${keyName}`);
        return null;
      }

      // Decrypt the key
      const decryptedValue = await decryptApiKey(targetKey.keyValue);
      
      // Cache the decrypted value
      this.keyCache.set(cacheKey, {
        value: decryptedValue,
        lastUpdated: new Date(),
        expires: new Date(Date.now() + this.CACHE_TTL)
      });

      console.log(`[KeyLoader] Successfully loaded key for ${serviceType}`);
      return decryptedValue;
    } catch (error) {
      console.error(`[KeyLoader] Error loading key for ${serviceType}:`, error);
      return null;
    }
  }

  /**
   * Get Stripe secret key
   */
  async getStripeKey(): Promise<string | null> {
    return this.getApiKey('stripe', 'STRIPE_SECRET_KEY') || 
           this.getApiKey('stripe'); // Fallback to any Stripe key
  }

  /**
   * Get OpenAI API key
   */
  async getOpenAIKey(): Promise<string | null> {
    return this.getApiKey('openai', 'OPENAI_API_KEY') || 
           this.getApiKey('openai'); // Fallback to any OpenAI key
  }

  /**
   * Get Twilio credentials
   */
  async getTwilioCredentials(): Promise<{ accountSid: string; authToken: string } | null> {
    const accountSid = await this.getApiKey('twilio', 'TWILIO_ACCOUNT_SID');
    const authToken = await this.getApiKey('twilio', 'TWILIO_AUTH_TOKEN');
    
    if (accountSid && authToken) {
      return { accountSid, authToken };
    }
    return null;
  }

  /**
   * Get ElevenLabs API key
   */
  async getElevenLabsKey(): Promise<string | null> {
    return this.getApiKey('elevenlabs', 'ELEVENLABS_API_KEY') || 
           this.getApiKey('elevenlabs');
  }

  /**
   * Get Google Cloud credentials
   */
  async getGoogleCredentials(): Promise<string | null> {
    return this.getApiKey('google', 'GOOGLE_APPLICATION_CREDENTIALS') || 
           this.getApiKey('google');
  }

  /**
   * Get Heroku API key
   */
  async getHerokuKey(): Promise<string | null> {
    return this.getApiKey('heroku', 'HEROKU_API_KEY') || 
           this.getApiKey('heroku');
  }

  /**
   * Invalidate cache for a specific service or all keys
   */
  invalidateCache(serviceType?: string, keyName?: string): void {
    if (serviceType && keyName) {
      // Invalidate specific key
      const cacheKey = `${serviceType}:${keyName}`;
      this.keyCache.delete(cacheKey);
      console.log(`[KeyLoader] Invalidated cache for ${cacheKey}`);
    } else if (serviceType) {
      // Invalidate all keys for service type
      for (const key of Array.from(this.keyCache.keys())) {
        if (key.startsWith(`${serviceType}:`)) {
          this.keyCache.delete(key);
        }
      }
      console.log(`[KeyLoader] Invalidated cache for service ${serviceType}`);
    } else {
      // Clear entire cache
      this.keyCache.clear();
      console.log(`[KeyLoader] Cleared entire key cache`);
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.keyCache.size,
      keys: Array.from(this.keyCache.keys())
    };
  }

  /**
   * Check if a service has valid API keys configured
   */
  async hasValidKey(serviceType: string, keyName?: string): Promise<boolean> {
    const key = await this.getApiKey(serviceType, keyName);
    return key !== null && key.length > 0;
  }

  /**
   * Audit log for key access (can be extended with proper audit logging)
   */
  private auditKeyAccess(serviceType: string, keyName?: string, success: boolean = true): void {
    console.log(`[KeyLoader Audit] Service: ${serviceType}, Key: ${keyName || 'default'}, Success: ${success}, Time: ${new Date().toISOString()}`);
    // TODO: Store in proper audit log database table
  }
}

// Singleton instance
export const keyLoader = new SecureKeyLoader();

/**
 * Convenience functions for external services
 */
export async function getStripeKey(): Promise<string | null> {
  return keyLoader.getStripeKey();
}

export async function getOpenAIKey(): Promise<string | null> {
  return keyLoader.getOpenAIKey();
}

export async function getTwilioCredentials(): Promise<{ accountSid: string; authToken: string } | null> {
  return keyLoader.getTwilioCredentials();
}

export async function getElevenLabsKey(): Promise<string | null> {
  return keyLoader.getElevenLabsKey();
}

export async function getGoogleCredentials(): Promise<string | null> {
  return keyLoader.getGoogleCredentials();
}

export async function getHerokuKey(): Promise<string | null> {
  return keyLoader.getHerokuKey();
}

export function invalidateKeyCache(serviceType?: string, keyName?: string): void {
  keyLoader.invalidateCache(serviceType, keyName);
}