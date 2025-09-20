import Stripe from "stripe";
import { storage } from "./storage";
import { enhancedBillingCalculator, EnhancedBillingCalculation } from "./enhanced-billing-calculator";
import { getStripeKey } from "./key-loader";
import crypto from "crypto";

export interface InvoiceGenerationResult {
  success: boolean;
  invoiceId?: string;
  stripeInvoiceId?: string;
  totalAmount?: number;
  error?: string;
}

export interface InvoiceItemCreation {
  customerId: string;
  amount: number; // in cents
  currency: string;
  description: string;
  metadata?: Record<string, string>;
}

export class StripeInvoiceService {
  private stripe: Stripe | null = null;

  /**
   * Generate idempotency key for Stripe operations
   * Ensures operations are not duplicated if retried
   */
  private generateIdempotencyKey(operation: string, ...params: string[]): string {
    const combined = `${operation}:${params.join(':')}`;
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
  }

  /**
   * Initialize Stripe instance
   */
  private async getStripe(): Promise<Stripe | null> {
    if (this.stripe) {
      return this.stripe;
    }

    try {
      const stripeKey = await getStripeKey();
      if (stripeKey) {
        this.stripe = new Stripe(stripeKey, {
          // Using latest stable API version by omitting apiVersion parameter
        });
        return this.stripe;
      }
    } catch (error) {
      console.error('[Stripe Invoice Service] Failed to initialize:', error);
    }
    
    return null;
  }

  /**
   * Generate invoice for a tenant for a specific billing period
   */
  async generateMonthlyInvoice(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<InvoiceGenerationResult> {
    try {
      const stripe = await this.getStripe();
      if (!stripe) {
        return {
          success: false,
          error: "Stripe not configured"
        };
      }

      // Get billing account
      const billingAccount = await storage.getBillingAccount(tenantId);
      if (!billingAccount) {
        return {
          success: false,
          error: "No billing account found for tenant"
        };
      }

      // CRITICAL: Check for existing invoices to prevent duplication
      const existingInvoices = await storage.getInvoices(tenantId);
      const duplicateInvoice = existingInvoices.find(invoice => {
        // Check if invoice period overlaps (exact match for monthly billing)
        const invoicePeriodStart = new Date(invoice.periodStart);
        const invoicePeriodEnd = new Date(invoice.periodEnd);
        return invoicePeriodStart.getTime() === periodStart.getTime() && 
               invoicePeriodEnd.getTime() === periodEnd.getTime() &&
               (invoice.status === 'pending' || invoice.status === 'paid');
      });

      if (duplicateInvoice) {
        console.log(`[Invoice] Duplicate prevention: Invoice already exists for tenant ${tenantId} period ${periodStart} - ${periodEnd}`);
        return {
          success: false,
          error: `Invoice already exists for this billing period (${duplicateInvoice.id})`
        };
      }

      // Calculate enhanced billing for the period with subscription plan logic
      const billingCalculation = await enhancedBillingCalculator.calculateEnhancedBillingForPeriod(
        tenantId,
        periodStart,
        periodEnd
      );

      // Skip invoice if no usage
      if (billingCalculation.totalCents <= 0) {
        console.log(`[Invoice] No usage for tenant ${tenantId} in period ${periodStart} - ${periodEnd}`);
        return {
          success: true,
          totalAmount: 0,
          error: "No usage to invoice"
        };
      }

      // Generate idempotency key for this billing period
      const invoiceIdempotencyKey = this.generateIdempotencyKey(
        'invoice',
        tenantId,
        periodStart.toISOString(),
        periodEnd.toISOString()
      );

      // Create invoice items in Stripe with idempotency
      const invoiceItems: Stripe.InvoiceItem[] = [];
      for (let index = 0; index < billingCalculation.lineItems.length; index++) {
        const lineItem = billingCalculation.lineItems[index];
        const itemIdempotencyKey = this.generateIdempotencyKey(
          'invoice_item',
          tenantId,
          periodStart.toISOString(),
          lineItem.kind,
          index.toString()
        );
        
      const invoiceItem = await stripe.invoiceItems.create({
        customer: billingAccount.stripeCustomerId,
        amount: lineItem.totalAmountCents, // Already in cents
        currency: billingCalculation.currency.toLowerCase(),
        description: `${lineItem.name}: ${lineItem.quantity.toLocaleString()} units × €${(lineItem.ratePerUnitCents / 100).toFixed(4)}`,
        metadata: {
          tenant_id: tenantId,
          usage_kind: lineItem.kind,
          quantity: lineItem.quantity.toString(),
          rate_per_unit_cents: lineItem.ratePerUnitCents.toString(),
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString()
        }
      }, {
        idempotencyKey: itemIdempotencyKey
      });
      invoiceItems.push(invoiceItem);
    }

      const adjustments = await storage.getBillingAdjustments(tenantId, { from: periodStart, to: periodEnd });
      const totalBefore = billingCalculation.lineItems.reduce((sum, item) => sum + item.totalAmountCents, 0);
      let discountCents = 0;
      for (const adjustment of adjustments) {
        if (adjustment.type === 'discount_percent' && adjustment.valuePercent) {
          discountCents += Math.round(totalBefore * (adjustment.valuePercent / 100));
        } else if (adjustment.type === 'discount_fixed_cents' && adjustment.valueCents) {
          discountCents += adjustment.valueCents;
        }
      }

      if (discountCents > 0) {
        const discountKey = this.generateIdempotencyKey(
          'invoice_item_discount',
          tenantId,
          periodStart.toISOString(),
          periodEnd.toISOString()
        );
        const discountItem = await stripe.invoiceItems.create({
          customer: billingAccount.stripeCustomerId,
          currency: billingCalculation.currency.toLowerCase(),
          amount: -1 * discountCents,
          description: `Rabatt für ${periodStart.toISOString().slice(0, 7)}`
        }, { idempotencyKey: discountKey });
        invoiceItems.push(discountItem);
      }

    // Create the invoice with idempotency key
    const invoice = await stripe.invoices.create({
        customer: billingAccount.stripeCustomerId,
        description: `Voice Agent Usage - ${periodStart.toLocaleDateString()} to ${periodEnd.toLocaleDateString()}`,
        metadata: {
          tenant_id: tenantId,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          line_items_count: billingCalculation.lineItems.length.toString()
        },
        auto_advance: false, // Don't auto-finalize
        collection_method: 'charge_automatically'
      }, {
        idempotencyKey: invoiceIdempotencyKey
      });

      // Finalize the invoice
      if (!invoice.id) {
        throw new Error('Invoice ID is required to finalize invoice');
      }
      const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {});

      // Store invoice in database
      const dbInvoice = await storage.createInvoice({
        tenantId,
        periodStart,
        periodEnd,
        stripeInvoiceId: finalizedInvoice.id,
        status: 'pending',
        totalAmount: (billingCalculation.totalCents / 100).toString(),
        currency: billingCalculation.currency,
        metadata: {
          stripe_status: finalizedInvoice.status,
          line_items: billingCalculation.lineItems,
          invoice_url: finalizedInvoice.hosted_invoice_url || undefined
        }
      });

      console.log(`[Invoice] Created invoice ${dbInvoice.id} for tenant ${tenantId}: €${(billingCalculation.totalCents / 100).toFixed(2)}`);

      return {
        success: true,
        invoiceId: dbInvoice.id,
        stripeInvoiceId: finalizedInvoice.id,
        totalAmount: billingCalculation.totalCents / 100 // Return as decimal for display
      };

    } catch (error) {
      console.error('[Invoice Generation] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate invoice for current month for a tenant
   */
  async generateCurrentMonthInvoice(tenantId: string): Promise<InvoiceGenerationResult> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return this.generateMonthlyInvoice(tenantId, monthStart, monthEnd);
  }

  /**
   * Create payment intent for an existing invoice
   */
  async createPaymentIntentForInvoice(invoiceId: string): Promise<{
    success: boolean;
    clientSecret?: string;
    paymentIntentId?: string;
    error?: string;
  }> {
    try {
      const stripe = await this.getStripe();
      if (!stripe) {
        return { success: false, error: "Stripe not configured" };
      }

      // Get invoice from database
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return { success: false, error: "Invoice not found" };
      }

      // Get billing account
      const billingAccount = await storage.getBillingAccount(invoice.tenantId);
      if (!billingAccount) {
        return { success: false, error: "Billing account not found" };
      }

      // Create payment intent with idempotency key
      const paymentIdempotencyKey = this.generateIdempotencyKey(
        'payment_intent',
        invoice.tenantId,
        invoice.id
      );

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(parseFloat(invoice.totalAmount) * 100), // Convert to cents
        currency: invoice.currency.toLowerCase(),
        customer: billingAccount.stripeCustomerId,
        description: `Payment for Invoice ${invoice.id}`,
        metadata: {
          tenant_id: invoice.tenantId,
          invoice_id: invoice.id,
          stripe_invoice_id: invoice.stripeInvoiceId || ''
        }
      }, {
        idempotencyKey: paymentIdempotencyKey
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret || undefined,
        paymentIntentId: paymentIntent.id
      };

    } catch (error) {
      console.error('[Payment Intent] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get invoice details with Stripe information
   */
  async getInvoiceWithStripeDetails(invoiceId: string): Promise<{
    invoice: any;
    stripeInvoice?: Stripe.Invoice;
    error?: string;
  }> {
    try {
      const stripe = await this.getStripe();
      if (!stripe) {
        return { invoice: null, error: "Stripe not configured" };
      }

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return { invoice: null, error: "Invoice not found" };
      }

      let stripeInvoice: Stripe.Invoice | undefined;
      if (invoice.stripeInvoiceId) {
        try {
          stripeInvoice = await stripe.invoices.retrieve(invoice.stripeInvoiceId);
        } catch (stripeError) {
          console.warn('[Invoice Details] Failed to retrieve Stripe invoice:', stripeError);
        }
      }

      return {
        invoice,
        stripeInvoice
      };

    } catch (error) {
      console.error('[Invoice Details] Error:', error);
      return {
        invoice: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Retry failed payment for an invoice
   */
  async retryInvoicePayment(invoiceId: string): Promise<InvoiceGenerationResult> {
    try {
      const stripe = await this.getStripe();
      if (!stripe) {
        return { success: false, error: "Stripe not configured" };
      }

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice || !invoice.stripeInvoiceId) {
        return { success: false, error: "Invoice or Stripe invoice not found" };
      }

      // Attempt to pay the invoice
      const stripeInvoice = await stripe.invoices.pay(invoice.stripeInvoiceId);

      // Update database status
      await storage.updateInvoice(invoiceId, {
        status: stripeInvoice.status === 'paid' ? 'paid' : 'pending'
      });

      return {
        success: true,
        invoiceId,
        stripeInvoiceId: invoice.stripeInvoiceId,
        totalAmount: parseFloat(invoice.totalAmount)
      };

    } catch (error) {
      console.error('[Invoice Retry] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export singleton instance
export const stripeInvoiceService = new StripeInvoiceService();