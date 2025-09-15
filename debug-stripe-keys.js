// Debug script for Stripe key decryption issues
import crypto from 'crypto';
import { promisify } from 'util';

// Simulate the decryption logic from crypto.ts
async function testDecryption(ciphertext, masterKey) {
  try {
    console.log('🔍 Testing decryption...');
    console.log('Ciphertext length:', ciphertext.length);
    console.log('Ciphertext prefix:', ciphertext.substring(0, 20));
    
    // Try to parse as Base64
    let combined;
    try {
      combined = Buffer.from(ciphertext, 'base64');
      console.log('✅ Successfully parsed as Base64, length:', combined.length);
    } catch (e) {
      console.log('❌ Failed to parse as Base64:', e.message);
      return false;
    }
    
    // Check if we have enough bytes for salt (16) + iv (16) + data
    if (combined.length < 32) {
      console.log('❌ Combined buffer too short, expected at least 32 bytes, got:', combined.length);
      return false;
    }
    
    // Extract components
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 32);
    const encrypted = combined.slice(32);
    
    console.log('Salt length:', salt.length);
    console.log('IV length:', iv.length);
    console.log('Encrypted data length:', encrypted.length);
    
    // Test key derivation
    const scrypt = promisify(crypto.scrypt);
    const derivedKey = await scrypt(masterKey, salt, 32);
    console.log('✅ Key derivation successful');
    
    // Test decryption
    const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    const result = decrypted.toString('utf8');
    console.log('✅ Decryption successful!');
    console.log('Decrypted result preview:', result.substring(0, 20) + '...');
    return result;
    
  } catch (error) {
    console.log('❌ Decryption failed:', error.message);
    console.log('Error type:', error.constructor.name);
    return false;
  }
}

// Test encryption to verify our setup works
async function testEncryption(plaintext, masterKey) {
  try {
    console.log('\n🔒 Testing encryption...');
    
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    
    const scrypt = promisify(crypto.scrypt);
    const derivedKey = await scrypt(masterKey, salt, 32);
    
    const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const combined = Buffer.concat([salt, iv, encrypted]);
    const result = combined.toString('base64');
    
    console.log('✅ Encryption successful!');
    console.log('Encrypted length:', result.length);
    console.log('Encrypted preview:', result.substring(0, 40) + '...');
    
    return result;
  } catch (error) {
    console.log('❌ Encryption failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting Stripe key debugging...\n');
  
  const masterKey = process.env.API_KEY_MASTER_KEY || 'dev-master-key-change-in-production-must-be-32-chars';
  console.log('Master key length:', masterKey.length);
  console.log('Master key preview:', masterKey.substring(0, 10) + '...');
  
  // Test values from database
  const storedPublicKey = 'sk_test_51S7HPOGnOdlvgsIEHgmqBIshpehEYiuqR3sApNn8pyWV3KAFU8cCpJhY8ghAxXwcoMmEzwajfr3RmIHBmJL2ucwP00w08MEFff';
  const storedSecretKey = 'rk_test_51S7HPOGnOdlvgsIE67FEu5t5HpnfVHGcnqJzkoNLZUQQr0SdPYd3MWhmH6gOR6j4GrtBMRRdJncTsCpdSZ7ptsJF00MfHfe4Mq';
  
  console.log('\n📊 Database Analysis:');
  console.log('STRIPE_PUBLIC_KEY stored value prefix:', storedPublicKey.substring(0, 15));
  console.log('STRIPE_SECRET_KEY stored value prefix:', storedSecretKey.substring(0, 15));
  
  // These look like raw Stripe keys, not encrypted Base64!
  if (storedPublicKey.startsWith('sk_test_') || storedSecretKey.startsWith('rk_test_')) {
    console.log('\n❌ CRITICAL ISSUE: Keys appear to be stored as raw values, not encrypted!');
    console.log('Expected: Base64 encoded encrypted data');
    console.log('Actual: Raw Stripe key format');
    
    // Test if they're actually meant to be Base64
    console.log('\n🔍 Testing if stored values are actually Base64...');
    await testDecryption(storedPublicKey, masterKey);
    await testDecryption(storedSecretKey, masterKey);
  }
  
  // Test encryption/decryption cycle with a sample key
  console.log('\n🧪 Testing encryption/decryption cycle with sample data...');
  const testKey = 'sk_test_sample_key_for_testing_123456789';
  const encrypted = await testEncryption(testKey, masterKey);
  
  if (encrypted) {
    console.log('\n🔄 Testing decryption of newly encrypted data...');
    const decrypted = await testDecryption(encrypted, masterKey);
    
    if (decrypted === testKey) {
      console.log('✅ Encryption/decryption cycle works perfectly!');
    } else {
      console.log('❌ Encryption/decryption mismatch');
    }
  }
  
  console.log('\n📋 DIAGNOSIS COMPLETE');
}

main().catch(console.error);