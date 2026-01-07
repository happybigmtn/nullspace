/**
 * Security tests for timing-safe comparison utility
 *
 * US-139: Validates constant-time behavior of timingSafeStringEqual
 *
 * Note: These tests verify correctness, not actual timing behavior.
 * True timing attack resistance requires statistical analysis across
 * many iterations which is impractical in unit tests.
 */

import { describe, it, expect } from 'vitest';
import { timingSafeStringEqual } from '../../src/utils/crypto.js';

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
