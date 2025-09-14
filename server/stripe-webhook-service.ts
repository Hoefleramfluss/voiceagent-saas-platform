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
      // Invoice lifecycle events
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

      case 'invoice.voided':
        await this.handleInvoiceVoided(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.marked_uncollectible':
        await this.handleInvoiceMarkedUncollectible(event.data.object as Stripe.Invoice);
        break;
      
      // Payment Intent lifecycle events
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
        
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.requires_action':
        await this.handlePaymentIntentRequiresAction(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.canceled':
        await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
        break;

      // Payment Method lifecycle events
      case 'payment_method.attached':
        await this.handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;

      case 'payment_method.detached':
        await this.handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
        break;

      case 'payment_method.updated':
        await this.handlePaymentMethodUpdated(event.data.object as Stripe.PaymentMethod);
        break;

      // Customer lifecycle events
      case 'customer.created':
        await this.handleCustomerCreated(event.data.object as Stripe.Customer);
        break;

      case 'customer.updated':
        await this.handleCustomerUpdated(event.data.object as Stripe.Customer);
        break;

      case 'customer.deleted':
        await this.handleCustomerDeleted(event.data.object as Stripe.Customer);
        break;

      // Customer payment source events
      case 'customer.source.created':
        await this.handleCustomerSourceCreated(event.data.object as Stripe.Source);
        break;

      case 'customer.source.deleted':
        await this.handleCustomerSourceDeleted(event.data.object as Stripe.Source);
        break;

      // Subscription lifecycle events (for future subscription features)
      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      // Charge lifecycle events
      case 'charge.succeeded':
        await this.handleChargeSucceeded(event.data.object as Stripe.Charge);
        break;

      case 'charge.failed':
        await this.handleChargeFailed(event.data.object as Stripe.Charge);
        break;

      case 'charge.dispute.created':
        await this.handleChargeDisputeCreated(event.data.object as Stripe.Dispute);
        break;
      
      // Refund lifecycle events
      case 'charge.refunded':
        await this.handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      case 'refund.created':
        await this.handleRefundCreated(event.data.object as Stripe.Refund);
        break;

      case 'refund.updated':
        await this.handleRefundUpdated(event.data.object as Stripe.Refund);
        break;
      
      // Additional dispute lifecycle events
      case 'charge.dispute.closed':
        await this.handleChargeDisputeClosed(event.data.object as Stripe.Dispute);
        break;

      case 'charge.dispute.funds_withdrawn':
        await this.handleChargeDisputeFundsWithdrawn(event.data.object as Stripe.Dispute);
        break;

      case 'charge.dispute.funds_reinstated':
        await this.handleChargeDisputeFundsReinstated(event.data.object as Stripe.Dispute);
        break;
      
      // Additional invoice events
      case 'invoice.finalization_failed':
        await this.handleInvoiceFinalizationFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.updated':
        await this.handleInvoiceUpdated(event.data.object as Stripe.Invoice);
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
        // Get the invoice to pass to unified synchronization
        const invoice = await storage.getInvoice(invoiceId);
        if (invoice && invoice.stripeInvoiceId) {
          // Create a minimal Stripe invoice object for synchronization
          const stripeInvoice = {
            id: invoice.stripeInvoiceId,
            status: 'paid',
            metadata: { tenant_id: tenantId }
          } as unknown as Stripe.Invoice;
          
          await this.synchronizeInvoiceStatus(stripeInvoice, 'paid');
        } else {
          // Fallback to direct update if we can't find Stripe invoice ID
          await storage.updateInvoice(invoiceId, { status: 'paid' });
          console.log(`[Webhook] Updated invoice ${invoiceId} status to paid via payment intent (direct update)`);
        }
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
        // Get the invoice to pass to unified synchronization
        const invoice = await storage.getInvoice(invoiceId);
        if (invoice && invoice.stripeInvoiceId) {
          // Create a minimal Stripe invoice object for synchronization
          const stripeInvoice = {
            id: invoice.stripeInvoiceId,
            status: 'open', // Payment failed but invoice still exists
            metadata: { tenant_id: tenantId }
          } as unknown as Stripe.Invoice;
          
          await this.synchronizeInvoiceStatus(stripeInvoice, 'failed');
        } else {
          // Fallback to direct update if we can't find Stripe invoice ID
          await storage.updateInvoice(invoiceId, { status: 'failed' });
          console.log(`[Webhook] Updated invoice ${invoiceId} status to failed via payment intent (direct update)`);
        }
      } catch (error) {
        console.error(`[Webhook] Failed to update invoice ${invoiceId}:`, error);
      }
    }
  }

  // Additional Invoice event handlers
  private async handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice voided: ${invoice.id}`);
    await this.synchronizeInvoiceStatus(invoice, 'failed');
  }

  private async handleInvoiceMarkedUncollectible(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice marked uncollectible: ${invoice.id}`);
    await this.synchronizeInvoiceStatus(invoice, 'failed');
  }

  // Additional Payment Intent event handlers
  private async handlePaymentIntentRequiresAction(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`[Webhook] Payment intent requires action: ${paymentIntent.id}`);
    
    const invoiceId = paymentIntent.metadata?.invoice_id;
    const tenantId = paymentIntent.metadata?.tenant_id;
    
    if (invoiceId && tenantId) {
      try {
        // Get the invoice to pass to unified synchronization
        const invoice = await storage.getInvoice(invoiceId);
        if (invoice && invoice.stripeInvoiceId) {
          // Create a minimal Stripe invoice object for synchronization
          const stripeInvoice = {
            id: invoice.stripeInvoiceId,
            status: 'open',
            metadata: { tenant_id: tenantId }
          } as unknown as Stripe.Invoice;
          
          await this.synchronizeInvoiceStatus(stripeInvoice, 'pending');
          
          // Add additional metadata for action required
          await storage.updateInvoice(invoiceId, { 
            metadata: {
              ...((await storage.getInvoice(invoiceId))?.metadata || {}),
              payment_requires_action: true,
              action_required_at: new Date().toISOString()
            }
          });
        } else {
          // Fallback to direct update if we can't find Stripe invoice ID
          await storage.updateInvoice(invoiceId, { 
            status: 'pending',
            metadata: {
              ...((await storage.getInvoice(invoiceId))?.metadata || {}),
              payment_requires_action: true,
              action_required_at: new Date().toISOString()
            }
          });
          console.log(`[Webhook] Updated invoice ${invoiceId} - payment action required (direct update)`);
        }
      } catch (error) {
        console.error(`[Webhook] Failed to update invoice ${invoiceId}:`, error);
      }
    }
  }

  private async handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`[Webhook] Payment intent canceled: ${paymentIntent.id}`);
    
    const invoiceId = paymentIntent.metadata?.invoice_id;
    const tenantId = paymentIntent.metadata?.tenant_id;
    
    if (invoiceId && tenantId) {
      try {
        // Get the invoice to pass to unified synchronization
        const invoice = await storage.getInvoice(invoiceId);
        if (invoice && invoice.stripeInvoiceId) {
          // Create a minimal Stripe invoice object for synchronization
          const stripeInvoice = {
            id: invoice.stripeInvoiceId,
            status: 'open',
            metadata: { tenant_id: tenantId }
          } as unknown as Stripe.Invoice;
          
          await this.synchronizeInvoiceStatus(stripeInvoice, 'pending');
          
          // Add additional metadata for cancelation
          await storage.updateInvoice(invoiceId, { 
            metadata: {
              ...((await storage.getInvoice(invoiceId))?.metadata || {}),
              payment_canceled: true,
              canceled_at: new Date().toISOString()
            }
          });
        } else {
          // Fallback to direct update if we can't find Stripe invoice ID
          await storage.updateInvoice(invoiceId, { 
            status: 'pending',
            metadata: {
              ...((await storage.getInvoice(invoiceId))?.metadata || {}),
              payment_canceled: true,
              canceled_at: new Date().toISOString()
            }
          });
          console.log(`[Webhook] Updated invoice ${invoiceId} - payment canceled (direct update)`);
        }
      } catch (error) {
        console.error(`[Webhook] Failed to update invoice ${invoiceId}:`, error);
      }
    }
  }

  // Payment Method event handlers
  private async handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    console.log(`[Webhook] Payment method attached: ${paymentMethod.id} to customer ${paymentMethod.customer}`);
    // Log payment method change for audit trail
    if (paymentMethod.customer) {
      const customerId = typeof paymentMethod.customer === 'string' ? paymentMethod.customer : paymentMethod.customer.id;
      console.log(`[Webhook] Customer ${customerId} added payment method ${paymentMethod.type}`);
    }
  }

  private async handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    console.log(`[Webhook] Payment method detached: ${paymentMethod.id}`);
    // Log payment method removal for audit trail
    console.log(`[Webhook] Payment method ${paymentMethod.type} removed`);
  }

  private async handlePaymentMethodUpdated(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    console.log(`[Webhook] Payment method updated: ${paymentMethod.id}`);
    // Log payment method update for audit trail
    if (paymentMethod.customer) {
      const customerId = typeof paymentMethod.customer === 'string' ? paymentMethod.customer : paymentMethod.customer.id;
      console.log(`[Webhook] Customer ${customerId} updated payment method ${paymentMethod.type}`);
    }
  }

  // Customer lifecycle event handlers
  private async handleCustomerCreated(customer: Stripe.Customer): Promise<void> {
    console.log(`[Webhook] Customer created: ${customer.id}`);
    // Find and update tenant with Stripe customer info if needed
    const tenantId = customer.metadata?.tenant_id;
    if (tenantId) {
      try {
        await storage.updateTenant(tenantId, {
          stripeCustomerId: customer.id,
          updatedAt: new Date()
        });
        console.log(`[Webhook] Updated tenant ${tenantId} with Stripe customer ${customer.id}`);
      } catch (error) {
        console.error(`[Webhook] Failed to update tenant ${tenantId}:`, error);
      }
    }
  }

  private async handleCustomerUpdated(customer: Stripe.Customer): Promise<void> {
    console.log(`[Webhook] Customer updated: ${customer.id}`);
    // Log customer updates for audit trail
    const tenantId = customer.metadata?.tenant_id;
    if (tenantId) {
      console.log(`[Webhook] Customer profile updated for tenant ${tenantId}`);
    }
  }

  private async handleCustomerDeleted(customer: Stripe.Customer): Promise<void> {
    console.log(`[Webhook] Customer deleted: ${customer.id}`);
    // Handle customer deletion - potentially mark tenant as inactive
    const tenantId = customer.metadata?.tenant_id;
    if (tenantId) {
      console.warn(`[Webhook] Customer deleted for tenant ${tenantId} - manual review required`);
      // Note: In production, you might want to trigger an alert or workflow here
    }
  }

  // Customer payment source event handlers
  private async handleCustomerSourceCreated(source: any): Promise<void> {
    console.log(`[Webhook] Customer payment source created: ${source.id || 'unknown'}`);
    // Log payment source addition
    if (source.customer) {
      const customerId = typeof source.customer === 'string' ? source.customer : source.customer.id;
      console.log(`[Webhook] Customer ${customerId} added payment source ${source.type || 'unknown'}`);
    }
  }

  private async handleCustomerSourceDeleted(source: any): Promise<void> {
    console.log(`[Webhook] Customer payment source deleted: ${source.id || 'unknown'}`);
    // Log payment source removal
    console.log(`[Webhook] Payment source ${source.type || 'unknown'} removed`);
  }

  // Subscription event handlers (for future subscription features)
  private async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    console.log(`[Webhook] Subscription created: ${subscription.id}`);
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    
    // Update billing account with subscription ID
    try {
      // Find tenant by Stripe customer ID
      const tenants = await storage.getTenants();
      const tenant = tenants.find((t: any) => t.stripeCustomerId === customerId);
      
      if (tenant) {
        await storage.updateBillingAccount(tenant.id, {
          stripeSubscriptionId: subscription.id
        });
        console.log(`[Webhook] Updated billing account for tenant ${tenant.id} with subscription ${subscription.id}`);
      }
    } catch (error) {
      console.error(`[Webhook] Failed to update billing account for subscription ${subscription.id}:`, error);
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    console.log(`[Webhook] Subscription updated: ${subscription.id}`);
    // Log subscription changes for audit trail
    console.log(`[Webhook] Subscription ${subscription.id} status: ${subscription.status}`);
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    console.log(`[Webhook] Subscription deleted: ${subscription.id}`);
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    
    // Remove subscription ID from billing account
    try {
      const tenants = await storage.getTenants();
      const tenant = tenants.find((t: any) => t.stripeCustomerId === customerId);
      
      if (tenant) {
        await storage.updateBillingAccount(tenant.id, {
          stripeSubscriptionId: undefined
        });
        console.log(`[Webhook] Removed subscription from billing account for tenant ${tenant.id}`);
      }
    } catch (error) {
      console.error(`[Webhook] Failed to update billing account for deleted subscription ${subscription.id}:`, error);
    }
  }

  // Charge event handlers
  private async handleChargeSucceeded(charge: Stripe.Charge): Promise<void> {
    console.log(`[Webhook] Charge succeeded: ${charge.id} for ${charge.amount / 100} ${charge.currency.toUpperCase()}`);
    
    const tenantId = charge.metadata?.tenant_id;
    if (tenantId) {
      console.log(`[Webhook] Payment of ${charge.amount / 100} ${charge.currency.toUpperCase()} processed for tenant ${tenantId}`);
    }
  }

  private async handleChargeFailed(charge: Stripe.Charge): Promise<void> {
    console.log(`[Webhook] Charge failed: ${charge.id} - ${charge.failure_message || 'Unknown error'}`);
    
    const tenantId = charge.metadata?.tenant_id;
    if (tenantId) {
      console.warn(`[Webhook] Payment failed for tenant ${tenantId}: ${charge.failure_message || 'Unknown error'}`);
    }
  }

  private async handleChargeDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
    console.log(`[Webhook] Charge dispute created: ${dispute.id} for charge ${dispute.charge}`);
    
    // Log dispute for manual review
    console.warn(`[Webhook] DISPUTE ALERT - Charge ${dispute.charge} disputed for ${dispute.amount / 100} ${dispute.currency.toUpperCase()}`);
    console.warn(`[Webhook] Dispute reason: ${dispute.reason} - Manual review required`);
  }

  // Refund event handlers
  private async handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    console.log(`[Webhook] Charge refunded: ${charge.id} - ${charge.amount_refunded / 100} ${charge.currency.toUpperCase()} refunded`);
    
    const tenantId = charge.metadata?.tenant_id;
    if (tenantId) {
      console.log(`[Webhook] Refund processed for tenant ${tenantId}: ${charge.amount_refunded / 100} ${charge.currency.toUpperCase()}`);
      
      // If charge is fully refunded, we may want to update related invoice status
      if (charge.refunded && charge.amount_refunded === charge.amount) {
        console.log(`[Webhook] Charge ${charge.id} is fully refunded - manual review may be needed for related invoices`);
      }
    }
  }

  private async handleRefundCreated(refund: Stripe.Refund): Promise<void> {
    console.log(`[Webhook] Refund created: ${refund.id} for ${refund.amount / 100} ${refund.currency.toUpperCase()}`);
    
    const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
    if (chargeId) {
      console.log(`[Webhook] Refund ${refund.id} created for charge ${chargeId}`);
      console.log(`[Webhook] Refund reason: ${refund.reason || 'No reason provided'}`);
    }
  }

  private async handleRefundUpdated(refund: Stripe.Refund): Promise<void> {
    console.log(`[Webhook] Refund updated: ${refund.id} - Status: ${refund.status}`);
    
    if (refund.status === 'failed') {
      console.warn(`[Webhook] Refund ${refund.id} failed: ${refund.failure_reason || 'Unknown reason'}`);
    } else if (refund.status === 'succeeded') {
      console.log(`[Webhook] Refund ${refund.id} successfully processed`);
    }
  }

  // Additional dispute event handlers
  private async handleChargeDisputeClosed(dispute: Stripe.Dispute): Promise<void> {
    console.log(`[Webhook] Charge dispute closed: ${dispute.id} - Status: ${dispute.status}`);
    
    if (dispute.status === 'lost') {
      console.warn(`[Webhook] DISPUTE LOST - ${dispute.id} for charge ${dispute.charge} - Amount lost: ${dispute.amount / 100} ${dispute.currency.toUpperCase()}`);
    } else if (dispute.status === 'won') {
      console.log(`[Webhook] DISPUTE WON - ${dispute.id} for charge ${dispute.charge}`);
    }
  }

  private async handleChargeDisputeFundsWithdrawn(dispute: Stripe.Dispute): Promise<void> {
    console.log(`[Webhook] Dispute funds withdrawn: ${dispute.id} for charge ${dispute.charge}`);
    console.warn(`[Webhook] FUNDS WITHDRAWN - ${dispute.amount / 100} ${dispute.currency.toUpperCase()} withdrawn due to dispute ${dispute.id}`);
  }

  private async handleChargeDisputeFundsReinstated(dispute: Stripe.Dispute): Promise<void> {
    console.log(`[Webhook] Dispute funds reinstated: ${dispute.id} for charge ${dispute.charge}`);
    console.log(`[Webhook] FUNDS REINSTATED - ${dispute.amount / 100} ${dispute.currency.toUpperCase()} reinstated from dispute ${dispute.id}`);
  }

  // Additional invoice event handlers
  private async handleInvoiceFinalizationFailed(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice finalization failed: ${invoice.id}`);
    
    const tenantId = invoice.metadata?.tenant_id;
    if (tenantId) {
      console.error(`[Webhook] INVOICE ERROR - Failed to finalize invoice ${invoice.id} for tenant ${tenantId}`);
      
      try {
        // Mark invoice as failed since finalization failed
        await this.synchronizeInvoiceStatus(invoice, 'failed');
      } catch (error) {
        console.error(`[Webhook] Failed to update invoice ${invoice.id} after finalization failure:`, error);
      }
    }
  }

  private async handleInvoiceUpdated(invoice: Stripe.Invoice): Promise<void> {
    console.log(`[Webhook] Invoice updated: ${invoice.id} - Status: ${invoice.status}`);
    
    const tenantId = invoice.metadata?.tenant_id;
    if (tenantId) {
      // Map Stripe invoice status to our internal status
      let internalStatus: 'pending' | 'paid' | 'failed';
      
      switch (invoice.status) {
        case 'paid':
          internalStatus = 'paid';
          break;
        case 'open':
        case 'draft':
          internalStatus = 'pending';
          break;
        case 'void':
        case 'uncollectible':
          internalStatus = 'failed';
          break;
        default:
          internalStatus = 'pending';
      }
      
      try {
        await this.synchronizeInvoiceStatus(invoice, internalStatus);
      } catch (error) {
        console.error(`[Webhook] Failed to synchronize updated invoice ${invoice.id}:`, error);
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