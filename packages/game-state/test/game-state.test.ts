import { describe, it, expect } from 'vitest';
import {
  parseBaccaratState,
  parseBlackjackState,
  parseCasinoWarState,
  parseCrapsState,
  parseHiLoState,
  parseRouletteState,
  parseSicBoState,
  parseThreeCardState,
  parseUltimateHoldemState,
  parseVideoPokerState,
} from '../src/index.js';

const writeU64BE = (buf: Uint8Array, offset: number, value: bigint): void => {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setBigUint64(offset, value, false);
};

const writeI64BE = (buf: Uint8Array, offset: number, value: bigint): void => {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setBigInt64(offset, value, false);
};

const writeU32BE = (buf: Uint8Array, offset: number, value: number): void => {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, false);
};

describe('game-state parsers', () => {
  it('parses blackjack state', () => {
    const blob = new Uint8Array(52);
    blob[0] = 4; // version
    blob[1] = 0; // betting stage
    writeU64BE(blob, 2, 0n); // side bet 21+3
    writeU64BE(blob, 10, 0n); // lucky ladies
    writeU64BE(blob, 18, 0n); // perfect pairs
    writeU64BE(blob, 26, 0n); // bust it
    writeU64BE(blob, 34, 0n); // royal match
    blob[42] = 0xff; // init cards (unknown)
    blob[43] = 0xff;
    blob[44] = 0; // active hand
    blob[45] = 0; // hand count
    blob[46] = 0; // dealer count
    blob[47] = 0; // rules flags
    blob[48] = 4; // rules decks
    blob[49] = 0; // player value
    blob[50] = 0; // dealer value
    blob[51] = 0; // action mask

    const parsed = parseBlackjackState(blob);
    expect(parsed).not.toBeNull();
    expect(parsed?.stage).toBe(0);
    expect(parsed?.hands.length).toBe(0);
    expect(parsed?.dealerCards.length).toBe(0);
  });

  it('parses baccarat state', () => {
    const blob = new Uint8Array([0, 0, 0]);
    const parsed = parseBaccaratState(blob);
    expect(parsed).toEqual({ betCount: 0, playerCards: [], bankerCards: [] });
  });

  it('parses roulette state', () => {
    const blob = new Uint8Array(20);
    blob[0] = 0; // bet count
    blob[1] = 1; // zero rule
    blob[2] = 1; // phase
    blob[19] = 7; // result
    const parsed = parseRouletteState(blob);
    expect(parsed?.betCount).toBe(0);
    expect(parsed?.zeroRule).toBe(1);
    expect(parsed?.phase).toBe(1);
    expect(parsed?.result).toBe(7);
  });

  it('parses sic bo state', () => {
    const blob = new Uint8Array([0, 1, 2, 3]);
    const parsed = parseSicBoState(blob);
    expect(parsed?.betCount).toBe(0);
    expect(parsed?.dice).toEqual([1, 2, 3]);
  });

  it('parses craps state', () => {
    const blob = new Uint8Array(8);
    blob[0] = 2; // version
    blob[1] = 0; // phase
    blob[2] = 0; // main point
    blob[3] = 1; // die1
    blob[4] = 2; // die2
    blob[5] = 0; // made points
    blob[6] = 0; // epoch flag
    blob[7] = 0; // bet count
    const parsed = parseCrapsState(blob);
    expect(parsed?.version).toBe(2);
    expect(parsed?.dice).toEqual([1, 2]);
    expect(parsed?.betCount).toBe(0);
  });

  it('rejects craps state with too many bets', () => {
    const blob = new Uint8Array(8);
    blob[0] = 2; // version
    blob[1] = 0; // phase
    blob[2] = 0; // main point
    blob[3] = 1; // die1
    blob[4] = 2; // die2
    blob[5] = 0; // made points
    blob[6] = 0; // epoch flag
    blob[7] = 21; // bet count (over limit)
    expect(parseCrapsState(blob)).toBeNull();
  });

  it('parses hi-lo state', () => {
    const blob = new Uint8Array(22);
    blob[0] = 10;
    writeI64BE(blob, 1, 10_000n);
    blob[9] = 1; // rules
    writeU32BE(blob, 10, 20);
    writeU32BE(blob, 14, 30);
    writeU32BE(blob, 18, 40);
    const parsed = parseHiLoState(blob);
    expect(parsed?.cardId).toBe(10);
    expect(parsed?.accumulatorBasisPoints).toBe(10_000n);
    expect(parsed?.rulesByte).toBe(1);
    expect(parsed?.nextMultipliers).toEqual({ higher: 20, lower: 30, same: 40 });
  });

  it('parses video poker state', () => {
    const blob = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const parsed = parseVideoPokerState(blob);
    expect(parsed?.stage).toBe(0);
    expect(parsed?.cards).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses casino war state', () => {
    const blob = new Uint8Array(12);
    blob[0] = 1; // version
    blob[1] = 0; // stage
    blob[2] = 8; // player card
    blob[3] = 9; // dealer card
    writeU64BE(blob, 4, 50n);
    const parsed = parseCasinoWarState(blob);
    expect(parsed?.version).toBe(1);
    expect(parsed?.tieBet).toBe(50n);
  });

  it('parses three card state', () => {
    const blob = new Uint8Array(32);
    blob[0] = 3; // version
    blob[1] = 0; // stage
    blob[2] = 1;
    blob[3] = 2;
    blob[4] = 3;
    blob[5] = 4;
    blob[6] = 5;
    blob[7] = 6;
    writeU64BE(blob, 8, 100n); // pair plus
    writeU64BE(blob, 16, 50n); // six card
    writeU64BE(blob, 24, 10n); // progressive
    const parsed = parseThreeCardState(blob);
    expect(parsed?.version).toBe(3);
    expect(parsed?.pairPlusBet).toBe(100);
    expect(parsed?.sixCardBonusBet).toBe(50);
    expect(parsed?.progressiveBet).toBe(10);
  });

  it('parses ultimate holdem state', () => {
    const blob = new Uint8Array(40);
    blob[0] = 3; // version
    blob[1] = 0; // stage
    blob[2] = 1;
    blob[3] = 2;
    blob[4] = 3;
    blob[5] = 4;
    blob[6] = 5;
    blob[7] = 6;
    blob[8] = 7;
    blob[9] = 8;
    blob[10] = 9;
    blob[11] = 4; // play multiplier
    blob[12] = 10;
    blob[13] = 11;
    blob[14] = 12;
    blob[15] = 13;
    writeU64BE(blob, 16, 25n); // trips
    writeU64BE(blob, 24, 15n); // six card
    writeU64BE(blob, 32, 5n); // progressive
    const parsed = parseUltimateHoldemState(blob);
    expect(parsed?.version).toBe(3);
    expect(parsed?.tripsBet).toBe(25);
    expect(parsed?.sixCardBonusBet).toBe(15);
    expect(parsed?.progressiveBet).toBe(5);
  });

  it('returns null for malformed blobs', () => {
    expect(parseBlackjackState(new Uint8Array())).toBeNull();
    expect(parseBaccaratState(new Uint8Array())).toBeNull();
    expect(parseRouletteState(new Uint8Array())).toBeNull();
    expect(parseSicBoState(new Uint8Array())).toBeNull();
    expect(parseCrapsState(new Uint8Array())).toBeNull();
    expect(parseHiLoState(new Uint8Array())).toBeNull();
    expect(parseVideoPokerState(new Uint8Array())).toBeNull();
    expect(parseCasinoWarState(new Uint8Array())).toBeNull();
    expect(parseThreeCardState(new Uint8Array())).toBeNull();
    expect(parseUltimateHoldemState(new Uint8Array())).toBeNull();
  });
});

/**
 * Golden vector tests (server→client state parsing)
 *
 * These tests validate that TypeScript parsers correctly decode state blobs
 * in the exact format that Rust's serialize_state() functions produce.
 */
describe('golden vector state parsing', () => {
  // Load golden vectors from fixtures
  const goldenVectors = (() => {
    try {
      return require('./fixtures/golden-vectors.json');
    } catch {
      console.warn('Golden vectors not found');
      return { stateParsingVectors: {} };
    }
  })();

  const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  };

  describe('blackjack state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.blackjack || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseBlackjackState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.version).toBe(vector.expected.version);
        expect(parsed?.stage).toBe(vector.expected.stage);
        expect(parsed?.sideBet21Plus3).toBe(vector.expected.sideBet21Plus3);
        expect(parsed?.sideBetLuckyLadies).toBe(vector.expected.sideBetLuckyLadies);
        expect(parsed?.sideBetPerfectPairs).toBe(vector.expected.sideBetPerfectPairs);
        expect(parsed?.sideBetBustIt).toBe(vector.expected.sideBetBustIt);
        expect(parsed?.sideBetRoyalMatch).toBe(vector.expected.sideBetRoyalMatch);
        expect(parsed?.initPlayerCards).toEqual(vector.expected.initPlayerCards);
        expect(parsed?.activeHandIndex).toBe(vector.expected.activeHandIndex);
        expect(parsed?.hands.length).toBe((vector.expected.hands as unknown[]).length);

        // Validate each hand
        const expectedHands = vector.expected.hands as { betMult: number; status: number; wasSplit: number; cards: number[] }[];
        parsed?.hands.forEach((hand, idx) => {
          expect(hand.betMult).toBe(expectedHands[idx].betMult);
          expect(hand.status).toBe(expectedHands[idx].status);
          expect(hand.wasSplit).toBe(expectedHands[idx].wasSplit);
          expect(hand.cards).toEqual(expectedHands[idx].cards);
        });

        expect(parsed?.dealerCards).toEqual(vector.expected.dealerCards);
        expect(parsed?.playerValue).toBe(vector.expected.playerValue);
        expect(parsed?.dealerValue).toBe(vector.expected.dealerValue);
        expect(parsed?.actionMask).toBe(vector.expected.actionMask);
      });
    });
  });

  describe('hilo state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.hilo || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseHiLoState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.cardId).toBe(vector.expected.cardId);
        expect(parsed?.accumulatorBasisPoints).toBe(BigInt(vector.expected.accumulatorBasisPoints as string));
        expect(parsed?.rulesByte).toBe(vector.expected.rulesByte);

        const expectedMultipliers = vector.expected.nextMultipliers as { higher: number; lower: number; same: number } | null;
        if (expectedMultipliers) {
          expect(parsed?.nextMultipliers).toEqual(expectedMultipliers);
        }
      });
    });
  });

  describe('videoPoker state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.videoPoker || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseVideoPokerState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.stage).toBe(vector.expected.stage);
        expect(parsed?.cards).toEqual(vector.expected.cards);
      });
    });
  });

  describe('casinoWar state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.casinoWar || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseCasinoWarState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.version).toBe(vector.expected.version);
        expect(parsed?.stage).toBe(vector.expected.stage);
        expect(parsed?.playerCard).toBe(vector.expected.playerCard);
        expect(parsed?.dealerCard).toBe(vector.expected.dealerCard);
        expect(parsed?.tieBet).toBe(BigInt(vector.expected.tieBet as string));
      });
    });
  });

  describe('baccarat state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.baccarat || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseBaccaratState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.betCount).toBe(vector.expected.betCount);
        expect(parsed?.playerCards).toEqual(vector.expected.playerCards);
        expect(parsed?.bankerCards).toEqual(vector.expected.bankerCards);
      });
    });
  });

  describe('roulette state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.roulette || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseRouletteState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.betCount).toBe(vector.expected.betCount);
        expect(parsed?.zeroRule).toBe(vector.expected.zeroRule);
        expect(parsed?.phase).toBe(vector.expected.phase);
        expect(parsed?.result).toBe(vector.expected.result);
      });
    });
  });

  describe('sicBo state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.sicBo || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseSicBoState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.betCount).toBe(vector.expected.betCount);
        expect(parsed?.dice).toEqual(vector.expected.dice);
      });
    });
  });

  describe('craps state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.craps || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseCrapsState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.version).toBe(vector.expected.version);
        expect(parsed?.phase).toBe(vector.expected.phase);
        expect(parsed?.mainPoint).toBe(vector.expected.mainPoint);
        expect(parsed?.dice).toEqual(vector.expected.dice);
        expect(parsed?.madePointsMask).toBe(vector.expected.madePointsMask);
        expect(parsed?.epochPointEstablished).toBe(vector.expected.epochPointEstablished);
        expect(parsed?.betCount).toBe(vector.expected.betCount);

        // Validate bets if present
        const expectedBets = vector.expected.bets as { betType: number; target: number; status: number; amount: number; oddsAmount: number }[];
        expect(parsed?.bets.length).toBe(expectedBets.length);
        parsed?.bets.forEach((bet, idx) => {
          expect(bet.betType).toBe(expectedBets[idx].betType);
          expect(bet.target).toBe(expectedBets[idx].target);
          expect(bet.status).toBe(expectedBets[idx].status);
          expect(bet.amount).toBe(expectedBets[idx].amount);
          expect(bet.oddsAmount).toBe(expectedBets[idx].oddsAmount);
        });
      });
    });
  });

  describe('threeCard state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.threeCard || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseThreeCardState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.version).toBe(vector.expected.version);
        expect(parsed?.stage).toBe(vector.expected.stage);
        expect(parsed?.playerCards).toEqual(vector.expected.playerCards);
        expect(parsed?.dealerCards).toEqual(vector.expected.dealerCards);
        expect(parsed?.pairPlusBet).toBe(vector.expected.pairPlusBet);
        expect(parsed?.sixCardBonusBet).toBe(vector.expected.sixCardBonusBet);
        expect(parsed?.progressiveBet).toBe(vector.expected.progressiveBet);
      });
    });
  });

  describe('ultimateHoldem state vectors', () => {
    const vectors = goldenVectors.stateParsingVectors?.ultimateHoldem || [];

    vectors.forEach((vector: { description: string; expected: Record<string, unknown>; hex: string }) => {
      it(vector.description, () => {
        const bytes = hexToBytes(vector.hex);
        const parsed = parseUltimateHoldemState(bytes);

        expect(parsed).not.toBeNull();
        expect(parsed?.version).toBe(vector.expected.version);
        expect(parsed?.stage).toBe(vector.expected.stage);
        expect(parsed?.playerCards).toEqual(vector.expected.playerCards);
        expect(parsed?.communityCards).toEqual(vector.expected.communityCards);
        expect(parsed?.dealerCards).toEqual(vector.expected.dealerCards);
        expect(parsed?.playMultiplier).toBe(vector.expected.playMultiplier);
        expect(parsed?.bonusCards).toEqual(vector.expected.bonusCards);
        expect(parsed?.tripsBet).toBe(vector.expected.tripsBet);
        expect(parsed?.sixCardBonusBet).toBe(vector.expected.sixCardBonusBet);
        expect(parsed?.progressiveBet).toBe(vector.expected.progressiveBet);
      });
    });
  });
});
