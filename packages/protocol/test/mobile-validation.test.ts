/**
 * US-103: Tests for type-safe message parsing and validation
 *
 * These tests verify that:
 * 1. Type guards correctly identify message types
 * 2. Malformed messages don't cause runtime crashes
 * 3. parseServerMessage returns proper error information
 * 4. safeGetField provides fallbacks for missing/wrong-typed fields
 */
import { describe, it, expect } from 'vitest';
import {
  GameMessageSchema,
  isGameResultMessage,
  isGameStartedMessage,
  isGameMoveMessage,
  isErrorMessage,
  isSessionReadyMessage,
  isBalanceMessage,
  isLiveTableStateMessage,
  isLiveTableResultMessage,
  parseServerMessage,
  parseBaseGameResult,
  safeGetField,
  withValidation,
  GameResultMessageSchema,
} from '../src/schema/mobile.js';

describe('US-103: Type-safe message parsing', () => {
  describe('GameMessageSchema validation', () => {
    it('validates game_result messages', () => {
      const validResult = {
        type: 'game_result',
        won: true,
        payout: '100',
      };
      expect(GameMessageSchema.safeParse(validResult).success).toBe(true);
    });

    it('validates game_started messages', () => {
      const validStarted = {
        type: 'game_started',
        sessionId: '12345',
        bet: '100',
      };
      expect(GameMessageSchema.safeParse(validStarted).success).toBe(true);
    });

    it('validates error messages', () => {
      const validError = {
        type: 'error',
        code: 'INVALID_BET',
        message: 'Bet amount exceeds balance',
      };
      expect(GameMessageSchema.safeParse(validError).success).toBe(true);
    });

    it('rejects messages without type field', () => {
      const noType = { won: true, payout: '100' };
      expect(GameMessageSchema.safeParse(noType).success).toBe(false);
    });

    it('rejects messages with unknown type', () => {
      const unknownType = { type: 'unknown_message_type' };
      expect(GameMessageSchema.safeParse(unknownType).success).toBe(false);
    });

    it('rejects game_result with wrong won type', () => {
      const wrongType = {
        type: 'game_result',
        won: 'yes', // should be boolean
        payout: '100',
      };
      expect(GameMessageSchema.safeParse(wrongType).success).toBe(false);
    });
  });

  describe('Type guards', () => {
    it('isGameResultMessage identifies game_result', () => {
      const result = { type: 'game_result', won: false, payout: '0' };
      expect(isGameResultMessage(result)).toBe(true);
      expect(isGameResultMessage({ type: 'error' })).toBe(false);
    });

    it('isGameStartedMessage identifies game_started', () => {
      const started = { type: 'game_started', sessionId: '123' };
      expect(isGameStartedMessage(started)).toBe(true);
      expect(isGameStartedMessage({ type: 'game_result' })).toBe(false);
    });

    it('isGameMoveMessage identifies game_move', () => {
      const move = { type: 'game_move', sessionId: '123' };
      expect(isGameMoveMessage(move)).toBe(true);
      expect(isGameMoveMessage({ type: 'game_started' })).toBe(false);
    });

    it('isErrorMessage identifies error', () => {
      const error = { type: 'error', code: 'E001', message: 'Test error' };
      expect(isErrorMessage(error)).toBe(true);
      expect(isErrorMessage({ type: 'game_result' })).toBe(false);
    });

    it('isSessionReadyMessage identifies session_ready', () => {
      const ready = {
        type: 'session_ready',
        sessionId: '123',
        publicKey: 'abc',
        registered: true,
        hasBalance: true,
      };
      expect(isSessionReadyMessage(ready)).toBe(true);
      expect(isSessionReadyMessage({ type: 'balance' })).toBe(false);
    });

    it('isBalanceMessage identifies balance', () => {
      const balance = {
        type: 'balance',
        registered: true,
        hasBalance: true,
        publicKey: 'abc',
      };
      expect(isBalanceMessage(balance)).toBe(true);
      expect(isBalanceMessage({ type: 'session_ready' })).toBe(false);
    });

    it('isLiveTableStateMessage identifies live_table_state', () => {
      const state = {
        type: 'live_table_state',
        game: 'craps',
        roundId: 1,
        phase: 'betting',
      };
      expect(isLiveTableStateMessage(state)).toBe(true);
      expect(isLiveTableStateMessage({ type: 'live_table_result' })).toBe(false);
    });

    it('isLiveTableResultMessage identifies live_table_result', () => {
      const result = {
        type: 'live_table_result',
        game: 'craps',
        roundId: 1,
        dice: [3, 4],
        total: 7,
      };
      expect(isLiveTableResultMessage(result)).toBe(true);
      expect(isLiveTableResultMessage({ type: 'live_table_state' })).toBe(false);
    });

    it('type guards return false for null/undefined', () => {
      expect(isGameResultMessage(null)).toBe(false);
      expect(isGameResultMessage(undefined)).toBe(false);
      expect(isErrorMessage(null)).toBe(false);
    });
  });

  describe('parseServerMessage', () => {
    it('returns success for valid messages', () => {
      const valid = { type: 'game_result', won: true, payout: '50' };
      const result = parseServerMessage(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('game_result');
      }
    });

    it('returns error details for invalid messages', () => {
      const invalid = { type: 'invalid_type' };
      const result = parseServerMessage(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
        expect(result.raw).toBe(invalid);
      }
    });

    it('handles non-object input gracefully', () => {
      expect(parseServerMessage(null).success).toBe(false);
      expect(parseServerMessage(undefined).success).toBe(false);
      expect(parseServerMessage('string').success).toBe(false);
      expect(parseServerMessage(123).success).toBe(false);
    });
  });

  describe('parseBaseGameResult', () => {
    it('returns parsed message for valid input', () => {
      const valid = { type: 'game_result', won: false, payout: '0' };
      const result = parseBaseGameResult(valid);
      expect(result).not.toBeNull();
      expect(result?.won).toBe(false);
      expect(result?.payout).toBe('0');
    });

    it('returns null for invalid input', () => {
      expect(parseBaseGameResult({ type: 'error' })).toBeNull();
      expect(parseBaseGameResult(null)).toBeNull();
      expect(parseBaseGameResult({ won: true })).toBeNull(); // missing type
    });
  });

  describe('safeGetField', () => {
    it('returns value when type matches', () => {
      const obj = { name: 'test', count: 42, active: true };
      expect(safeGetField(obj, 'name', '')).toBe('test');
      expect(safeGetField(obj, 'count', 0)).toBe(42);
      expect(safeGetField(obj, 'active', false)).toBe(true);
    });

    it('returns fallback for missing fields', () => {
      const obj = { name: 'test' };
      expect(safeGetField(obj, 'missing', 'default')).toBe('default');
      expect(safeGetField(obj, 'count', 0)).toBe(0);
    });

    it('returns fallback for wrong type', () => {
      const obj = { count: 'not a number', active: 'true' };
      expect(safeGetField(obj, 'count', 0)).toBe(0);
      expect(safeGetField(obj, 'active', false)).toBe(false);
    });

    it('handles arrays', () => {
      const obj = { items: [1, 2, 3], notArray: 'string' };
      expect(safeGetField(obj, 'items', [])).toEqual([1, 2, 3]);
      expect(safeGetField(obj, 'notArray', [])).toEqual([]);
      expect(safeGetField(obj, 'missing', [1, 2])).toEqual([1, 2]);
    });

    it('returns fallback for null/undefined values', () => {
      const obj = { nullVal: null, undefVal: undefined };
      expect(safeGetField(obj, 'nullVal', 'default')).toBe('default');
      expect(safeGetField(obj, 'undefVal', 'default')).toBe('default');
    });
  });

  describe('withValidation', () => {
    it('calls handler with validated data', () => {
      const handler = withValidation(GameResultMessageSchema, (msg) => msg.won);
      const valid = { type: 'game_result', won: true, payout: '100' };
      expect(handler(valid)).toBe(true);
    });

    it('returns undefined for invalid input', () => {
      const handler = withValidation(GameResultMessageSchema, (msg) => msg.won);
      const invalid = { type: 'error' };
      expect(handler(invalid)).toBeUndefined();
    });

    it('works with complex transformations', () => {
      const handler = withValidation(GameResultMessageSchema, (msg) => {
        return msg.won ? `Won ${msg.payout}` : 'Lost';
      });
      expect(handler({ type: 'game_result', won: true, payout: '50' })).toBe('Won 50');
      expect(handler({ type: 'game_result', won: false, payout: '0' })).toBe('Lost');
    });
  });

  describe('Malformed message handling', () => {
    it('rejects game_result with missing required fields', () => {
      // won is required
      expect(GameMessageSchema.safeParse({ type: 'game_result', payout: '100' }).success).toBe(false);
      // payout is required
      expect(GameMessageSchema.safeParse({ type: 'game_result', won: true }).success).toBe(false);
    });

    it('rejects error message with missing code', () => {
      const noCode = { type: 'error', message: 'Something went wrong' };
      expect(GameMessageSchema.safeParse(noCode).success).toBe(false);
    });

    it('rejects session_ready with missing fields', () => {
      const partial = { type: 'session_ready', sessionId: '123' };
      expect(GameMessageSchema.safeParse(partial).success).toBe(false);
    });

    it('handles deeply nested invalid data', () => {
      const badNested = {
        type: 'game_result',
        won: true,
        payout: '100',
        hands: [{ cards: 'not an array' }], // passthrough allows this but would fail stricter schema
      };
      // GameResultMessageSchema uses passthrough, so this passes base validation
      // The stricter BlackjackGameResultMessageSchema would catch this
      const result = GameMessageSchema.safeParse(badNested);
      expect(result.success).toBe(true); // passthrough allows extra fields
    });

    it('rejects completely malformed JSON structures', () => {
      expect(parseServerMessage([1, 2, 3]).success).toBe(false);
      expect(parseServerMessage({ 0: 'array-like' }).success).toBe(false);
    });
  });
});
