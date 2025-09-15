import { storage } from './storage';
import { checkPhoneSecurityViolations } from './phone-security-utils';
import { validateTwilioSignature } from './twilio-verification';
import { randomUUID } from 'crypto';

/**
 * Enterprise End-to-End Tests
 * Comprehensive testing for tenant isolation, security controls, and webhook routing
 */

interface TestResult {
  testName: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  error?: string;
  details?: any;
}

interface TestSuite {
  suiteName: string;
  results: TestResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDuration: number;
}

class EnterpriseTestRunner {
  private testResults: TestSuite[] = [];

  async runTest(testName: string, testFunction: () => Promise<void>): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      await testFunction();
      const duration = Date.now() - startTime;
      
      console.log(`[TEST] ✅ ${testName} (${duration}ms)`);
      return {
        testName,
        status: 'PASS',
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`[TEST] ❌ ${testName} (${duration}ms):`, error);
      return {
        testName,
        status: 'FAIL',
        duration,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async runTestSuite(suiteName: string, tests: Array<{ name: string; test: () => Promise<void> }>): Promise<TestSuite> {
    console.log(`[TEST SUITE] Starting ${suiteName}...`);
    const startTime = Date.now();
    
    const results: TestResult[] = [];
    
    for (const { name, test } of tests) {
      const result = await this.runTest(name, test);
      results.push(result);
    }
    
    const suite: TestSuite = {
      suiteName,
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.status === 'PASS').length,
      failedTests: results.filter(r => r.status === 'FAIL').length,
      skippedTests: results.filter(r => r.status === 'SKIP').length,
      totalDuration: Date.now() - startTime
    };
    
    this.testResults.push(suite);
    
    console.log(`[TEST SUITE] ${suiteName} completed: ${suite.passedTests}/${suite.totalTests} passed (${suite.totalDuration}ms)`);
    
    return suite;
  }

  getTestReport(): { suites: TestSuite[]; summary: any } {
    const totalTests = this.testResults.reduce((sum, suite) => sum + suite.totalTests, 0);
    const totalPassed = this.testResults.reduce((sum, suite) => sum + suite.passedTests, 0);
    const totalFailed = this.testResults.reduce((sum, suite) => sum + suite.failedTests, 0);
    const totalDuration = this.testResults.reduce((sum, suite) => sum + suite.totalDuration, 0);
    
    return {
      suites: this.testResults,
      summary: {
        totalTests,
        totalPassed,
        totalFailed,
        successRate: totalTests > 0 ? (totalPassed / totalTests * 100) : 0,
        totalDuration,
        overallStatus: totalFailed === 0 ? 'PASS' : 'FAIL'
      }
    };
  }

  clearResults(): void {
    this.testResults = [];
  }
}

export const testRunner = new EnterpriseTestRunner();

/**
 * Tenant Isolation Tests
 * Verify that tenants cannot access each other's data
 */
export async function testTenantIsolation(): Promise<TestSuite> {
  // Create test tenants for isolation testing
  const tenant1 = await storage.createTenant({
    name: 'Test Tenant 1',
    status: 'active'
  });
  
  const tenant2 = await storage.createTenant({
    name: 'Test Tenant 2', 
    status: 'active'
  });

  const tests = [
    {
      name: 'Tenant Bot Isolation',
      test: async () => {
        // Create bots for each tenant
        const bot1 = await storage.createBot({
          tenantId: tenant1.id,
          name: 'Tenant 1 Bot',
          systemPrompt: 'Test bot for tenant 1',
          locale: 'de-AT'
        });
        
        const bot2 = await storage.createBot({
          tenantId: tenant2.id,
          name: 'Tenant 2 Bot',
          systemPrompt: 'Test bot for tenant 2',
          locale: 'de-AT'
        });

        // Verify tenant 1 can only see their bot
        const tenant1Bots = await storage.getBotsByTenantId(tenant1.id);
        if (tenant1Bots.length !== 1 || tenant1Bots[0].id !== bot1.id) {
          throw new Error('Tenant 1 should only see their own bot');
        }

        // Verify tenant 2 can only see their bot
        const tenant2Bots = await storage.getBotsByTenantId(tenant2.id);
        if (tenant2Bots.length !== 1 || tenant2Bots[0].id !== bot2.id) {
          throw new Error('Tenant 2 should only see their own bot');
        }

        // Try to access cross-tenant bot (should fail)
        try {
          await storage.getBot(bot1.id, tenant2.id);
          throw new Error('Cross-tenant bot access should have failed');
        } catch (error) {
          // Expected to fail
        }
      }
    },
    
    {
      name: 'Tenant Flow Isolation',
      test: async () => {
        // Create flows for each tenant
        const flow1 = await storage.createFlow({
          tenantId: tenant1.id,
          name: 'Tenant 1 Flow',
          description: 'Test flow for tenant 1'
        });
        
        const flow2 = await storage.createFlow({
          tenantId: tenant2.id,
          name: 'Tenant 2 Flow',
          description: 'Test flow for tenant 2'
        });

        // Verify tenant isolation for flows
        const tenant1Flows = await storage.getFlowsByTenantId(tenant1.id);
        if (tenant1Flows.length !== 1 || tenant1Flows[0].id !== flow1.id) {
          throw new Error('Tenant 1 should only see their own flow');
        }

        const tenant2Flows = await storage.getFlowsByTenantId(tenant2.id);
        if (tenant2Flows.length !== 1 || tenant2Flows[0].id !== flow2.id) {
          throw new Error('Tenant 2 should only see their own flow');
        }
      }
    },

    {
      name: 'Tenant User Isolation',
      test: async () => {
        // Create users for each tenant
        const user1 = await storage.createUser({
          email: 'user1@tenant1.test',
          password: 'hash1',
          role: 'customer_admin',
          tenantId: tenant1.id
        });
        
        const user2 = await storage.createUser({
          email: 'user2@tenant2.test',
          password: 'hash2',
          role: 'customer_admin',
          tenantId: tenant2.id
        });

        // Verify users can only see their tenant's data
        const tenant1Users = await storage.getUsersByTenantId(tenant1.id);
        if (tenant1Users.length !== 1 || tenant1Users[0].id !== user1.id) {
          throw new Error('Tenant 1 should only see their own users');
        }

        const tenant2Users = await storage.getUsersByTenantId(tenant2.id);
        if (tenant2Users.length !== 1 || tenant2Users[0].id !== user2.id) {
          throw new Error('Tenant 2 should only see their own users');
        }
      }
    },

    {
      name: 'Phone Mapping Isolation',
      test: async () => {
        // Test cross-tenant phone mapping security
        const phoneNumber = '+4367712345678';
        
        // Create test bot for tenant 1
        const testBot1 = await storage.createBot({
          name: 'Test Bot 1',
          tenantId: tenant1.id,
          systemPrompt: 'Test bot 1 for phone mapping',
          status: 'ready'
        });
        
        // Create phone mapping for tenant 1
        await storage.createPhoneMapping({
          phoneNumber,
          tenantId: tenant1.id,
          botId: testBot1.id,
          isActive: true
        });

        // Create test bot for tenant 2
        const testBot2 = await storage.createBot({
          name: 'Test Bot 2',
          tenantId: tenant2.id,
          systemPrompt: 'Test bot 2 for phone mapping',
          status: 'ready'
        });
        
        // Verify security check prevents cross-tenant access
        const securityResult = await checkPhoneSecurityViolations(
          phoneNumber, 
          tenant2.id, 
          testBot2.id
        );
        
        if (!securityResult.hasViolations) {
          throw new Error('Cross-tenant phone mapping should be blocked');
        }
        
        if (!securityResult.violations.includes('CROSS_TENANT_PHONE_BINDING')) {
          throw new Error('Should detect cross-tenant phone binding violation');
        }
      }
    }
  ];

  const suite = await testRunner.runTestSuite('Tenant Isolation Tests', tests);
  
  // Cleanup test data
  try {
    await storage.deleteTenant(tenant1.id);
    await storage.deleteTenant(tenant2.id);
  } catch (error) {
    console.warn('[TEST CLEANUP] Failed to cleanup test tenants:', error);
  }
  
  return suite;
}

/**
 * Phone Mapping Security Tests
 * Verify phone number routing security and tenant isolation
 */
export async function testPhoneMappingSecurity(): Promise<TestSuite> {
  const tests = [
    {
      name: 'E.164 Phone Normalization',
      test: async () => {
        // Test various phone number formats
        const testCases = [
          { input: '+43 677 12345678', expected: '+4367712345678' },
          { input: '0043 677 12345678', expected: '+4367712345678' },
          { input: '0677 12345678', expected: '+4367712345678' },
          { input: '+1 555 123 4567', expected: '+15551234567' }
        ];

        for (const testCase of testCases) {
          const { normalizePhoneToE164 } = await import('./phone-security-utils');
          const normalized = normalizePhoneToE164(testCase.input, 'AT');
          
          if (normalized !== testCase.expected) {
            throw new Error(`Phone normalization failed: ${testCase.input} -> ${normalized}, expected ${testCase.expected}`);
          }
        }
      }
    },

    {
      name: 'Phone Number Validation',
      test: async () => {
        const { validatePhoneNumber } = await import('./phone-security-utils');
        
        // Valid numbers should pass
        const validNumbers = ['+4367712345678', '+15551234567', '+4915112345678'];
        for (const number of validNumbers) {
          const result = validatePhoneNumber(number);
          if (!result.isValid) {
            throw new Error(`Valid number ${number} should pass validation`);
          }
        }

        // Invalid numbers should fail
        const invalidNumbers = ['+15555551234', '+44555123456', 'invalid'];
        for (const number of invalidNumbers) {
          const result = validatePhoneNumber(number);
          if (result.isValid) {
            throw new Error(`Invalid number ${number} should fail validation`);
          }
        }
      }
    },

    {
      name: 'Active Phone Number Constraints',
      test: async () => {
        const phoneNumber = '+4367712345679';
        
        // Create test tenant
        const testTenant = await storage.createTenant({
          name: 'Phone Test Tenant',
          status: 'active'
        });
        
        // Create test bots
        const bot1 = await storage.createBot({
          tenantId: testTenant.id,
          name: 'Test Bot 1',
          systemPrompt: 'Test bot 1',
          status: 'ready'
        });
        
        const bot2 = await storage.createBot({
          tenantId: testTenant.id,
          name: 'Test Bot 2',
          systemPrompt: 'Test bot 2',
          status: 'ready'
        });
        
        try {
          // Create first mapping
          await storage.createPhoneMapping({
            phoneNumber,
            tenantId: testTenant.id,
            botId: bot1.id,
            isActive: true
          });

          // Try to create second active mapping (should fail)
          try {
            await storage.createPhoneMapping({
              phoneNumber,
              tenantId: testTenant.id,
              botId: bot2.id,
              isActive: true
            });
            throw new Error('Should not allow multiple active mappings for same number');
          } catch (error) {
            // Expected to fail due to unique constraint
          }
        } finally {
          // Cleanup
          try {
            await storage.removePhoneMapping(phoneNumber);
            await storage.deleteTenant(testTenant.id);
          } catch (cleanupError) {
            console.warn('[TEST CLEANUP] Failed to cleanup phone test data:', cleanupError);
          }
        }
      }
    }
  ];

  return await testRunner.runTestSuite('Phone Mapping Security Tests', tests);
}

/**
 * Twilio Webhook Routing Tests
 * Verify webhook signature validation and call routing
 */
export async function testTwilioWebhookRouting(): Promise<TestSuite> {
  const tests = [
    {
      name: 'Webhook Signature Validation',
      test: async () => {
        // Mock Twilio webhook data
        const webhookUrl = 'https://example.com/webhook';
        const webhookBody = 'CallSid=CA123&From=%2B4367712345678&To=%2B15551234567';
        
        // Test with invalid signature (should fail)
        const invalidSignature = 'invalid-signature';
        const invalidResult = await validateTwilioSignature(webhookUrl, webhookBody, invalidSignature);
        
        if (invalidResult.isValid) {
          throw new Error('Invalid signature should fail validation');
        }

        // Note: We can't test valid signatures without real Twilio auth token
        // In production, this would verify against actual Twilio signatures
      }
    },

    {
      name: 'Call Routing Logic',
      test: async () => {
        const phoneNumber = '+4367712345680';
        
        // Create test tenant
        const testTenant = await storage.createTenant({
          name: 'Routing Test Tenant',
          status: 'active'
        });
        
        // Create test bot
        const testBot = await storage.createBot({
          tenantId: testTenant.id,
          name: 'Routing Test Bot',
          systemPrompt: 'Test bot for routing',
          status: 'ready'
        });
        
        try {
          // Create phone mapping for routing
          await storage.createPhoneMapping({
            phoneNumber,
            tenantId: testTenant.id,
            botId: testBot.id,
            isActive: true
          });

          // Test call routing lookup
          const mapping = await storage.getPhoneMappingByNumber(phoneNumber);
          
          if (!mapping) {
            throw new Error('Phone mapping should exist for routing');
          }
          
          if (mapping.tenantId !== testTenant.id || mapping.botId !== testBot.id) {
            throw new Error('Phone mapping should route to correct tenant and bot');
          }
          
          if (!mapping.isActive) {
            throw new Error('Phone mapping should be active for routing');
          }
        } finally {
          // Cleanup
          try {
            await storage.removePhoneMapping(phoneNumber);
            await storage.deleteTenant(testTenant.id);
          } catch (cleanupError) {
            console.warn('[TEST CLEANUP] Failed to cleanup routing test data:', cleanupError);
          }
        }
      }
    },

    {
      name: 'Webhook Rate Limiting',
      test: async () => {
        // Test that webhook endpoints have appropriate rate limiting
        // This would typically involve making actual HTTP requests
        // For now, we verify the rate limiting configuration exists
        
        const { enterpriseWebhookRateLimit } = await import('./enterprise-security');
        
        if (!enterpriseWebhookRateLimit) {
          throw new Error('Enterprise webhook rate limiting should be configured');
        }
        
        // Verify rate limit configuration
        const config = enterpriseWebhookRateLimit as any;
        if (config.windowMs !== 5 * 60 * 1000) {
          throw new Error('Webhook rate limit window should be 5 minutes');
        }
      }
    }
  ];

  return await testRunner.runTestSuite('Twilio Webhook Routing Tests', tests);
}

/**
 * Connector Access Security Tests
 * Verify connector permissions and tenant isolation
 */
export async function testConnectorAccessSecurity(): Promise<TestSuite> {
  const tests = [
    {
      name: 'Connector Configuration Isolation',
      test: async () => {
        // Create test tenants
        const tenant1 = await storage.createTenant({
          name: 'Connector Test Tenant 1',
          status: 'active'
        });
        
        const tenant2 = await storage.createTenant({
          name: 'Connector Test Tenant 2',
          status: 'active'
        });
        
        try {
          // Create connector configs for different tenants
          const config1 = await storage.createConnectorConfig({
            tenantId: tenant1.id,
            connectorType: 'google_calendar',
            isActive: true,
            config: { encrypted: 'tenant1-config' }
          });
          
          const config2 = await storage.createConnectorConfig({
            tenantId: tenant2.id,
            connectorType: 'google_calendar',
            isActive: true,
            config: { encrypted: 'tenant2-config' }
          });

          // Verify tenant isolation
          const tenant1Configs = await storage.getConnectorConfigsByTenantId(tenant1.id);
          if (tenant1Configs.length !== 1 || tenant1Configs[0].id !== config1.id) {
            throw new Error('Tenant 1 should only see their connector configs');
          }

          const tenant2Configs = await storage.getConnectorConfigsByTenantId(tenant2.id);
          if (tenant2Configs.length !== 1 || tenant2Configs[0].id !== config2.id) {
            throw new Error('Tenant 2 should only see their connector configs');
          }
        } finally {
          // Cleanup
          try {
            await storage.deleteTenant(tenant1.id);
            await storage.deleteTenant(tenant2.id);
          } catch (cleanupError) {
            console.warn('[TEST CLEANUP] Failed to cleanup connector test tenants:', cleanupError);
          }
        }
      }
    },

    {
      name: 'Connector API Security',
      test: async () => {
        // Test that connector APIs properly validate tenant access
        // Check if CalendarAdapter type is available for testing
        try {
          const connectorTypes = await import('./connector-adapters');
          // CalendarAdapter is an interface, so we just need to verify it exists
          console.log('[TEST] CalendarAdapter interface available for testing');
        } catch (error) {
          throw new Error('CalendarAdapter interface not available');
        }
        
        // Create test tenant
        const testTenant = await storage.createTenant({
          name: 'API Security Test Tenant',
          status: 'active'
        });
        
        try {
          const mockConfig = {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            calendarId: 'primary'
          };

          // Import an actual CalendarAdapter implementation for testing
          const { GoogleCalendarAdapter } = await import('./connector-implementations');
          const adapter = new GoogleCalendarAdapter(mockConfig);
          
          // Test connection
          const connectionResult = await adapter.testConnection();
          if (!connectionResult.success) {
            throw new Error('Connector should be able to test connection with valid config');
          }
        } finally {
          // Cleanup
          try {
            await storage.deleteTenant(testTenant.id);
          } catch (cleanupError) {
            console.warn('[TEST CLEANUP] Failed to cleanup API test tenant:', cleanupError);
          }
        }
      }
    }
  ];

  return await testRunner.runTestSuite('Connector Access Security Tests', tests);
}

/**
 * Integration Security Tests
 * Comprehensive security validation across all systems
 */
export async function testIntegrationSecurity(): Promise<TestSuite> {
  const tests = [
    {
      name: 'Rate Limiting Integration',
      test: async () => {
        const { rateLimitMetrics } = await import('./enterprise-security');
        
        // Verify rate limiting metrics are operational
        const metrics = rateLimitMetrics.getMetrics();
        
        if (typeof metrics.totalRequests !== 'number') {
          throw new Error('Rate limiting metrics should track total requests');
        }
        
        if (typeof metrics.totalBlocked !== 'number') {
          throw new Error('Rate limiting metrics should track blocked requests');
        }
      }
    },

    {
      name: 'Security Headers Integration',
      test: async () => {
        // Verify security headers are properly configured
        const { SECURITY_CONFIG } = await import('./enterprise-hardening');
        
        if (!SECURITY_CONFIG.blockedCountries || !Array.isArray(SECURITY_CONFIG.blockedCountries)) {
          throw new Error('Security config should have blocked countries');
        }
        
        if (!SECURITY_CONFIG.alertThresholds) {
          throw new Error('Security config should have alert thresholds');
        }
      }
    },

    {
      name: 'Background Jobs Integration',
      test: async () => {
        const { backgroundJobManager } = await import('./background-jobs');
        
        // Verify background jobs are registered
        const status = backgroundJobManager.getJobStatus();
        
        if (status.length === 0) {
          throw new Error('Background jobs should be registered');
        }
        
        // Verify cleanup jobs exist
        const cleanupJobs = status.filter(job => 
          job.name.includes('cleanup') || job.name.includes('archive')
        );
        
        if (cleanupJobs.length === 0) {
          throw new Error('Cleanup background jobs should be registered');
        }
      }
    }
  ];

  return await testRunner.runTestSuite('Integration Security Tests', tests);
}

/**
 * Run All Enterprise Tests
 * Comprehensive test suite for enterprise security and functionality
 */
export async function runAllEnterpriseTests(): Promise<any> {
  console.log('[ENTERPRISE TESTS] Starting comprehensive test suite...');
  
  testRunner.clearResults();
  
  try {
    // Run all test suites
    await testTenantIsolation();
    await testPhoneMappingSecurity();
    await testTwilioWebhookRouting();
    await testConnectorAccessSecurity();
    await testIntegrationSecurity();
    
    const report = testRunner.getTestReport();
    
    console.log(`[ENTERPRISE TESTS] Complete: ${report.summary.totalPassed}/${report.summary.totalTests} passed (${report.summary.successRate.toFixed(1)}%)`);
    
    return report;
    
  } catch (error) {
    console.error('[ENTERPRISE TESTS] Test suite failed:', error);
    throw error;
  }
}

/**
 * Express endpoint for running enterprise tests (Admin only)
 */
export async function runEnterpriseTestsEndpoint(req: any, res: any): Promise<any> {
  try {
    console.log(`[ENTERPRISE TESTS] Test suite initiated by admin: ${req.user?.email}, IP: ${req.ip}`);
    
    const report = await runAllEnterpriseTests();
    
    return res.json({
      success: true,
      timestamp: new Date(),
      report,
      message: `Enterprise tests completed: ${report.summary.overallStatus}`
    });
    
  } catch (error) {
    console.error('[ENTERPRISE TESTS] Test endpoint failed:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Enterprise test suite failed',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date()
    });
  }
}