/**
 * Fairness verification utilities for provably fair RNG.
 *
 * This module provides client-side verification of the commit-reveal scheme
 * used for deterministic, verifiable random number generation.
 *
 * ## Commit-Reveal Flow
 *
 * 1. **Commit** - House publishes `commit = SHA256(reveal)` before betting closes
 * 2. **Reveal** - House discloses `reveal` after betting locks
 * 3. **Verify** - Anyone can verify `SHA256(reveal) == commit`
 *
 * This prevents manipulation because:
 * - The commit is published BEFORE bets are placed
 * - The reveal is disclosed AFTER betting closes
 * - Anyone can verify the hash matches
 */

/**
 * Length of commit and reveal values in bytes (SHA256 output).
 */
export const COMMIT_REVEAL_LEN = 32;

/**
 * Result of a commit-reveal verification.
 */
export interface VerificationResult {
  /** Whether the verification passed (commit == SHA256(reveal)) */
  isValid: boolean;
  /** The computed hash of the reveal value */
  computedCommit: Uint8Array;
  /** Human-readable error message if verification failed */
  error?: string;
}

/**
 * Compute SHA256 hash using Web Crypto API.
 *
 * @param data - The data to hash
 * @returns The SHA256 hash as a Uint8Array
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Verify that a commitment matches the hash of a reveal value.
 *
 * This is the core verification that allows anyone to prove the house
 * didn't manipulate the outcome after seeing bets.
 *
 * @param commit - The commitment hash (published before betting closed)
 * @param reveal - The reveal value (disclosed after betting locked)
 * @returns A VerificationResult with isValid and computedCommit
 *
 * @example
 * ```ts
 * const result = await verifyCommitReveal(outcome.rngCommit, outcome.rollSeed);
 * if (result.isValid) {
 *   console.log('Verification passed!');
 * } else {
 *   console.log('Verification failed:', result.error);
 * }
 * ```
 */
export async function verifyCommitReveal(
  commit: Uint8Array,
  reveal: Uint8Array
): Promise<VerificationResult> {
  // Validate lengths
  if (commit.length !== COMMIT_REVEAL_LEN) {
    return {
      isValid: false,
      computedCommit: new Uint8Array(0),
      error: `Invalid commit length: ${commit.length} (expected ${COMMIT_REVEAL_LEN})`,
    };
  }

  if (reveal.length !== COMMIT_REVEAL_LEN) {
    return {
      isValid: false,
      computedCommit: new Uint8Array(0),
      error: `Invalid reveal length: ${reveal.length} (expected ${COMMIT_REVEAL_LEN})`,
    };
  }

  // Compute hash of reveal
  const computedCommit = await sha256(reveal);

  // Compare commits (constant-time comparison for security)
  const isValid = timingSafeEqual(commit, computedCommit);

  return {
    isValid,
    computedCommit,
    error: isValid ? undefined : 'Hash mismatch: SHA256(reveal) does not equal commit',
  };
}

/**
 * Timing-safe comparison of two Uint8Arrays.
 *
 * Compares in constant time to prevent timing attacks.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Convert a Uint8Array to a hex string.
 *
 * @param bytes - The bytes to convert
 * @returns The hex string representation
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a hex string to a Uint8Array.
 *
 * @param hex - The hex string to convert
 * @returns The Uint8Array representation
 * @throws Error if the hex string is invalid
 */
export function hexToBytes(hex: string): Uint8Array {
  // Remove 0x prefix if present
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;

  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }

  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new Error('Invalid hex string: contains non-hex characters');
  }

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Format a hex string for display with truncation.
 *
 * @param hex - The full hex string
 * @param startChars - Number of characters to show at start (default: 8)
 * @param endChars - Number of characters to show at end (default: 8)
 * @returns The truncated hex string with ellipsis
 */
export function formatHexTruncated(
  hex: string,
  startChars: number = 8,
  endChars: number = 8
): string {
  if (hex.length <= startChars + endChars + 3) {
    return hex;
  }
  return `${hex.slice(0, startChars)}...${hex.slice(-endChars)}`;
}

/**
 * Copy text to clipboard.
 *
 * @param text - The text to copy
 * @returns Promise that resolves when copy is complete
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}
