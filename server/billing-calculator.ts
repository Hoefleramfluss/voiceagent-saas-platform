import { storage } from "./storage";
import { UsageEvent } from "@shared/schema";

export interface PricingTier {
  kind: 'call' | 'minute' | 'stt_req' | 'tts_char' | 'gpt_tokens';
  ratePerUnitCents: number; // Rate in cents for precision
  name: string;
  description: string;
}

export interface BillingLineItem {
  kind: 'call' | 'minute' | 'stt_req' | 'tts_char' | 'gpt_tokens';
  quantity: number;
  ratePerUnitCents: number;
  totalAmountCents: number;
  name: string;
  description: string;
}

export interface BillingCalculation {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  lineItems: BillingLineItem[];
  subtotalCents: number;
  taxCents?: number;
  totalCents: number;
  currency: string;
}

/**
 * Standard pricing tiers for voice agent services
 * These rates are in cents for precise calculations
 */
export const DEFAULT_PRICING: PricingTier[] = [
  {
    kind: 'call',
    ratePerUnitCents: 2, // 2 cents (€0.02) per call initiated
    name: 'Call Initiation',
    description: 'Per incoming call answered'
  },
  {
    kind: 'minute',
    ratePerUnitCents: 5, // 5 cents (€0.05) per minute of talk time
    name: 'Call Duration',
    description: 'Per minute of conversation'
  },
  {
    kind: 'stt_req',
    ratePerUnitCents: 1, // 1 cent (€0.006) per speech-to-text request (rounded up)
    name: 'Speech Recognition',
    description: 'Per speech-to-text conversion'
  },
  {
    kind: 'tts_char',
    ratePerUnitCents: 1, // 1 cent per 500 characters (€0.00002 * 500)
    name: 'Speech Synthesis',
    description: 'Per 500 characters of text-to-speech'
  },
  {
    kind: 'gpt_tokens',
    ratePerUnitCents: 1, // 1 cent per 500 tokens (€0.000002 * 500)
    name: 'AI Processing',
    description: 'Per 500 AI tokens processed'
  }
];

export class BillingCalculator {
  private pricingTiers: Map<string, PricingTier>;

  constructor(customPricing?: PricingTier[]) {
    this.pricingTiers = new Map();
    const pricing = customPricing || DEFAULT_PRICING;
    
    pricing.forEach(tier => {
      this.pricingTiers.set(tier.kind, tier);
    });
  }

  /**
   * Calculate billing for a tenant for a specific period
   */
  async calculateBillingForPeriod(
    tenantId: string, 
    periodStart: Date, 
    periodEnd: Date
  ): Promise<BillingCalculation> {
    // Get all usage events for the period
    const usageEvents = await storage.getUsageEvents(tenantId, {
      periodStart,
      periodEnd,
      limit: 10000 // Get all events for the period
    });

    // Group and sum usage by kind
    const usageSummary = this.summarizeUsage(usageEvents);
    
    // Calculate line items
    const lineItems = this.calculateLineItems(usageSummary);
    
    // Calculate totals in cents
    const subtotalCents = lineItems.reduce((sum, item) => sum + item.totalAmountCents, 0);
    const taxCents = 0; // Tax calculation can be added later
    const totalCents = subtotalCents + taxCents;

    return {
      tenantId,
      periodStart,
      periodEnd,
      lineItems,
      subtotalCents,
      taxCents,
      totalCents,
      currency: 'EUR'
    };
  }

  /**
   * Calculate costs for a specific usage summary in cents
   */
  calculateCostsFromSummary(usageSummary: { [key: string]: number }): { [key: string]: number } {
    const costs: { [key: string]: number } = {};
    
    Object.entries(usageSummary).forEach(([kind, quantity]) => {
      const pricing = this.pricingTiers.get(kind);
      if (pricing) {
        costs[kind] = quantity * pricing.ratePerUnitCents;
      }
    });

    return costs;
  }

  /**
   * Get current usage and costs for display (returns costs in cents)
   */
  async getCurrentUsageAndCosts(tenantId: string): Promise<{
    usage: { [key: string]: number };
    costs: { [key: string]: number };
    totalCostCents: number;
  }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const usageEvents = await storage.getUsageEvents(tenantId, {
      periodStart: monthStart,
      periodEnd: now
    });

    const usage = this.summarizeUsage(usageEvents);
    const costs = this.calculateCostsFromSummary(usage);
    const totalCostCents = Object.values(costs).reduce((sum, cost) => sum + cost, 0);

    return { usage, costs, totalCostCents };
  }

  /**
   * Get pricing information
   */
  getPricing(): PricingTier[] {
    return Array.from(this.pricingTiers.values());
  }

  /**
   * Update pricing for a specific usage type (rate in cents)
   */
  updatePricing(kind: string, newRateCents: number): void {
    const existing = this.pricingTiers.get(kind);
    if (existing) {
      existing.ratePerUnitCents = newRateCents;
    }
  }

  /**
   * Summarize usage events by kind (quantities are now integers)
   */
  private summarizeUsage(events: UsageEvent[]): { [key: string]: number } {
    const summary: { [key: string]: number } = {};
    
    events.forEach(event => {
      const kind = event.kind;
      const quantity = event.quantity; // Now already an integer from schema
      
      if (summary[kind]) {
        summary[kind] += quantity;
      } else {
        summary[kind] = quantity;
      }
    });

    return summary;
  }

  /**
   * Calculate line items from usage summary (using cents for precision)
   */
  private calculateLineItems(usageSummary: { [key: string]: number }): BillingLineItem[] {
    const lineItems: BillingLineItem[] = [];
    
    Object.entries(usageSummary).forEach(([kind, quantity]) => {
      const pricing = this.pricingTiers.get(kind);
      if (pricing && quantity > 0) {
        lineItems.push({
          kind: kind as any,
          quantity,
          ratePerUnitCents: pricing.ratePerUnitCents,
          totalAmountCents: quantity * pricing.ratePerUnitCents,
          name: pricing.name,
          description: pricing.description
        });
      }
    });

    // Sort by total amount descending
    return lineItems.sort((a, b) => b.totalAmountCents - a.totalAmountCents);
  }
}

// Export singleton instance
export const billingCalculator = new BillingCalculator();