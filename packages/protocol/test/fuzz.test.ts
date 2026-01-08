/**
 * Protocol Fuzzing Tests (US-167)
 *
 * Property-based fuzzing tests using fast-check to discover edge cases
 * that manual tests miss. Tests:
 *
 * 1. Roundtrip encoding: encode(x) -> decode(encode(x)) === x (where applicable)
 * 2. Mutation testing: flip bits in valid messages, ensure graceful handling
 * 3. Random binary input: decode should never crash on arbitrary bytes
 * 4. Boundary conditions: test edge values for all numeric fields
 *
 * Run with: pnpm test fuzz.test.ts
 * Run extended: FUZZ_ITERATIONS=1000000 pnpm test fuzz.test.ts
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  // Encoders
  encodeBlackjackMove,
  encodeRouletteBet,
  encodeRouletteAtomicBatch,
  encodeCrapsAtomicBatch,
  encodeBaccaratAtomicBatch,
  encodeSicBoAtomicBatch,
  encodeCrapsPlaceBet,
  type BlackjackMoveAction,
  type RouletteMoveAction,
  type CrapsMoveAction,
} from '../src/encode.js';
import {
  // Decoders
  decodeCard,
  decodeCards,
  decodeGameResult,
  decodeBlackjackState,
  decodeVersionedPayload,
  tryDecodeVersion,
  CURRENT_PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  MAX_PROTOCOL_VERSION,
  ProtocolError,
  UnsupportedProtocolVersionError,
} from '../src/index.js';
import {
  withVersionHeader,
  stripVersionHeader,
  validateVersion,
  peekVersion,
} from '../src/version.js';

// Number of iterations - can be overridden with FUZZ_ITERATIONS env var
const FUZZ_ITERATIONS = parseInt(process.env.FUZZ_ITERATIONS || '10000', 10);
const CI_ITERATIONS = 1000; // Reduced count for CI

const iterations = process.env.CI ? CI_ITERATIONS : FUZZ_ITERATIONS;

describe('Protocol Fuzzing Tests', () => {
  describe('Version header roundtrip', () => {
    it('withVersionHeader → stripVersionHeader preserves payload', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 1, maxLength: 1000 }),
          (payload) => {
            const versioned = withVersionHeader(payload);
            const { version, payload: stripped } = stripVersionHeader(versioned);

            expect(version).toBe(CURRENT_PROTOCOL_VERSION);
            expect(stripped).toEqual(payload);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('peekVersion returns version byte without consuming', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 1, maxLength: 100 }),
          (data) => {
            const version = peekVersion(data);
            expect(version).toBe(data[0]);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('peekVersion returns null for empty buffer', () => {
      expect(peekVersion(new Uint8Array([]))).toBeNull();
    });
  });

  describe('Blackjack move encoding stability', () => {
    const validMoves: BlackjackMoveAction[] = ['hit', 'stand', 'double', 'split', 'deal', 'surrender'];

    it('encodes all valid moves without error', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...validMoves),
          (move) => {
            const encoded = encodeBlackjackMove(move);
            expect(encoded.length).toBe(2); // version + opcode
            expect(encoded[0]).toBe(CURRENT_PROTOCOL_VERSION);
          }
        ),
        { numRuns: iterations }
      );
    });
  });

  describe('Roulette bet encoding stability', () => {
    it('encodes valid roulette bets without error', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 255 }), // betType
          fc.integer({ min: 0, max: 36 }),  // number (0-36 valid for roulette)
          fc.bigInt({ min: 1n, max: BigInt(Number.MAX_SAFE_INTEGER) }), // amount
          (betType, number, amount) => {
            const encoded = encodeRouletteBet(betType, number, amount);
            expect(encoded.length).toBe(12); // version + opcode + betType + number + 8 bytes amount
            expect(encoded[0]).toBe(CURRENT_PROTOCOL_VERSION);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('handles maximum bigint amounts', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: BigInt('9223372036854775807'), max: BigInt('18446744073709551615') }),
          (amount) => {
            const encoded = encodeRouletteBet(0, 0, amount);
            expect(encoded.length).toBe(12);
          }
        ),
        { numRuns: Math.min(iterations, 1000) } // Fewer iterations for large numbers
      );
    });
  });

  describe('Atomic batch encoding stability', () => {
    it('encodes roulette atomic batches without error', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              type: fc.integer({ min: 0, max: 20 }),
              amount: fc.bigInt({ min: 1n, max: 1000000n }),
              target: fc.integer({ min: 0, max: 36 }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (bets) => {
            const encoded = encodeRouletteAtomicBatch(
              bets.map((b) => ({ betType: b.type, amount: b.amount, number: b.target }))
            );
            expect(encoded.length).toBe(3 + bets.length * 10); // version + opcode + count + bets
          }
        ),
        { numRuns: iterations }
      );
    });

    it('encodes craps atomic batches without error', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              type: fc.integer({ min: 0, max: 20 }),
              amount: fc.bigInt({ min: 1n, max: 1000000n }),
              target: fc.integer({ min: 0, max: 10 }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (bets) => {
            const encoded = encodeCrapsAtomicBatch(bets);
            expect(encoded.length).toBe(3 + bets.length * 10);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('encodes baccarat atomic batches without error', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              type: fc.integer({ min: 0, max: 5 }),
              amount: fc.bigInt({ min: 1n, max: 1000000n }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (bets) => {
            const encoded = encodeBaccaratAtomicBatch(bets);
            expect(encoded.length).toBe(3 + bets.length * 9); // baccarat bets are 9 bytes each
          }
        ),
        { numRuns: iterations }
      );
    });

    it('encodes sicbo atomic batches without error', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              type: fc.integer({ min: 0, max: 20 }),
              amount: fc.bigInt({ min: 1n, max: 1000000n }),
              target: fc.integer({ min: 0, max: 18 }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (bets) => {
            const encoded = encodeSicBoAtomicBatch(bets);
            expect(encoded.length).toBe(3 + bets.length * 10);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('rejects empty bet arrays', () => {
      expect(() => encodeRouletteAtomicBatch([])).toThrow('No bets provided');
      expect(() => encodeCrapsAtomicBatch([])).toThrow('No bets provided');
      expect(() => encodeBaccaratAtomicBatch([])).toThrow('No bets provided');
      expect(() => encodeSicBoAtomicBatch([])).toThrow('No bets provided');
    });

    it('rejects zero/negative amounts', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: BigInt('-1000000'), max: 0n }),
          (amount) => {
            expect(() =>
              encodeRouletteAtomicBatch([{ betType: 0, amount, number: 0 }])
            ).toThrow('Bet amount must be positive');
          }
        ),
        { numRuns: Math.min(iterations, 100) }
      );
    });
  });

  describe('Card decoding robustness', () => {
    it('decodes valid cards without error', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 3 }),  // suit 0-3
          fc.integer({ min: 0, max: 12 }), // rank 0-12
          fc.integer({ min: 0, max: 255 }), // faceUp (any non-zero = true)
          (suit, rank, faceUp) => {
            const data = new Uint8Array([suit, rank, faceUp]);
            const card = decodeCard(data, 0);
            expect(['spades', 'hearts', 'diamonds', 'clubs']).toContain(card.suit);
            expect(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']).toContain(
              card.rank
            );
            expect(card.faceUp).toBe(faceUp !== 0);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('throws ProtocolError for invalid suit bytes', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 4, max: 255 }), // invalid suit
          (suit) => {
            const data = new Uint8Array([suit, 0, 1]);
            expect(() => decodeCard(data, 0)).toThrow(ProtocolError);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('throws ProtocolError for invalid rank bytes', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 13, max: 255 }), // invalid rank
          (rank) => {
            const data = new Uint8Array([0, rank, 1]);
            expect(() => decodeCard(data, 0)).toThrow(ProtocolError);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('throws ProtocolError for truncated card data', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 2 }), // less than 3 bytes
          (data) => {
            expect(() => decodeCard(data, 0)).toThrow(ProtocolError);
          }
        ),
        { numRuns: iterations }
      );
    });
  });

  describe('Game result decoding robustness', () => {
    it('decodes valid game results without error', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: BigInt('18446744073709551615') }), // sessionId
          fc.integer({ min: 0, max: 9 }), // gameType
          fc.boolean(), // won
          fc.bigInt({ min: 0n, max: BigInt('18446744073709551615') }), // payout
          fc.string({ minLength: 0, maxLength: 200 }), // message
          (sessionId, gameType, won, payout, message) => {
            const msgBytes = new TextEncoder().encode(message);
            if (msgBytes.length > 255) return; // Skip if message too long for u8 length

            const buffer = new ArrayBuffer(19 + msgBytes.length);
            const view = new DataView(buffer);
            view.setBigUint64(0, sessionId, true);
            view.setUint8(8, gameType);
            view.setUint8(9, won ? 1 : 0);
            view.setBigUint64(10, payout, true);
            view.setUint8(18, msgBytes.length);
            new Uint8Array(buffer).set(msgBytes, 19);

            const result = decodeGameResult(new Uint8Array(buffer));
            expect(result.sessionId).toBe(sessionId);
            expect(result.gameType).toBe(gameType);
            expect(result.won).toBe(won);
            expect(result.payout).toBe(payout);
            // Message may differ due to UTF-8 encoding differences
          }
        ),
        { numRuns: iterations }
      );
    });

    it('throws ProtocolError for invalid game type', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 255 }), // invalid gameType
          (gameType) => {
            const buffer = new ArrayBuffer(19);
            const view = new DataView(buffer);
            view.setBigUint64(0, 1n, true);
            view.setUint8(8, gameType);
            view.setUint8(9, 0);
            view.setBigUint64(10, 0n, true);
            view.setUint8(18, 0);

            expect(() => decodeGameResult(new Uint8Array(buffer))).toThrow(ProtocolError);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('throws ProtocolError for truncated game result data', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 18 }), // less than minimum 19 bytes
          (data) => {
            expect(() => decodeGameResult(data)).toThrow(ProtocolError);
          }
        ),
        { numRuns: iterations }
      );
    });
  });

  describe('Blackjack state decoding robustness', () => {
    it('throws ProtocolError for truncated blackjack state', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 7 }), // less than minimum 8 bytes
          (data) => {
            expect(() => decodeBlackjackState(data)).toThrow(ProtocolError);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('throws ProtocolError for invalid stage byte', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 4, max: 255 }), // invalid stage
          (stage) => {
            const buffer = new ArrayBuffer(15);
            const view = new DataView(buffer);
            view.setBigUint64(0, 1n, true);
            view.setUint8(8, 0); // 0 player cards
            view.setUint8(9, 0); // 0 dealer cards
            view.setUint8(10, 21); // playerTotal
            view.setUint8(11, 10); // dealerTotal
            view.setUint8(12, stage); // invalid stage
            view.setUint8(13, 0); // actionFlags

            expect(() => decodeBlackjackState(new Uint8Array(buffer))).toThrow(ProtocolError);
          }
        ),
        { numRuns: iterations }
      );
    });
  });

  describe('Versioned payload decoding robustness', () => {
    it('decodes valid versioned payloads', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: MIN_PROTOCOL_VERSION, max: MAX_PROTOCOL_VERSION }),
          fc.integer({ min: 0, max: 255 }), // opcode
          fc.uint8Array({ minLength: 0, maxLength: 100 }), // extra payload
          (version, opcode, extra) => {
            const data = new Uint8Array(2 + extra.length);
            data[0] = version;
            data[1] = opcode;
            data.set(extra, 2);

            const decoded = decodeVersionedPayload(data);
            expect(decoded.version).toBe(version);
            expect(decoded.opcode).toBe(opcode);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('throws for unsupported protocol versions', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: 0, max: MIN_PROTOCOL_VERSION - 1 }),
            fc.integer({ min: MAX_PROTOCOL_VERSION + 1, max: 255 })
          ),
          (version) => {
            const data = new Uint8Array([version, 0]);
            expect(() => decodeVersionedPayload(data)).toThrow(UnsupportedProtocolVersionError);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('throws for payloads shorter than 2 bytes', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 1 }),
          (data) => {
            expect(() => decodeVersionedPayload(data)).toThrow(ProtocolError);
          }
        ),
        { numRuns: iterations }
      );
    });

    it('tryDecodeVersion returns isSupported correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 255 }),
          (version) => {
            const data = new Uint8Array([version]);
            const result = tryDecodeVersion(data);

            expect(result).not.toBeNull();
            expect(result!.version).toBe(version);
            expect(result!.isSupported).toBe(
              version >= MIN_PROTOCOL_VERSION && version <= MAX_PROTOCOL_VERSION
            );
          }
        ),
        { numRuns: iterations }
      );
    });
  });

  describe('Random binary input (crash testing)', () => {
    it('decodeCard never crashes on random bytes', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 100 }),
          (data) => {
            try {
              decodeCard(data, 0);
            } catch (e) {
              // Should only throw ProtocolError, never crash
              expect(e).toBeInstanceOf(ProtocolError);
            }
          }
        ),
        { numRuns: iterations }
      );
    });

    it('decodeCards never crashes on random bytes', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 100 }),
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 0, max: 50 }),
          (data, count, offset) => {
            try {
              decodeCards(data, count, offset);
            } catch (e) {
              expect(e).toBeInstanceOf(ProtocolError);
            }
          }
        ),
        { numRuns: iterations }
      );
    });

    it('decodeGameResult never crashes on random bytes', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 500 }),
          (data) => {
            try {
              decodeGameResult(data);
            } catch (e) {
              expect(e).toBeInstanceOf(ProtocolError);
            }
          }
        ),
        { numRuns: iterations }
      );
    });

    it('decodeBlackjackState never crashes on random bytes', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 500 }),
          (data) => {
            try {
              decodeBlackjackState(data);
            } catch (e) {
              expect(e).toBeInstanceOf(ProtocolError);
            }
          }
        ),
        { numRuns: iterations }
      );
    });

    it('decodeVersionedPayload never crashes on random bytes', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 100 }),
          (data) => {
            try {
              decodeVersionedPayload(data);
            } catch (e) {
              // Can throw ProtocolError or UnsupportedProtocolVersionError
              expect(e instanceof ProtocolError || e instanceof UnsupportedProtocolVersionError).toBe(true);
            }
          }
        ),
        { numRuns: iterations }
      );
    });

    it('stripVersionHeader never crashes on random bytes', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 100 }),
          (data) => {
            try {
              stripVersionHeader(data);
            } catch (e) {
              expect(e instanceof ProtocolError || e instanceof UnsupportedProtocolVersionError).toBe(true);
            }
          }
        ),
        { numRuns: iterations }
      );
    });
  });

  describe('Mutation testing (bit flips)', () => {
    it('handles single bit flips in valid card data gracefully', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 3 }),  // valid suit
          fc.integer({ min: 0, max: 12 }), // valid rank
          fc.integer({ min: 0, max: 23 }), // bit position (3 bytes = 24 bits)
          (suit, rank, bitPos) => {
            const data = new Uint8Array([suit, rank, 1]);
            const byteIdx = Math.floor(bitPos / 8);
            const bitIdx = bitPos % 8;
            data[byteIdx] ^= (1 << bitIdx); // flip bit

            try {
              const card = decodeCard(data, 0);
              // If decoding succeeds, card should be valid structure
              expect(card).toHaveProperty('suit');
              expect(card).toHaveProperty('rank');
              expect(card).toHaveProperty('faceUp');
            } catch (e) {
              // Should only throw ProtocolError for invalid data
              expect(e).toBeInstanceOf(ProtocolError);
            }
          }
        ),
        { numRuns: iterations }
      );
    });

    it('handles byte truncation in valid game result data', () => {
      // Create a valid game result
      const validResult = new ArrayBuffer(24);
      const view = new DataView(validResult);
      view.setBigUint64(0, 42n, true);
      view.setUint8(8, 2); // gameType
      view.setUint8(9, 1); // won
      view.setBigUint64(10, 500n, true);
      view.setUint8(18, 5); // msgLen
      new Uint8Array(validResult).set(new TextEncoder().encode('hello'), 19);

      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 23 }), // truncation point
          (truncateAt) => {
            const truncated = new Uint8Array(validResult).slice(0, truncateAt);
            try {
              decodeGameResult(truncated);
            } catch (e) {
              expect(e).toBeInstanceOf(ProtocolError);
            }
          }
        ),
        { numRuns: Math.min(iterations, 24) } // Only 24 meaningful truncation points
      );
    });
  });

  describe('Boundary condition tests', () => {
    it('handles boundary values for sessionId', () => {
      const boundaryValues = [
        0n,
        1n,
        BigInt(Number.MAX_SAFE_INTEGER),
        BigInt('9223372036854775807'), // i64 max
        BigInt('18446744073709551615'), // u64 max
      ];

      for (const sessionId of boundaryValues) {
        const buffer = new ArrayBuffer(19);
        const view = new DataView(buffer);
        view.setBigUint64(0, sessionId, true);
        view.setUint8(8, 0); // gameType
        view.setUint8(9, 0); // won
        view.setBigUint64(10, 0n, true); // payout
        view.setUint8(18, 0); // msgLen

        const result = decodeGameResult(new Uint8Array(buffer));
        expect(result.sessionId).toBe(sessionId);
      }
    });

    it('handles boundary values for payout', () => {
      const boundaryValues = [
        0n,
        1n,
        BigInt(Number.MAX_SAFE_INTEGER),
        BigInt('9223372036854775807'),
        BigInt('18446744073709551615'),
      ];

      for (const payout of boundaryValues) {
        const buffer = new ArrayBuffer(19);
        const view = new DataView(buffer);
        view.setBigUint64(0, 1n, true);
        view.setUint8(8, 0);
        view.setUint8(9, 1);
        view.setBigUint64(10, payout, true);
        view.setUint8(18, 0);

        const result = decodeGameResult(new Uint8Array(buffer));
        expect(result.payout).toBe(payout);
      }
    });

    it('handles boundary values for bet amounts in encoding', () => {
      const boundaryValues = [
        1n,
        BigInt(Number.MAX_SAFE_INTEGER),
        BigInt('9223372036854775807'),
        BigInt('18446744073709551615'),
      ];

      for (const amount of boundaryValues) {
        // Should encode without error
        const encoded = encodeRouletteBet(0, 0, amount);
        expect(encoded.length).toBe(12);
      }
    });

    it('handles boundary values for message length', () => {
      // Test message lengths 0, 1, 255 (max for u8)
      for (const msgLen of [0, 1, 127, 255]) {
        const msg = 'x'.repeat(msgLen);
        const msgBytes = new TextEncoder().encode(msg);
        const buffer = new ArrayBuffer(19 + msgLen);
        const view = new DataView(buffer);
        view.setBigUint64(0, 1n, true);
        view.setUint8(8, 0);
        view.setUint8(9, 0);
        view.setBigUint64(10, 0n, true);
        view.setUint8(18, msgLen);
        new Uint8Array(buffer).set(msgBytes, 19);

        const result = decodeGameResult(new Uint8Array(buffer));
        expect(result.message.length).toBe(msgLen);
      }
    });

    it('handles boundary values for card counts', () => {
      // Test 0 cards, 1 card, max reasonable (21 cards in blackjack edge case)
      for (const cardCount of [0, 1, 10, 21]) {
        const cardBytes = cardCount * 3;
        const buffer = new ArrayBuffer(14 + cardBytes * 2);
        const view = new DataView(buffer);
        view.setBigUint64(0, 1n, true);
        view.setUint8(8, cardCount); // player cards
        // Fill with valid card data
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < cardCount; i++) {
          bytes[9 + i * 3] = 0; // suit
          bytes[9 + i * 3 + 1] = 0; // rank
          bytes[9 + i * 3 + 2] = 1; // faceUp
        }
        view.setUint8(9 + cardBytes, cardCount); // dealer cards
        for (let i = 0; i < cardCount; i++) {
          bytes[10 + cardBytes + i * 3] = 0;
          bytes[10 + cardBytes + i * 3 + 1] = 0;
          bytes[10 + cardBytes + i * 3 + 2] = 1;
        }
        view.setUint8(10 + cardBytes * 2, 0); // playerTotal
        view.setUint8(11 + cardBytes * 2, 0); // dealerTotal
        view.setUint8(12 + cardBytes * 2, 0); // stage
        view.setUint8(13 + cardBytes * 2, 0); // flags

        const state = decodeBlackjackState(bytes);
        expect(state.playerCards.length).toBe(cardCount);
        expect(state.dealerCards.length).toBe(cardCount);
      }
    });
  });

  describe('Extended fuzzing (when FUZZ_ITERATIONS > 100000)', () => {
    const extendedIterations = iterations > 100000 ? iterations : 100;

    it('stress test: random bytes never cause unhandled exceptions', () => {
      let crashes = 0;
      let total = 0;

      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 0, maxLength: 1000 }),
          (data) => {
            total++;
            const decoders = [
              () => decodeCard(data, 0),
              () => decodeCards(data, data.length / 3, 0),
              () => decodeGameResult(data),
              () => decodeBlackjackState(data),
              () => decodeVersionedPayload(data),
              () => stripVersionHeader(data),
            ];

            for (const decoder of decoders) {
              try {
                decoder();
              } catch (e) {
                if (
                  !(e instanceof ProtocolError) &&
                  !(e instanceof UnsupportedProtocolVersionError)
                ) {
                  crashes++;
                  // Log unexpected error type for debugging
                  console.error('Unexpected error type:', e);
                }
              }
            }
            return true;
          }
        ),
        { numRuns: extendedIterations }
      );

      expect(crashes).toBe(0);
      console.log(`Fuzzing complete: ${total} iterations, ${crashes} crashes`);
    });
  });
});
