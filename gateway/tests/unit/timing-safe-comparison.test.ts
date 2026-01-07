/**
 * Security tests for cryptographic utilities
 *
 * US-139: Validates constant-time behavior of timingSafeStringEqual
 * US-140: Validates cryptographically secure ID generation
 *
 * Note: These tests verify correctness, not actual timing behavior.
 * True timing attack resistance requires statistical analysis across
 * many iterations which is impractical in unit tests.
 */

import { describe, it, expect } from 'vitest';
import { timingSafeStringEqual, generateSecureId } from '../../src/utils/crypto.js';

describe('timingSafeStringEqual', () => {
  describe('correctness', () => {
    it('returns true for identical strings', () => {
      expect(timingSafeStringEqual('secret123', 'secret123')).toBe(true);
      expect(timingSafeStringEqual('', '')).toBe(true);
      expect(timingSafeStringEqual('a', 'a')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(timingSafeStringEqual('secret123', 'secret456')).toBe(false);
      expect(timingSafeStringEqual('abc', 'def')).toBe(false);
      expect(timingSafeStringEqual('a', 'b')).toBe(false);
    });

    it('returns false for strings with different lengths', () => {
      expect(timingSafeStringEqual('short', 'longer')).toBe(false);
      expect(timingSafeStringEqual('abc', 'ab')).toBe(false);
      expect(timingSafeStringEqual('', 'a')).toBe(false);
    });

    it('returns false for null/undefined inputs', () => {
      expect(timingSafeStringEqual(null, 'secret')).toBe(false);
      expect(timingSafeStringEqual('secret', null)).toBe(false);
      expect(timingSafeStringEqual(undefined, 'secret')).toBe(false);
      expect(timingSafeStringEqual('secret', undefined)).toBe(false);
      expect(timingSafeStringEqual(null, null)).toBe(false);
      expect(timingSafeStringEqual(undefined, undefined)).toBe(false);
      expect(timingSafeStringEqual(null, undefined)).toBe(false);
    });

    it('handles special characters correctly', () => {
      expect(timingSafeStringEqual('pa$$w0rd!', 'pa$$w0rd!')).toBe(true);
      expect(timingSafeStringEqual('pa$$w0rd!', 'pa$$w0rd?')).toBe(false);
    });

    it('handles unicode characters correctly', () => {
      expect(timingSafeStringEqual('secreté', 'secreté')).toBe(true);
      expect(timingSafeStringEqual('secreté', 'secrete')).toBe(false);
      expect(timingSafeStringEqual('日本語', '日本語')).toBe(true);
      expect(timingSafeStringEqual('日本語', '日本话')).toBe(false);
    });

    it('handles base64 tokens correctly', () => {
      const token1 = 'SLNmUmUHvNzc+wUagF9aOPGaQBb1DNp8jSG75+Cq5uI=';
      const token2 = 'SLNmUmUHvNzc+wUagF9aOPGaQBb1DNp8jSG75+Cq5uI=';
      const token3 = 'XLNmUmUHvNzc+wUagF9aOPGaQBb1DNp8jSG75+Cq5uI=';

      expect(timingSafeStringEqual(token1, token2)).toBe(true);
      expect(timingSafeStringEqual(token1, token3)).toBe(false);
    });
  });

  describe('security properties', () => {
    it('compares identical prefixes correctly', () => {
      // These strings start identically but differ at the end
      // A non-constant-time comparison would return faster for strings
      // that differ early vs late
      expect(timingSafeStringEqual('secretAAAA', 'secretAAAA')).toBe(true);
      expect(timingSafeStringEqual('secretAAAA', 'secretAAAB')).toBe(false);
      expect(timingSafeStringEqual('secretAAAA', 'secretAAAC')).toBe(false);
    });

    it('compares strings that differ at first character', () => {
      // These strings differ at the first character
      // A non-constant-time comparison would return immediately
      expect(timingSafeStringEqual('Asecret123', 'Bsecret123')).toBe(false);
      expect(timingSafeStringEqual('Asecret123', 'Csecret123')).toBe(false);
    });

    it('compares strings that differ only at last character', () => {
      // These strings only differ at the last character
      // A non-constant-time comparison would take longer to reject
      expect(timingSafeStringEqual('secretabcX', 'secretabcY')).toBe(false);
      expect(timingSafeStringEqual('secretabcX', 'secretabcZ')).toBe(false);
    });

    it('handles typical bearer token format', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
      const invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake';

      expect(timingSafeStringEqual(validToken, validToken)).toBe(true);
      expect(timingSafeStringEqual(validToken, invalidToken)).toBe(false);
    });
  });
});

describe('generateSecureId', () => {
  describe('format', () => {
    it('generates ID with correct prefix and format', () => {
      const id = generateSecureId('conn');
      expect(id).toMatch(/^conn_\d+_[a-f0-9]+$/);
    });

    it('uses default prefix when none provided', () => {
      const id = generateSecureId();
      expect(id).toMatch(/^id_\d+_[a-f0-9]+$/);
    });

    it('includes timestamp component', () => {
      const before = Date.now();
      const id = generateSecureId('test');
      const after = Date.now();

      const parts = id.split('_');
      const timestamp = parseInt(parts[1], 10);

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('generates hex random part with correct length', () => {
      // Default is 8 bytes = 16 hex characters
      const id = generateSecureId('test');
      const parts = id.split('_');
      expect(parts[2]).toHaveLength(16);

      // Custom bytes: 16 bytes = 32 hex characters
      const id32 = generateSecureId('test', 16);
      const parts32 = id32.split('_');
      expect(parts32[2]).toHaveLength(32);
    });
  });

  describe('uniqueness', () => {
    it('generates unique IDs on consecutive calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateSecureId('test'));
      }
      // All 1000 IDs should be unique
      expect(ids.size).toBe(1000);
    });

    it('generates different random parts even with same timestamp', () => {
      // Generate many IDs very quickly (same timestamp likely)
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(generateSecureId('test'));
      }

      // Extract just the random parts
      const randomParts = ids.map(id => id.split('_')[2]);
      const uniqueRandomParts = new Set(randomParts);

      // All random parts should be unique
      expect(uniqueRandomParts.size).toBe(100);
    });
  });

  describe('security properties', () => {
    it('produces IDs with sufficient entropy (64 bits default)', () => {
      // 8 bytes = 64 bits of entropy
      // Probability of collision in N IDs: ~N²/2^65
      // For 10^9 IDs: ~10^18/2^65 ≈ 0.00003 (very low)
      const id = generateSecureId('test', 8);
      const randomPart = id.split('_')[2];

      // Verify hex string represents 8 bytes
      expect(randomPart).toMatch(/^[a-f0-9]{16}$/);
    });

    it('produces IDs with high entropy on request (128 bits)', () => {
      const id = generateSecureId('session', 16);
      const randomPart = id.split('_')[2];

      // Verify hex string represents 16 bytes
      expect(randomPart).toMatch(/^[a-f0-9]{32}$/);
    });

    it('random parts are uniformly distributed', () => {
      // Generate many IDs and check first byte distribution
      const firstBytes: number[] = [];
      for (let i = 0; i < 10000; i++) {
        const id = generateSecureId('test');
        const randomPart = id.split('_')[2];
        const firstByte = parseInt(randomPart.slice(0, 2), 16);
        firstBytes.push(firstByte);
      }

      // Calculate mean - should be close to 127.5 for uniform [0,255]
      const mean = firstBytes.reduce((a, b) => a + b, 0) / firstBytes.length;
      expect(mean).toBeGreaterThan(115);
      expect(mean).toBeLessThan(140);

      // Check we see a good distribution of values
      const uniqueValues = new Set(firstBytes);
      expect(uniqueValues.size).toBeGreaterThan(200); // Should see most of 0-255
    });
  });
});
