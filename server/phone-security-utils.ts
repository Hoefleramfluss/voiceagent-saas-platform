/**
 * Phone Number Security Utilities
 * 
 * Critical security functions for phone number normalization and tenant validation
 * to prevent cross-tenant bot binding and call misrouting vulnerabilities.
 */

import { db } from "./db";
import { bots } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { createError } from "./error-handling";
import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';

/**
 * Normalize phone number to E.164 format for consistent storage and lookup
 * Prevents routing failures due to different phone number formats
 * Uses libphonenumber-js for proper international phone number handling
 */
export function normalizePhoneNumber(phoneNumber: string, defaultCountry?: string): string {
  if (!phoneNumber) {
    throw createError.validation('Phone number is required');
  }
  
  try {
    // First check if it's already a valid phone number
    if (isValidPhoneNumber(phoneNumber)) {
      const parsed = parsePhoneNumber(phoneNumber);
      return parsed.format('E.164');
    }
    
    // Try with default country (US) if no country specified
    const countryToTry = (defaultCountry || 'US') as CountryCode;
    
    if (isValidPhoneNumber(phoneNumber, countryToTry)) {
      const parsed = parsePhoneNumber(phoneNumber, countryToTry);
      return parsed.format('E.164');
    }
    
    // Try common countries for international numbers
    const commonCountries: CountryCode[] = ['US', 'CA', 'GB', 'DE', 'FR', 'AU', 'AT'];
    for (const country of commonCountries) {
      try {
        if (isValidPhoneNumber(phoneNumber, country)) {
          const parsed = parsePhoneNumber(phoneNumber, country);
          return parsed.format('E.164');
        }
      } catch {
        // Continue trying other countries
      }
    }
    
    throw createError.validation('Invalid phone number format - unable to parse as valid international number');
    
  } catch (error) {
    if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'BadRequestError')) {
      throw error;
    }
    throw createError.validation(`Invalid phone number format: ${error instanceof Error ? error.message : 'Unknown error'}`);
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