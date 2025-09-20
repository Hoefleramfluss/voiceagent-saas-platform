import { storage } from './storage';
import { stripeInvoiceService } from './stripe-invoice-service';
import { CronJob } from 'cron';

/**
 * Enterprise Background Jobs Service
 * Handles scheduled cleanup, maintenance, and monitoring tasks
 */

interface JobMetrics {
  jobName: string;
  lastRun: Date | null;
  lastSuccess: Date | null;
  lastError: Date | null;
  totalRuns: number;
  successCount: number;
  errorCount: number;
  averageRunTimeMs: number;
  isRunning: boolean;
}

class BackgroundJobManager {
  private static instance: BackgroundJobManager;
  private jobs = new Map<string, CronJob>();
  private metrics = new Map<string, JobMetrics>();
  private runTimes = new Map<string, number[]>();

  static getInstance(): BackgroundJobManager {
    if (!BackgroundJobManager.instance) {
      BackgroundJobManager.instance = new BackgroundJobManager();
    }
    return BackgroundJobManager.instance;
  }

  private initializeMetrics(jobName: string): void {
    if (!this.metrics.has(jobName)) {
      this.metrics.set(jobName, {
        jobName,
        lastRun: null,
        lastSuccess: null,
        lastError: null,
        totalRuns: 0,
        successCount: 0,
        errorCount: 0,
        averageRunTimeMs: 0,
        isRunning: false
      });
      this.runTimes.set(jobName, []);
    }
  }

  private updateMetrics(jobName: string, success: boolean, runTimeMs: number, error?: Error): void {
    const metrics = this.metrics.get(jobName)!;
    const runTimes = this.runTimes.get(jobName)!;

    metrics.lastRun = new Date();
    metrics.totalRuns++;
    metrics.isRunning = false;

    if (success) {
      metrics.successCount++;
      metrics.lastSuccess = new Date();
    } else {
      metrics.errorCount++;
      metrics.lastError = new Date();
    }

    // Track run times (keep last 10 for average calculation)
    runTimes.push(runTimeMs);
    if (runTimes.length > 10) {
      runTimes.shift();
    }
    
    metrics.averageRunTimeMs = runTimes.reduce((sum, time) => sum + time, 0) / runTimes.length;

    console.log(`[BACKGROUND JOB] ${jobName} completed: ${success ? 'SUCCESS' : 'FAILED'} (${runTimeMs}ms)${error ? `, Error: ${error.message}` : ''}`);
  }

  registerJob(
    name: string, 
    cronPattern: string, 
    jobFunction: () => Promise<void>,
    options: { 
      immediate?: boolean;
      timezone?: string;
      description?: string;
    } = {}
  ): void {
    this.initializeMetrics(name);

    const wrappedFunction = async () => {
      const startTime = Date.now();
      const metrics = this.metrics.get(name)!;
      
      if (metrics.isRunning) {
        console.warn(`[BACKGROUND JOB] ${name} is already running, skipping this execution`);
        return;
      }

      metrics.isRunning = true;
      
      try {
        console.log(`[BACKGROUND JOB] Starting ${name}`);
        await jobFunction();
        this.updateMetrics(name, true, Date.now() - startTime);
      } catch (error) {
        this.updateMetrics(name, false, Date.now() - startTime, error as Error);
        console.error(`[BACKGROUND JOB] ${name} failed:`, error);
      }
    };

    const job = new CronJob(
      cronPattern,
      wrappedFunction,
      null, // onComplete
      false, // start immediately
      options.timezone || 'UTC'
    );

    this.jobs.set(name, job);
    console.log(`[BACKGROUND JOB] Registered job: ${name} (${cronPattern}) - ${options.description || 'No description'}`);

    // Run immediately if requested
    if (options.immediate) {
      console.log(`[BACKGROUND JOB] Running ${name} immediately`);
      wrappedFunction().catch(error => {
        console.error(`[BACKGROUND JOB] Initial run of ${name} failed:`, error);
      });
    }
  }

  startJob(name: string): void {
    const job = this.jobs.get(name);
    if (job) {
      job.start();
      console.log(`[BACKGROUND JOB] Started job: ${name}`);
    } else {
      console.error(`[BACKGROUND JOB] Job not found: ${name}`);
    }
  }

  stopJob(name: string): void {
    const job = this.jobs.get(name);
    if (job) {
      job.stop();
      console.log(`[BACKGROUND JOB] Stopped job: ${name}`);
    } else {
      console.error(`[BACKGROUND JOB] Job not found: ${name}`);
    }
  }

  startAllJobs(): void {
    console.log(`[BACKGROUND JOB] Starting ${this.jobs.size} background jobs`);
    this.jobs.forEach((job, name) => {
      job.start();
      console.log(`[BACKGROUND JOB] ✅ Started: ${name}`);
    });
  }

  stopAllJobs(): void {
    console.log(`[BACKGROUND JOB] Stopping ${this.jobs.size} background jobs`);
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`[BACKGROUND JOB] ⏹️  Stopped: ${name}`);
    });
  }

  getJobMetrics(jobName?: string): JobMetrics | JobMetrics[] {
    if (jobName) {
      const metrics = this.metrics.get(jobName);
      if (!metrics) {
        return {
          jobName: jobName,
          lastRun: null,
          lastSuccess: null,
          lastError: null,
          totalRuns: 0,
          successCount: 0,
          errorCount: 0,
          averageRunTimeMs: 0,
          isRunning: false
        };
      }
      return metrics;
    }
    return Array.from(this.metrics.values());
  }

  getJobStatus(): Array<{ name: string; running: boolean; nextRun: Date | null }> {
    return Array.from(this.jobs.entries()).map(([name, job]) => ({
      name,
      running: (job as any).running || false,
      nextRun: job.nextDate()?.toJSDate() || null
    }));
  }
}

// Create singleton instance
const backgroundJobManagerInstance = BackgroundJobManager.getInstance();

/**
 * Cleanup expired verification codes
 * Removes codes that have expired or been used to keep database clean
 */
export async function cleanupExpiredVerificationCodes(): Promise<void> {
  try {
    console.log('[CLEANUP] Starting verification code cleanup...');
    
    const result = await storage.cleanupExpiredVerificationCodes();
    
    if (result.deletedCount > 0) {
      console.log(`[CLEANUP] ✅ Cleaned up ${result.deletedCount} expired verification codes`);
    } else {
      console.log('[CLEANUP] ✅ No expired verification codes to clean up');
    }

    // Additional cleanup: remove codes older than 24 hours regardless of expiry
    const staleCodesQuery = `
      DELETE FROM demo_verification_codes 
      WHERE created_at < NOW() - INTERVAL '24 hours'
    `;
    
    const staleResult = await storage.executeRaw(staleCodesQuery);
    if (staleResult.rowCount > 0) {
      console.log(`[CLEANUP] ✅ Removed ${staleResult.rowCount} stale verification codes (>24h old)`);
    }

  } catch (error) {
    console.error('[CLEANUP] ❌ Failed to cleanup verification codes:', error);
    throw error;
  }
}

/**
 * Cleanup stale demo tenants and artifacts
 * Removes demo tenants that were never verified or are too old
 */
export async function cleanupStaleDemoTenants(): Promise<void> {
  try {
    console.log('[CLEANUP] Starting stale demo tenant cleanup...');
    
    // Find demo tenants that are older than 7 days and still in trial status
    const staleTenants = await storage.getStaleTrialTenants(7); // 7 days old
    
    if (staleTenants.length === 0) {
      console.log('[CLEANUP] ✅ No stale demo tenants to clean up');
      return;
    }

    let cleanedCount = 0;
    for (const tenant of staleTenants) {
      try {
        // Clean up tenant-related data
        await storage.cleanupTenantData(tenant.id);
        
        // Remove phone mappings
        await storage.removePhoneMappingsByTenantId(tenant.id);
        
        // Delete the tenant
        await storage.deleteTenant(tenant.id);
        
        cleanedCount++;
        console.log(`[CLEANUP] ✅ Cleaned up stale demo tenant: ${tenant.name} (${tenant.id})`);
        
      } catch (error) {
        console.error(`[CLEANUP] ❌ Failed to cleanup tenant ${tenant.id}:`, error);
        // Continue with other tenants
      }
    }
    
    console.log(`[CLEANUP] ✅ Cleaned up ${cleanedCount}/${staleTenants.length} stale demo tenants`);
    
  } catch (error) {
    console.error('[CLEANUP] ❌ Failed to cleanup stale demo tenants:', error);
    throw error;
  }
}

/**
 * Cleanup orphaned phone mappings
 * Removes phone mappings that point to non-existent tenants or bots
 */
export async function cleanupOrphanedPhoneMappings(): Promise<void> {
  try {
    console.log('[CLEANUP] Starting orphaned phone mapping cleanup...');
    
    const result = await storage.cleanupOrphanedPhoneMappings();
    
    if (result.deletedCount > 0) {
      console.log(`[CLEANUP] ✅ Cleaned up ${result.deletedCount} orphaned phone mappings`);
    } else {
      console.log('[CLEANUP] ✅ No orphaned phone mappings to clean up');
    }
    
  } catch (error) {
    console.error('[CLEANUP] ❌ Failed to cleanup orphaned phone mappings:', error);
    throw error;
  }
}

/**
 * System health monitoring and alerting
 * Checks system metrics and generates alerts for anomalies
 */
export async function performSystemHealthCheck(): Promise<void> {
  try {
    console.log('[HEALTH CHECK] Starting system health monitoring...');
    
    // Check database connectivity
    await storage.healthCheck();
    
    // Check for rate limiting anomalies
    const { rateLimitMetrics } = await import('./enterprise-security');
    const metrics = rateLimitMetrics.getMetrics();
    
    // Alert thresholds
    const alerts: string[] = [];
    
    if (metrics.totalRequests > 0) {
      const blockRate = metrics.totalBlocked / metrics.totalRequests;
      if (blockRate > 0.2) { // >20% block rate
        alerts.push(`High rate limit block rate: ${(blockRate * 100).toFixed(1)}%`);
      }
    }
    
    if (metrics.topAbusers.some(abuser => abuser.blocked > 100)) {
      alerts.push('Detected high-volume abuser (>100 blocks)');
    }
    
    // Check for failed background jobs
    const jobMetrics = backgroundJobManagerInstance.getJobMetrics() as JobMetrics[];
    const failedJobs = jobMetrics.filter(job => 
      job.totalRuns > 0 && (job.errorCount / job.totalRuns) > 0.5 // >50% failure rate
    );
    
    if (failedJobs.length > 0) {
      alerts.push(`Background job failures detected: ${failedJobs.map(j => j.jobName).join(', ')}`);
    }
    
    if (alerts.length > 0) {
      console.warn('[HEALTH CHECK] ⚠️  System alerts detected:', alerts);
      // In production, send these alerts to your monitoring system
    } else {
      console.log('[HEALTH CHECK] ✅ System health check passed');
    }
    
  } catch (error) {
    console.error('[HEALTH CHECK] ❌ System health check failed:', error);
    throw error;
  }
}

/**
 * Archive old audit logs
 * Moves old audit logs to archive tables to keep main tables performant
 */
export async function archiveOldAuditLogs(): Promise<void> {
  try {
    console.log('[ARCHIVE] Starting audit log archival...');
    
    // Archive logs older than 90 days
    const archiveDate = new Date();
    archiveDate.setDate(archiveDate.getDate() - 90);
    
    const result = await storage.archiveOldAuditLogs(archiveDate);
    
    if (result.archivedCount > 0) {
      console.log(`[ARCHIVE] ✅ Archived ${result.archivedCount} old audit log entries`);
    } else {
      console.log('[ARCHIVE] ✅ No old audit logs to archive');
    }
    
  } catch (error) {
    console.error('[ARCHIVE] ❌ Failed to archive audit logs:', error);
    throw error;
  }
}

async function runMonthlyBillingJob(): Promise<void> {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const isMonthEnd = now.getMonth() !== tomorrow.getMonth();

  if (!isMonthEnd) {
    console.log('[Monthly Billing] Skipped - not last day of month');
    return;
  }

  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const tenants = await storage.getTenants();

  console.log('[Monthly Billing] Starting for', tenants.length, 'tenants', 'period', periodStart.toISOString(), '-', periodEnd.toISOString());

  for (const tenant of tenants) {
    try {
      const twilio = await import('./twilio-service');
      await twilio.importForwardingForTenantPeriod(tenant.id, periodStart, periodEnd);
    } catch (error) {
      console.error('[Monthly Billing] Twilio import failed for tenant', tenant.id, error);
    }

    try {
      await stripeInvoiceService.generateMonthlyInvoice(tenant.id, periodStart, periodEnd);
    } catch (error) {
      console.error('[Monthly Billing] Invoice generation failed for tenant', tenant.id, error);
    }
  }
}

/**
 * Initialize all background jobs with their schedules
 */
export function initializeBackgroundJobs(): void {
  console.log('[BACKGROUND JOBS] Initializing enterprise background job scheduler...');
  
  // Verification code cleanup - every hour
  backgroundJobManagerInstance.registerJob(
    'cleanup-verification-codes',
    '0 * * * *', // Every hour at minute 0
    cleanupExpiredVerificationCodes,
    { 
      immediate: true, // Run immediately on startup
      description: 'Cleanup expired phone verification codes' 
    }
  );
  
  // Demo tenant cleanup - daily at 2 AM
  backgroundJobManagerInstance.registerJob(
    'cleanup-stale-demo-tenants',
    '0 2 * * *', // Daily at 2 AM
    cleanupStaleDemoTenants,
    { 
      description: 'Cleanup stale demo tenants and artifacts' 
    }
  );
  
  // Phone mapping cleanup - daily at 3 AM
  backgroundJobManagerInstance.registerJob(
    'cleanup-orphaned-phone-mappings',
    '0 3 * * *', // Daily at 3 AM
    cleanupOrphanedPhoneMappings,
    { 
      description: 'Cleanup orphaned phone mappings' 
    }
  );
  
  // System health monitoring - every 15 minutes
  backgroundJobManagerInstance.registerJob(
    'system-health-check',
    '*/15 * * * *', // Every 15 minutes
    performSystemHealthCheck,
    { 
      description: 'Monitor system health and generate alerts' 
    }
  );
  
  // Audit log archival - weekly on Sunday at 1 AM
  backgroundJobManagerInstance.registerJob(
    'archive-audit-logs',
    '0 1 * * 0', // Weekly on Sunday at 1 AM
    archiveOldAuditLogs,
    {
      description: 'Archive old audit logs for performance'
    }
  );

  // Monthly billing run - daily at 23:55 Europe/Vienna, only executes on month end
  backgroundJobManagerInstance.registerJob(
    'monthly-billing',
    '0 55 23 * * *',
    runMonthlyBillingJob,
    {
      timezone: 'Europe/Vienna',
      description: 'Import Twilio forwarding minutes & generate Stripe invoices at month end'
    }
  );

  // Start all jobs
  backgroundJobManagerInstance.startAllJobs();
  
  console.log('[BACKGROUND JOBS] ✅ All background jobs initialized and started');
}

/**
 * Graceful shutdown of background jobs
 */
export function shutdownBackgroundJobs(): void {
  console.log('[BACKGROUND JOBS] Shutting down background job scheduler...');
  backgroundJobManagerInstance.stopAllJobs();
  console.log('[BACKGROUND JOBS] ✅ All background jobs stopped');
}

// Export for external access
export { backgroundJobManagerInstance as backgroundJobManager };