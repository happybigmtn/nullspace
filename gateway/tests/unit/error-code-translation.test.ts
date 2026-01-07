/**
 * Error Code Translation Layer Tests (US-063)
 *
 * Tests the error code translation across the three layers:
 *   1. Rust numeric error codes (u8) → Gateway string codes
 *   2. Gateway string codes → Mobile user-friendly messages
 *   3. Unknown error code graceful handling
 *
 * Documents the full error code mapping table for reference.
 */

import { describe, it, expect } from 'vitest';
import { ErrorCodes, createError, type ErrorCode } from '../../src/types/errors.js';

/**
 * Rust Error Code Constants (from types/src/casino/constants.rs)
 * These are the numeric u8 values emitted by the execution layer.
 */
const RustErrorCodes = {
  ERROR_PLAYER_ALREADY_REGISTERED: 1,
  ERROR_PLAYER_NOT_FOUND: 2,
  ERROR_INSUFFICIENT_FUNDS: 3,
  ERROR_INVALID_BET: 4,
  ERROR_SESSION_EXISTS: 5,
  ERROR_SESSION_NOT_FOUND: 6,
  ERROR_SESSION_NOT_OWNED: 7,
  ERROR_SESSION_COMPLETE: 8,
  ERROR_INVALID_MOVE: 9,
  ERROR_RATE_LIMITED: 10,
  ERROR_TOURNAMENT_NOT_REGISTERING: 11,
  ERROR_ALREADY_IN_TOURNAMENT: 12,
  ERROR_TOURNAMENT_LIMIT_REACHED: 13,
  ERROR_NOT_IN_TOURNAMENT: 14,
  ERROR_UNAUTHORIZED: 15,
} as const;

type RustErrorCode = (typeof RustErrorCodes)[keyof typeof RustErrorCodes];

/**
 * Expected mapping from Rust numeric codes to Gateway string codes.
 *
 * NOTE: Currently the gateway doesn't actually translate these - it passes
 * through errorMessage and uses TRANSACTION_REJECTED. This test documents
 * the EXPECTED behavior that should be implemented.
 *
 * This is the authoritative reference for error code translation.
 */
const RUST_TO_GATEWAY_MAPPING: Record<RustErrorCode, ErrorCode> = {
  [RustErrorCodes.ERROR_PLAYER_ALREADY_REGISTERED]: ErrorCodes.REGISTRATION_FAILED,
  [RustErrorCodes.ERROR_PLAYER_NOT_FOUND]: ErrorCodes.NOT_REGISTERED,
  [RustErrorCodes.ERROR_INSUFFICIENT_FUNDS]: ErrorCodes.INSUFFICIENT_BALANCE,
  [RustErrorCodes.ERROR_INVALID_BET]: ErrorCodes.INVALID_BET,
  [RustErrorCodes.ERROR_SESSION_EXISTS]: ErrorCodes.GAME_IN_PROGRESS,
  [RustErrorCodes.ERROR_SESSION_NOT_FOUND]: ErrorCodes.NO_ACTIVE_GAME,
  [RustErrorCodes.ERROR_SESSION_NOT_OWNED]: ErrorCodes.TRANSACTION_REJECTED,
  [RustErrorCodes.ERROR_SESSION_COMPLETE]: ErrorCodes.NO_ACTIVE_GAME,
  [RustErrorCodes.ERROR_INVALID_MOVE]: ErrorCodes.TRANSACTION_REJECTED,
  [RustErrorCodes.ERROR_RATE_LIMITED]: ErrorCodes.TRANSACTION_REJECTED,
  [RustErrorCodes.ERROR_TOURNAMENT_NOT_REGISTERING]: ErrorCodes.TRANSACTION_REJECTED,
  [RustErrorCodes.ERROR_ALREADY_IN_TOURNAMENT]: ErrorCodes.TRANSACTION_REJECTED,
  [RustErrorCodes.ERROR_TOURNAMENT_LIMIT_REACHED]: ErrorCodes.TRANSACTION_REJECTED,
  [RustErrorCodes.ERROR_NOT_IN_TOURNAMENT]: ErrorCodes.TRANSACTION_REJECTED,
  [RustErrorCodes.ERROR_UNAUTHORIZED]: ErrorCodes.SESSION_EXPIRED,
};

/**
 * User-friendly messages for mobile display.
 * These are the messages that should be shown to users.
 */
const GATEWAY_TO_USER_MESSAGE: Record<ErrorCode, string> = {
  [ErrorCodes.INVALID_MESSAGE]: 'Invalid request. Please try again.',
  [ErrorCodes.INVALID_GAME_TYPE]: 'Unknown game type.',
  [ErrorCodes.INVALID_BET]: 'Bet amount is invalid.',
  [ErrorCodes.NO_ACTIVE_GAME]: 'No active game. Please start a new game.',
  [ErrorCodes.INSUFFICIENT_BALANCE]: 'Insufficient balance for this bet.',
  [ErrorCodes.NOT_REGISTERED]: 'Please register before playing.',
  [ErrorCodes.BACKEND_UNAVAILABLE]: 'Server is temporarily unavailable. Please try again.',
  [ErrorCodes.TRANSACTION_REJECTED]: 'Transaction was rejected. Please try again.',
  [ErrorCodes.NONCE_MISMATCH]: 'Session out of sync. Please refresh.',
  [ErrorCodes.INTERNAL_ERROR]: 'An unexpected error occurred.',
  [ErrorCodes.SESSION_EXPIRED]: 'Your session has expired. Please reconnect.',
  [ErrorCodes.GAME_IN_PROGRESS]: 'A game is already in progress.',
  [ErrorCodes.REGISTRATION_FAILED]: 'Registration failed. Please try again.',
};

/**
 * Translate Rust numeric error code to Gateway string code.
 * This function should be used by the gateway to translate backend errors.
 *
 * When an unknown code is encountered:
 * - Uses TRANSACTION_REJECTED as the code
 * - Uses the fallbackMessage if provided, otherwise uses the default message
 */
function translateRustErrorCode(
  rustCode: number,
  fallbackMessage?: string
): { code: ErrorCode; message: string } {
  const gatewayCode =
    RUST_TO_GATEWAY_MAPPING[rustCode as RustErrorCode] || ErrorCodes.TRANSACTION_REJECTED;

  // For unknown codes, prefer the fallback message from the backend
  const isKnownCode = rustCode in RUST_TO_GATEWAY_MAPPING;
  const userMessage = isKnownCode
    ? GATEWAY_TO_USER_MESSAGE[gatewayCode]
    : fallbackMessage || GATEWAY_TO_USER_MESSAGE[gatewayCode];

  return { code: gatewayCode, message: userMessage };
}

/**
 * Get user-friendly message for a Gateway error code.
 * This function should be used by the mobile app to display errors.
 */
function getUserFriendlyMessage(gatewayCode: ErrorCode, fallbackMessage?: string): string {
  return (
    GATEWAY_TO_USER_MESSAGE[gatewayCode] ||
    fallbackMessage ||
    'An error occurred. Please try again.'
  );
}

describe('Error Code Translation Layer', () => {
  describe('Rust to Gateway Code Mapping', () => {
    it('maps ERROR_INSUFFICIENT_FUNDS to INSUFFICIENT_BALANCE', () => {
      const result = translateRustErrorCode(RustErrorCodes.ERROR_INSUFFICIENT_FUNDS);
      expect(result.code).toBe(ErrorCodes.INSUFFICIENT_BALANCE);
    });

    it('maps ERROR_INVALID_BET to INVALID_BET', () => {
      const result = translateRustErrorCode(RustErrorCodes.ERROR_INVALID_BET);
      expect(result.code).toBe(ErrorCodes.INVALID_BET);
    });

    it('maps ERROR_PLAYER_NOT_FOUND to NOT_REGISTERED', () => {
      const result = translateRustErrorCode(RustErrorCodes.ERROR_PLAYER_NOT_FOUND);
      expect(result.code).toBe(ErrorCodes.NOT_REGISTERED);
    });

    it('maps ERROR_SESSION_EXISTS to GAME_IN_PROGRESS', () => {
      const result = translateRustErrorCode(RustErrorCodes.ERROR_SESSION_EXISTS);
      expect(result.code).toBe(ErrorCodes.GAME_IN_PROGRESS);
    });

    it('maps ERROR_SESSION_NOT_FOUND to NO_ACTIVE_GAME', () => {
      const result = translateRustErrorCode(RustErrorCodes.ERROR_SESSION_NOT_FOUND);
      expect(result.code).toBe(ErrorCodes.NO_ACTIVE_GAME);
    });

    it('maps ERROR_UNAUTHORIZED to SESSION_EXPIRED', () => {
      const result = translateRustErrorCode(RustErrorCodes.ERROR_UNAUTHORIZED);
      expect(result.code).toBe(ErrorCodes.SESSION_EXPIRED);
    });

    it('maps ERROR_PLAYER_ALREADY_REGISTERED to REGISTRATION_FAILED', () => {
      const result = translateRustErrorCode(RustErrorCodes.ERROR_PLAYER_ALREADY_REGISTERED);
      expect(result.code).toBe(ErrorCodes.REGISTRATION_FAILED);
    });

    it('maps all defined Rust codes to valid Gateway codes', () => {
      for (const [name, code] of Object.entries(RustErrorCodes)) {
        const result = translateRustErrorCode(code);
        expect(result.code).toBeDefined();
        expect(Object.values(ErrorCodes)).toContain(result.code);
      }
    });
  });

  describe('Unknown Error Code Handling', () => {
    it('handles unknown error code (0) gracefully', () => {
      const result = translateRustErrorCode(0);
      expect(result.code).toBe(ErrorCodes.TRANSACTION_REJECTED);
      expect(result.message).toBeTruthy();
    });

    it('handles undefined error code (255) gracefully', () => {
      const result = translateRustErrorCode(255);
      expect(result.code).toBe(ErrorCodes.TRANSACTION_REJECTED);
    });

    it('handles future error codes (100+) gracefully', () => {
      const result = translateRustErrorCode(100);
      expect(result.code).toBe(ErrorCodes.TRANSACTION_REJECTED);
    });

    it('uses fallback message for unknown codes when provided', () => {
      const customMessage = 'Custom backend error message';
      const result = translateRustErrorCode(255, customMessage);
      expect(result.message).toBe(customMessage);
    });
  });

  describe('Gateway to User-Friendly Message Mapping', () => {
    it('translates INSUFFICIENT_BALANCE to user message', () => {
      const message = getUserFriendlyMessage(ErrorCodes.INSUFFICIENT_BALANCE);
      expect(message).toContain('Insufficient');
      expect(message).toContain('balance');
    });

    it('translates INVALID_BET to user message', () => {
      const message = getUserFriendlyMessage(ErrorCodes.INVALID_BET);
      expect(message).toContain('Bet');
      expect(message).toContain('invalid');
    });

    it('translates SESSION_EXPIRED to user message', () => {
      const message = getUserFriendlyMessage(ErrorCodes.SESSION_EXPIRED);
      expect(message).toContain('session');
      expect(message.toLowerCase()).toContain('expired');
    });

    it('translates BACKEND_UNAVAILABLE to user message', () => {
      const message = getUserFriendlyMessage(ErrorCodes.BACKEND_UNAVAILABLE);
      expect(message.toLowerCase()).toContain('unavailable');
    });

    it('provides user-friendly message for all Gateway codes', () => {
      for (const code of Object.values(ErrorCodes)) {
        const message = getUserFriendlyMessage(code);
        expect(message).toBeTruthy();
        expect(message.length).toBeGreaterThan(5);
      }
    });

    it('uses fallback message when Gateway code is undefined', () => {
      const fallback = 'Fallback message';
      const message = getUserFriendlyMessage('UNKNOWN_CODE' as ErrorCode, fallback);
      expect(message).toBe(fallback);
    });
  });

  describe('createError Helper', () => {
    it('creates properly structured error response', () => {
      const error = createError(ErrorCodes.INSUFFICIENT_BALANCE, 'Not enough funds');
      expect(error.type).toBe('error');
      expect(error.code).toBe(ErrorCodes.INSUFFICIENT_BALANCE);
      expect(error.message).toBe('Not enough funds');
    });

    it('includes optional details in error response', () => {
      const error = createError(ErrorCodes.INVALID_BET, 'Bet too high', {
        minBet: 10,
        maxBet: 1000,
        attempted: 5000,
      });
      expect(error.details).toEqual({
        minBet: 10,
        maxBet: 1000,
        attempted: 5000,
      });
    });

    it('omits details when not provided', () => {
      const error = createError(ErrorCodes.INTERNAL_ERROR, 'Something went wrong');
      expect(error.details).toBeUndefined();
    });
  });

  describe('End-to-End Error Flow', () => {
    it('translates Rust code 3 (INSUFFICIENT_FUNDS) through full chain', () => {
      // Layer 1: Rust emits numeric code 3
      const rustCode = RustErrorCodes.ERROR_INSUFFICIENT_FUNDS;
      expect(rustCode).toBe(3);

      // Layer 2: Gateway translates to string code
      const gatewayResult = translateRustErrorCode(rustCode);
      expect(gatewayResult.code).toBe(ErrorCodes.INSUFFICIENT_BALANCE);

      // Layer 3: Mobile gets user-friendly message
      const userMessage = getUserFriendlyMessage(gatewayResult.code);
      expect(userMessage).toContain('Insufficient');

      // Full error response
      const errorResponse = createError(gatewayResult.code, userMessage);
      expect(errorResponse.type).toBe('error');
      expect(errorResponse.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('translates Rust code 4 (INVALID_BET) through full chain', () => {
      const rustCode = RustErrorCodes.ERROR_INVALID_BET;
      const gatewayResult = translateRustErrorCode(rustCode);
      const userMessage = getUserFriendlyMessage(gatewayResult.code);
      const errorResponse = createError(gatewayResult.code, userMessage);

      expect(errorResponse.code).toBe('INVALID_BET');
      expect(userMessage.toLowerCase()).toContain('invalid');
    });

    it('translates Rust code 6 (SESSION_NOT_FOUND) through full chain', () => {
      const rustCode = RustErrorCodes.ERROR_SESSION_NOT_FOUND;
      const gatewayResult = translateRustErrorCode(rustCode);
      const userMessage = getUserFriendlyMessage(gatewayResult.code);
      const errorResponse = createError(gatewayResult.code, userMessage);

      expect(errorResponse.code).toBe('NO_ACTIVE_GAME');
      expect(userMessage).toContain('No active game');
    });
  });
});

/**
 * ============================================================================
 * ERROR CODE MAPPING TABLE
 * ============================================================================
 *
 * This is the authoritative reference for error code translation.
 *
 * | Rust Code (u8) | Rust Constant                    | Gateway Code          | User Message                                    |
 * |----------------|----------------------------------|-----------------------|-------------------------------------------------|
 * | 1              | ERROR_PLAYER_ALREADY_REGISTERED  | REGISTRATION_FAILED   | Registration failed. Please try again.          |
 * | 2              | ERROR_PLAYER_NOT_FOUND           | NOT_REGISTERED        | Please register before playing.                 |
 * | 3              | ERROR_INSUFFICIENT_FUNDS         | INSUFFICIENT_BALANCE  | Insufficient balance for this bet.              |
 * | 4              | ERROR_INVALID_BET                | INVALID_BET           | Bet amount is invalid.                          |
 * | 5              | ERROR_SESSION_EXISTS             | GAME_IN_PROGRESS      | A game is already in progress.                  |
 * | 6              | ERROR_SESSION_NOT_FOUND          | NO_ACTIVE_GAME        | No active game. Please start a new game.        |
 * | 7              | ERROR_SESSION_NOT_OWNED          | TRANSACTION_REJECTED  | Transaction was rejected. Please try again.     |
 * | 8              | ERROR_SESSION_COMPLETE           | NO_ACTIVE_GAME        | No active game. Please start a new game.        |
 * | 9              | ERROR_INVALID_MOVE               | TRANSACTION_REJECTED  | Transaction was rejected. Please try again.     |
 * | 10             | ERROR_RATE_LIMITED               | TRANSACTION_REJECTED  | Transaction was rejected. Please try again.     |
 * | 11             | ERROR_TOURNAMENT_NOT_REGISTERING | TRANSACTION_REJECTED  | Transaction was rejected. Please try again.     |
 * | 12             | ERROR_ALREADY_IN_TOURNAMENT      | TRANSACTION_REJECTED  | Transaction was rejected. Please try again.     |
 * | 13             | ERROR_TOURNAMENT_LIMIT_REACHED   | TRANSACTION_REJECTED  | Transaction was rejected. Please try again.     |
 * | 14             | ERROR_NOT_IN_TOURNAMENT          | TRANSACTION_REJECTED  | Transaction was rejected. Please try again.     |
 * | 15             | ERROR_UNAUTHORIZED               | SESSION_EXPIRED       | Your session has expired. Please reconnect.     |
 * | (unknown)      | -                                | TRANSACTION_REJECTED  | Transaction was rejected. Please try again.     |
 *
 * ============================================================================
 */
