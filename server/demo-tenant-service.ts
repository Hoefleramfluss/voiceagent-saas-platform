/**
 * Demo Tenant Setup Service
 * Handles simplified onboarding workflow for demo tenants with phone verification
 */

import { storage } from "./storage";
import { keyLoader } from "./key-loader";
import { normalizePhoneNumber, validateDemoPhoneNumber } from "./phone-security-utils";
import { createError } from "./error-handling";
import crypto from "crypto";

interface DemoTenantData {
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  firstName?: string;
  lastName?: string;
  industry?: string;
  useCase?: string;
}

interface DemoTenantResult {
  success: boolean;
  tenantId?: string;
  botId?: string;
  phoneNumber?: string;
  demoNumber?: string; // Twilio-owned number for testing
  error?: string;
  // SECURITY: Verification code removed from response interface
}

interface PhoneVerificationResult {
  success: boolean;
  isVerified?: boolean;
  demoNumber?: string; // Provisioned demo number for testing
  error?: string;
}

export class DemoTenantService {
  // SECURITY: Verification codes now stored in database for persistence
  // No longer using volatile in-memory storage
  
  /**
   * Create demo tenant with simplified workflow
   * Skips Stripe setup and uses demo billing for trial period
   */
  async createDemoTenant(demoData: DemoTenantData): Promise<DemoTenantResult> {
    try {
      console.log(`[DemoSetup] Starting demo setup for: ${demoData.companyName}`);
      
      // SECURITY: Validate and normalize phone number with strict checks
      validateDemoPhoneNumber(demoData.contactPhone);
      const normalizedPhone = normalizePhoneNumber(demoData.contactPhone);
      
      // Generate demo subdomain (simplified - no conflict checking for demo)
      const subdomain = this.generateDemoSubdomain(demoData.companyName);
      
      // Create demo tenant
      const tenant = await storage.createTenant({
        name: demoData.companyName,
        status: 'trial', // Demo tenants start in trial mode
        stripeCustomerId: null // No Stripe for demo
      });
      
      // Create demo admin user
      const demoUser = await this.createDemoUser(tenant.id, demoData);
      
      // Create default demo bot
      const bot = await this.createDemoBot(tenant.id, demoData.companyName);
      
      // Generate phone verification code
      const verificationCode = this.generateVerificationCode();
      await this.storeVerificationCode(tenant.id, verificationCode, normalizedPhone);
      
      // Send verification SMS (if Twilio is configured)
      await this.sendVerificationSMS(normalizedPhone, verificationCode, demoData.companyName);
      
      console.log(`[DemoSetup] Demo tenant created successfully:
        - Tenant ID: ${tenant.id}
        - Company: ${demoData.companyName}
        - Bot ID: ${bot.id}
        - Phone: ${normalizedPhone}`);
      
      // Log verification code server-side only for debugging (never return to client)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DemoSetup] DEVELOPMENT ONLY - Verification code for tenant ${tenant.id}: ${verificationCode}`);
      }
      
      return {
        success: true,
        tenantId: tenant.id,
        botId: bot.id,
        phoneNumber: normalizedPhone
        // SECURITY: Never expose verification code to client
      };
      
    } catch (error) {
      console.error('[DemoSetup] Failed to create demo tenant:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown setup error'
      };
    }
  }
  
  /**
   * Verify phone number with SMS code
   */
  async verifyPhoneNumber(tenantId: string, code: string): Promise<PhoneVerificationResult> {
    try {
      // SECURITY: Get verification code from database
      const verification = await storage.getVerificationCode(tenantId);
      
      if (!verification) {
        return {
          success: false,
          error: 'No verification code found. Please request a new code.'
        };
      }
      
      if (verification.expiresAt < new Date()) {
        await storage.deleteVerificationCode(tenantId);
        return {
          success: false,
          error: 'Verification code has expired. Please request a new code.'
        };
      }
      
      // SECURITY: Track failed attempts to prevent brute force
      if (verification.code !== code.trim()) {
        await storage.updateVerificationCode(verification.id, {
          attempts: verification.attempts + 1
        });
        
        // Block after too many attempts
        if (verification.attempts >= 4) {
          await storage.deleteVerificationCode(tenantId);
          return {
            success: false,
            error: 'Too many invalid attempts. Please request a new verification code.'
          };
        }
        
        return {
          success: false,
          error: 'Invalid verification code. Please check and try again.'
        };
      }
      
      // Code is valid - provision demo number and create phone mapping
      const demoNumber = await this.provisionDemoNumber(tenantId);
      await this.createPhoneMapping(tenantId, demoNumber);
      
      // Update tenant status to active
      await storage.updateTenant(tenantId, {
        status: 'active',
        updatedAt: new Date()
      });
      
      // SECURITY: Mark verification code as used and clean up
      await storage.updateVerificationCode(verification.id, { isUsed: true });
      await storage.deleteVerificationCode(tenantId);
      
      console.log(`[DemoSetup] Phone verification successful for tenant ${tenantId}`);
      
      // Get the demo number that was provisioned for this tenant
      const phoneMapping = await storage.getPhoneNumberMappings(tenantId);
      const provisionedDemoNumber = phoneMapping.length > 0 ? phoneMapping[0].phoneNumber : null;
      
      return {
        success: true,
        isVerified: true,
        demoNumber: provisionedDemoNumber || undefined // Return the demo number for testing
      };
      
    } catch (error) {
      console.error('[DemoSetup] Phone verification failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Verification failed'
      };
    }
  }
  
  /**
   * Resend verification code
   */
  async resendVerificationCode(tenantId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // SECURITY: Get verification code from database
      const verification = await storage.getVerificationCode(tenantId);
      
      if (!verification) {
        return {
          success: false,
          error: 'No active verification found. Please start setup again.'
        };
      }
      
      // Generate new code and update database
      const newCode = this.generateVerificationCode();
      await storage.updateVerificationCode(verification.id, {
        code: newCode,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        attempts: 0 // Reset attempts on resend
      });
      
      // Resend SMS
      await this.sendVerificationSMS(verification.phoneNumber, newCode, 'VoiceAgent Demo');
      
      return { success: true };
      
    } catch (error) {
      console.error('[DemoSetup] Failed to resend verification:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resend code'
      };
    }
  }
  
  private generateDemoSubdomain(companyName: string): string {
    const base = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 10);
    
    const suffix = Math.random().toString(36).substring(2, 6);
    return `${base}-demo-${suffix}`;
  }
  
  private async createDemoUser(tenantId: string, demoData: DemoTenantData) {
    const { hashPassword } = await import('./auth');
    
    // Generate temporary password for demo user
    const tempPassword = this.generateTempPassword();
    const hashedPassword = await hashPassword(tempPassword);
    
    return await storage.createUser({
      email: demoData.contactEmail,
      password: hashedPassword,
      firstName: demoData.firstName || 'Demo',
      lastName: demoData.lastName || 'User',
      role: 'customer_admin',
      tenantId,
      isActive: true
    });
  }
  
  private async createDemoBot(tenantId: string, companyName: string) {
    return await storage.createBot({
      tenantId,
      name: `${companyName} Demo Bot`,
      systemPrompt: `You are a helpful voice assistant for ${companyName}. You are in demo mode, so provide friendly and informative responses while explaining that this is a demonstration of VoiceAgent capabilities.`,
      status: 'pending',
      locale: 'de-AT',
      greetingMessage: 'Hello! This is a demo of VoiceAgent capabilities. How can I help you today?'
    });
  }
  
  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
  
  private generateTempPassword(): string {
    return crypto.randomBytes(8).toString('hex');
  }
  
  private async storeVerificationCode(tenantId: string, code: string, phone: string): Promise<void> {
    // SECURITY: Store verification code in database for persistence
    await storage.createVerificationCode({
      tenantId,
      code,
      phoneNumber: phone,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      isUsed: false,
      attempts: 0
    });
  }
  
  private async sendVerificationSMS(phoneNumber: string, code: string, companyName: string): Promise<void> {
    try {
      // Check if Twilio is configured
      const accountSid = await keyLoader.getApiKey('twilio', 'TWILIO_ACCOUNT_SID');
      const authToken = await keyLoader.getApiKey('twilio', 'TWILIO_AUTH_TOKEN');
      
      if (!accountSid || !authToken) {
        console.log('[DemoSetup] Twilio not configured - skipping SMS verification');
        return;
      }
      
      // Import Twilio client
      const { default: Twilio } = await import('twilio');
      const client = Twilio(accountSid, authToken);
      
      const message = `Your ${companyName} VoiceAgent demo verification code is: ${code}. This code expires in 10 minutes.`;
      
      await client.messages.create({
        body: message,
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER || '+1234567890' // Demo fallback
      });
      
      console.log(`[DemoSetup] Verification SMS sent to ${phoneNumber}`);
      
    } catch (error) {
      console.error('[DemoSetup] Failed to send verification SMS:', error);
      // Don't throw - SMS failure shouldn't block demo setup
    }
  }
  
  /**
   * Provision or allocate a demo phone number for the tenant
   * Uses predefined pool of demo numbers or provisions new ones from Twilio
   */
  private async provisionDemoNumber(tenantId: string): Promise<string> {
    try {
      // For demo purposes, use a pool of predefined demo numbers
      // In production, this would provision from Twilio or use a rotating pool
      const demoNumberPool = [
        '+1555DEMO001', // Demo number 1
        '+1555DEMO002', // Demo number 2
        '+1555DEMO003', // Demo number 3
        '+1555DEMO004', // Demo number 4
        '+1555DEMO005'  // Demo number 5
      ];
      
      // Simple round-robin allocation based on tenant ID hash
      const tenantHash = tenantId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const selectedNumber = demoNumberPool[tenantHash % demoNumberPool.length];
      
      console.log(`[DemoSetup] Allocated demo number ${selectedNumber} for tenant ${tenantId}`);
      
      // In production, you would:
      // 1. Check Twilio for available numbers
      // 2. Purchase/provision a number if needed
      // 3. Configure webhook URLs
      // 4. Store number assignment in database
      
      return selectedNumber;
      
    } catch (error) {
      console.error('[DemoSetup] Failed to provision demo number:', error);
      // Fallback to a default demo number
      return '+1555DEMO000';
    }
  }

  private async createPhoneMapping(tenantId: string, demoNumber: string) {
    try {
      // Get the demo bot for this tenant
      const bots = await storage.getBots(tenantId);
      const demoBot = bots[0]; // Use first bot as demo bot
      
      if (!demoBot) {
        throw new Error('No demo bot found for phone mapping');
      }
      
      // SECURITY: Map demo number (not user's phone) to bot for proper call routing
      await storage.createPhoneNumberMapping({
        phoneNumber: demoNumber,
        tenantId,
        botId: demoBot.id,
        isActive: true
      });
      
      console.log(`[DemoSetup] Phone mapping created: ${demoNumber} -> ${demoBot.id} (tenant: ${tenantId})`);
      
    } catch (error) {
      console.error('[DemoSetup] Failed to create phone mapping:', error);
      throw error;
    }
  }
}

export const demoTenantService = new DemoTenantService();