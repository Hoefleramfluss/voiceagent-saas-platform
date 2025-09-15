/**
 * Centralized Error Handling System for VoiceAgent SaaS Platform
 * Provides standardized error types, logging, monitoring, and recovery strategies
 */

import { Request, Response, NextFunction } from "express";

// Standard error types for the application
export enum ErrorType {
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION', 
  AUTHORIZATION = 'AUTHORIZATION',
  NOT_FOUND = 'NOT_FOUND',
  DATABASE = 'DATABASE',
  EXTERNAL_SERVICE = 'EXTERNAL_SERVICE',
  RATE_LIMIT = 'RATE_LIMIT',
  INTERNAL = 'INTERNAL',
  BILLING = 'BILLING',
  PROVISIONING = 'PROVISIONING'
}

// Error severity levels
export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM', 
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

// Custom application error class
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly severity: ErrorSeverity;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, any>;
  public readonly timestamp: Date;

  constructor(
    message: string,
    type: ErrorType,
    statusCode: number = 500,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context?: Record<string, any>,
    isOperational: boolean = true
  ) {
    super(message);
    
    this.type = type;
    this.severity = severity;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;
    this.timestamp = new Date();

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

// Error context interface for logging
interface ErrorContext {
  userId?: string;
  tenantId?: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
  endpoint?: string;
  method?: string;
}

// Structured error logger
class ErrorLogger {
  private static instance: ErrorLogger;

  static getInstance(): ErrorLogger {
    if (!ErrorLogger.instance) {
      ErrorLogger.instance = new ErrorLogger();
    }
    return ErrorLogger.instance;
  }

  /**
   * Log error with structured format and sensitive data masking
   */
  logError(error: Error | AppError, context?: ErrorContext): void {
    const errorInfo = this.formatError(error, context);
    
    // Log based on severity
    if (error instanceof AppError) {
      switch (error.severity) {
        case ErrorSeverity.CRITICAL:
          console.error(`[CRITICAL ERROR]`, errorInfo);
          this.alertCriticalError(error, context);
          break;
        case ErrorSeverity.HIGH:
          console.error(`[HIGH ERROR]`, errorInfo);
          break;
        case ErrorSeverity.MEDIUM:
          console.error(`[ERROR]`, errorInfo);
          break;
        case ErrorSeverity.LOW:
          console.warn(`[WARN]`, errorInfo);
          break;
      }
    } else {
      console.error(`[UNHANDLED ERROR]`, errorInfo);
    }
  }

  /**
   * Format error for structured logging with sensitive data masking
   */
  private formatError(error: Error | AppError, context?: ErrorContext): any {
    const baseInfo = {
      message: error.message,
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    };

    if (error instanceof AppError) {
      return {
        ...baseInfo,
        type: error.type,
        severity: error.severity,
        statusCode: error.statusCode,
        isOperational: error.isOperational,
        context: this.maskSensitiveData(error.context),
        requestContext: this.maskSensitiveData(context),
      };
    }

    return {
      ...baseInfo,
      type: 'UNHANDLED',
      severity: ErrorSeverity.HIGH,
      context: this.maskSensitiveData(context),
    };
  }

  /**
   * Mask sensitive data in error context
   */
  private maskSensitiveData(data?: Record<string, any>): Record<string, any> | undefined {
    if (!data) return data;

    const masked = { ...data };
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'api_key', 'stripe_key'];

    for (const key of Object.keys(masked)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        masked[key] = '[MASKED]';
      }
    }

    return masked;
  }

  /**
   * Alert critical errors (placeholder for future monitoring integration)
   */
  private alertCriticalError(error: AppError, context?: ErrorContext): void {
    // TODO: Integrate with monitoring service (e.g., Sentry, DataDog, etc.)
    console.error(`[ALERT] Critical error requires immediate attention:`, {
      error: error.message,
      type: error.type,
      context: context?.endpoint
    });
  }
}

// Error monitoring and metrics
export class ErrorMonitor {
  private static errorCounts: Map<string, number> = new Map();
  private static errorHistory: Array<{ timestamp: Date; error: AppError }> = [];
  private static readonly MAX_HISTORY = 1000;

  /**
   * Track error occurrence for monitoring
   */
  static trackError(error: AppError): void {
    const errorKey = `${error.type}:${error.statusCode}`;
    const currentCount = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, currentCount + 1);

    // Add to history
    this.errorHistory.unshift({ timestamp: new Date(), error });
    if (this.errorHistory.length > this.MAX_HISTORY) {
      this.errorHistory.pop();
    }
  }

  /**
   * Get error statistics for monitoring
   */
  static getErrorStats(): {
    counts: Record<string, number>;
    recentErrors: number;
    criticalErrors: number;
  } {
    const counts = Object.fromEntries(this.errorCounts);
    
    // Count recent errors (last hour)
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentErrors = this.errorHistory.filter(entry => entry.timestamp > hourAgo).length;
    
    // Count critical errors (last 24 hours)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const criticalErrors = this.errorHistory.filter(entry => 
      entry.timestamp > dayAgo && entry.error.severity === ErrorSeverity.CRITICAL
    ).length;

    return {
      counts,
      recentErrors,
      criticalErrors
    };
  }
}

// Centralized error handling middleware
export function errorHandlingMiddleware(
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const logger = ErrorLogger.getInstance();
  
  // Build error context from request
  const context: ErrorContext = {
    userId: (req as any).user?.id,
    tenantId: (req as any).tenantId,
    requestId: (req as any).requestId,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    endpoint: req.path,
    method: req.method,
  };

  // Convert unknown errors to AppError
  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else {
    // Handle common error types
    if (err.name === 'ValidationError') {
      appError = new AppError(
        err.message,
        ErrorType.VALIDATION,
        400,
        ErrorSeverity.LOW,
        { originalError: err.name }
      );
    } else if (err.name === 'UnauthorizedError') {
      appError = new AppError(
        'Authentication required',
        ErrorType.AUTHENTICATION,
        401,
        ErrorSeverity.MEDIUM
      );
    } else {
      appError = new AppError(
        'Internal server error',
        ErrorType.INTERNAL,
        500,
        ErrorSeverity.HIGH,
        { originalMessage: err.message }
      );
    }
  }

  // Log the error
  logger.logError(appError, context);

  // Track error for monitoring
  ErrorMonitor.trackError(appError);

  // Send response if headers not already sent
  if (!res.headersSent) {
    const errorResponse = {
      error: {
        message: appError.message,
        type: appError.type,
        timestamp: appError.timestamp.toISOString(),
        ...(process.env.NODE_ENV === 'development' && {
          stack: appError.stack,
          context: appError.context
        })
      }
    };

    res.status(appError.statusCode).json(errorResponse);
  }
}

// Utility functions for creating common errors
export const createError = {
  validation: (message: string, context?: Record<string, any>) =>
    new AppError(message, ErrorType.VALIDATION, 400, ErrorSeverity.LOW, context),

  authentication: (message: string = 'Authentication required') =>
    new AppError(message, ErrorType.AUTHENTICATION, 401, ErrorSeverity.MEDIUM),

  authorization: (message: string = 'Insufficient permissions') =>
    new AppError(message, ErrorType.AUTHORIZATION, 403, ErrorSeverity.MEDIUM),

  notFound: (resource: string) =>
    new AppError(`${resource} not found`, ErrorType.NOT_FOUND, 404, ErrorSeverity.LOW),

  database: (message: string, context?: Record<string, any>) =>
    new AppError(message, ErrorType.DATABASE, 500, ErrorSeverity.HIGH, context),

  externalService: (service: string, message?: string, context?: Record<string, any>) =>
    new AppError(
      message || `${service} service unavailable`,
      ErrorType.EXTERNAL_SERVICE,
      503,
      ErrorSeverity.HIGH,
      { service, ...context }
    ),

  rateLimit: (message: string = 'Too many requests') =>
    new AppError(message, ErrorType.RATE_LIMIT, 429, ErrorSeverity.MEDIUM),

  billing: (message: string, context?: Record<string, any>) =>
    new AppError(message, ErrorType.BILLING, 402, ErrorSeverity.CRITICAL, context),

  provisioning: (message: string, context?: Record<string, any>) =>
    new AppError(message, ErrorType.PROVISIONING, 500, ErrorSeverity.HIGH, context),
};

// Async error wrapper for route handlers
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Health check for error monitoring
export function getSystemHealth(): {
  status: 'healthy' | 'degraded' | 'unhealthy';
  errors: any;
  timestamp: string;
} {
  const stats = ErrorMonitor.getErrorStats();
  
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  
  if (stats.criticalErrors > 0) {
    status = 'unhealthy';
  } else if (stats.recentErrors > 10) {
    status = 'degraded';
  }

  return {
    status,
    errors: stats,
    timestamp: new Date().toISOString()
  };
}