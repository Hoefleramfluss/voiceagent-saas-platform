/**
 * Retry Logic and Circuit Breaker Utilities for VoiceAgent SaaS Platform
 * Provides resilient patterns for database and external service operations
 */

import { AppError, ErrorType, ErrorSeverity, createError } from './error-handling';

// Retry configuration options
interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
  retryableStatusCodes?: number[];
  onRetry?: (attempt: number, error: Error) => void;
}

// Default retry configurations for different operation types
export const RETRY_CONFIGS = {
  DATABASE: {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 2000,
    backoffMultiplier: 2,
    retryableErrors: ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    retryableStatusCodes: [502, 503, 504]
  },
  EXTERNAL_SERVICE: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504]
  },
  BILLING: {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 500, 502, 503, 504]
  }
};

/**
 * Executes a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryOptions,
  operationName?: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await operation();
      
      // Log successful retry if not first attempt
      if (attempt > 1) {
        console.log(`[RETRY SUCCESS] ${operationName || 'Operation'} succeeded on attempt ${attempt}`);
      }
      
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if error is retryable
      if (!isRetryableError(lastError, config)) {
        console.error(`[RETRY FAILED] ${operationName || 'Operation'} failed with non-retryable error:`, lastError);
        throw lastError;
      }
      
      // Don't retry on last attempt
      if (attempt === config.maxAttempts) {
        console.error(`[RETRY EXHAUSTED] ${operationName || 'Operation'} failed after ${config.maxAttempts} attempts`);
        throw createError.externalService(
          operationName || 'External service',
          `Operation failed after ${config.maxAttempts} attempts: ${lastError.message}`,
          { attempts: config.maxAttempts, lastError: lastError.message }
        );
      }
      
      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelayMs
      );
      const jitteredDelay = delay + (Math.random() * delay * 0.1); // Add 10% jitter
      
      console.warn(`[RETRY] ${operationName || 'Operation'} failed (attempt ${attempt}/${config.maxAttempts}), retrying in ${Math.round(jitteredDelay)}ms:`, lastError.message);
      
      // Call retry callback if provided
      if (config.onRetry) {
        config.onRetry(attempt, lastError);
      }
      
      // Wait before retrying
      await sleep(jitteredDelay);
    }
  }
  
  throw lastError;
}

/**
 * Circuit breaker implementation for external services
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private readonly serviceName: string,
    private readonly failureThreshold: number = 5,
    private readonly recoveryTimeMs: number = 60000, // 1 minute
    private readonly successThreshold: number = 3
  ) {}

  /**
   * Execute operation through circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime < this.recoveryTimeMs) {
        throw createError.externalService(
          this.serviceName,
          `Circuit breaker is OPEN for ${this.serviceName}. Service temporarily unavailable.`,
          { state: this.state, failures: this.failures }
        );
      } else {
        this.state = 'HALF_OPEN';
        console.log(`[CIRCUIT BREAKER] ${this.serviceName} circuit breaker moving to HALF_OPEN state`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      console.log(`[CIRCUIT BREAKER] ${this.serviceName} operation succeeded in HALF_OPEN state`);
    }
    
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      console.error(`[CIRCUIT BREAKER] ${this.serviceName} circuit breaker is now OPEN after ${this.failures} failures`);
    }
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): {
    serviceName: string;
    state: string;
    failures: number;
    lastFailureTime: number;
  } {
    return {
      serviceName: this.serviceName,
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

/**
 * Circuit breaker manager for different services
 */
export class CircuitBreakerManager {
  private static breakers: Map<string, CircuitBreaker> = new Map();

  static getBreaker(serviceName: string): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(serviceName, new CircuitBreaker(serviceName));
    }
    return this.breakers.get(serviceName)!;
  }

  static getAllStatus(): Array<{
    serviceName: string;
    state: string;
    failures: number;
    lastFailureTime: number;
  }> {
    return Array.from(this.breakers.values()).map(breaker => breaker.getStatus());
  }
}

/**
 * Database operation wrapper with retry logic
 */
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  operationName?: string
): Promise<T> {
  return withRetry(operation, RETRY_CONFIGS.DATABASE, `DB: ${operationName}`);
}

/**
 * External service operation wrapper with circuit breaker and retry
 */
export async function withExternalServiceResilience<T>(
  operation: () => Promise<T>,
  serviceName: string,
  operationName?: string
): Promise<T> {
  const circuitBreaker = CircuitBreakerManager.getBreaker(serviceName);
  
  return circuitBreaker.execute(() => 
    withRetry(operation, RETRY_CONFIGS.EXTERNAL_SERVICE, `${serviceName}: ${operationName}`)
  );
}

/**
 * Billing operation wrapper with enhanced retry logic
 */
export async function withBillingResilience<T>(
  operation: () => Promise<T>,
  operationName?: string
): Promise<T> {
  const circuitBreaker = CircuitBreakerManager.getBreaker('Stripe');
  
  return circuitBreaker.execute(() => 
    withRetry(operation, RETRY_CONFIGS.BILLING, `Billing: ${operationName}`)
  );
}

/**
 * Check if an error is retryable based on configuration
 */
function isRetryableError(error: Error, config: RetryOptions): boolean {
  // Check error codes
  if (config.retryableErrors) {
    const errorCode = (error as any).code || (error as any).errno;
    if (errorCode && config.retryableErrors.includes(errorCode)) {
      return true;
    }
  }
  
  // Check HTTP status codes
  if (config.retryableStatusCodes) {
    const statusCode = (error as any).status || (error as any).statusCode;
    if (statusCode && config.retryableStatusCodes.includes(statusCode)) {
      return true;
    }
  }
  
  // Check error messages for common transient failure patterns
  const transientPatterns = [
    'timeout',
    'connection',
    'network',
    'temporary',
    'unavailable',
    'rate limit',
    'too many requests'
  ];
  
  const errorMessage = error.message.toLowerCase();
  return transientPatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Sleep utility for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Health check for retry and circuit breaker systems
 */
export function getResilienceHealth(): {
  circuitBreakers: Array<{
    serviceName: string;
    state: string;
    failures: number;
    lastFailureTime: number;
  }>;
  openCircuits: number;
  timestamp: string;
} {
  const breakersStatus = CircuitBreakerManager.getAllStatus();
  const openCircuits = breakersStatus.filter(b => b.state === 'OPEN').length;
  
  return {
    circuitBreakers: breakersStatus,
    openCircuits,
    timestamp: new Date().toISOString()
  };
}