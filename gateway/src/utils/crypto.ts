/**
 * Cryptographic utilities for secure operations
 *
 * US-139: Timing-safe comparison functions to prevent timing attacks
 */

import { timingSafeEqual } from 'node:crypto';

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
