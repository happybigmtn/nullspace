/**
 * Player Name Validation Tests (US-072)
 *
 * Tests for player name validation:
 * - Length limits (min/max)
 * - Character restrictions
 * - Empty/whitespace-only names rejected
 * - XSS/injection characters sanitized
 */
import { describe, it, expect } from 'vitest';
import {
  validatePlayerName,
  sanitizePlayerName,
  generateDefaultPlayerName,
  getValidPlayerName,
  PLAYER_NAME_MIN_LENGTH,
  PLAYER_NAME_MAX_LENGTH,
} from '../../src/utils/player-name-validation.js';

describe('Player Name Validation', () => {
  describe('Constants', () => {
    it('should have minimum length of 2', () => {
      expect(PLAYER_NAME_MIN_LENGTH).toBe(2);
    });

    it('should have maximum length of 32', () => {
      expect(PLAYER_NAME_MAX_LENGTH).toBe(32);
    });
  });

  describe('validatePlayerName - Length Limits', () => {
    it('should reject empty string', () => {
      const result = validatePlayerName('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject single character name', () => {
      const result = validatePlayerName('A');
      expect(result.valid).toBe(false);
      expect(result.error).toContain(`at least ${PLAYER_NAME_MIN_LENGTH}`);
    });

    it('should accept minimum length name (2 chars)', () => {
      const result = validatePlayerName('AB');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('AB');
    });

    it('should accept maximum length name (32 chars)', () => {
      const name = 'A'.repeat(32);
      const result = validatePlayerName(name);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(name);
    });

    it('should reject name exceeding maximum length (33 chars)', () => {
      const name = 'A'.repeat(33);
      const result = validatePlayerName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain(`exceed ${PLAYER_NAME_MAX_LENGTH}`);
    });

    it('should reject extremely long name (1000 chars)', () => {
      const name = 'A'.repeat(1000);
      const result = validatePlayerName(name);
      expect(result.valid).toBe(false);
    });
  });

  describe('validatePlayerName - Character Restrictions', () => {
    it('should accept alphanumeric names', () => {
      expect(validatePlayerName('Player123').valid).toBe(true);
      expect(validatePlayerName('ABC').valid).toBe(true);
      expect(validatePlayerName('abc').valid).toBe(true);
      expect(validatePlayerName('123').valid).toBe(true);
    });

    it('should accept names with underscores', () => {
      const result = validatePlayerName('Player_One');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Player_One');
    });

    it('should accept names with hyphens', () => {
      const result = validatePlayerName('Player-One');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Player-One');
    });

    it('should accept names with spaces', () => {
      const result = validatePlayerName('Player One');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Player One');
    });

    it('should reject names with special characters', () => {
      expect(validatePlayerName('Player!').valid).toBe(false);
      expect(validatePlayerName('Player@Name').valid).toBe(false);
      expect(validatePlayerName('Player#123').valid).toBe(false);
      expect(validatePlayerName('Player$Name').valid).toBe(false);
      expect(validatePlayerName('Player%Name').valid).toBe(false);
    });

    it('should reject names with emoji', () => {
      // Emojis are non-alphanumeric
      expect(validatePlayerName('Player😀').valid).toBe(false);
      expect(validatePlayerName('🎮Gamer').valid).toBe(false);
    });

    it('should reject names with unicode special chars', () => {
      expect(validatePlayerName('Pläyer').valid).toBe(false);
      expect(validatePlayerName('Plàyer').valid).toBe(false);
    });
  });

  describe('validatePlayerName - Empty/Whitespace', () => {
    it('should reject null', () => {
      const result = validatePlayerName(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be a string');
    });

    it('should reject undefined', () => {
      const result = validatePlayerName(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be a string');
    });

    it('should reject whitespace-only string (spaces)', () => {
      const result = validatePlayerName('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('whitespace only');
    });

    it('should reject whitespace-only string (tabs)', () => {
      const result = validatePlayerName('\t\t');
      expect(result.valid).toBe(false);
    });

    it('should reject whitespace-only string (mixed)', () => {
      const result = validatePlayerName(' \t \n ');
      expect(result.valid).toBe(false);
    });

    it('should trim leading/trailing whitespace', () => {
      const result = validatePlayerName('  Player  ');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Player');
    });

    it('should reject consecutive spaces', () => {
      const result = validatePlayerName('Player  One');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('consecutive spaces');
    });

    it('should reject leading underscore', () => {
      const result = validatePlayerName('_Player');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('start or end');
    });

    it('should reject trailing underscore', () => {
      const result = validatePlayerName('Player_');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('start or end');
    });

    it('should reject leading hyphen', () => {
      const result = validatePlayerName('-Player');
      expect(result.valid).toBe(false);
    });

    it('should reject trailing hyphen', () => {
      const result = validatePlayerName('Player-');
      expect(result.valid).toBe(false);
    });
  });

  describe('validatePlayerName - XSS/Injection Prevention', () => {
    it('should reject HTML script tags', () => {
      expect(validatePlayerName('<script>alert(1)</script>').valid).toBe(false);
      expect(validatePlayerName('Player<script>').valid).toBe(false);
    });

    it('should reject HTML angle brackets', () => {
      expect(validatePlayerName('Player<div>').valid).toBe(false);
      expect(validatePlayerName('<Player>').valid).toBe(false);
    });

    it('should reject single quotes', () => {
      expect(validatePlayerName("Player'sName").valid).toBe(false);
    });

    it('should reject double quotes', () => {
      expect(validatePlayerName('Player"Name').valid).toBe(false);
    });

    it('should reject ampersand', () => {
      expect(validatePlayerName('Player&Name').valid).toBe(false);
    });

    it('should reject backslash', () => {
      expect(validatePlayerName('Player\\Name').valid).toBe(false);
    });

    it('should reject forward slash', () => {
      expect(validatePlayerName('Player/Name').valid).toBe(false);
    });

    it('should reject backticks', () => {
      expect(validatePlayerName('Player`Name').valid).toBe(false);
    });

    it('should reject control characters', () => {
      expect(validatePlayerName('Player\x00Name').valid).toBe(false);
      expect(validatePlayerName('Player\x1fName').valid).toBe(false);
    });

    it('should reject SQL injection patterns', () => {
      expect(validatePlayerName("'; DROP TABLE users;--").valid).toBe(false);
      expect(validatePlayerName('1 OR 1=1').valid).toBe(false);
    });
  });
});

describe('sanitizePlayerName', () => {
  it('should remove HTML tags', () => {
    expect(sanitizePlayerName('<script>alert(1)</script>')).toBe('scriptalert1script');
  });

  it('should remove dangerous characters', () => {
    expect(sanitizePlayerName("Player's<>\"Name")).toBe('PlayersName');
  });

  it('should preserve allowed characters', () => {
    expect(sanitizePlayerName('Player_One-123')).toBe('Player_One-123');
  });

  it('should collapse multiple spaces', () => {
    expect(sanitizePlayerName('Player   Name')).toBe('Player Name');
  });

  it('should trim whitespace', () => {
    expect(sanitizePlayerName('  Player  ')).toBe('Player');
  });

  it('should truncate to max length', () => {
    const input = 'A'.repeat(100);
    const result = sanitizePlayerName(input);
    expect(result.length).toBe(PLAYER_NAME_MAX_LENGTH);
  });

  it('should handle empty string', () => {
    expect(sanitizePlayerName('')).toBe('');
  });

  it('should handle null/undefined', () => {
    expect(sanitizePlayerName(null as unknown as string)).toBe('');
    expect(sanitizePlayerName(undefined as unknown as string)).toBe('');
  });

  it('should remove control characters', () => {
    expect(sanitizePlayerName('Player\x00\x1fName')).toBe('PlayerName');
  });

  it('should remove unicode special characters', () => {
    // 'ä' is removed, leaving 'Plyer' (not 'Player' since the 'a' was never there)
    expect(sanitizePlayerName('Pläyer')).toBe('Plyer');
    expect(sanitizePlayerName('日本語')).toBe('');
  });
});

describe('generateDefaultPlayerName', () => {
  it('should generate name with Player_ prefix', () => {
    const name = generateDefaultPlayerName('abcdef123456');
    expect(name.startsWith('Player_')).toBe(true);
  });

  it('should use first 8 chars of public key', () => {
    const name = generateDefaultPlayerName('abcdefgh12345678');
    expect(name).toBe('Player_abcdefgh');
  });

  it('should handle short public keys', () => {
    const name = generateDefaultPlayerName('abc');
    expect(name).toBe('Player_abc');
  });

  it('should strip non-alphanumeric from public key', () => {
    const name = generateDefaultPlayerName('abc:def:123');
    expect(name).toBe('Player_abcdef12');
  });
});

describe('getValidPlayerName', () => {
  const fallbackKey = 'abc123def456';

  it('should return valid name unchanged', () => {
    const result = getValidPlayerName('ValidPlayer', fallbackKey);
    expect(result.name).toBe('ValidPlayer');
    expect(result.wasModified).toBe(false);
  });

  it('should trim whitespace from valid name', () => {
    const result = getValidPlayerName('  ValidPlayer  ', fallbackKey);
    expect(result.name).toBe('ValidPlayer');
    expect(result.wasModified).toBe(true);
  });

  it('should use fallback for null', () => {
    const result = getValidPlayerName(null, fallbackKey);
    expect(result.name).toBe('Player_abc123de');
    expect(result.wasModified).toBe(true);
  });

  it('should use fallback for undefined', () => {
    const result = getValidPlayerName(undefined, fallbackKey);
    expect(result.name).toBe('Player_abc123de');
    expect(result.wasModified).toBe(true);
  });

  it('should sanitize invalid name if possible', () => {
    const result = getValidPlayerName('Player<script>', fallbackKey);
    expect(result.name).toBe('Playerscript');
    expect(result.wasModified).toBe(true);
  });

  it('should use fallback when sanitization results in empty', () => {
    const result = getValidPlayerName('<>', fallbackKey);
    expect(result.name).toBe('Player_abc123de');
    expect(result.wasModified).toBe(true);
  });

  it('should use generic fallback when no public key provided', () => {
    const result = getValidPlayerName(null);
    expect(result.name).toBe('Player');
    expect(result.wasModified).toBe(true);
  });
});

describe('Edge Cases', () => {
  it('should handle very long XSS payload', () => {
    const payload = '<script>'.repeat(100) + 'alert(1)' + '</script>'.repeat(100);
    const result = validatePlayerName(payload);
    expect(result.valid).toBe(false);
  });

  it('should handle null byte injection', () => {
    const result = validatePlayerName('Player\x00Admin');
    expect(result.valid).toBe(false);
  });

  it('should handle unicode normalization attacks', () => {
    // Different unicode representations of same character
    const result = validatePlayerName('Pla\u0079er'); // 'y' as combining char
    expect(result.valid).toBe(true); // This one is actually fine - it's just 'Player'
  });

  it('should handle numbers only', () => {
    const result = validatePlayerName('12345');
    expect(result.valid).toBe(true);
  });

  it('should handle boundary: exactly min length', () => {
    const result = validatePlayerName('AB');
    expect(result.valid).toBe(true);
    expect(result.sanitized?.length).toBe(2);
  });

  it('should handle boundary: exactly max length', () => {
    const name = 'A'.repeat(32);
    const result = validatePlayerName(name);
    expect(result.valid).toBe(true);
    expect(result.sanitized?.length).toBe(32);
  });

  it('should handle boundary: one over max length', () => {
    const name = 'A'.repeat(33);
    const result = validatePlayerName(name);
    expect(result.valid).toBe(false);
  });

  it('should handle mixed valid and invalid characters', () => {
    // All valid
    expect(validatePlayerName('Player_One-2').valid).toBe(true);
    // Has one invalid char
    expect(validatePlayerName('Player@One').valid).toBe(false);
  });
});

describe('Real-World Attack Patterns', () => {
  it('should reject DOM clobbering attempts', () => {
    expect(validatePlayerName('<img src=x onerror=alert(1)>').valid).toBe(false);
  });

  it('should reject event handler injection', () => {
    expect(validatePlayerName('onclick=alert(1)').valid).toBe(false);
  });

  it('should reject javascript: protocol', () => {
    expect(validatePlayerName('javascript:alert(1)').valid).toBe(false);
  });

  it('should reject data: protocol', () => {
    expect(validatePlayerName('data:text/html,<script>').valid).toBe(false);
  });

  it('should reject URL encoding attacks', () => {
    expect(validatePlayerName('%3Cscript%3E').valid).toBe(false);
  });

  it('should reject HTML entity encoding', () => {
    expect(validatePlayerName('&lt;script&gt;').valid).toBe(false);
  });
});
