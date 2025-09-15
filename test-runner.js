#!/usr/bin/env node

// Simple test runner for enterprise tests
import { runAllEnterpriseTests } from './server/enterprise-tests.ts';

async function runTests() {
  console.log('🔄 Starting Enterprise Test Suite...');
  console.log('='.repeat(60));
  
  try {
    const report = await runAllEnterpriseTests();
    
    console.log('\n📊 ENTERPRISE TEST RESULTS');
    console.log('='.repeat(60));
    
    // Display summary
    const { summary } = report;
    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`Passed: ${summary.totalPassed}`);
    console.log(`Failed: ${summary.totalFailed}`);
    console.log(`Success Rate: ${summary.successRate.toFixed(1)}%`);
    console.log(`Duration: ${summary.totalDuration}ms`);
    console.log(`Overall Status: ${summary.overallStatus}`);
    
    // Display detailed results by suite
    console.log('\n📋 DETAILED RESULTS BY SUITE');
    console.log('='.repeat(60));
    
    report.suites.forEach(suite => {
      console.log(`\n${suite.suiteName}: ${suite.passedTests}/${suite.totalTests} passed`);
      
      suite.results.forEach(result => {
        const status = result.status === 'PASS' ? '✅' : '❌';
        console.log(`  ${status} ${result.testName} (${result.duration}ms)`);
        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
      });
    });
    
    // Check if we achieved our target
    if (summary.successRate >= 90.0) {
      console.log('\n🎉 SUCCESS: Achieved 90%+ test success rate for production deployment!');
      process.exit(0);
    } else {
      console.log(`\n⚠️  NEEDS IMPROVEMENT: Success rate is ${summary.successRate.toFixed(1)}%, target is 90%+`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ ENTERPRISE TESTS FAILED');
    console.error(error);
    process.exit(1);
  }
}

// Run tests if this script is executed directly
runTests();