import Stripe from "stripe";
import { storage } from "./storage";
import { getStripeKey } from "./key-loader";

export class StripeWebhookService {
  private stripe: Stripe | null = null;

  private async getStripe(): Promise<Stripe | null> {
    if (this.stripe) {
      return this.stripe;
    }

    try {
      const stripeKey = await getStripeKey();
      if (stripeKey) {
        this.stripe = new Stripe(stripeKey, {
          apiVersion: "2025-08-27.basil",
        });
        return this.stripe;
      }
    } catch (error) {
      console.error('[Stripe Webhook] Failed to initialize:', error);
    }
    
    return null;
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(payload: Buffer, signature: string, endpointSecret: string): Promise<{
    success: boolean;
    event?: Stripe.Event;
    error?: string;
  }> {
    try {
      const stripe = await this.getStripe();
      if (!stripe) {
        return { success: false, error: "Stripe not configured" };
      }

      // Verify webhook signature
      const event = stripe.webhooks.constructEvent(payload, signature, endpointSecret);
      
      // Process the event
      await this.processWebhookEvent(event);
      
      return { success: true, event };
    } catch (error) {
      console.error('[Stripe Webhook] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process individual webhook events
   */
  private async processWebhookEvent(event: Stripe.Event): Promise<void> {
    console.log(`[Stripe Webhook] Processing event: ${event.type}`);

    switch (event.type) {
      case 'invoice.created':
        await this.handleInvoiceCreated(event.data.object as Stripe.Invoice);
        break;
        
      case 'invoice.finalized':
        await this.handleInvoiceFinalized(event.data.object as Stripe.Invoice);
        break;
        
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
        
      case 'invoice.payment_action_required':
        await this.handleInvoicePaymentActionRequired(event.data.object as Stripe.Invoice);
        break;
      
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
        
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
  }

  private async handleInvoiceCreated(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice created: ${invoice.id}`);
    await this.synchronizeInvoiceStatus(invoice, 'pending');
  }

  private async handleInvoiceFinalized(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice finalized: ${invoice.id}`);
    await this.synchronizeInvoiceStatus(invoice, 'pending');
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice payment succeeded: ${invoice.id}`);
    await this.synchronizeInvoiceStatus(invoice, 'paid');
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice payment failed: ${invoice.id}`);
    await this.synchronizeInvoiceStatus(invoice, 'failed');
  }

  private async handleInvoicePaymentActionRequired(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice payment action required: ${invoice.id}`);
    await this.synchronizeInvoiceStatus(invoice, 'pending');
  }

  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`[Webhook] Payment intent succeeded: ${paymentIntent.id}`);
    
    // Update any invoices associated with this payment intent
    const invoiceId = paymentIntent.metadata?.invoice_id;
    const tenantId = paymentIntent.metadata?.tenant_id;
    
    if (invoiceId && tenantId) {
      try {
        await storage.updateInvoice(invoiceId, { status: 'paid' });
        console.log(`[Webhook] Updated invoice ${invoiceId} status to paid via payment intent`);
      } catch (error) {
        console.error(`[Webhook] Failed to update invoice ${invoiceId}:`, error);
      }
    }
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`[Webhook] Payment intent failed: ${paymentIntent.id}`);
    
    // Update any invoices associated with this payment intent
    const invoiceId = paymentIntent.metadata?.invoice_id;
    const tenantId = paymentIntent.metadata?.tenant_id;
    
    if (invoiceId && tenantId) {
      try {
        await storage.updateInvoice(invoiceId, { status: 'failed' });
        console.log(`[Webhook] Updated invoice ${invoiceId} status to failed via payment intent`);
      } catch (error) {
        console.error(`[Webhook] Failed to update invoice ${invoiceId}:`, error);
      }
    }
  }

  /**
   * Centralized invoice status synchronization with error handling
   */
  private async synchronizeInvoiceStatus(invoice: Stripe.Invoice, status: 'pending' | 'paid' | 'failed'): Promise<void> {
    const tenantId = invoice.metadata?.tenant_id;
    if (!tenantId) {
      console.warn(`[Webhook] No tenant_id found in invoice metadata: ${invoice.id}`);
      return;
    }

    try {
      const invoices = await storage.getInvoices(tenantId);
      const dbInvoice = invoices.find(inv => inv.stripeInvoiceId === invoice.id);
      
      if (dbInvoice) {
        await storage.updateInvoice(dbInvoice.id, { 
          status,
          metadata: {
            ...(typeof dbInvoice.metadata === 'object' && dbInvoice.metadata !== null ? dbInvoice.metadata : {}),
            stripe_status: invoice.status,
            stripe_updated_at: new Date().toISOString(),
            last_webhook_event: status
          }
        });
        console.log(`[Webhook] Successfully updated invoice ${dbInvoice.id} status to ${status}`);
      } else {
        console.warn(`[Webhook] No database invoice found for Stripe invoice: ${invoice.id}`);
      }
    } catch (error) {
      console.error(`[Webhook] Failed to synchronize invoice status for ${invoice.id}:`, error);
      throw error;
    }
  }
}

export const stripeWebhookService = new StripeWebhookService();