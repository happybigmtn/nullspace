/**
 * Config Validation Tests
 *
 * AC-1.2: Local config validation fails fast with clear, actionable errors
 * for missing or invalid settings.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateProductionConfig,
  validateProductionConfigOrThrow,
  validateDevelopmentConfig,
  type ConfigValidationError,
} from '../../src/config/validation.js';

describe('Config Validation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Snapshot original env
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('validateProductionConfig', () => {
    it('returns empty array in non-production mode', () => {
      process.env.NODE_ENV = 'development';
      const errors = validateProductionConfig();
      expect(errors).toEqual([]);
    });

    it('returns empty array in test mode', () => {
      process.env.NODE_ENV = 'test';
      const errors = validateProductionConfig();
      expect(errors).toEqual([]);
    });

    describe('in production mode', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        // Set valid GATEWAY_ALLOWED_ORIGINS to pass that check
        process.env.GATEWAY_ALLOWED_ORIGINS = 'https://app.nullspace.io';
      });

      it('detects placeholder values in critical env vars', () => {
        process.env.JWT_SECRET = 'your_secret_here';
        const errors = validateProductionConfig();
        const jwtError = errors.find((e) => e.key === 'JWT_SECRET');
        expect(jwtError).toBeDefined();
        expect(jwtError?.reason).toContain('placeholder');
      });

      it('detects "changeme" placeholder pattern', () => {
        process.env.SESSION_SECRET = 'changeme';
        const errors = validateProductionConfig();
        const sessionError = errors.find((e) => e.key === 'SESSION_SECRET');
        expect(sessionError).toBeDefined();
        expect(sessionError?.reason).toContain('placeholder');
      });

      it('detects short secrets', () => {
        process.env.JWT_SECRET = 'abc'; // Less than 8 characters
        const errors = validateProductionConfig();
        const jwtError = errors.find((e) => e.key === 'JWT_SECRET');
        expect(jwtError).toBeDefined();
        expect(jwtError?.reason).toContain('too short');
      });

      it('does not error on valid secrets', () => {
        process.env.JWT_SECRET = 'a-secure-random-secret-that-is-long-enough';
        const errors = validateProductionConfig();
        const jwtError = errors.find((e) => e.key === 'JWT_SECRET');
        expect(jwtError).toBeUndefined();
      });

      it('allows unset optional env vars', () => {
        // Do not set any OAuth credentials
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;
        const errors = validateProductionConfig();
        // Should not have errors for missing optional vars
        const githubError = errors.find((e) => e.key.startsWith('GITHUB_'));
        expect(githubError).toBeUndefined();
      });

      describe('GATEWAY_ALLOWED_ORIGINS validation', () => {
        it('errors when GATEWAY_ALLOWED_ORIGINS is empty', () => {
          process.env.GATEWAY_ALLOWED_ORIGINS = '';
          const errors = validateProductionConfig();
          const originsError = errors.find((e) => e.key === 'GATEWAY_ALLOWED_ORIGINS');
          expect(originsError).toBeDefined();
          expect(originsError?.reason).toContain('Must be set in production');
        });

        it('errors when GATEWAY_ALLOWED_ORIGINS is not set', () => {
          delete process.env.GATEWAY_ALLOWED_ORIGINS;
          const errors = validateProductionConfig();
          const originsError = errors.find((e) => e.key === 'GATEWAY_ALLOWED_ORIGINS');
          expect(originsError).toBeDefined();
        });

        it('validates URL format', () => {
          process.env.GATEWAY_ALLOWED_ORIGINS = 'not-a-url';
          const errors = validateProductionConfig();
          const originsError = errors.find((e) => e.key === 'GATEWAY_ALLOWED_ORIGINS');
          expect(originsError).toBeDefined();
          expect(originsError?.reason).toContain('Invalid URL format');
        });

        it('validates protocol is http or https', () => {
          process.env.GATEWAY_ALLOWED_ORIGINS = 'ftp://example.com';
          const errors = validateProductionConfig();
          const originsError = errors.find((e) => e.key === 'GATEWAY_ALLOWED_ORIGINS');
          expect(originsError).toBeDefined();
          expect(originsError?.reason).toContain('Invalid protocol');
        });

        it('accepts valid http origin', () => {
          process.env.GATEWAY_ALLOWED_ORIGINS = 'http://localhost:3000';
          const errors = validateProductionConfig();
          const originsError = errors.find((e) => e.key === 'GATEWAY_ALLOWED_ORIGINS');
          expect(originsError).toBeUndefined();
        });

        it('accepts valid https origin', () => {
          process.env.GATEWAY_ALLOWED_ORIGINS = 'https://app.nullspace.io';
          const errors = validateProductionConfig();
          const originsError = errors.find((e) => e.key === 'GATEWAY_ALLOWED_ORIGINS');
          expect(originsError).toBeUndefined();
        });

        it('validates multiple origins', () => {
          process.env.GATEWAY_ALLOWED_ORIGINS = 'https://app.nullspace.io,invalid-url';
          const errors = validateProductionConfig();
          const originsError = errors.find(
            (e) => e.key === 'GATEWAY_ALLOWED_ORIGINS' && e.value === 'invalid-url'
          );
          expect(originsError).toBeDefined();
        });

        it('accepts multiple valid origins', () => {
          process.env.GATEWAY_ALLOWED_ORIGINS = 'https://app.nullspace.io,https://staging.nullspace.io';
          const errors = validateProductionConfig();
          const originsErrors = errors.filter((e) => e.key === 'GATEWAY_ALLOWED_ORIGINS');
          expect(originsErrors).toHaveLength(0);
        });
      });
    });
  });

  describe('validateProductionConfigOrThrow', () => {
    it('does not throw in development mode', () => {
      process.env.NODE_ENV = 'development';
      expect(() => validateProductionConfigOrThrow()).not.toThrow();
    });

    it('throws with detailed message in production when errors exist', () => {
      process.env.NODE_ENV = 'production';
      process.env.GATEWAY_ALLOWED_ORIGINS = '';
      process.env.JWT_SECRET = 'changeme';

      expect(() => validateProductionConfigOrThrow()).toThrow(/Configuration validation failed/);
    });

    it('includes error count in message', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.GATEWAY_ALLOWED_ORIGINS;
      process.env.JWT_SECRET = 'x'; // Too short

      try {
        validateProductionConfigOrThrow();
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toMatch(/\d+ error/);
      }
    });

    it('does not throw when config is valid in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.GATEWAY_ALLOWED_ORIGINS = 'https://app.nullspace.io';
      // Remove all placeholder-prone vars
      delete process.env.JWT_SECRET;
      delete process.env.SESSION_SECRET;
      delete process.env.GITHUB_CLIENT_ID;
      delete process.env.GITHUB_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.TWITTER_API_KEY;
      delete process.env.TWITTER_API_SECRET;
      delete process.env.METRICS_AUTH_TOKEN;

      expect(() => validateProductionConfigOrThrow()).not.toThrow();
    });
  });

  describe('validateDevelopmentConfig', () => {
    let consoleWarnSpy: ReturnType<typeof import('vitest').vi.spyOn>;

    beforeEach(async () => {
      const { vi } = await import('vitest');
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy?.mockRestore();
    });

    it('does nothing in production mode', () => {
      process.env.NODE_ENV = 'production';
      validateDevelopmentConfig();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('warns about missing OAuth credentials in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.GITHUB_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.TWITTER_API_KEY;

      validateDevelopmentConfig();

      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCalls = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnCalls).toContain('GITHUB_CLIENT_ID');
      expect(warnCalls).toContain('GOOGLE_CLIENT_ID');
      expect(warnCalls).toContain('TWITTER_API_KEY');
    });

    it('does not warn if credentials are set', () => {
      process.env.NODE_ENV = 'development';
      process.env.GITHUB_CLIENT_ID = 'test-id';
      process.env.GOOGLE_CLIENT_ID = 'test-id';
      process.env.TWITTER_API_KEY = 'test-key';

      validateDevelopmentConfig();

      const warnCalls = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnCalls).not.toContain('GITHUB_CLIENT_ID');
      expect(warnCalls).not.toContain('GOOGLE_CLIENT_ID');
      expect(warnCalls).not.toContain('TWITTER_API_KEY');
    });
  });

  describe('error message clarity (AC-1.2)', () => {
    it('provides actionable error messages with specific remediation', () => {
      process.env.NODE_ENV = 'production';
      process.env.GATEWAY_ALLOWED_ORIGINS = '';

      const errors = validateProductionConfig();
      const originsError = errors.find((e) => e.key === 'GATEWAY_ALLOWED_ORIGINS');

      expect(originsError?.reason).toContain('comma-separated list');
      expect(originsError?.reason).toContain('https://');
    });

    it('truncates sensitive values in error output', () => {
      process.env.NODE_ENV = 'production';
      process.env.GATEWAY_ALLOWED_ORIGINS = 'https://app.nullspace.io';
      process.env.JWT_SECRET = 'your_secret_here_very_long_placeholder_value';

      const errors = validateProductionConfig();
      const jwtError = errors.find((e) => e.key === 'JWT_SECRET');

      // Value should be truncated to prevent leaking full secrets
      expect(jwtError?.value.length).toBeLessThanOrEqual(25); // 20 chars + "..."
    });

    it('redacts secret values entirely when too short', () => {
      process.env.NODE_ENV = 'production';
      process.env.GATEWAY_ALLOWED_ORIGINS = 'https://app.nullspace.io';
      process.env.JWT_SECRET = 'tiny';

      const errors = validateProductionConfig();
      const jwtError = errors.find((e) => e.key === 'JWT_SECRET');

      expect(jwtError?.value).toBe('[REDACTED]');
    });
  });
});
