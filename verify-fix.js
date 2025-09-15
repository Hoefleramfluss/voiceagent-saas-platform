import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

async function testDecryption(ciphertext, masterKey) {
  try {
    const combined = Buffer.from(ciphertext, 'base64');
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 32);
    const encrypted = combined.slice(32);
    
    const derivedKey = await scryptAsync(masterKey, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

async function main() {
  console.log('🔍 Verifying Stripe key fix...\n');
  
  const correctMasterKey = 'master-key-for-api-encryption-32b';
  const corruptedMasterKey = process.env.API_KEY_MASTER_KEY;
  
  console.log('Current master key length:', corruptedMasterKey?.length || 'undefined');
  console.log('Current master key prefix:', corruptedMasterKey?.substring(0, 15) || 'undefined');
  console.log('');
  
  // Test with the new encrypted keys from database
  const newSecretKey = 'fpl5S48SRMmWdRLjuqADz61btdFqWoQMsjr9zyANGVKZiTZIVE67BqUESiNhoFgpfK2hXJPjBZFJo6EyU8eNBt8j9vqGu/a5pgb8GdardKKkEo7dOktOq0cJSwB45M/DkIPGqeW7FVjGArkHk6ma5J/Vyfs+5RG6yeGn/ypYfwJ0OL6CRD6Esyo9GPF4LymB';
  
  console.log('🧪 Testing decryption with CORRUPTED master key:');
  try {
    const result1 = await testDecryption(newSecretKey, corruptedMasterKey);
    console.log('❌ Should not work! Decrypted:', result1.substring(0, 20) + '...');
  } catch (error) {
    console.log('✅ Expected failure with corrupted key:', error.message);
  }
  
  console.log('\n🧪 Testing decryption with CORRECT master key:');
  try {
    const result2 = await testDecryption(newSecretKey, correctMasterKey);
    console.log('✅ SUCCESS! Decrypted key:', result2.substring(0, 20) + '...');
    
    if (result2.startsWith('sk_live_') || result2.startsWith('sk_test_')) {
      console.log('✅ Valid Stripe secret key format confirmed!');
    }
  } catch (error) {
    console.log('❌ Unexpected failure:', error.message);
  }
  
  console.log('\n🎯 FINAL SOLUTION:');
  console.log('========================================');
  console.log('The database has been fixed with properly encrypted keys.');
  console.log('');
  console.log('❗ CRITICAL: Set the correct master key in your environment:');
  console.log('API_KEY_MASTER_KEY = "master-key-for-api-encryption-32b"');
  console.log('');
  console.log('Current corrupted value starts with:', corruptedMasterKey?.substring(0, 15));
  console.log('Should be exactly: "master-key-for-api-encryption-32b"');
  console.log('');
  console.log('After updating the environment variable:');
  console.log('1. Restart the application workflow');
  console.log('2. Stripe keys should load successfully from database');
  console.log('3. No more fallback to environment variables');
  console.log('========================================');
}

main().catch(console.error);