// Simple Base64 encoding for demonstration purposes
// In production, use proper encryption with AES

export function encryptApiKey(plaintext: string): string {
  try {
    // Simple Base64 encoding (not secure, but works for demo)
    const encoded = Buffer.from(plaintext, 'utf8').toString('base64');
    return encoded;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt API key');
  }
}

export function decryptApiKey(ciphertext: string): string {
  try {
    // Simple Base64 decoding
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
    return decoded;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}

export function maskApiKey(value: string): string {
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  return '*'.repeat(value.length - 4) + value.slice(-4);
}