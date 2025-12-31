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
} from '@nullspace/game-state';

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
    const blob = new Uint8Array(20);
    blob[0] = 2; // version
    blob[1] = 0; // betting stage
    writeU64BE(blob, 2, 0n); // side bet
    blob[10] = 0xff; // init cards (unknown)
    blob[11] = 0xff;
    blob[12] = 0; // active hand
    blob[13] = 0; // hand count
    blob[14] = 0; // dealer count
    blob[15] = 0; // rules flags
    blob[16] = 4; // rules decks
    blob[17] = 0; // player value
    blob[18] = 0; // dealer value
    blob[19] = 0; // action mask

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
