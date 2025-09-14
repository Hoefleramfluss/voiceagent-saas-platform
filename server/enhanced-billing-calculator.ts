import { storage } from "./storage";
import type { UsageEvent, SubscriptionPlan } from "@shared/schema";

export interface EnhancedBillingLineItem {
  kind: 'base_fee' | 'voice_bot_overage' | 'forwarding_overage' | 'call' | 'stt_req' | 'tts_char' | 'gpt_tokens';
  quantity: number;
  ratePerUnitCents: number;
  totalAmountCents: number;
  name: string;
  description: string;
  freeAllowance?: number; // For minute-based items, track free allowance
  usedFromFree?: number; // How many units were covered by free allowance
}

export interface EnhancedBillingCalculation {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  subscriptionPlan: SubscriptionPlan | null;
  lineItems: EnhancedBillingLineItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  minuteBreakdown: {
    voiceBotMinutes: {
      used: number;
      free: number;
      overage: number;
      overageRate: number;
    };
    forwardingMinutes: {
      used: number;
      free: number;
      overage: number;
      overageRate: number;
    };
  };
}

export interface UsageSummary {
  voice_bot_minute: number;
  forwarding_minute: number;
  call: number;
  stt_req: number;
  tts_char: number;
  gpt_tokens: number;
}

// Default rates for non-subscription billing (fallback)
export const DEFAULT_MINUTE_RATES = {
  voice_bot_rate_per_minute_cents: 5, // €0.05 per minute
  forwarding_rate_per_minute_cents: 3, // €0.03 per minute
  call_rate_cents: 2, // €0.02 per call
  stt_rate_cents: 1, // €0.01 per request
  tts_rate_cents: 1, // €0.01 per 500 chars
  gpt_rate_cents: 1, // €0.01 per 500 tokens
};

export class EnhancedBillingCalculator {
  
  /**
   * Calculate comprehensive billing for a tenant including subscription and usage-based charges
   */
  async calculateEnhancedBillingForPeriod(
    tenantId: string, 
    periodStart: Date, 
    periodEnd: Date
  ): Promise<EnhancedBillingCalculation> {
    
    // Get tenant's current subscription plan
    const subscription = await storage.getTenantSubscription(tenantId);
    const plan = subscription.plan;
    
    // Get all usage events for the period
    const usageEvents = await storage.getUsageEvents(tenantId, {
      periodStart,
      periodEnd,
      limit: 10000 // Get all events for the period
    });

    // Summarize usage by kind
    const usageSummary = this.summarizeUsage(usageEvents);
    
    // Calculate line items with subscription plan logic
    const lineItems = this.calculateEnhancedLineItems(usageSummary, plan);
    
    // Calculate minute breakdown for display
    const minuteBreakdown = this.calculateMinuteBreakdown(usageSummary, plan);
    
    // Calculate totals in cents
    const subtotalCents = lineItems.reduce((sum, item) => sum + item.totalAmountCents, 0);
    const taxCents = 0; // Tax calculation can be added later
    const totalCents = subtotalCents + taxCents;

    return {
      tenantId,
      periodStart,
      periodEnd,
      subscriptionPlan: plan,
      lineItems,
      subtotalCents,
      taxCents,
      totalCents,
      currency: 'EUR',
      minuteBreakdown
    };
  }

  /**
   * Summarize usage events by kind, handling decimal quantities
   */
  private summarizeUsage(events: UsageEvent[]): UsageSummary {
    const summary: UsageSummary = {
      voice_bot_minute: 0,
      forwarding_minute: 0,
      call: 0,
      stt_req: 0,
      tts_char: 0,
      gpt_tokens: 0
    };
    
    events.forEach(event => {
      const kind = event.kind;
      const quantity = parseFloat(event.quantity.toString()); // Handle decimal quantities
      
      if (kind in summary) {
        (summary as any)[kind] += quantity;
      }
    });

    return summary;
  }

  /**
   * Calculate line items with subscription plan logic including free minute deductions
   */
  private calculateEnhancedLineItems(
    usageSummary: UsageSummary, 
    plan: SubscriptionPlan | null
  ): EnhancedBillingLineItem[] {
    const lineItems: EnhancedBillingLineItem[] = [];
    
    if (plan) {
      // Add base subscription fee
      const monthlyFee = parseFloat(plan.monthlyPriceEur.toString()) * 100; // Convert to cents
      lineItems.push({
        kind: 'base_fee',
        quantity: 1,
        ratePerUnitCents: monthlyFee,
        totalAmountCents: monthlyFee,
        name: `${plan.name} - Monatsgebühr`,
        description: `Monatliche Grundgebühr für ${plan.name} Plan`
      });

      // Handle voice bot minutes with free allowance
      const voiceBotMinutesUsed = usageSummary.voice_bot_minute;
      const freeVoiceBotMinutes = plan.freeVoiceBotMinutes || 0;
      const voiceBotOverage = Math.max(0, voiceBotMinutesUsed - freeVoiceBotMinutes);
      
      if (voiceBotOverage > 0) {
        const rate = plan.voiceBotRatePerMinuteCents || DEFAULT_MINUTE_RATES.voice_bot_rate_per_minute_cents;
        lineItems.push({
          kind: 'voice_bot_overage',
          quantity: voiceBotOverage,
          ratePerUnitCents: rate,
          totalAmountCents: Math.round(voiceBotOverage * rate),
          name: 'VoiceBot Minuten (Zusatz)',
          description: `Zusätzliche VoiceBot Minuten über ${freeVoiceBotMinutes} inkl. Minuten`,
          freeAllowance: freeVoiceBotMinutes,
          usedFromFree: Math.min(voiceBotMinutesUsed, freeVoiceBotMinutes)
        });
      }

      // Handle forwarding minutes with free allowance
      const forwardingMinutesUsed = usageSummary.forwarding_minute;
      const freeForwardingMinutes = plan.freeForwardingMinutes || 0;
      const forwardingOverage = Math.max(0, forwardingMinutesUsed - freeForwardingMinutes);
      
      if (forwardingOverage > 0) {
        const rate = plan.forwardingRatePerMinuteCents || DEFAULT_MINUTE_RATES.forwarding_rate_per_minute_cents;
        lineItems.push({
          kind: 'forwarding_overage',
          quantity: forwardingOverage,
          ratePerUnitCents: rate,
          totalAmountCents: Math.round(forwardingOverage * rate),
          name: 'Weiterleitung Minuten (Zusatz)',
          description: `Zusätzliche Weiterleitungsminuten über ${freeForwardingMinutes} inkl. Minuten`,
          freeAllowance: freeForwardingMinutes,
          usedFromFree: Math.min(forwardingMinutesUsed, freeForwardingMinutes)
        });
      }
    } else {
      // No subscription plan - charge for all usage at default rates
      if (usageSummary.voice_bot_minute > 0) {
        const rate = DEFAULT_MINUTE_RATES.voice_bot_rate_per_minute_cents;
        lineItems.push({
          kind: 'voice_bot_overage',
          quantity: usageSummary.voice_bot_minute,
          ratePerUnitCents: rate,
          totalAmountCents: Math.round(usageSummary.voice_bot_minute * rate),
          name: 'VoiceBot Minuten',
          description: 'VoiceBot Nutzung (Pay-per-Use)'
        });
      }

      if (usageSummary.forwarding_minute > 0) {
        const rate = DEFAULT_MINUTE_RATES.forwarding_rate_per_minute_cents;
        lineItems.push({
          kind: 'forwarding_overage',
          quantity: usageSummary.forwarding_minute,
          ratePerUnitCents: rate,
          totalAmountCents: Math.round(usageSummary.forwarding_minute * rate),
          name: 'Weiterleitung Minuten',
          description: 'Weiterleitungsminuten (Pay-per-Use)'
        });
      }
    }

    // Add other usage charges (calls, STT, TTS, GPT) - these are not covered by subscriptions
    if (usageSummary.call > 0) {
      lineItems.push({
        kind: 'call',
        quantity: usageSummary.call,
        ratePerUnitCents: DEFAULT_MINUTE_RATES.call_rate_cents,
        totalAmountCents: Math.round(usageSummary.call * DEFAULT_MINUTE_RATES.call_rate_cents),
        name: 'Anrufinitiierung',
        description: 'Pro eingehender Anruf'
      });
    }

    if (usageSummary.stt_req > 0) {
      lineItems.push({
        kind: 'stt_req',
        quantity: usageSummary.stt_req,
        ratePerUnitCents: DEFAULT_MINUTE_RATES.stt_rate_cents,
        totalAmountCents: Math.round(usageSummary.stt_req * DEFAULT_MINUTE_RATES.stt_rate_cents),
        name: 'Spracherkennung',
        description: 'Pro Speech-to-Text Anfrage'
      });
    }

    if (usageSummary.tts_char > 0) {
      lineItems.push({
        kind: 'tts_char',
        quantity: usageSummary.tts_char,
        ratePerUnitCents: DEFAULT_MINUTE_RATES.tts_rate_cents,
        totalAmountCents: Math.round(usageSummary.tts_char * DEFAULT_MINUTE_RATES.tts_rate_cents),
        name: 'Sprachsynthese',
        description: 'Pro 500 Zeichen Text-to-Speech'
      });
    }

    if (usageSummary.gpt_tokens > 0) {
      lineItems.push({
        kind: 'gpt_tokens',
        quantity: usageSummary.gpt_tokens,
        ratePerUnitCents: DEFAULT_MINUTE_RATES.gpt_rate_cents,
        totalAmountCents: Math.round(usageSummary.gpt_tokens * DEFAULT_MINUTE_RATES.gpt_rate_cents),
        name: 'KI-Verarbeitung',
        description: 'Pro 500 KI-Tokens verarbeitet'
      });
    }

    // Sort by total amount descending
    return lineItems.sort((a, b) => b.totalAmountCents - a.totalAmountCents);
  }

  /**
   * Calculate minute usage breakdown for display purposes
   */
  private calculateMinuteBreakdown(
    usageSummary: UsageSummary, 
    plan: SubscriptionPlan | null
  ): EnhancedBillingCalculation['minuteBreakdown'] {
    const freeVoiceBotMinutes = plan?.freeVoiceBotMinutes || 0;
    const freeForwardingMinutes = plan?.freeForwardingMinutes || 0;
    const voiceBotRate = plan?.voiceBotRatePerMinuteCents || DEFAULT_MINUTE_RATES.voice_bot_rate_per_minute_cents;
    const forwardingRate = plan?.forwardingRatePerMinuteCents || DEFAULT_MINUTE_RATES.forwarding_rate_per_minute_cents;

    return {
      voiceBotMinutes: {
        used: usageSummary.voice_bot_minute,
        free: freeVoiceBotMinutes,
        overage: Math.max(0, usageSummary.voice_bot_minute - freeVoiceBotMinutes),
        overageRate: voiceBotRate
      },
      forwardingMinutes: {
        used: usageSummary.forwarding_minute,
        free: freeForwardingMinutes,
        overage: Math.max(0, usageSummary.forwarding_minute - freeForwardingMinutes),
        overageRate: forwardingRate
      }
    };
  }

  /**
   * Get current usage and costs for display (enhanced version)
   */
  async getEnhancedCurrentUsageAndCosts(tenantId: string): Promise<{
    usage: UsageSummary;
    billing: EnhancedBillingCalculation;
    totalCostCents: number;
  }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const billing = await this.calculateEnhancedBillingForPeriod(tenantId, monthStart, now);
    
    const usageEvents = await storage.getUsageEvents(tenantId, {
      periodStart: monthStart,
      periodEnd: now
    });

    const usage = this.summarizeUsage(usageEvents);
    const totalCostCents = billing.totalCents;

    return { usage, billing, totalCostCents };
  }
}

// Export singleton instance
export const enhancedBillingCalculator = new EnhancedBillingCalculator();