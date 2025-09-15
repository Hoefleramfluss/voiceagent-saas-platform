import { randomBytes, scrypt, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

/**
 * Tenant-scoped encryption/decryption for secure storage of OAuth tokens
 * and other sensitive tenant data. Each tenant gets isolated encryption keys.
 */

// Get master key from environment variable or generate a default one
const getMasterKey = (): string => {
  const masterKey = process.env.TENANT_SECRETS_MASTER_KEY || process.env.API_KEY_MASTER_KEY;
  if (!masterKey) {
    console.warn('WARNING: TENANT_SECRETS_MASTER_KEY not set in environment variables. Using default key for development only.');
    // Default key for development - should never be used in production
    return 'dev-tenant-secrets-master-key-change-in-production';
  }
  return masterKey;
};

/**
 * Derive tenant-specific encryption key using HMAC-based key derivation
 */
async function deriveTenantKey(tenantId: string, salt: Buffer): Promise<Buffer> {
  const masterKey = getMasterKey();
  
  // Create tenant-specific key material using HMAC
  const hmac = createHmac('sha256', masterKey);
  hmac.update(`tenant:${tenantId}`);
  const tenantKeyMaterial = hmac.digest();
  
  // Derive final key using scrypt with tenant-specific salt
  const derivedKey = await scryptAsync(tenantKeyMaterial, salt, 32) as Buffer;
  return derivedKey;
}

/**
 * Encrypt data with tenant-scoped key
 */
export async function encrypt(plaintext: string, tenantId?: string): Promise<string> {
  try {
    // Use default tenant if not provided (backward compatibility)
    const scopedTenantId = tenantId || 'default';
    
    // Generate random salt and IV
    const salt = randomBytes(16);
    const iv = randomBytes(16);
    
    // Derive tenant-specific key
    const derivedKey = await deriveTenantKey(scopedTenantId, salt);
    
    // Create cipher using AES-256-CBC
    const cipher = createCipheriv('aes-256-cbc', derivedKey, iv);
    
    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Combine salt + iv + encrypted data + tenant ID hash (for validation)
    const tenantHash = createHmac('sha256', getMasterKey())
      .update(`tenant:${scopedTenantId}`)
      .digest()
      .slice(0, 8); // First 8 bytes as tenant identifier
    
    const combined = Buffer.concat([salt, iv, tenantHash, encrypted]);
    
    return combined.toString('base64');
  } catch (error) {
    console.error('Tenant encryption error:', error);
    throw new Error('Failed to encrypt sensitive data');
  }
}

/**
 * Decrypt data with tenant-scoped key
 */
export async function decrypt(ciphertext: string, tenantId?: string): Promise<string> {
  try {
    // Use default tenant if not provided (backward compatibility)
    const scopedTenantId = tenantId || 'default';
    
    const combined = Buffer.from(ciphertext, 'base64');
    
    if (combined.length < 48) { // salt(16) + iv(16) + tenantHash(8) + min_encrypted(8)
      throw new Error('Invalid ciphertext format - too short');
    }
    
    // Extract components
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 32);
    const storedTenantHash = combined.slice(32, 40);
    const encrypted = combined.slice(40);
    
    // Verify tenant context to prevent cross-tenant decryption
    const expectedTenantHash = createHmac('sha256', getMasterKey())
      .update(`tenant:${scopedTenantId}`)
      .digest()
      .slice(0, 8);
    
    if (!timingSafeEqual(storedTenantHash, expectedTenantHash)) {
      throw new Error('Tenant context mismatch - possible cross-tenant access attempt');
    }
    
    // Derive key using same tenant-specific process
    const derivedKey = await deriveTenantKey(scopedTenantId, salt);
    
    // Create decipher
    const decipher = createDecipheriv('aes-256-cbc', derivedKey, iv);
    
    // Decrypt
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Tenant decryption error:', error);
    throw new Error('Failed to decrypt sensitive data - data may be corrupted, tampered with, or accessed with wrong tenant context');
  }
}

/**
 * Generate cryptographically secure nonce for OAuth state validation
 */
export function generateSecureNonce(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate HMAC-signed state parameter for OAuth CSRF protection
 */
export function generateOAuthState(tenantId: string, provider: string, nonce: string): string {
  const stateData = `${provider}:${tenantId}:${nonce}:${Date.now()}`;
  const hmac = createHmac('sha256', getMasterKey());
  hmac.update(stateData);
  const signature = hmac.digest('base64url');
  
  return `${stateData}:${signature}`;
}

/**
 * Validate and parse OAuth state parameter
 */
export function validateOAuthState(state: string): { 
  provider: string; 
  tenantId: string; 
  nonce: string; 
  timestamp: number;
  valid: boolean; 
} {
  try {
    const parts = state.split(':');
    if (parts.length !== 5) {
      return { provider: '', tenantId: '', nonce: '', timestamp: 0, valid: false };
    }
    
    const [provider, tenantId, nonce, timestampStr, signature] = parts;
    const timestamp = parseInt(timestampStr);
    
    // Recreate expected signature
    const stateData = `${provider}:${tenantId}:${nonce}:${timestamp}`;
    const hmac = createHmac('sha256', getMasterKey());
    hmac.update(stateData);
    const expectedSignature = hmac.digest('base64url');
    
    // Verify signature using timing-safe comparison
    const providedSigBuffer = Buffer.from(signature, 'base64url');
    const expectedSigBuffer = Buffer.from(expectedSignature, 'base64url');
    
    if (!timingSafeEqual(providedSigBuffer, expectedSigBuffer)) {
      return { provider, tenantId, nonce, timestamp, valid: false };
    }
    
    // Check timestamp (valid for 1 hour)
    const maxAge = 60 * 60 * 1000; // 1 hour
    const isValidTimestamp = (Date.now() - timestamp) < maxAge;
    
    return { 
      provider, 
      tenantId, 
      nonce, 
      timestamp, 
      valid: isValidTimestamp 
    };
  } catch (error) {
    console.error('OAuth state validation error:', error);
    return { provider: '', tenantId: '', nonce: '', timestamp: 0, valid: false };
  }
}

/**
 * Mask sensitive data for logging (similar to API key masking)
 */
export function maskToken(token: string): string {
  if (token.length <= 8) {
    return '*'.repeat(token.length);
  }
  return '*'.repeat(token.length - 8) + token.slice(-8);
}