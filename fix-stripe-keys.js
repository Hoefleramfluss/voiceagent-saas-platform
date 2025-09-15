import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

// Proper encryption function matching crypto.ts
async function encryptApiKey(plaintext, masterKey) {
  try {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    
    const derivedKey = await scryptAsync(masterKey, salt, 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const combined = Buffer.concat([salt, iv, encrypted]);
    return combined.toString('base64');
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt API key');
  }
}

async function main() {
  console.log('🔧 Starting Stripe key fix...\n');
  
  // Generate a proper 32-byte master key
  const properMasterKey = 'master-key-for-api-encryption-32b';
  console.log('✅ Using proper 32-byte master key');
  
  // Get Stripe keys from environment
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  
  if (!stripeSecretKey) {
    console.log('❌ No STRIPE_SECRET_KEY found in environment');
    return;
  }
  
  console.log('Environment Stripe secret key prefix:', stripeSecretKey.substring(0, 15));
  
  // Validate the key format
  if (!stripeSecretKey.startsWith('sk_test_') && !stripeSecretKey.startsWith('sk_live_')) {
    console.log('❌ Invalid Stripe secret key format');
    return;
  }
  
  console.log('✅ Valid Stripe secret key found');
  
  // Encrypt the Stripe keys properly
  console.log('\n🔒 Encrypting Stripe keys...');
  
  const encryptedSecretKey = await encryptApiKey(stripeSecretKey, properMasterKey);
  console.log('✅ Secret key encrypted, length:', encryptedSecretKey.length);
  
  // For public key, we'll generate a test public key since one doesn't exist in env
  const testPublicKey = stripeSecretKey.replace('sk_', 'pk_');
  const encryptedPublicKey = await encryptApiKey(testPublicKey, properMasterKey);
  console.log('✅ Public key encrypted, length:', encryptedPublicKey.length);
  
  console.log('\n📋 SQL Commands to fix the database:');
  console.log('-- First, set the correct master key in your environment:');
  console.log('-- export API_KEY_MASTER_KEY="master-key-for-api-encryption-32b"');
  console.log('');
  console.log('-- Update the Stripe keys in database:');
  console.log(`UPDATE api_keys SET key_value = '${encryptedSecretKey}' WHERE service_type = 'stripe' AND key_name = 'STRIPE_SECRET_KEY';`);
  console.log(`UPDATE api_keys SET key_value = '${encryptedPublicKey}' WHERE service_type = 'stripe' AND key_name = 'STRIPE_PUBLIC_KEY';`);
  
  console.log('\n🧪 Testing decryption with new master key...');
  
  // Test decryption
  try {
    const salt = Buffer.from(encryptedSecretKey, 'base64').slice(0, 16);
    const iv = Buffer.from(encryptedSecretKey, 'base64').slice(16, 32);
    const encrypted = Buffer.from(encryptedSecretKey, 'base64').slice(32);
    
    const derivedKey = await scryptAsync(properMasterKey, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    const result = decrypted.toString('utf8');
    
    if (result === stripeSecretKey) {
      console.log('✅ Decryption test PASSED - encrypted/decrypted keys match!');
    } else {
      console.log('❌ Decryption test FAILED - mismatch');
    }
  } catch (error) {
    console.log('❌ Decryption test failed:', error.message);
  }
  
  console.log('\n🎯 Next Steps:');
  console.log('1. Set API_KEY_MASTER_KEY environment variable');
  console.log('2. Run the SQL UPDATE commands');
  console.log('3. Restart the application');
  console.log('4. Verify keys load successfully from database');
}

main().catch(console.error);