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
  
  // SECURITY: Basic input sanitization - allow only phone number characters
  const sanitized = phoneNumber.trim().replace(/[^\+\-\s\(\)\.\d]/g, '');
  if (sanitized !== phoneNumber.trim()) {
    throw createError.validation('Phone number contains invalid characters');
  }
  
  try {
    let parsedNumber;
    
    // Strategy 1: If number starts with +, try parsing as international number
    if (sanitized.startsWith('+')) {
      try {
        parsedNumber = parsePhoneNumber(sanitized);
        // Verify it's a supported region
        if (parsedNumber?.country && SUPPORTED_REGIONS.includes(parsedNumber.country)) {
          return parsedNumber.format('E.164');
        }
      } catch {
        // Continue to other strategies
      }
    }
    
    // Strategy 2: Try with default country first (highest priority for local numbers)
    if (defaultCountry && !sanitized.startsWith('+')) {
      const countryToTry = defaultCountry as CountryCode;
      if (SUPPORTED_REGIONS.includes(countryToTry)) {
        try {
          parsedNumber = parsePhoneNumber(sanitized, countryToTry);
          if (parsedNumber?.country && SUPPORTED_REGIONS.includes(parsedNumber.country)) {
            return parsedNumber.format('E.164');
          }
        } catch {
          // Continue to next strategy
        }
      }
    }
    
    // Strategy 2.5: Smart detection for European mobile prefixes
    if (!sanitized.startsWith('+') && sanitized.replace(/\D/g, '').startsWith('067')) {
      // Austrian mobile numbers starting with 067x
      try {
        parsedNumber = parsePhoneNumber(sanitized, 'AT');
        if (parsedNumber?.country === 'AT') {
          return parsedNumber.format('E.164');
        }
      } catch {
        // Continue to next strategy
      }
    }
    
    // Strategy 3: Try US first (for US numbers without country code)
    if (!defaultCountry || defaultCountry !== 'US') {
      try {
        parsedNumber = parsePhoneNumber(sanitized, 'US');
        if (parsedNumber?.country === 'US') {
          return parsedNumber.format('E.164');
        }
      } catch {
        // Continue to next strategy
      }
    }
    
    // Strategy 4: Try Austria specifically for numbers starting with 0
    if (!sanitized.startsWith('+') && sanitized.replace(/\D/g, '').startsWith('0')) {
      try {
        parsedNumber = parsePhoneNumber(sanitized, 'AT');
        if (parsedNumber?.country === 'AT') {
          return parsedNumber.format('E.164');
        }
      } catch {
        // Continue to next strategy
      }
    }
    
    // Strategy 5: Try each supported region systematically
    const regionsToTry = SUPPORTED_REGIONS.filter(region => 
      region !== defaultCountry && region !== 'US' && region !== 'AT'
    );
    
    for (const country of regionsToTry) {
      try {
        parsedNumber = parsePhoneNumber(sanitized, country);
        if (parsedNumber?.country && SUPPORTED_REGIONS.includes(parsedNumber.country)) {
          return parsedNumber.format('E.164');
        }
      } catch {
        // Continue trying other countries
      }
    }
    
    // Strategy 5: Final attempt without country hint
    try {
      parsedNumber = parsePhoneNumber(sanitized);
      if (parsedNumber?.country && SUPPORTED_REGIONS.includes(parsedNumber.country)) {
        return parsedNumber.format('E.164');
      }
    } catch {
      // Final strategy failed
    }
    
    throw createError.validation(
      `Unable to parse phone number as valid format. Supported regions: ${SUPPORTED_REGIONS.join(', ')}`
    );
    
  } catch (error) {
    if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'BadRequestError')) {
      throw error;
    }
    throw createError.validation(`Phone number validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * SECURITY: Validate phone number for demo signup with flexible test number support
 * Allows 555 numbers for testing while blocking known problematic patterns in production
 */
export function validateDemoPhoneNumber(phoneNumber: string, allowTestNumbers: boolean = true): void {
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
    
    // Block known problematic number patterns (except for test scenarios)
    const problematicPatterns = [];
    
    // Only block 555 numbers in production/strict mode
    if (!allowTestNumbers) {
      problematicPatterns.push(/^\+1555/); // US reserved test numbers
    }
    
    // Always block these problematic patterns
    problematicPatterns.push(
      /^\+44800/, // UK freephone
      /^\+49800/, // DE freephone
      /^\+1800/, // US toll-free
      /^\+1888/, // US toll-free
      /^\+1877/, // US toll-free
      /^\+1866/, // US toll-free
    );
    
    for (const pattern of problematicPatterns) {
      if (pattern.test(normalized)) {
        throw createError.validation('Phone number type not supported for verification');
      }
    }
    
    console.log(`[PhoneValidation] Valid demo phone number: ${normalized} (country: ${parsed.country}, testMode: ${allowTestNumbers})`);
    
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
 * Supports both production and test number validation modes
 */
export function validatePhoneNumber(phoneNumber: string, options: { allowTestNumbers?: boolean; strictMode?: boolean } = {}): { isValid: boolean; error?: string } {
  const { allowTestNumbers = true, strictMode = false } = options;
  
  try {
    // Basic format validation first
    validatePhoneNumberFormat(phoneNumber);
    
    // Try to normalize - this will check if it's in supported regions
    const normalized = normalizePhoneNumber(phoneNumber);
    
    // Additional validation using libphonenumber-js
    if (!isValidPhoneNumber(normalized)) {
      return { isValid: false, error: 'Phone number format is invalid according to libphonenumber-js' };
    }
    
    // Apply demo phone validation logic if in strict mode
    if (strictMode) {
      try {
        validateDemoPhoneNumber(phoneNumber, allowTestNumbers);
      } catch (error) {
        return {
          isValid: false,
          error: error instanceof Error ? error.message : 'Failed strict validation'
        };
      }
    }
    
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