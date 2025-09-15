import { storage } from "./storage";
import { stripeInvoiceService } from "./stripe-invoice-service";
import { InvoiceJob } from "@shared/schema";

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
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private readonly SCHEDULER_INTERVAL = 15 * 60 * 1000; // Check every 15 minutes
  private readonly INVOICE_DAY = 1; // Run on 1st of each month
  private readonly INVOICE_HOUR = 2; // Run at 2 AM UTC

  /**
   * Start automated invoice generation scheduler with robust catch-up logic
   * Uses UTC time and persistent tracking to ensure reliability
   */
  async startScheduler() {
    if (this.intervalId) {
      console.log('[AutoInvoice] Scheduler already running');
      return;
    }

    console.log('[AutoInvoice] ✅ Starting automated invoice scheduler with catch-up logic...');
    
    // Run catch-up logic on startup
    await this.performStartupCatchUp();

    // Check every 15 minutes for scheduled runs
    this.intervalId = setInterval(() => {
      this.checkAndRunScheduledInvoicing();
    }, this.SCHEDULER_INTERVAL);

    console.log('[AutoInvoice] ✅ Automated invoice scheduler started successfully');
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
   * Perform startup catch-up logic to handle missed invoice periods
   * This is critical for production reliability
   */
  private async performStartupCatchUp() {
    try {
      console.log('[AutoInvoice] 🔍 Performing startup catch-up analysis...');
      
      // Get the last successful invoice job
      const lastJob = await storage.getLastSuccessfulInvoiceJob();
      const now = new Date();
      
      let missedPeriods: { start: Date; end: Date }[] = [];
      
      if (!lastJob) {
        // No previous jobs - check if we need to run for previous months
        const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const previousMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59));
        
        // If we're past the 3rd of this month and no jobs exist, we likely missed last month
        if (now.getUTCDate() > 3) {
          missedPeriods.push({ start: previousMonth, end: previousMonthEnd });
          console.log('[AutoInvoice] ⚠️ No previous jobs found, will run for previous month');
        }
      } else {
        // Check for gaps since last successful job
        const lastPeriodEnd = new Date(lastJob.periodEnd);
        const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        
        // Find all months between last job and current month
        let checkDate = new Date(lastPeriodEnd);
        checkDate.setUTCMonth(checkDate.getUTCMonth() + 1);
        checkDate.setUTCDate(1);
        
        while (checkDate < currentMonth) {
          const periodStart = new Date(Date.UTC(checkDate.getUTCFullYear(), checkDate.getUTCMonth(), 1));
          const periodEnd = new Date(Date.UTC(checkDate.getUTCFullYear(), checkDate.getUTCMonth() + 1, 0, 23, 59, 59));
          
          missedPeriods.push({ start: periodStart, end: periodEnd });
          checkDate.setUTCMonth(checkDate.getUTCMonth() + 1);
        }
        
        if (missedPeriods.length > 0) {
          console.log(`[AutoInvoice] ⚠️ Found ${missedPeriods.length} missed billing periods since last job`);
        }
      }
      
      // Process missed periods in chronological order
      for (const period of missedPeriods) {
        console.log(`[AutoInvoice] 🔧 Running catch-up for missed period: ${period.start.toISOString()} - ${period.end.toISOString()}`);
        await this.generateMonthlyInvoicesForAllTenants(period.start, period.end);
        
        // Small delay between catch-up runs
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (missedPeriods.length === 0) {
        console.log('[AutoInvoice] ✅ No missed periods found - system is up to date');
      } else {
        console.log(`[AutoInvoice] ✅ Catch-up completed for ${missedPeriods.length} missed periods`);
      }
      
    } catch (error) {
      console.error('[AutoInvoice] ❌ Error during startup catch-up:', error);
    }
  }

  /**
   * Check if we should run scheduled monthly invoicing using UTC time
   */
  private async checkAndRunScheduledInvoicing() {
    if (this.isRunning) {
      console.log('[AutoInvoice] ⏭️ Skipping scheduled check - job already running');
      return;
    }

    try {
      const now = new Date();
      const utcDay = now.getUTCDate();
      const utcHour = now.getUTCHours();
      
      // Only run on the configured day and hour (UTC)
      if (utcDay !== this.INVOICE_DAY || utcHour !== this.INVOICE_HOUR) {
        return;
      }
      
      // Calculate the period to bill (last month)
      const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59));
      
      // Check if we've already run for this period
      const existingJobs = await storage.getInvoiceJobs({
        periodStart: lastMonth,
        periodEnd: lastMonthEnd,
        status: 'completed'
      });
      
      if (existingJobs.length > 0) {
        console.log(`[AutoInvoice] ✅ Invoice already generated for period ${lastMonth.toISOString()} - ${lastMonthEnd.toISOString()}`);
        return;
      }
      
      console.log(`[AutoInvoice] ⚡ Triggering scheduled monthly invoice generation for period: ${lastMonth.toISOString()} - ${lastMonthEnd.toISOString()}`);
      await this.generateMonthlyInvoicesForAllTenants(lastMonth, lastMonthEnd);
      
    } catch (error) {
      console.error('[AutoInvoice] ❌ Error in scheduled invoicing check:', error);
    }
  }

  /**
   * Generate monthly invoices for all tenants with robust persistent tracking
   */
  async generateMonthlyInvoicesForAllTenants(periodStart?: Date, periodEnd?: Date): Promise<AutomatedInvoiceJob> {
    // Prevent concurrent runs
    if (this.isRunning) {
      throw new Error('Invoice generation is already running');
    }

    this.isRunning = true;

    // Default to last month if no period specified (using UTC)
    if (!periodStart || !periodEnd) {
      const now = new Date();
      periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59));
    }

    const jobId = `invoice_job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let dbJob: InvoiceJob | null = null;
    
    try {
      // Create persistent job record in database
      dbJob = await storage.createInvoiceJob({
        jobId,
        status: 'pending',
        periodStart,
        periodEnd,
        startTime: new Date(),
        processedTenants: 0,
        totalTenants: 0,
        successfulInvoices: [],
        failedInvoices: [],
        errors: [],
        metadata: {
          startedBy: 'automated_scheduler',
          version: '2.0'
        }
      });

      // Update to running status
      if (!dbJob) {
        throw new Error('Failed to create invoice job in database');
      }
      
      dbJob = await storage.updateInvoiceJob(dbJob.id, { status: 'running' });
      
      console.log(`[AutoInvoice] 🚀 Starting automated invoice generation job: ${jobId} (DB ID: ${dbJob.id})`);

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

      // Update tenant count in database
      dbJob = await storage.updateInvoiceJob(dbJob.id, { 
        totalTenants: activeTenantsWithBilling.length 
      });

      console.log(`[AutoInvoice] Found ${activeTenantsWithBilling.length} active tenants with billing accounts`);

      const successfulInvoices: string[] = [];
      const failedInvoices: { tenantId: string; error: string }[] = [];
      const errors: string[] = [];
      let processedTenants = 0;

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
              successfulInvoices.push(`${tenant.id}:${result.invoiceId}`);
              console.log(`[AutoInvoice] ✅ Invoice generated for tenant ${tenant.id}: ${result.invoiceId}`);
            } else {
              console.log(`[AutoInvoice] ℹ️ No usage to invoice for tenant ${tenant.id}`);
            }
          } else {
            failedInvoices.push({
              tenantId: tenant.id,
              error: result.error || 'Unknown error'
            });
            console.error(`[AutoInvoice] ❌ Failed to generate invoice for tenant ${tenant.id}: ${result.error}`);
          }
        } catch (error) {
          const errorMessage = (error as Error).message;
          failedInvoices.push({
            tenantId: tenant.id,
            error: errorMessage
          });
          errors.push(`Tenant ${tenant.id}: ${errorMessage}`);
          console.error(`[AutoInvoice] ❌ Error processing tenant ${tenant.id}:`, error);
        }

        processedTenants++;
        
        // Update progress in database periodically (every 10 tenants)
        if (processedTenants % 10 === 0 && dbJob) {
          await storage.updateInvoiceJob(dbJob.id, {
            processedTenants,
            successfulInvoices,
            failedInvoices,
            errors
          });
        }
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Complete the job
      const endTime = new Date();
      if (!dbJob) {
        throw new Error('Database job record is null');
      }
      
      dbJob = await storage.updateInvoiceJob(dbJob.id, {
        status: 'completed',
        endTime,
        processedTenants,
        successfulInvoices,
        failedInvoices,
        errors,
        metadata: {
          ...(dbJob.metadata || {}),
          completedAt: endTime.toISOString(),
          summary: {
            processed: processedTenants,
            successful: successfulInvoices.length,
            failed: failedInvoices.length,
            duration: endTime.getTime() - dbJob.startTime.getTime()
          }
        }
      });
      
      const summary = {
        processed: processedTenants,
        successful: successfulInvoices.length,
        failed: failedInvoices.length,
        duration: endTime.getTime() - dbJob.startTime.getTime()
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
            jobId: dbJob?.jobId || jobId,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            summary,
            successfulInvoices,
            failedInvoices
          }
        });
      } catch (auditError) {
        console.error('[AutoInvoice] Warning: Failed to create audit log:', auditError);
      }

      // Return compatible legacy format
      return {
        id: dbJob?.jobId || jobId,
        status: 'completed',
        startTime: dbJob?.startTime || new Date(),
        endTime,
        periodStart: dbJob?.periodStart || periodStart,
        periodEnd: dbJob?.periodEnd || periodEnd,
        processedTenants,
        totalTenants: activeTenantsWithBilling.length,
        errors,
        successfulInvoices,
        failedInvoices
      };

    } catch (error) {
      const endTime = new Date();
      const errorMessage = (error as Error).message;
      
      // Update job status to failed in database
      if (dbJob) {
        try {
          await storage.updateInvoiceJob(dbJob.id, {
            status: 'failed',
            endTime,
            errors: [errorMessage],
            metadata: {
              ...(dbJob.metadata || {}),
              failedAt: endTime.toISOString(),
              error: errorMessage
            }
          });
        } catch (updateError) {
          console.error('[AutoInvoice] Failed to update job status to failed:', updateError);
        }
      }
      
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
            jobId: dbJob?.jobId || jobId,
            error: errorMessage,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString()
          }
        });
      } catch (auditError) {
        console.error('[AutoInvoice] Warning: Failed to create error audit log:', auditError);
      }

      // Return failed job
      return {
        id: dbJob?.jobId || jobId,
        status: 'failed',
        startTime: dbJob?.startTime || new Date(),
        endTime,
        periodStart,
        periodEnd,
        processedTenants: dbJob?.processedTenants || 0,
        totalTenants: dbJob?.totalTenants || 0,
        errors: [errorMessage],
        successfulInvoices: [],
        failedInvoices: []
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get status of a specific job from database
   */
  async getJobStatus(jobId: string): Promise<AutomatedInvoiceJob | null> {
    try {
      const dbJob = await storage.getInvoiceJobByJobId(jobId);
      if (!dbJob) return null;

      return {
        id: dbJob.jobId,
        status: dbJob.status as 'pending' | 'running' | 'completed' | 'failed',
        startTime: dbJob.startTime,
        endTime: dbJob.endTime || undefined,
        periodStart: dbJob.periodStart,
        periodEnd: dbJob.periodEnd,
        processedTenants: dbJob.processedTenants,
        totalTenants: dbJob.totalTenants,
        errors: Array.isArray(dbJob.errors) ? dbJob.errors : [],
        successfulInvoices: Array.isArray(dbJob.successfulInvoices) ? dbJob.successfulInvoices : [],
        failedInvoices: Array.isArray(dbJob.failedInvoices) ? dbJob.failedInvoices : []
      };
    } catch (error) {
      console.error('[AutoInvoice] Error getting job status:', error);
      return null;
    }
  }

  /**
   * Get all jobs from database (for admin monitoring)
   */
  async getAllJobs(limit = 20): Promise<AutomatedInvoiceJob[]> {
    try {
      const dbJobs = await storage.getInvoiceJobs({ limit });
      return dbJobs.map(dbJob => ({
        id: dbJob.jobId,
        status: dbJob.status as 'pending' | 'running' | 'completed' | 'failed',
        startTime: dbJob.startTime,
        endTime: dbJob.endTime || undefined,
        periodStart: dbJob.periodStart,
        periodEnd: dbJob.periodEnd,
        processedTenants: dbJob.processedTenants,
        totalTenants: dbJob.totalTenants,
        errors: Array.isArray(dbJob.errors) ? dbJob.errors : [],
        successfulInvoices: Array.isArray(dbJob.successfulInvoices) ? dbJob.successfulInvoices : [],
        failedInvoices: Array.isArray(dbJob.failedInvoices) ? dbJob.failedInvoices : []
      }));
    } catch (error) {
      console.error('[AutoInvoice] Error getting all jobs:', error);
      return [];
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

  /**
   * Check system health and return status
   */
  async getSystemStatus(): Promise<{
    schedulerRunning: boolean;
    currentlyProcessing: boolean;
    lastSuccessfulJob?: InvoiceJob;
    pendingJobs: number;
    failedJobs: number;
  }> {
    try {
      const lastSuccessfulJob = await storage.getLastSuccessfulInvoiceJob();
      const pendingJobs = await storage.getInvoiceJobs({ status: 'pending', limit: 100 });
      const failedJobs = await storage.getInvoiceJobs({ status: 'failed', limit: 100 });
      
      return {
        schedulerRunning: this.intervalId !== null,
        currentlyProcessing: this.isRunning,
        lastSuccessfulJob: lastSuccessfulJob || undefined,
        pendingJobs: pendingJobs.length,
        failedJobs: failedJobs.length
      };
    } catch (error) {
      console.error('[AutoInvoice] Error getting system status:', error);
      return {
        schedulerRunning: this.intervalId !== null,
        currentlyProcessing: this.isRunning,
        pendingJobs: 0,
        failedJobs: 0
      };
    }
  }
}

// Export singleton instance
export const automatedInvoiceService = new AutomatedInvoiceService();