/**
 * Deposit Address Validation Unit Tests
 *
 * Tests for EVM address validation, checksum verification,
 * and protection against common deposit errors.
 */
import { describe, it, expect } from 'vitest';
import {
  isValidAddressFormat,
  normalizeAddress,
  isValidChecksum,
  validateDepositAddress,
  toChecksumAddress,
} from '../../src/utils/address-validation.js';

describe('Address Format Validation', () => {
  describe('isValidAddressFormat', () => {
    it('should accept valid addresses with 0x prefix', () => {
      expect(isValidAddressFormat('0x0000000000000000000000000000000000000001')).toBe(true);
      expect(isValidAddressFormat('0xABCDEF1234567890abcdef1234567890ABCDEF12')).toBe(true);
    });

    it('should accept valid addresses without 0x prefix', () => {
      expect(isValidAddressFormat('0000000000000000000000000000000000000001')).toBe(true);
      expect(isValidAddressFormat('ABCDEF1234567890abcdef1234567890ABCDEF12')).toBe(true);
    });

    it('should accept addresses with 0X prefix (uppercase)', () => {
      expect(isValidAddressFormat('0X0000000000000000000000000000000000000001')).toBe(true);
    });

    it('should reject empty or null addresses', () => {
      expect(isValidAddressFormat('')).toBe(false);
      expect(isValidAddressFormat(null as unknown as string)).toBe(false);
      expect(isValidAddressFormat(undefined as unknown as string)).toBe(false);
    });

    it('should reject addresses with wrong length', () => {
      // Too short
      expect(isValidAddressFormat('0x123')).toBe(false);
      expect(isValidAddressFormat('0x' + '1'.repeat(39))).toBe(false);

      // Too long
      expect(isValidAddressFormat('0x' + '1'.repeat(41))).toBe(false);
      expect(isValidAddressFormat('0x' + '1'.repeat(64))).toBe(false);
    });

    it('should reject addresses with invalid characters', () => {
      expect(isValidAddressFormat('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
      expect(isValidAddressFormat('0x123456789012345678901234567890123456789X')).toBe(false);
      expect(isValidAddressFormat('0x1234567890123456789012345678901234567890!')).toBe(false);
    });

    it('should reject addresses with spaces', () => {
      expect(isValidAddressFormat('0x 1234567890123456789012345678901234567890')).toBe(false);
      expect(isValidAddressFormat(' 0x1234567890123456789012345678901234567890')).toBe(false);
      expect(isValidAddressFormat('0x1234567890123456789012345678901234567890 ')).toBe(false);
    });
  });

  describe('normalizeAddress', () => {
    it('should convert to lowercase with 0x prefix', () => {
      expect(normalizeAddress('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef12'
      );
    });

    it('should add 0x prefix if missing', () => {
      expect(normalizeAddress('abcdef1234567890abcdef1234567890abcdef12')).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef12'
      );
    });

    it('should handle mixed case', () => {
      expect(normalizeAddress('0xAbCdEf1234567890aBcDeF1234567890AbCdEf12')).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef12'
      );
    });

    it('should throw for invalid addresses', () => {
      expect(() => normalizeAddress('')).toThrow();
      expect(() => normalizeAddress('invalid')).toThrow();
      expect(() => normalizeAddress('0x123')).toThrow();
    });
  });
});

describe('Checksum Validation', () => {
  describe('toChecksumAddress', () => {
    // These are known EIP-55 checksum addresses
    const KNOWN_CHECKSUMS = [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ];

    it('should generate valid checksums for known addresses', () => {
      for (const address of KNOWN_CHECKSUMS) {
        const result = toChecksumAddress(address.toLowerCase());
        expect(result).toBe(address);
      }
    });

    it('should throw for invalid addresses', () => {
      expect(() => toChecksumAddress('')).toThrow();
      expect(() => toChecksumAddress('invalid')).toThrow();
    });
  });

  describe('isValidChecksum', () => {
    it('should accept all lowercase addresses', () => {
      expect(isValidChecksum('0xabcdef1234567890abcdef1234567890abcdef12')).toBe(true);
    });

    it('should accept all uppercase addresses', () => {
      expect(isValidChecksum('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')).toBe(true);
    });

    it('should validate mixed case checksums', () => {
      // Valid checksums
      expect(isValidChecksum('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true);

      // Invalid checksum (wrong case)
      expect(isValidChecksum('0x5AAEB6053F3E94C9B9A09f33669435E7Ef1BeAed')).toBe(false);
    });

    it('should reject invalid format', () => {
      expect(isValidChecksum('')).toBe(false);
      expect(isValidChecksum('invalid')).toBe(false);
    });
  });
});

describe('Deposit Address Validation', () => {
  describe('validateDepositAddress', () => {
    it('should accept valid addresses', () => {
      const result = validateDepositAddress(
        '0x1234567890123456789012345678901234567890'
      );
      expect(result.valid).toBe(true);
      expect(result.normalized).toBeDefined();
      expect(result.checksummed).toBeDefined();
    });

    it('should reject invalid format', () => {
      const result = validateDepositAddress('invalid');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid address format');
    });

    it('should reject zero address', () => {
      const result = validateDepositAddress(
        '0x0000000000000000000000000000000000000000'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('burn address');
    });

    it('should reject common burn address', () => {
      const result = validateDepositAddress(
        '0x000000000000000000000000000000000000dEaD'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('burn address');
    });

    it('should reject precompile addresses', () => {
      // Precompiles 1-9 should be rejected
      for (let i = 1; i <= 9; i++) {
        const address = '0x' + '0'.repeat(39) + i.toString();
        const result = validateDepositAddress(address);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('burn address');
      }
    });

    it('should reject addresses with invalid checksum', () => {
      // Valid format but invalid mixed-case checksum
      const result = validateDepositAddress(
        '0x5AAEB6053F3E94C9B9A09f33669435E7Ef1BeAed'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid checksum');
    });

    it('should accept contract addresses', () => {
      // Contract addresses (non-zero, not precompile) should be valid
      // Using a valid hex address (lowercase, so no checksum validation needed)
      const result = validateDepositAddress(
        '0x6b175474e89094c44da98b954eedeacd1f129a03' // Example contract address (all lowercase)
      );
      // Lowercase address should pass format and be valid
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return normalized and checksummed versions', () => {
      const result = validateDepositAddress(
        '0xabcdef1234567890abcdef1234567890abcdef12'
      );

      if (result.valid) {
        expect(result.normalized).toBe(
          '0xabcdef1234567890abcdef1234567890abcdef12'
        );
        expect(result.checksummed?.startsWith('0x')).toBe(true);
        expect(result.checksummed?.length).toBe(42);
      }
    });
  });
});

describe('Edge Cases', () => {
  it('should handle address with only 0x prefix', () => {
    expect(isValidAddressFormat('0x')).toBe(false);
    expect(() => normalizeAddress('0x')).toThrow();
  });

  it('should handle numeric-looking addresses', () => {
    // All zeros except last character
    expect(isValidAddressFormat('0x0000000000000000000000000000000000000001')).toBe(true);

    // All ones
    expect(isValidAddressFormat('0x1111111111111111111111111111111111111111')).toBe(true);
  });

  it('should handle addresses with leading zeros', () => {
    const address = '0x000000000000000000000000000000000000000A';
    expect(isValidAddressFormat(address)).toBe(true);

    const result = validateDepositAddress(address);
    // This is a valid format but may be a precompile (address 10)
    expect(result.error?.includes('format')).not.toBe(true);
  });

  it('should handle case sensitivity consistently', () => {
    const lower = '0xabcdef1234567890abcdef1234567890abcdef12';
    const upper = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';

    // Both should normalize to the same value
    expect(normalizeAddress(lower)).toBe(normalizeAddress(upper));
  });
});

describe('Security Considerations', () => {
  it('should not accept addresses with unicode lookalikes', () => {
    // Address with unicode zero-width characters
    const malicious = '0x\u200Babcdef1234567890abcdef1234567890abcdef12';
    expect(isValidAddressFormat(malicious)).toBe(false);
  });

  it('should not accept addresses with newlines', () => {
    expect(isValidAddressFormat('0xabcdef1234567890abcdef1234567890abcdef12\n')).toBe(false);
  });

  it('should handle very long input', () => {
    const longInput = '0x' + 'a'.repeat(10000);
    expect(isValidAddressFormat(longInput)).toBe(false);
  });

  it('should handle SQL injection attempts in address', () => {
    const sqlInjection = "0x'; DROP TABLE users; --";
    expect(isValidAddressFormat(sqlInjection)).toBe(false);
  });
});
