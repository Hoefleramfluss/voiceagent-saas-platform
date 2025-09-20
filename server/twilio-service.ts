import { storage } from "./storage";
import { keyLoader } from "./key-loader";

/**
 * Twilio Phone Number Management Service
 * Handles purchasing new numbers and managing existing ones
 */

interface TwilioPhoneNumber {
  phoneNumber: string;
  friendlyName: string;
  capabilities: string[];
  region: string;
  sid: string;
}

interface PurchaseNumberOptions {
  countryCode: string;
  areaCode?: string;
  capabilities: ('voice' | 'sms')[];
  friendlyName?: string;
}

class TwilioService {
  private twilioClient: any = null;
  
  private async getTwilioClient() {
    if (this.twilioClient) {
      return this.twilioClient;
    }
    
    try {
      const accountSid = await keyLoader.getApiKey('twilio', 'TWILIO_ACCOUNT_SID');
      const authToken = await keyLoader.getApiKey('twilio', 'TWILIO_AUTH_TOKEN');
      
      if (!accountSid || !authToken) {
        throw new Error('Twilio credentials not configured');
      }
      
      // Dynamic import to avoid loading if not configured
      const { default: Twilio } = await import('twilio');
      this.twilioClient = Twilio(accountSid, authToken);
      
      return this.twilioClient;
    } catch (error) {
      console.error('[Twilio] Failed to initialize client:', error);
      throw error;
    }
  }
  
  /**
   * List available phone numbers for purchase
   */
  async searchAvailableNumbers(options: {
    countryCode: string;
    areaCode?: string;
    voiceEnabled?: boolean;
    smsEnabled?: boolean;
    limit?: number;
  }): Promise<TwilioPhoneNumber[]> {
    try {
      const client = await this.getTwilioClient();
      
      const searchOptions: any = {
        limit: options.limit || 10
      };
      
      if (options.areaCode) {
        searchOptions.areaCode = options.areaCode;
      }
      
      if (options.voiceEnabled !== undefined) {
        searchOptions.voiceEnabled = options.voiceEnabled;
      }
      
      if (options.smsEnabled !== undefined) {
        searchOptions.smsEnabled = options.smsEnabled;
      }
      
      const numbers = await client.availablePhoneNumbers(options.countryCode)
        .local
        .list(searchOptions);
      
      return numbers.map((number: any) => ({
        phoneNumber: number.phoneNumber,
        friendlyName: number.friendlyName,
        capabilities: [
          ...(number.capabilities.voice ? ['voice'] : []),
          ...(number.capabilities.sms ? ['sms'] : [])
        ],
        region: number.region,
        sid: number.sid
      }));
      
    } catch (error) {
      console.error('[Twilio] Failed to search available numbers:', error);
      throw error;
    }
  }
  
  /**
   * Purchase a new phone number
   */
  async purchasePhoneNumber(options: PurchaseNumberOptions & {
    phoneNumber: string;
    tenantId: string;
    botId: string;
  }): Promise<{
    success: boolean;
    phoneNumber?: string;
    sid?: string;
    error?: string;
  }> {
    try {
      const client = await this.getTwilioClient();
      
      const purchaseOptions: any = {
        phoneNumber: options.phoneNumber
      };
      
      // Set webhook URLs if bot is configured
      const webhookBaseUrl = process.env.REPLIT_DOMAINS 
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
        : 'https://your-domain.replit.app';
      
      if (options.capabilities.includes('voice')) {
        purchaseOptions.voiceUrl = `${webhookBaseUrl}/api/twilio/voice/${options.botId}`;
        purchaseOptions.voiceMethod = 'POST';
        purchaseOptions.statusCallback = `${webhookBaseUrl}/api/twilio/status/${options.botId}`;
        purchaseOptions.statusCallbackMethod = 'POST';
      }
      
      if (options.capabilities.includes('sms')) {
        purchaseOptions.smsUrl = `${webhookBaseUrl}/api/twilio/sms/${options.botId}`;
        purchaseOptions.smsMethod = 'POST';
      }
      
      if (options.friendlyName) {
        purchaseOptions.friendlyName = options.friendlyName;
      }
      
      const purchasedNumber = await client.incomingPhoneNumbers.create(purchaseOptions);
      
      // Update bot with new phone number
      await storage.updateBot(options.botId, {
        twilioNumber: purchasedNumber.phoneNumber,
        status: 'provisioning'
      });
      
      console.log(`[Twilio] Successfully purchased number ${purchasedNumber.phoneNumber} for bot ${options.botId}`);
      
      return {
        success: true,
        phoneNumber: purchasedNumber.phoneNumber,
        sid: purchasedNumber.sid
      };
      
    } catch (error) {
      console.error('[Twilio] Failed to purchase phone number:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * List existing phone numbers for the account
   */
  async listExistingNumbers(): Promise<TwilioPhoneNumber[]> {
    try {
      const client = await this.getTwilioClient();
      
      const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });
      
      return numbers.map((number: any) => ({
        phoneNumber: number.phoneNumber,
        friendlyName: number.friendlyName,
        capabilities: [
          ...(number.capabilities.voice ? ['voice'] : []),
          ...(number.capabilities.sms ? ['sms'] : [])
        ],
        region: number.region || 'US',
        sid: number.sid
      }));
      
    } catch (error) {
      console.error('[Twilio] Failed to list existing numbers:', error);
      throw error;
    }
  }
  
  /**
   * Assign existing phone number to a bot
   */
  async assignExistingNumber(options: {
    numberSid: string;
    phoneNumber: string;
    tenantId: string;
    botId: string;
  }): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const client = await this.getTwilioClient();
      
      const webhookBaseUrl = process.env.REPLIT_DOMAINS 
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
        : 'https://your-domain.replit.app';
      
      // Update the number's webhook configuration
      await client.incomingPhoneNumbers(options.numberSid).update({
        voiceUrl: `${webhookBaseUrl}/api/twilio/voice/${options.botId}`,
        voiceMethod: 'POST',
        smsUrl: `${webhookBaseUrl}/api/twilio/sms/${options.botId}`,
        smsMethod: 'POST',
        statusCallback: `${webhookBaseUrl}/api/twilio/status/${options.botId}`,
        statusCallbackMethod: 'POST',
        friendlyName: `VoiceBot ${options.botId}`
      });
      
      // Update bot with assigned phone number
      await storage.updateBot(options.botId, {
        twilioNumber: options.phoneNumber,
        status: 'ready'
      });

      const existingMapping = await storage.getPhoneNumberMappingByPhone(options.phoneNumber);
      if (existingMapping) {
        await storage.updatePhoneNumberMapping(existingMapping.id, options.tenantId, {
          botId: options.botId,
          numberSid: options.numberSid,
          isActive: true,
        });
      } else {
        await storage.createPhoneNumberMapping({
          tenantId: options.tenantId,
          botId: options.botId,
          phoneNumber: options.phoneNumber,
          numberSid: options.numberSid,
          webhookUrl: `${webhookBaseUrl}/api/twilio/voice/${options.botId}`,
        });
      }

      console.log(`[Twilio] Successfully assigned number ${options.phoneNumber} to bot ${options.botId}`);

      return { success: true };
      
    } catch (error) {
      console.error('[Twilio] Failed to assign existing number:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Check if Twilio is configured
   */
  async isConfigured(): Promise<boolean> {
    try {
      const accountSid = await keyLoader.getApiKey('twilio', 'TWILIO_ACCOUNT_SID');
      const authToken = await keyLoader.getApiKey('twilio', 'TWILIO_AUTH_TOKEN');
      
      return !!(accountSid && authToken);
    } catch {
      return false;
    }
  }
}

export const twilioService = new TwilioService();
// Summe der weitergeleiteten Minuten für eine Nummer im Zeitraum
export async function fetchForwardingMinutes(options: { numberSid: string; periodStart: Date; periodEnd: Date }): Promise<{ totalSeconds: number; calls: any[] }> {
  // @ts-ignore
  const client = await this.getTwilioClient ? this.getTwilioClient() : (await (await import('twilio')).default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN));
  const calls = await client.calls.list({ startTimeAfter: options.periodStart, endTimeBefore: options.periodEnd, status: 'completed', limit: 500 });
  const related = calls.filter((c: any) => c.phoneNumberSid === options.numberSid);
  const totalSeconds = related.reduce((s: number, c: any) => s + (c.duration ? parseInt(c.duration) : 0), 0);
  return { totalSeconds, calls: related };
}

// Monatsimport (idempotent) für alle zugeordneten Nummern eines Tenants
export async function importForwardingForTenantPeriod(tenantId: string, periodStart: Date, periodEnd: Date): Promise<{ minutes: number }> {
  const mappings = await storage.getPhoneNumberMappings(tenantId);
  let totalSec = 0;
  for (const m of mappings) {
    const numberSid = (m as any).numberSid as string | undefined;
    if (!numberSid) continue;
    const res = await fetchForwardingMinutes({ numberSid, periodStart, periodEnd });
    totalSec += res.totalSeconds;
  }
  const periodKey = periodStart.toISOString().slice(0,7);
  const events = await storage.getUsageEvents(tenantId, { periodStart, periodEnd });
  for (const ev of events) {
    const metadata = (ev.metadata ?? {}) as Record<string, any>;
    if (ev.kind === 'forwarding_minute' && metadata.source === 'twilio_import' && metadata.period === periodKey) {
      await storage.deleteUsageEvent(ev.id);
    }
  }
  const minutes = Math.round(totalSec/60);
  const bots = await storage.getBots(tenantId);
  const botId = bots[0]?.id;
  if (minutes > 0 && botId) {
    await storage.createUsageEvent({
      tenantId,
      botId,
      kind: 'forwarding_minute' as any,
      quantity: minutes.toString() as any,
      metadata: { source: 'twilio_import', period: periodKey },
    });
  }
  return { minutes };
}
