import { storage } from "./storage";
import { stripeInvoiceService } from "./stripe-invoice-service";

export interface AutomatedInvoiceJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  periodStart: Date;
  periodEnd: Date;
  processedTenants: number;
  totalTenants: number;
  errors: string[];
  successfulInvoices: string[];
  failedInvoices: { tenantId: string; error: string }[];
}

export class AutomatedInvoiceService {
  private jobs: Map<string, AutomatedInvoiceJob> = new Map();
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Start automated invoice generation scheduler
   * Runs on the 1st of every month at 2 AM
   */
  startScheduler() {
    if (this.intervalId) {
      console.log('[AutoInvoice] Scheduler already running');
      return;
    }

    // Check every hour and run if it's the first day of the month at 2 AM
    this.intervalId = setInterval(() => {
      this.checkAndRunMonthlyInvoicing();
    }, 60 * 60 * 1000); // Every hour

    console.log('[AutoInvoice] ✅ Automated invoice scheduler started');
  }

  /**
   * Stop the automated scheduler
   */
  stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[AutoInvoice] ⏹️ Automated invoice scheduler stopped');
    }
  }

  /**
   * Check if we should run monthly invoicing and execute if needed
   */
  private async checkAndRunMonthlyInvoicing() {
    const now = new Date();
    const day = now.getDate();
    const hour = now.getHours();
    
    // Run on the 1st of the month between 2-3 AM
    if (day === 1 && hour === 2) {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      
      console.log(`[AutoInvoice] ⚡ Triggering monthly invoice generation for period: ${lastMonth.toISOString()} - ${lastMonthEnd.toISOString()}`);
      
      await this.generateMonthlyInvoicesForAllTenants(lastMonth, lastMonthEnd);
    }
  }

  /**
   * Manually trigger monthly invoice generation for all tenants
   */
  async generateMonthlyInvoicesForAllTenants(periodStart?: Date, periodEnd?: Date): Promise<AutomatedInvoiceJob> {
    // Default to last month if no period specified
    if (!periodStart || !periodEnd) {
      const now = new Date();
      periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    }

    const jobId = `invoice_job_${Date.now()}`;
    const job: AutomatedInvoiceJob = {
      id: jobId,
      status: 'pending',
      startTime: new Date(),
      periodStart,
      periodEnd,
      processedTenants: 0,
      totalTenants: 0,
      errors: [],
      successfulInvoices: [],
      failedInvoices: []
    };

    this.jobs.set(jobId, job);
    
    try {
      // Start the job
      job.status = 'running';
      console.log(`[AutoInvoice] 🚀 Starting automated invoice generation job: ${jobId}`);

      // Get all active tenants with billing accounts
      const allTenants = await storage.getTenants();
      const activeTenantsWithBilling = [];

      for (const tenant of allTenants) {
        try {
          const billingAccount = await storage.getBillingAccount(tenant.id);
          if (billingAccount && billingAccount.stripeCustomerId) {
            activeTenantsWithBilling.push(tenant);
          }
        } catch (error) {
          console.warn(`[AutoInvoice] Warning: Could not get billing account for tenant ${tenant.id}:`, error);
        }
      }

      job.totalTenants = activeTenantsWithBilling.length;
      console.log(`[AutoInvoice] Found ${activeTenantsWithBilling.length} active tenants with billing accounts`);

      // Process each tenant
      for (const tenant of activeTenantsWithBilling) {
        try {
          console.log(`[AutoInvoice] Processing tenant: ${tenant.id} (${tenant.name})`);
          
          const result = await stripeInvoiceService.generateMonthlyInvoice(
            tenant.id,
            periodStart,
            periodEnd
          );

          if (result.success) {
            if (result.invoiceId) {
              job.successfulInvoices.push(`${tenant.id}:${result.invoiceId}`);
              console.log(`[AutoInvoice] ✅ Invoice generated for tenant ${tenant.id}: ${result.invoiceId}`);
            } else {
              console.log(`[AutoInvoice] ℹ️ No usage to invoice for tenant ${tenant.id}`);
            }
          } else {
            job.failedInvoices.push({
              tenantId: tenant.id,
              error: result.error || 'Unknown error'
            });
            console.error(`[AutoInvoice] ❌ Failed to generate invoice for tenant ${tenant.id}: ${result.error}`);
          }
        } catch (error) {
          const errorMessage = (error as Error).message;
          job.failedInvoices.push({
            tenantId: tenant.id,
            error: errorMessage
          });
          job.errors.push(`Tenant ${tenant.id}: ${errorMessage}`);
          console.error(`[AutoInvoice] ❌ Error processing tenant ${tenant.id}:`, error);
        }

        job.processedTenants++;
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Complete the job
      job.status = 'completed';
      job.endTime = new Date();
      
      const summary = {
        processed: job.processedTenants,
        successful: job.successfulInvoices.length,
        failed: job.failedInvoices.length,
        duration: job.endTime.getTime() - job.startTime.getTime()
      };

      console.log(`[AutoInvoice] ✅ Automated invoice generation completed: ${JSON.stringify(summary)}`);
      
      // Create audit log for the invoice generation run
      try {
        await storage.createAuditLog({
          operation: 'automated_invoice_generation',
          eventType: 'sensitive_operation',
          userId: null,
          userEmail: 'system@voiceagent.app',
          tenantId: null,
          ipAddress: '127.0.0.1',
          userAgent: 'VoiceAgent-AutoInvoice-Service',
          success: true,
          statusCode: 200,
          metadata: {
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            summary,
            successfulInvoices: job.successfulInvoices,
            failedInvoices: job.failedInvoices
          }
        });
      } catch (auditError) {
        console.error('[AutoInvoice] Warning: Failed to create audit log:', auditError);
      }

    } catch (error) {
      job.status = 'failed';
      job.endTime = new Date();
      job.errors.push((error as Error).message);
      
      console.error(`[AutoInvoice] ❌ Fatal error in automated invoice generation:`, error);
      
      // Create error audit log
      try {
        await storage.createAuditLog({
          operation: 'automated_invoice_generation_error',
          eventType: 'sensitive_operation',
          userId: null,
          userEmail: 'system@voiceagent.app',
          tenantId: null,
          ipAddress: '127.0.0.1',
          userAgent: 'VoiceAgent-AutoInvoice-Service',
          success: false,
          statusCode: 500,
          metadata: {
            error: (error as Error).message,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString()
          }
        });
      } catch (auditError) {
        console.error('[AutoInvoice] Warning: Failed to create error audit log:', auditError);
      }
    }

    // Clean up old jobs (keep only last 10)
    this.cleanupOldJobs();

    return job;
  }

  /**
   * Get status of a specific job
   */
  getJobStatus(jobId: string): AutomatedInvoiceJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get all jobs (for admin monitoring)
   */
  getAllJobs(): AutomatedInvoiceJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  /**
   * Clean up old jobs to prevent memory bloat
   */
  private cleanupOldJobs() {
    const jobs = Array.from(this.jobs.entries()).sort((a, b) => b[1].startTime.getTime() - a[1].startTime.getTime());
    
    // Keep only the 10 most recent jobs
    if (jobs.length > 10) {
      const jobsToDelete = jobs.slice(10);
      jobsToDelete.forEach(([jobId]) => {
        this.jobs.delete(jobId);
      });
      console.log(`[AutoInvoice] Cleaned up ${jobsToDelete.length} old jobs`);
    }
  }

  /**
   * Force run invoice generation for testing/debugging
   * (Can be called manually from admin interface)
   */
  async forceRunMonthlyInvoicing(periodStart?: Date, periodEnd?: Date): Promise<AutomatedInvoiceJob> {
    console.log('[AutoInvoice] 🔧 Force running monthly invoice generation...');
    return await this.generateMonthlyInvoicesForAllTenants(periodStart, periodEnd);
  }
}

// Export singleton instance
export const automatedInvoiceService = new AutomatedInvoiceService();