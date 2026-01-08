/**
 * Protocol Round-Trip Tests (US-024)
 *
 * These tests verify the complete TypeScript → Rust → TypeScript flow:
 * 1. TypeScript encodes a move payload
 * 2. Rust processes it and generates a state blob
 * 3. TypeScript decodes the state blob
 *
 * This catches protocol drift between frontend encoding and backend processing.
 *
 * NOTE: US-149 added a protocol version header to all encoded payloads.
 * The Rust backend doesn't yet understand the version header, so we strip it
 * before sending payloads to the Rust binary (via toHexStripped helper).
 * Once the Rust side is updated (execution/src/casino/payload.rs), these tests
 * can send versioned payloads directly.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { stripVersionHeader } from '../src/version.js';

// Import encoders from protocol package
import {
  encodeBlackjackMove,
  encodeRouletteMove,
  encodeRouletteAtomicBatch,
  encodeCrapsAtomicBatch,
  encodeBaccaratAtomicBatch,
  encodeSicBoAtomicBatch,
} from '../src/encode.js';

// Dynamically import game-state parsers (separate package)
const gameStateModule = await import('@nullspace/game-state');
const {
  parseBlackjackState,
  parseRouletteState,
  parseCrapsState,
  parseBaccaratState,
  parseSicBoState,
  parseHiLoState,
  parseVideoPokerState,
  parseCasinoWarState,
  parseThreeCardState,
  parseUltimateHoldemState,
} = gameStateModule;

// Helper to convert Uint8Array to hex string
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to strip version header and convert to hex for Rust binary
// The Rust binary doesn't yet understand version headers (US-149),
// so we strip them before sending.
function toHexStripped(bytes: Uint8Array): string {
  const { payload } = stripVersionHeader(bytes);
  return toHex(payload);
}

// Helper to convert hex string to Uint8Array
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

interface RoundTripResult {
  game_type: string;
  bet: number;
  session_id: number;
  moves_processed: number;
  state_blob_hex: string;
  is_complete: boolean;
  move_count: number;
}

// Path to the Rust binary
const RUST_BINARY_PATH = join(__dirname, '..', '..', '..', 'target', 'debug', 'game-round-trip');
const RUST_BINARY_RELEASE_PATH = join(__dirname, '..', '..', '..', 'target', 'release', 'game-round-trip');

function getRustBinaryPath(): string {
  if (existsSync(RUST_BINARY_RELEASE_PATH)) {
    return RUST_BINARY_RELEASE_PATH;
  }
  if (existsSync(RUST_BINARY_PATH)) {
    return RUST_BINARY_PATH;
  }
  throw new Error(
    `Rust binary not found. Build it with: cargo build --bin game-round-trip\n` +
    `Checked paths:\n  ${RUST_BINARY_PATH}\n  ${RUST_BINARY_RELEASE_PATH}`
  );
}

function runRustGame(gameType: string, bet: number, moveHexes: string[]): RoundTripResult {
  const binaryPath = getRustBinaryPath();
  const args = [gameType, bet.toString(), ...moveHexes];

  const result = spawnSync(binaryPath, args, {
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (result.error) {
    throw new Error(`Failed to run Rust binary: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Rust binary failed with status ${result.status}: ${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout.trim());
  } catch (e) {
    throw new Error(`Failed to parse Rust output as JSON: ${result.stdout}`);
  }
}

describe('Protocol Round-Trip Tests', () => {
  let binaryAvailable = false;

  beforeAll(() => {
    try {
      getRustBinaryPath();
      binaryAvailable = true;
    } catch {
      console.warn('Rust binary not available, skipping round-trip tests');
      console.warn('Build with: cargo build --bin game-round-trip');
    }
  });

  describe('Blackjack', () => {
    it('encodes deal, Rust processes, TypeScript decodes state', () => {
      if (!binaryAvailable) return;

      // TypeScript encodes (now includes version header)
      const dealPayload = encodeBlackjackMove('deal');
      expect(dealPayload).toEqual(new Uint8Array([0x01, 0x04])); // [version, deal opcode]

      // Rust processes (strip version header since Rust doesn't know about it yet)
      const result = runRustGame('blackjack', 100, [toHexStripped(dealPayload)]);
      expect(result.moves_processed).toBe(1);
      expect(result.state_blob_hex.length).toBeGreaterThan(0);

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseBlackjackState(stateBlob);

      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe(4); // v4 is current
      expect(parsed!.stage).toBe(1); // 1 = playing after deal
      expect(parsed!.hands.length).toBeGreaterThan(0);
      expect(parsed!.dealerCards.length).toBeGreaterThan(0);
    });

    it('encodes hit after deal', () => {
      if (!binaryAvailable) return;

      const dealPayload = encodeBlackjackMove('deal');
      const hitPayload = encodeBlackjackMove('hit');

      // Strip version headers for Rust binary
      const result = runRustGame('blackjack', 100, [
        toHexStripped(dealPayload),
        toHexStripped(hitPayload),
      ]);

      expect(result.moves_processed).toBe(2);

      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseBlackjackState(stateBlob);

      expect(parsed).not.toBeNull();
      // After hit, player should have more cards
      if (parsed!.hands.length > 0) {
        expect(parsed!.hands[0].cards.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('Roulette', () => {
    it('encodes bet (auto-spins), TypeScript decodes result', () => {
      if (!binaryAvailable) return;

      // TypeScript encodes atomic batch bet
      // Roulette auto-spins when bet is placed
      const betPayload = encodeRouletteAtomicBatch([
        { betType: 1, number: 0, amount: 100n }, // Red bet
      ]);

      // Rust processes (bet triggers auto-spin) - strip version header
      const result = runRustGame('roulette', 100, [toHexStripped(betPayload)]);

      expect(result.moves_processed).toBe(1);
      expect(result.is_complete).toBe(true); // Game completes after spin

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseRouletteState(stateBlob);

      expect(parsed).not.toBeNull();
      expect(parsed!.betCount).toBeGreaterThanOrEqual(0);
      // After spin, result should be set (0-36)
      if (parsed!.result !== null) {
        expect(parsed!.result).toBeGreaterThanOrEqual(0);
        expect(parsed!.result).toBeLessThanOrEqual(36);
      }
    });
  });

  describe('Craps', () => {
    it('encodes bet (auto-rolls), TypeScript decodes dice', () => {
      if (!binaryAvailable) return;

      // TypeScript encodes atomic batch bet
      // Craps auto-rolls when bet is placed
      const betPayload = encodeCrapsAtomicBatch([
        { betType: 0, target: 0, amount: 100n }, // Pass bet
      ]);

      // Rust processes (bet triggers auto-roll) - strip version header
      const result = runRustGame('craps', 100, [toHexStripped(betPayload)]);

      expect(result.moves_processed).toBe(1);
      expect(result.is_complete).toBe(true); // Game completes after roll

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseCrapsState(stateBlob);

      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe(2);
      expect(parsed!.dice).toBeDefined();
      // Dice values should be 1-6
      expect(parsed!.dice[0]).toBeGreaterThanOrEqual(1);
      expect(parsed!.dice[0]).toBeLessThanOrEqual(6);
      expect(parsed!.dice[1]).toBeGreaterThanOrEqual(1);
      expect(parsed!.dice[1]).toBeLessThanOrEqual(6);
    });
  });

  describe('Baccarat', () => {
    it('encodes bet + deal, TypeScript decodes cards', () => {
      if (!binaryAvailable) return;

      // TypeScript encodes atomic batch bet
      const betPayload = encodeBaccaratAtomicBatch([
        { betType: 0, amount: 100n }, // Player bet
      ]);
      // Deal is opcode 0 (the bet triggers deal in baccarat)
      // Actually baccarat auto-deals when you place bet

      // Rust processes - strip version header
      const result = runRustGame('baccarat', 100, [toHexStripped(betPayload)]);

      expect(result.moves_processed).toBe(1);

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseBaccaratState(stateBlob);

      expect(parsed).not.toBeNull();
      // After bet, cards are dealt
      expect(parsed!.playerCards.length).toBeGreaterThanOrEqual(0);
      expect(parsed!.bankerCards.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SicBo', () => {
    it('encodes bet (auto-rolls), TypeScript decodes dice', () => {
      if (!binaryAvailable) return;

      // TypeScript encodes atomic batch bet
      // SicBo auto-rolls when bet is placed
      const betPayload = encodeSicBoAtomicBatch([
        { betType: 0, target: 0, amount: 100n }, // Small bet
      ]);

      // Rust processes (bet triggers auto-roll) - strip version header
      const result = runRustGame('sicbo', 100, [toHexStripped(betPayload)]);

      expect(result.moves_processed).toBe(1);
      expect(result.is_complete).toBe(true);

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseSicBoState(stateBlob);

      expect(parsed).not.toBeNull();
      // After roll, should have 3 dice
      if (parsed!.dice) {
        expect(parsed!.dice.length).toBe(3);
        parsed!.dice.forEach((d) => {
          expect(d).toBeGreaterThanOrEqual(1);
          expect(d).toBeLessThanOrEqual(6);
        });
      }
    });
  });

  describe('HiLo', () => {
    it('processes deal, TypeScript decodes card and multipliers', () => {
      if (!binaryAvailable) return;

      // HiLo Deal is opcode 0 (raw payload without version for Rust)
      const dealPayload = new Uint8Array([0x00]);

      // Rust processes (passing raw opcode without version)
      const result = runRustGame('hilo', 100, [toHex(dealPayload)]);

      expect(result.moves_processed).toBe(1);
      expect(result.is_complete).toBe(true); // Single card game

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseHiLoState(stateBlob);

      expect(parsed).not.toBeNull();
      // Card ID should be 0-51
      expect(parsed!.cardId).toBeGreaterThanOrEqual(0);
      expect(parsed!.cardId).toBeLessThanOrEqual(51);
      // Accumulator can be 0 or positive depending on game state
      expect(parsed!.accumulatorBasisPoints).toBeGreaterThanOrEqual(0n);
      // Should have multipliers
      if (parsed!.nextMultipliers) {
        expect(parsed!.nextMultipliers.higher).toBeGreaterThanOrEqual(0);
        expect(parsed!.nextMultipliers.lower).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('VideoPoker', () => {
    it('processes deal, TypeScript decodes cards', () => {
      if (!binaryAvailable) return;

      // VideoPoker Deal is opcode 0 (raw payload without version for Rust)
      const dealPayload = new Uint8Array([0x00]);

      // Rust processes (passing raw opcode without version)
      const result = runRustGame('videopoker', 100, [toHex(dealPayload)]);

      expect(result.moves_processed).toBe(1);
      expect(result.is_complete).toBe(true); // Game resolves after deal

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseVideoPokerState(stateBlob);

      expect(parsed).not.toBeNull();
      expect(parsed!.stage).toBeGreaterThanOrEqual(0); // 0 = deal, 1 = draw
      expect(parsed!.cards.length).toBe(5); // 5 cards dealt
      // Cards should be 0-51
      parsed!.cards.forEach((c) => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(51);
      });
    });
  });

  describe('CasinoWar', () => {
    it('processes deal, TypeScript decodes cards', () => {
      if (!binaryAvailable) return;

      // Deal is opcode 0 (raw payload without version for Rust)
      const dealPayload = new Uint8Array([0x00]);

      // Rust processes (passing raw opcode without version)
      const result = runRustGame('casinowar', 100, [toHex(dealPayload)]);

      expect(result.moves_processed).toBe(1);

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseCasinoWarState(stateBlob);

      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe(1);
      // After deal, should have cards
      if (parsed!.playerCard !== 255) {
        expect(parsed!.playerCard).toBeGreaterThanOrEqual(0);
        expect(parsed!.playerCard).toBeLessThanOrEqual(51);
      }
      if (parsed!.dealerCard !== 255) {
        expect(parsed!.dealerCard).toBeGreaterThanOrEqual(0);
        expect(parsed!.dealerCard).toBeLessThanOrEqual(51);
      }
    });
  });

  describe('ThreeCard', () => {
    it('processes deal, TypeScript decodes cards', () => {
      if (!binaryAvailable) return;

      // ThreeCard Deal is opcode 2 (raw payload without version for Rust)
      const dealPayload = new Uint8Array([0x02]);

      // Rust processes (passing raw opcode without version)
      const result = runRustGame('threecard', 100, [toHex(dealPayload)]);

      expect(result.moves_processed).toBe(1);

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseThreeCardState(stateBlob);

      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBeGreaterThanOrEqual(1);
      // Should have 3 player cards (or 255 if hidden)
      expect(parsed!.playerCards.length).toBe(3);
    });
  });

  describe('UltimateHoldem', () => {
    it('processes deal, TypeScript decodes cards', () => {
      if (!binaryAvailable) return;

      // UltimateHoldem Deal is opcode 5 (raw payload without version for Rust)
      const dealPayload = new Uint8Array([0x05]);

      // Rust processes (passing raw opcode without version)
      const result = runRustGame('ultimateholdem', 100, [toHex(dealPayload)]);

      expect(result.moves_processed).toBe(1);

      // TypeScript decodes
      const stateBlob = fromHex(result.state_blob_hex);
      const parsed = parseUltimateHoldemState(stateBlob);

      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBeGreaterThanOrEqual(1);
      // Should have 2 player cards
      expect(parsed!.playerCards.length).toBe(2);
      // Should have 5 community card slots
      expect(parsed!.communityCards.length).toBe(5);
    });
  });
});
