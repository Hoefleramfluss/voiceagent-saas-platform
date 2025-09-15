#!/usr/bin/env tsx

/**
 * Comprehensive Phone Validation Test
 * Tests the fixed phone validation logic across all scenarios
 */

import { 
  normalizePhoneNumber, 
  validatePhoneNumber, 
  validateDemoPhoneNumber,
  checkPhoneSecurityViolations 
} from './phone-security-utils';

interface TestCase {
  input: string;
  expected?: string;
  shouldPass: boolean;
  description: string;
  options?: { allowTestNumbers?: boolean; strictMode?: boolean };
}

interface TestResult {
  passed: number;
  failed: number;
  total: number;
  successRate: number;
  details: Array<{ test: string; status: 'PASS' | 'FAIL'; error?: string }>;
}

async function runPhoneValidationTests(): Promise<TestResult> {
  console.log('🧪 Running Comprehensive Phone Validation Tests...\n');
  
  const testCases: TestCase[] = [
    // US Numbers (using actually valid numbers)
    { 
      input: '+14155552001', 
      expected: '+14155552001', 
      shouldPass: true, 
      description: 'US valid number (San Francisco)',
      options: { allowTestNumbers: false }
    },
    { 
      input: '4155552001', 
      expected: '+14155552001', 
      shouldPass: true, 
      description: 'US valid number (10-digit)',
      options: { allowTestNumbers: false }
    },
    { 
      input: '(415) 555-2001', 
      expected: '+14155552001', 
      shouldPass: true, 
      description: 'US valid number (formatted)',
      options: { allowTestNumbers: false }
    },
    {
      input: '+14155552002',
      expected: '+14155552002',
      shouldPass: true,
      description: 'US valid number (another SF)',
      options: { allowTestNumbers: false }
    },
    // Test 555 numbers should fail when allowTestNumbers is false
    {
      input: '+15551234567',
      shouldPass: false,
      description: 'US 555 number (should be invalid)',
      options: { allowTestNumbers: false }
    },
    
    // Austrian Numbers (using valid prefix)
    { 
      input: '+4367612345678', 
      expected: '+4367612345678', 
      shouldPass: true, 
      description: 'Austrian mobile number',
      options: { allowTestNumbers: false }
    },
    { 
      input: '0676 12345678', 
      expected: '+4367612345678', 
      shouldPass: true, 
      description: 'Austrian local format',
      options: { allowTestNumbers: false }
    },
    
    // German Numbers
    { 
      input: '+4915112345678', 
      expected: '+4915112345678', 
      shouldPass: true, 
      description: 'German mobile number',
      options: { allowTestNumbers: false }
    },
    
    // UK Numbers (using valid UK mobile)
    { 
      input: '+447123456789', 
      expected: '+447123456789', 
      shouldPass: true, 
      description: 'UK mobile number',
      options: { allowTestNumbers: false }
    },
    
    // Invalid Numbers
    { 
      input: 'invalid', 
      shouldPass: false, 
      description: 'Invalid text input',
      options: { allowTestNumbers: true }
    },
    { 
      input: '+123', 
      shouldPass: false, 
      description: 'Too short number',
      options: { allowTestNumbers: true }
    },
    { 
      input: '+1234567890123456789', 
      shouldPass: false, 
      description: 'Too long number',
      options: { allowTestNumbers: true }
    },
    
    // Test validation with different strictness levels
    { 
      input: '+14155552003', 
      shouldPass: true, 
      description: 'Valid US number in strict mode',
      options: { allowTestNumbers: false, strictMode: true }
    }
  ];
  
  const results: TestResult = {
    passed: 0,
    failed: 0,
    total: testCases.length,
    successRate: 0,
    details: []
  };
  
  console.log('📞 Testing Phone Number Validation...\n');
  
  for (const testCase of testCases) {
    try {
      console.log(`Testing: ${testCase.description}`);
      console.log(`  Input: ${testCase.input}`);
      
      // Test normalization if expected value is provided
      if (testCase.expected) {
        try {
          // Use appropriate default country based on test case
          let defaultCountry = 'US';
          if (testCase.input.includes('0676') || testCase.description.includes('Austrian')) {
            defaultCountry = 'AT';
          } else if (testCase.input.includes('+44') || testCase.description.includes('UK')) {
            defaultCountry = 'GB'; 
          } else if (testCase.input.includes('+49') || testCase.description.includes('German')) {
            defaultCountry = 'DE';
          }
          
          const normalized = normalizePhoneNumber(testCase.input, defaultCountry);
          if (normalized === testCase.expected) {
            console.log(`  ✅ Normalization: ${testCase.input} → ${normalized}`);
          } else {
            console.log(`  ❌ Normalization: ${testCase.input} → ${normalized} (expected ${testCase.expected})`);
            if (testCase.shouldPass) {
              results.failed++;
              results.details.push({ 
                test: testCase.description + ' (normalization)', 
                status: 'FAIL', 
                error: `Got ${normalized}, expected ${testCase.expected}` 
              });
              continue;
            }
          }
        } catch (error) {
          console.log(`  ❌ Normalization failed: ${(error as Error).message}`);
          if (testCase.shouldPass) {
            results.failed++;
            results.details.push({ 
              test: testCase.description + ' (normalization)', 
              status: 'FAIL', 
              error: (error as Error).message 
            });
            continue;
          }
        }
      }
      
      // Test validation
      const validationResult = validatePhoneNumber(testCase.input, testCase.options);
      
      if (validationResult.isValid === testCase.shouldPass) {
        console.log(`  ✅ Validation: ${validationResult.isValid ? 'VALID' : 'INVALID'}`);
        results.passed++;
        results.details.push({ test: testCase.description, status: 'PASS' });
      } else {
        console.log(`  ❌ Validation: Expected ${testCase.shouldPass ? 'VALID' : 'INVALID'}, got ${validationResult.isValid ? 'VALID' : 'INVALID'}`);
        if (validationResult.error) {
          console.log(`     Error: ${validationResult.error}`);
        }
        results.failed++;
        results.details.push({ 
          test: testCase.description, 
          status: 'FAIL', 
          error: validationResult.error || 'Validation mismatch' 
        });
      }
      
    } catch (error) {
      console.log(`  ❌ Test error: ${(error as Error).message}`);
      results.failed++;
      results.details.push({ 
        test: testCase.description, 
        status: 'FAIL', 
        error: (error as Error).message 
      });
    }
    
    console.log(''); // Empty line for readability
  }
  
  results.successRate = (results.passed / results.total) * 100;
  
  console.log('🎯 COMPREHENSIVE TEST RESULTS:');
  console.log('===============================');
  console.log(`Total Tests: ${results.total}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Success Rate: ${results.successRate.toFixed(1)}%`);
  console.log(`Target (95%): ${results.successRate >= 95 ? '✅ MET' : '❌ NOT MET'}`);
  
  if (results.failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.details.filter(d => d.status === 'FAIL').forEach(detail => {
      console.log(`  - ${detail.test}: ${detail.error}`);
    });
  }
  
  return results;
}

// Run the tests
runPhoneValidationTests().catch(console.error);