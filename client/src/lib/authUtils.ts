export function isUnauthorizedError(error: Error): boolean {
  // Check for status property if available
  if ((error as any).status === 401) {
    return true;
  }
  
  // Check message for various 401 patterns
  return /(^401\b)|\bUnauthorized\b/i.test(error.message);
}