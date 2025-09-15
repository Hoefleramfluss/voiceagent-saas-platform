#!/usr/bin/env tsx

/**
 * Debug script to understand libphonenumber-js behavior
 */

import { parsePhoneNumber, isValidPhoneNumber, getCountries, CountryCode } from 'libphonenumber-js';

console.log('🔍 Debugging libphonenumber-js validation behavior...\n');

// Test cases with valid phone numbers
const testNumbers = [
  '+15551234567', // US test number (555 is test range)  
  '+12125551234', // Valid NYC test number
  '+447700900123', // UK test number
  '+4367712345678', // Austrian mobile (working)
  '+4915112345678', // German mobile (working)
  '+14155552001', // Valid SF test number
  '4155552001' // 10-digit SF test
];

console.log('📞 Testing individual number validation:\n');

for (const number of testNumbers) {
  console.log(`Testing: ${number}`);
  
  try {
    // Test basic validation
    const isValid = isValidPhoneNumber(number);
    console.log(`  isValidPhoneNumber: ${isValid}`);
    
    // Test parsing
    try {
      const parsed = parsePhoneNumber(number);
      console.log(`  parsePhoneNumber: ${parsed?.number} (country: ${parsed?.country}, type: ${parsed?.getType()})`);
    } catch (parseError) {
      console.log(`  parsePhoneNumber: ERROR - ${parseError}`);
    }
    
    // Test with US default for local numbers
    if (!number.startsWith('+')) {
      try {
        const parsedUS = parsePhoneNumber(number, 'US');
        console.log(`  parsePhoneNumber(US): ${parsedUS?.number} (country: ${parsedUS?.country}, type: ${parsedUS?.getType()})`);
        console.log(`  isValidPhoneNumber(US): ${isValidPhoneNumber(number, 'US')}`);
      } catch (parseError) {
        console.log(`  parsePhoneNumber(US): ERROR - ${parseError}`);
      }
    }
    
  } catch (error) {
    console.log(`  ERROR: ${error}`);
  }
  
  console.log('');
}

console.log('🌍 Available countries:');
const countries = getCountries();
console.log(`Total countries supported: ${countries.length}`);
console.log('US supported:', countries.includes('US'));
console.log('GB supported:', countries.includes('GB'));
console.log('AT supported:', countries.includes('AT'));
console.log('DE supported:', countries.includes('DE'));

console.log('\n🧪 Testing valid alternatives:');

// Try some definitely valid numbers
const knownValidNumbers = [
  '+12125551234', // Valid NYC test number
  '+14155552001', // Valid SF test number
  '+4367712345678', // Austrian mobile
  '+447700900123', // UK test range
];

for (const number of knownValidNumbers) {
  const isValid = isValidPhoneNumber(number);
  console.log(`${number}: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
}