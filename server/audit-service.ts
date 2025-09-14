import { storage } from "./storage";
import { type InsertAuditLog } from "@shared/schema";
import type { Request, Response } from "express";

export interface AuditableUser {
  id?: string;
  email?: string;
  tenantId?: string;
}

export interface AuditContext {
  user?: AuditableUser;
  ipAddress?: string;
  userAgent?: string;
  operation: string;
  eventType: 'api_key_created' | 'api_key_deleted' | 'user_login' | 'user_logout' | 'password_change' | 'role_change' | 'sensitive_operation';
  success: boolean;
  statusCode?: number;
  metadata?: any;
}

export class AuditService {
  /**
   * Sanitizes metadata by removing or masking sensitive fields to prevent secret leakage
   */
  private static redactMetadata(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    
    const sensitiveFields = [
      'password', 'keyValue', 'secret', 'token', 'apikey', 'api_key',
      'authorization', 'auth', 'private_key', 'privatekey', 'credential',
      'credentials', 'session_id', 'sessionid', 'jwt', 'bearer'
    ];
    
    const redacted = JSON.parse(JSON.stringify(obj));
    
    const redactRecursive = (item: any, path: string[] = []): any => {
      if (!item || typeof item !== 'object') return item;
      
      for (const [key, value] of Object.entries(item)) {
        const lowerKey = key.toLowerCase();
        
        // Check if this field should be redacted
        if (sensitiveFields.some(field => lowerKey.includes(field))) {
          item[key] = typeof value === 'string' && value.length > 4 
            ? '••••' + value.slice(-4) 
            : '••••••••';
        } else if (typeof value === 'object' && value !== null) {
          redactRecursive(value, [...path, key]);
        }
      }
      
      return item;
    };
    
    return redactRecursive(redacted);
  }

  static async log(context: AuditContext): Promise<void> {
    try {
      const auditLog: InsertAuditLog = {
        eventType: context.eventType,
        operation: context.operation,
        userId: context.user?.id,
        userEmail: context.user?.email,
        tenantId: context.user?.tenantId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        success: context.success,
        statusCode: context.statusCode,
        metadata: context.metadata ? this.redactMetadata(context.metadata) : undefined
      };

      await storage.createAuditLog(auditLog);

      // Also log to console for immediate visibility during development
      const logLevel = context.success ? 'info' : 'warn';
      console[logLevel](`[AUDIT] ${context.eventType} - ${context.operation} - User: ${context.user?.email || 'unknown'} - Success: ${context.success}`);
    } catch (error) {
      // Log audit failures to console as fallback
      console.error('[AUDIT ERROR] Failed to log audit event:', error, context);
    }
  }

  static async logFromRequest(
    req: Request,
    res: Response,
    eventType: AuditContext['eventType'],
    operation: string,
    metadata?: any
  ): Promise<void> {
    const user = (req as any).user as AuditableUser | undefined;
    const ipAddress = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    const userAgent = req.get('User-Agent');
    const success = res.statusCode >= 200 && res.statusCode < 400;

    await this.log({
      user,
      ipAddress,
      userAgent,
      operation,
      eventType,
      success,
      statusCode: res.statusCode,
      metadata
    });
  }

  static async logApiKeyOperation(
    user: AuditableUser,
    operation: 'created' | 'deleted',
    keyDetails: { serviceType: string; keyName: string },
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const eventType = operation === 'created' ? 'api_key_created' : 'api_key_deleted';
    
    await this.log({
      user,
      ipAddress,
      userAgent,
      operation: `API Key ${operation} - Service: ${keyDetails.serviceType}, Name: ${keyDetails.keyName}`,
      eventType,
      success: true,
      statusCode: 200,
      metadata: keyDetails
    });
  }

  static async logSensitiveOperation(
    user: AuditableUser,
    operation: string,
    success: boolean,
    statusCode: number,
    ipAddress?: string,
    userAgent?: string,
    metadata?: any
  ): Promise<void> {
    await this.log({
      user,
      ipAddress,
      userAgent,
      operation,
      eventType: 'sensitive_operation',
      success,
      statusCode,
      metadata
    });
  }
}

export const auditService = AuditService;