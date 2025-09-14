import { storage } from "./storage";
import { keyLoader } from "./key-loader";
import Stripe from "stripe";

/**
 * Comprehensive Customer Onboarding Service
 * 
 * Automatically provisions everything a new customer needs:
 * - Stripe customer creation
 * - Billing account setup
 * - Default VoiceBot creation
 * - Provisioning jobs for infrastructure setup
 * - Default configurations
 */

interface OnboardingResult {
  success: boolean;
  stripeCustomerId?: string;
  botId?: string;
  provisioningJobId?: string;
  error?: string;
}

interface CustomerData {
  tenantId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  organizationName: string;
}

class CustomerOnboardingService {

  /**
   * Complete automated onboarding workflow for new customers
   */
  async onboardNewCustomer(customerData: CustomerData): Promise<OnboardingResult> {
    const { tenantId, email, firstName, lastName, organizationName } = customerData;
    
    try {
      console.log(`[Onboarding] Starting onboarding for tenant ${tenantId}: ${email}`);
      
      // Step 1: Create Stripe customer
      const stripeCustomerId = await this.createStripeCustomer({
        email,
        firstName,
        lastName,
        organizationName
      });
      
      if (!stripeCustomerId) {
        return {
          success: false,
          error: "Failed to create Stripe customer"
        };
      }
      
      // Step 2: Update tenant with Stripe customer ID
      await storage.updateTenant(tenantId, {
        stripeCustomerId,
        updatedAt: new Date()
      });
      
      // Step 3: Create billing account
      await this.createBillingAccount(tenantId, stripeCustomerId);
      
      // Step 4: Create default VoiceBot
      const botId = await this.createDefaultVoiceBot(tenantId, organizationName);
      
      if (!botId) {
        return {
          success: false,
          error: "Failed to create default VoiceBot"
        };
      }
      
      // Step 5: Create provisioning jobs for infrastructure setup
      const provisioningJobId = await this.createInfrastructureProvisioningJob(tenantId, botId);
      
      console.log(`[Onboarding] Successfully onboarded tenant ${tenantId}: 
        - Stripe Customer: ${stripeCustomerId}
        - VoiceBot: ${botId}
        - Provisioning Job: ${provisioningJobId}`);
      
      return {
        success: true,
        stripeCustomerId,
        botId,
        provisioningJobId: provisioningJobId || undefined
      };
      
    } catch (error) {
      console.error(`[Onboarding] Failed to onboard tenant ${tenantId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown onboarding error"
      };
    }
  }
  
  /**
   * Create Stripe customer with proper metadata
   */
  private async createStripeCustomer(data: {
    email: string;
    firstName?: string;
    lastName?: string;
    organizationName: string;
  }): Promise<string | null> {
    try {
      const stripeSecretKey = await keyLoader.getApiKey('stripe');
      if (!stripeSecretKey) {
        console.warn('[Onboarding] Stripe not configured - skipping customer creation');
        return null;
      }
      
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: "2025-08-27.basil"
      });
      
      const customerName = data.firstName && data.lastName 
        ? `${data.firstName} ${data.lastName}`
        : data.organizationName;
      
      const customer = await stripe.customers.create({
        email: data.email,
        name: customerName,
        description: `VoiceAgent customer for ${data.organizationName}`,
        metadata: {
          organization_name: data.organizationName,
          created_via: 'automated_onboarding',
          first_name: data.firstName || '',
          last_name: data.lastName || ''
        }
      });
      
      console.log(`[Onboarding] Created Stripe customer ${customer.id} for ${data.email}`);
      return customer.id;
      
    } catch (error) {
      console.error('[Onboarding] Failed to create Stripe customer:', error);
      return null;
    }
  }
  
  
  /**
   * Create billing account record
   */
  private async createBillingAccount(tenantId: string, stripeCustomerId: string): Promise<void> {
    try {
      await storage.createBillingAccount({
        tenantId,
        stripeCustomerId
      });
      console.log(`[Onboarding] Created billing account for tenant ${tenantId}`);
    } catch (error) {
      console.warn(`[Onboarding] Failed to create billing account for tenant ${tenantId}:`, error);
      // Non-fatal - billing account can be created later
    }
  }
  
  /**
   * Create default VoiceBot with sensible defaults
   */
  private async createDefaultVoiceBot(tenantId: string, organizationName: string): Promise<string | null> {
    try {
      const defaultConfig = {
        voice: 'alloy',
        language: 'en-US',
        responseTimeout: 30000,
        maxCallDuration: 300000, // 5 minutes
        greeting: `Hello! Welcome to ${organizationName}. How can I help you today?`,
        fallbackMessage: "I didn't quite catch that. Could you please repeat?",
        endCallMessage: "Thank you for calling. Have a great day!",
        enableRecording: true,
        enableTranscription: true
      };
      
      const bot = await storage.createBot({
        tenantId,
        name: `${organizationName} Main VoiceBot`,
        status: 'pending',
        locale: 'en-US',
        sttProvider: 'google',
        ttsProvider: 'elevenlabs',
        greetingMessage: defaultConfig.greeting,
        configJson: defaultConfig
      });
      
      console.log(`[Onboarding] Created default VoiceBot ${bot.id} for tenant ${tenantId}`);
      return bot.id;
      
    } catch (error) {
      console.error(`[Onboarding] Failed to create default VoiceBot for tenant ${tenantId}:`, error);
      return null;
    }
  }
  
  /**
   * Create provisioning jobs for infrastructure setup
   */
  private async createInfrastructureProvisioningJob(tenantId: string, botId: string): Promise<string | null> {
    try {
      const provisioningPayload = {
        steps: [
          {
            type: 'heroku_app_creation',
            config: {
              appName: `voicebot-${tenantId.slice(0, 8)}`,
              region: 'us',
              stack: 'heroku-22'
            }
          },
          {
            type: 'twilio_number_purchase',
            config: {
              countryCode: 'US',
              capabilities: ['voice', 'sms'],
              voiceUrl: null // Will be set after Heroku app is deployed
            }
          },
          {
            type: 'environment_variables',
            config: {
              variables: {
                NODE_ENV: 'production',
                BOT_ID: botId,
                TENANT_ID: tenantId
              }
            }
          },
          {
            type: 'webhook_configuration',
            config: {
              twilioWebhookUrl: null, // Will be configured after deployment
              stripeWebhookUrl: null
            }
          }
        ],
        priority: 'high',
        estimatedDuration: 300 // 5 minutes
      };
      
      const job = await storage.createProvisioningJob({
        tenantId,
        botId,
        status: 'queued',
        payloadJson: provisioningPayload
      });
      
      console.log(`[Onboarding] Created provisioning job ${job.id} for bot ${botId}`);
      return job.id;
      
    } catch (error) {
      console.error(`[Onboarding] Failed to create provisioning job for bot ${botId}:`, error);
      return null;
    }
  }
  
  /**
   * Get onboarding status for a tenant
   */
  async getOnboardingStatus(tenantId: string): Promise<{
    completed: boolean;
    hasStripeCustomer: boolean;
    hasBillingAccount: boolean;
    hasVoiceBot: boolean;
    hasProvisioningJob: boolean;
    provisioningStatus?: string;
  }> {
    try {
      // Check tenant has Stripe customer
      const tenant = await storage.getTenant(tenantId);
      const hasStripeCustomer = !!tenant?.stripeCustomerId;
      
      // Check billing account exists
      const billingAccount = await storage.getBillingAccount(tenantId);
      const hasBillingAccount = !!billingAccount;
      
      // Check VoiceBot exists
      const bots = await storage.getBots(tenantId);
      const hasVoiceBot = bots.length > 0;
      
      // Check provisioning job exists
      const provisioningJobs = await storage.getProvisioningJobs(tenantId);
      const hasProvisioningJob = provisioningJobs.length > 0;
      const provisioningStatus = hasProvisioningJob ? provisioningJobs[0].status : undefined;
      
      const completed = hasStripeCustomer && hasBillingAccount && hasVoiceBot && hasProvisioningJob;
      
      return {
        completed,
        hasStripeCustomer,
        hasBillingAccount,
        hasVoiceBot,
        hasProvisioningJob,
        provisioningStatus
      };
      
    } catch (error) {
      console.error(`[Onboarding] Failed to get onboarding status for tenant ${tenantId}:`, error);
      return {
        completed: false,
        hasStripeCustomer: false,
        hasBillingAccount: false,
        hasVoiceBot: false,
        hasProvisioningJob: false
      };
    }
  }
}

export const customerOnboardingService = new CustomerOnboardingService();