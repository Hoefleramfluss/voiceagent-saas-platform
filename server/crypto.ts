import { randomBytes, scrypt, createCipheriv, createDecipheriv, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// Get master key from environment variable or generate a default one
const getMasterKey = (): string => {
  const masterKey = process.env.API_KEY_MASTER_KEY;
  if (!masterKey) {
    console.warn('WARNING: API_KEY_MASTER_KEY not set in environment variables. Using default key for development only.');
    // Default key for development - should never be used in production
    return 'dev-master-key-change-in-production-must-be-32-chars';
  }
  return masterKey;
};

export async function encryptApiKey(plaintext: string): Promise<string> {
  try {
    // Generate random salt and IV
    const salt = randomBytes(16);
    const iv = randomBytes(16);
    
    // Derive 32-byte key using scrypt
    const masterKey = getMasterKey();
    const derivedKey = await scryptAsync(masterKey, salt, 32) as Buffer;
    
    // Create cipher using AES-256-CBC
    const cipher = createCipheriv('aes-256-cbc', derivedKey, iv);
    
    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Combine salt + iv + encrypted data
    const combined = Buffer.concat([salt, iv, encrypted]);
    
    return combined.toString('base64');
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt API key');
  }
}

export async function decryptApiKey(ciphertext: string): Promise<string> {
  try {
    const combined = Buffer.from(ciphertext, 'base64');
    
    // Extract components
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 32);
    const encrypted = combined.slice(32);
    
    // Derive key using scrypt
    const masterKey = getMasterKey();
    const derivedKey = await scryptAsync(masterKey, salt, 32) as Buffer;
    
    // Create decipher
    const decipher = createDecipheriv('aes-256-cbc', derivedKey, iv);
    
    // Decrypt
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    // Log minimal info for decryption failures - avoid stack traces for expected issues
    if (error instanceof Error) {
      console.warn('Decryption failed:', error.message);
    } else {
      console.warn('Decryption failed: Unknown error');
    }
    throw new Error('Failed to decrypt API key - data may be corrupted or tampered with');
  }
}

export function maskApiKey(value: string): string {
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  return '*'.repeat(value.length - 4) + value.slice(-4);
}