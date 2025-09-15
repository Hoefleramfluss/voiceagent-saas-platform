/**
 * Phone Number Security Utilities
 * 
 * Critical security functions for phone number normalization and tenant validation
 * to prevent cross-tenant bot binding and call misrouting vulnerabilities.
 */

import { db } from "./db";
import { bots, phoneNumberMappings } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { createError } from "./error-handling";
import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';

/**
 * Supported regions for demo phone verification
 * Limits to regions where SMS delivery is reliable and cost-effective
 */
const SUPPORTED_REGIONS: CountryCode[] = [
  'US', 'CA', // North America
  'GB', 'DE', 'FR', 'AT', 'CH', 'NL', 'BE', 'IE', // Western Europe
  'AU', 'NZ', // Oceania
  'SE', 'NO', 'DK', 'FI' // Nordic countries
];

/**
 * Enhanced phone number normalization with strict E.164 validation and region allowlisting
 * SECURITY: Only allows phone numbers from supported regions to prevent abuse
 */
export function normalizePhoneNumber(phoneNumber: string, defaultCountry?: string): string {
  if (!phoneNumber) {
    throw createError.validation('Phone number is required');
  }
  
  // SECURITY: Basic input sanitization
  const sanitized = phoneNumber.trim().replace(/[^\+\-\s\(\)\d]/g, '');
  if (sanitized !== phoneNumber.trim()) {
    throw createError.validation('Phone number contains invalid characters');
  }
  
  try {
    let parsedNumber;
    
    // First try to parse without country hint
    if (isValidPhoneNumber(sanitized)) {
      parsedNumber = parsePhoneNumber(sanitized);
    } else if (defaultCountry) {
      // Try with provided default country
      const countryToTry = defaultCountry as CountryCode;
      if (SUPPORTED_REGIONS.includes(countryToTry) && isValidPhoneNumber(sanitized, countryToTry)) {
        parsedNumber = parsePhoneNumber(sanitized, countryToTry);
      }
    }
    
    // If still not parsed, try supported regions in order of preference
    if (!parsedNumber) {
      for (const country of SUPPORTED_REGIONS) {
        try {
          if (isValidPhoneNumber(sanitized, country)) {
            parsedNumber = parsePhoneNumber(sanitized, country);
            break;
          }
        } catch {
          // Continue trying other countries
        }
      }
    }
    
    if (!parsedNumber) {
      throw createError.validation(
        `Invalid phone number format. Supported regions: ${SUPPORTED_REGIONS.join(', ')}`
      );
    }
    
    // SECURITY: Verify the parsed number is from a supported region
    if (!parsedNumber.country || !SUPPORTED_REGIONS.includes(parsedNumber.country)) {
      throw createError.validation(
        `Phone number region '${parsedNumber.country || 'unknown'}' is not supported. ` +
        `Supported regions: ${SUPPORTED_REGIONS.join(', ')}`
      );
    }
    
    // SECURITY: Additional validation for mobile numbers (preferred for SMS)
    const numberType = parsedNumber.getType();
    if (numberType && !['MOBILE', 'FIXED_LINE_OR_MOBILE'].includes(numberType)) {
      console.warn(`[PhoneValidation] Non-mobile number detected: ${parsedNumber.number} (type: ${numberType})`);
    }
    
    return parsedNumber.format('E.164');
    
  } catch (error) {
    if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'BadRequestError')) {
      throw error;
    }
    throw createError.validation(`Invalid phone number format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * SECURITY: Validate phone number for demo signup with strict checks
 */
export function validateDemoPhoneNumber(phoneNumber: string): void {
  if (!phoneNumber) {
    throw createError.validation('Phone number is required for demo verification');
  }
  
  // Basic format validation
  validatePhoneNumberFormat(phoneNumber);
  
  try {
    // Ensure it can be normalized to a supported region
    const normalized = normalizePhoneNumber(phoneNumber);
    
    // Additional security checks
    const parsed = parsePhoneNumber(normalized);
    
    // Block known problematic number patterns
    const problematicPatterns = [
      /^\+1555/, // US reserved test numbers
      /^\+44800/, // UK freephone
      /^\+49800/, // DE freephone
    ];
    
    for (const pattern of problematicPatterns) {
      if (pattern.test(normalized)) {
        throw createError.validation('Phone number type not supported for verification');
      }
    }
    
    console.log(`[PhoneValidation] Valid demo phone number: ${normalized} (country: ${parsed.country})`);
    
  } catch (error) {
    if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'BadRequestError')) {
      throw error;
    }
    throw createError.validation('Phone number validation failed');
  }
}

/**
 * CRITICAL SECURITY: Validate that a bot belongs to the specified tenant
 * Prevents cross-tenant bot binding vulnerability
 */
export async function validateBotOwnership(botId: string, tenantId: string): Promise<void> {
  if (!botId || !tenantId) {
    throw createError.validation('Bot ID and Tenant ID are required');
  }
  
  const [bot] = await db
    .select({ id: bots.id, tenantId: bots.tenantId })
    .from(bots)
    .where(and(
      eq(bots.id, botId),
      eq(bots.tenantId, tenantId)
    ));
  
  if (!bot) {
    throw createError.authorization('Bot does not belong to this tenant or does not exist');
  }
}

/**
 * Validate phone number format without normalization (for validation only)
 */
export function validatePhoneNumberFormat(phoneNumber: string): void {
  if (!phoneNumber) {
    throw createError.validation('Phone number is required');
  }
  
  // Remove all non-digit characters for validation
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    throw createError.validation('Phone number must be between 10 and 15 digits');
  }
  
  // Check for valid characters (only digits, spaces, parentheses, hyphens, plus)
  if (!/^[\+\-\s\(\)\d]+$/.test(phoneNumber)) {
    throw createError.validation('Phone number contains invalid characters');
  }
}

/**
 * Alias for normalizePhoneNumber to match enterprise test expectations
 */
export function normalizePhoneToE164(phoneNumber: string, defaultCountry?: string): string {
  return normalizePhoneNumber(phoneNumber, defaultCountry);
}

/**
 * Validate phone number and return validation result (for enterprise tests)
 */
export function validatePhoneNumber(phoneNumber: string): { isValid: boolean; error?: string } {
  try {
    validatePhoneNumberFormat(phoneNumber);
    normalizePhoneNumber(phoneNumber);
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown validation error'
    };
  }
}

/**
 * Security violation types for phone number checks
 */
export interface PhoneSecurityViolation {
  hasViolations: boolean;
  violations: string[];
  details?: string;
}

/**
 * Check for phone number security violations (cross-tenant access, etc.)
 * CRITICAL SECURITY: Prevents cross-tenant bot binding and call misrouting
 */
export async function checkPhoneSecurityViolations(
  phoneNumber: string,
  requestedTenantId: string,
  requestedBotId: string
): Promise<PhoneSecurityViolation> {
  const violations: string[] = [];
  const details: string[] = [];
  
  try {
    // Normalize phone number first
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    
    // Check if phone number is already mapped to a different tenant
    const [existingMapping] = await db
      .select({
        tenantId: phoneNumberMappings.tenantId,
        botId: phoneNumberMappings.botId,
        isActive: phoneNumberMappings.isActive
      })
      .from(phoneNumberMappings)
      .where(and(
        eq(phoneNumberMappings.phoneNumber, normalizedPhone),
        eq(phoneNumberMappings.isActive, true)
      ));
    
    if (existingMapping) {
      // Check if trying to bind to different tenant
      if (existingMapping.tenantId !== requestedTenantId) {
        violations.push('CROSS_TENANT_PHONE_BINDING');
        details.push(`Phone number ${normalizedPhone} is already bound to tenant ${existingMapping.tenantId}`);
      }
      
      // Check if trying to bind to different bot within same tenant
      if (existingMapping.tenantId === requestedTenantId && existingMapping.botId !== requestedBotId) {
        violations.push('CROSS_TENANT_BOT_BINDING');
        details.push(`Phone number ${normalizedPhone} is already bound to bot ${existingMapping.botId}`);
      }
    }
    
    // Validate that the requested bot actually belongs to the tenant
    try {
      await validateBotOwnership(requestedBotId, requestedTenantId);
    } catch (error) {
      violations.push('INVALID_BOT_OWNERSHIP');
      details.push(`Bot ${requestedBotId} does not belong to tenant ${requestedTenantId}`);
    }
    
    return {
      hasViolations: violations.length > 0,
      violations,
      details: details.join('; ')
    };
    
  } catch (error) {
    violations.push('VALIDATION_ERROR');
    details.push(`Phone validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    return {
      hasViolations: true,
      violations,
      details: details.join('; ')
    };
  }
}