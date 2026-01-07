/**
 * Cryptographic utilities for secure operations
 *
 * US-139: Timing-safe comparison functions to prevent timing attacks
 * US-140: Cryptographically secure random ID generation
 */

import { timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Constant-time string comparison to prevent timing attacks
 *
 * Uses crypto.timingSafeEqual() which always compares all bytes regardless
 * of where the first mismatch occurs. This prevents attackers from measuring
 * response time to deduce the correct value byte-by-byte.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 *
 * @example
 * ```ts
 * // Safe comparison for bearer tokens
 * if (timingSafeStringEqual(providedToken, expectedToken)) {
 *   // Token is valid
 * }
 * ```
 */
export function timingSafeStringEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  // Handle null/undefined cases - timing doesn't matter for null checks
  if (a == null || b == null) {
    return false;
  }

  // Convert to buffers for comparison
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Different byte lengths cannot be equal - this is safe to leak
  // because timing attacks need the ability to guess byte-by-byte
  // Note: We check byte length, not string length, due to multi-byte UTF-8 characters
  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Generate a cryptographically secure random ID
 *
 * Uses crypto.randomBytes() which provides cryptographically strong
 * pseudo-random data. This is suitable for security-sensitive IDs like
 * session tokens and connection IDs where unpredictability is critical.
 *
 * @param prefix - Optional prefix for the ID (e.g., 'conn', 'session')
 * @param bytes - Number of random bytes to generate (default: 16 = 128 bits)
 * @returns A random ID string in the format `${prefix}_${timestamp}_${randomHex}`
 *
 * @example
 * ```ts
 * // Generate a connection ID
 * const connId = generateSecureId('conn');
 * // => "conn_1704067200000_a3f2b8c1d4e5f6a7"
 *
 * // Generate a session ID with more entropy
 * const sessionId = generateSecureId('session', 32);
 * // => "session_1704067200000_a3f2b8c1d4e5f6a7b8c9d0e1f2a3b4c5"
 * ```
 */
export function generateSecureId(prefix: string = 'id', bytes: number = 8): string {
  const timestamp = Date.now();
  const randomPart = randomBytes(bytes).toString('hex');
  return `${prefix}_${timestamp}_${randomPart}`;
}
