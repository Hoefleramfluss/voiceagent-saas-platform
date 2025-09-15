/**
 * Twilio Webhook Verification Utilities
 * 
 * Security functions for validating Twilio webhook signatures
 * and ensuring webhook authenticity to prevent spoofing attacks
 */

import crypto from 'crypto';
import { createError } from './error-handling';

/**
 * Interface for Twilio signature validation result
 */
export interface TwilioSignatureValidation {
  isValid: boolean;
  error?: string;
}

/**
 * Validate Twilio webhook signature
 * SECURITY: Prevents webhook spoofing by verifying HMAC signature
 * 
 * @param url The full URL of the webhook endpoint
 * @param body The raw POST body from Twilio
 * @param signature The X-Twilio-Signature header value
 * @param authToken Your Twilio Auth Token (from environment)
 */
export async function validateTwilioSignature(
  url: string,
  body: string,
  signature: string,
  authToken?: string
): Promise<TwilioSignatureValidation> {
  try {
    // Get auth token from environment if not provided
    const token = authToken || process.env.TWILIO_AUTH_TOKEN;
    
    if (!token) {
      return {
        isValid: false,
        error: 'Twilio auth token not configured'
      };
    }
    
    if (!signature) {
      return {
        isValid: false,
        error: 'Missing Twilio signature header'
      };
    }
    
    // Create the expected signature using Twilio's algorithm
    // 1. Take the full URL of the request (from protocol through query string)
    // 2. If the request is a POST, append each POST parameter (key=value) in alphabetical order by key
    // 3. Take the resulting string and hash it using HMAC-SHA1, using your AuthToken as the key
    
    let data = url;
    
    // For POST requests, sort and append parameters
    if (body) {
      const params = new URLSearchParams(body);
      const sortedParams = Array.from(params.entries()).sort();
      for (const [key, value] of sortedParams) {
        data += key + value;
      }
    }
    
    // Create HMAC-SHA1 signature
    const expectedSignature = crypto
      .createHmac('sha1', token)
      .update(data, 'utf8')
      .digest('base64');
    
    // Compare signatures using timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(expectedSignature, 'base64')
    );
    
    if (!isValid) {
      console.warn(`[TwilioVerification] Signature mismatch for URL: ${url}`);
      console.warn(`[TwilioVerification] Expected: ${expectedSignature}`);
      console.warn(`[TwilioVerification] Received: ${signature}`);
    }
    
    return {
      isValid,
      error: isValid ? undefined : 'Invalid Twilio signature'
    };
    
  } catch (error) {
    console.error('[TwilioVerification] Signature validation error:', error);
    return {
      isValid: false,
      error: `Signature validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Validate Twilio webhook request with comprehensive security checks
 * 
 * @param request Express request object or equivalent with headers and body
 * @param url The full webhook URL (optional, will construct from request if not provided)
 */
export async function validateTwilioWebhookRequest(
  request: {
    headers: Record<string, string | string[] | undefined>;
    body: any;
    rawBody?: string;
    url?: string;
    protocol?: string;
    hostname?: string;
    originalUrl?: string;
  },
  url?: string
): Promise<TwilioSignatureValidation> {
  try {
    // Get signature from headers
    const signature = request.headers['x-twilio-signature'];
    if (!signature || Array.isArray(signature)) {
      return {
        isValid: false,
        error: 'Missing or invalid Twilio signature header'
      };
    }
    
    // Construct URL with proxy header support
    let webhookUrl = url;
    if (!webhookUrl) {
      // Handle proxy headers for proper URL construction
      const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'https';
      const host = request.headers['x-forwarded-host'] || request.hostname;
      const originalUrl = request.originalUrl || request.url || '';
      
      if (host) {
        webhookUrl = `${protocol}://${host}${originalUrl}`;
      }
    }
    
    if (!webhookUrl) {
      return {
        isValid: false,
        error: 'Unable to determine webhook URL for validation'
      };
    }
    
    // CRITICAL SECURITY: Use raw body for signature verification
    let bodyString = '';
    if (request.rawBody) {
      // Use captured raw body (preferred for security)
      bodyString = request.rawBody;
      console.log('[TwilioVerification] Using captured raw body for signature verification');
    } else if (typeof request.body === 'string') {
      // Fallback to string body if raw body not available
      bodyString = request.body;
      console.warn('[TwilioVerification] Using string body fallback - raw body preferred for security');
    } else if (request.body && typeof request.body === 'object') {
      // Convert object to URL-encoded string (least secure fallback)
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(request.body)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      }
      bodyString = params.toString();
      console.warn('[TwilioVerification] Using reconstructed body - raw body preferred for security');
    }
    
    return await validateTwilioSignature(webhookUrl, bodyString, signature);
    
  } catch (error) {
    console.error('[TwilioVerification] Webhook validation error:', error);
    return {
      isValid: false,
      error: `Webhook validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Middleware factory for Express to validate Twilio webhooks
 * Usage: app.use('/webhook/twilio', validateTwilioMiddleware())
 */
export function createTwilioValidationMiddleware() {
  return async (req: any, res: any, next: any) => {
    try {
      const validation = await validateTwilioWebhookRequest(req);
      
      if (!validation.isValid) {
        console.warn('[TwilioMiddleware] Webhook validation failed:', validation.error);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid Twilio signature'
        });
      }
      
      console.log('[TwilioMiddleware] Webhook signature validated successfully');
      next();
      
    } catch (error) {
      console.error('[TwilioMiddleware] Middleware error:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Webhook validation error'
      });
    }
  };
}