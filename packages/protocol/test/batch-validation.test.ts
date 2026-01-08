/**
 * Atomic Batch Validation Tests
 *
 * Tests for bet encoding and validation across all games
 * that support atomic batch betting (Baccarat, Roulette, Craps, Sic Bo).
 *
 * Note: All payloads include a version header as the first byte.
 * Format: [version:u8] [opcode:u8] [count:u8] [bets...]
 */
import { describe, it, expect } from 'vitest';
import {
  encodeBaccaratAtomicBatch,
  encodeRouletteAtomicBatch,
  encodeCrapsAtomicBatch,
  encodeSicBoAtomicBatch,
  type BaccaratAtomicBetInput,
  type RouletteAtomicBetInput,
  type CrapsAtomicBetInput,
  type SicBoAtomicBetInput,
} from '../src/encode.js';
import { encodeAtomicBatchPayload } from '../src/games/atomic.js';
import { BaccaratMove, RouletteMove, CrapsMove, SicBoMove } from '@nullspace/constants';
import { CURRENT_PROTOCOL_VERSION } from '../src/version.js';

describe('Baccarat Atomic Batch Validation', () => {
  describe('Valid Bets', () => {
    it('should encode a single player bet', () => {
      const bets: BaccaratAtomicBetInput[] = [
        { type: 'PLAYER', amount: 100n },
      ];

      const result = encodeBaccaratAtomicBatch(bets);

      expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
      expect(result[1]).toBe(BaccaratMove.AtomicBatch);
      expect(result[2]).toBe(1); // bet count
      expect(result.length).toBe(3 + 1 * 9); // version + header + 1 bet (type + 8 bytes amount)
    });

    it('should encode multiple bets', () => {
      const bets: BaccaratAtomicBetInput[] = [
        { type: 'PLAYER', amount: 100n },
        { type: 'BANKER', amount: 200n },
        { type: 'TIE', amount: 50n },
      ];

      const result = encodeBaccaratAtomicBatch(bets);

      expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
      expect(result[1]).toBe(BaccaratMove.AtomicBatch);
      expect(result[2]).toBe(3); // bet count
      expect(result.length).toBe(3 + 3 * 9); // version + header + 3 bets
    });

    it('should accept all valid baccarat bet types', () => {
      const validTypes = [
        'PLAYER',
        'BANKER',
        'TIE',
        'P_PAIR',
        'B_PAIR',
        'LUCKY6',
        'P_DRAGON',
        'B_DRAGON',
        'PANDA8',
        'PERFECT_PAIR',
      ];

      for (const type of validTypes) {
        const bets: BaccaratAtomicBetInput[] = [
          { type: type as BaccaratAtomicBetInput['type'], amount: 50n },
        ];

        expect(() => encodeBaccaratAtomicBatch(bets)).not.toThrow();
      }
    });

    it('should accept numeric bet types', () => {
      const bets: BaccaratAtomicBetInput[] = [
        { type: 0, amount: 100n }, // Numeric PLAYER
      ];

      const result = encodeBaccaratAtomicBatch(bets);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle case-insensitive string types', () => {
      const bets: BaccaratAtomicBetInput[] = [
        { type: 'player' as BaccaratAtomicBetInput['type'], amount: 100n },
      ];

      expect(() => encodeBaccaratAtomicBatch(bets)).not.toThrow();
    });
  });

  describe('Invalid Bets', () => {
    it('should reject empty bet array', () => {
      expect(() => encodeBaccaratAtomicBatch([])).toThrow('No bets provided');
    });

    it('should reject zero amount', () => {
      const bets: BaccaratAtomicBetInput[] = [
        { type: 'PLAYER', amount: 0n },
      ];

      expect(() => encodeBaccaratAtomicBatch(bets)).toThrow(
        'Bet amount must be positive'
      );
    });

    it('should reject negative amount', () => {
      const bets: BaccaratAtomicBetInput[] = [
        { type: 'PLAYER', amount: -100n },
      ];

      expect(() => encodeBaccaratAtomicBatch(bets)).toThrow(
        'Bet amount must be positive'
      );
    });

    it('should reject invalid string bet type', () => {
      const bets: BaccaratAtomicBetInput[] = [
        { type: 'INVALID_TYPE' as BaccaratAtomicBetInput['type'], amount: 100n },
      ];

      expect(() => encodeBaccaratAtomicBatch(bets)).toThrow('Invalid bet type');
    });
  });
});

describe('Roulette Atomic Batch Validation', () => {
  describe('Valid Bets', () => {
    it('should encode a straight up bet', () => {
      const bets: RouletteAtomicBetInput[] = [
        { type: 'STRAIGHT', amount: 100n, value: 17 },
      ];

      const result = encodeRouletteAtomicBatch(bets);

      expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
      expect(result[1]).toBe(RouletteMove.AtomicBatch);
      expect(result[2]).toBe(1);
      expect(result.length).toBe(3 + 1 * 10); // version + header + 1 bet (type + value + 8 bytes)
    });

    it('should encode outside bets', () => {
      const outsideBets: RouletteAtomicBetInput[] = [
        { type: 'RED', amount: 100n },
        { type: 'BLACK', amount: 100n },
        { type: 'ODD', amount: 100n },
        { type: 'EVEN', amount: 100n },
        { type: 'LOW', amount: 100n },
        { type: 'HIGH', amount: 100n },
      ];

      const result = encodeRouletteAtomicBatch(outsideBets);
      expect(result[2]).toBe(6); // 6 bets (at offset 2 after version + opcode)
    });

    it('should encode dozen and column bets', () => {
      const bets: RouletteAtomicBetInput[] = [
        { type: 'DOZEN_1', amount: 100n }, // 1st dozen
        { type: 'DOZEN_2', amount: 100n }, // 2nd dozen
        { type: 'COL_3', amount: 100n }, // 3rd column
      ];

      const result = encodeRouletteAtomicBatch(bets);
      expect(result[2]).toBe(3); // count at offset 2
    });

    it('should accept target, number, or value for bet value', () => {
      const variations: RouletteAtomicBetInput[] = [
        { type: 'STRAIGHT', amount: 100n, target: 5 },
        { type: 'STRAIGHT', amount: 100n, number: 10 },
        { type: 'STRAIGHT', amount: 100n, value: 15 },
      ];

      expect(() => encodeRouletteAtomicBatch(variations)).not.toThrow();
    });
  });

  describe('Invalid Bets', () => {
    it('should reject empty bet array', () => {
      expect(() => encodeRouletteAtomicBatch([])).toThrow('No bets provided');
    });

    it('should reject zero amount', () => {
      const bets: RouletteAtomicBetInput[] = [
        { type: 'RED', amount: 0n },
      ];

      expect(() => encodeRouletteAtomicBatch(bets)).toThrow(
        'Bet amount must be positive'
      );
    });

    it('should reject invalid string bet type', () => {
      const bets: RouletteAtomicBetInput[] = [
        { type: 'INVALID' as RouletteAtomicBetInput['type'], amount: 100n },
      ];

      expect(() => encodeRouletteAtomicBatch(bets)).toThrow('Invalid bet type');
    });
  });
});

describe('Craps Atomic Batch Validation', () => {
  describe('Valid Bets', () => {
    it('should encode pass line bet', () => {
      const bets: CrapsAtomicBetInput[] = [{ type: 'PASS', amount: 100n }];

      const result = encodeCrapsAtomicBatch(bets);

      expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
      expect(result[1]).toBe(CrapsMove.AtomicBatch);
      expect(result[2]).toBe(1);
      expect(result.length).toBe(3 + 1 * 10); // version + header + bet (type + target + 8 bytes)
    });

    it('should encode place bets with targets', () => {
      const bets: CrapsAtomicBetInput[] = [
        { type: 'YES', amount: 100n, target: 6 },
        { type: 'YES', amount: 100n, target: 8 },
        { type: 'NO', amount: 100n, target: 4 },
      ];

      const result = encodeCrapsAtomicBatch(bets);
      expect(result[2]).toBe(3); // count at offset 2
    });

    it('should accept all craps bet types', () => {
      const validTypes = [
        'PASS',
        'DONT_PASS',
        'COME',
        'DONT_COME',
        'FIELD',
        'YES',
        'NO',
        'NEXT',
        'HARDWAY',
        'FIRE',
        'ATS_SMALL',
        'ATS_TALL',
        'ATS_ALL',
        'MUGGSY',
        'DIFF_DOUBLES',
        'RIDE_LINE',
        'REPLAY',
        'HOT_ROLLER',
      ];

      for (const type of validTypes) {
        const bets: CrapsAtomicBetInput[] = [
          {
            type: type as CrapsAtomicBetInput['type'],
            amount: 50n,
            target: type === 'YES' || type === 'NO' || type === 'NEXT' ? 6 : 0,
          },
        ];

        expect(() => encodeCrapsAtomicBatch(bets)).not.toThrow();
      }
    });
  });

  describe('Invalid Bets', () => {
    it('should reject empty bet array', () => {
      expect(() => encodeCrapsAtomicBatch([])).toThrow('No bets provided');
    });

    it('should reject zero amount', () => {
      const bets: CrapsAtomicBetInput[] = [{ type: 'PASS', amount: 0n }];

      expect(() => encodeCrapsAtomicBatch(bets)).toThrow(
        'Bet amount must be positive'
      );
    });

    it('should reject invalid bet type', () => {
      const bets: CrapsAtomicBetInput[] = [
        { type: 'INVALID' as CrapsAtomicBetInput['type'], amount: 100n },
      ];

      expect(() => encodeCrapsAtomicBatch(bets)).toThrow('Invalid bet type');
    });
  });
});

describe('Sic Bo Atomic Batch Validation', () => {
  describe('Valid Bets', () => {
    it('should encode small/big bets', () => {
      const bets: SicBoAtomicBetInput[] = [
        { type: 'SMALL', amount: 100n },
        { type: 'BIG', amount: 100n },
      ];

      const result = encodeSicBoAtomicBatch(bets);

      expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
      expect(result[1]).toBe(SicBoMove.AtomicBatch);
      expect(result[2]).toBe(2); // count at offset 2
    });

    it('should encode sum bet with number', () => {
      const bets: SicBoAtomicBetInput[] = [
        { type: 'SUM', amount: 100n, number: 10 },
      ];

      const result = encodeSicBoAtomicBatch(bets);
      expect(result.length).toBe(3 + 1 * 10); // version + opcode + count + bet
    });

    it('should accept all sic bo bet types', () => {
      const validTypes = [
        'SMALL',
        'BIG',
        'ODD',
        'EVEN',
        'TRIPLE_SPECIFIC',
        'TRIPLE_ANY',
        'DOUBLE_SPECIFIC',
        'SUM',
        'SINGLE_DIE',
        'DOMINO',
        'HOP3_EASY',
        'HOP3_HARD',
        'HOP4_EASY',
      ];

      for (const type of validTypes) {
        const bets: SicBoAtomicBetInput[] = [
          {
            type: type as SicBoAtomicBetInput['type'],
            amount: 50n,
            number: type === 'SUM' ? 10 : 1,
          },
        ];

        expect(() => encodeSicBoAtomicBatch(bets)).not.toThrow();
      }
    });
  });

  describe('Invalid Bets', () => {
    it('should reject empty bet array', () => {
      expect(() => encodeSicBoAtomicBatch([])).toThrow('No bets provided');
    });

    it('should reject zero amount', () => {
      const bets: SicBoAtomicBetInput[] = [{ type: 'SMALL', amount: 0n }];

      expect(() => encodeSicBoAtomicBatch(bets)).toThrow(
        'Bet amount must be positive'
      );
    });

    it('should reject invalid bet type', () => {
      const bets: SicBoAtomicBetInput[] = [
        { type: 'INVALID' as SicBoAtomicBetInput['type'], amount: 100n },
      ];

      expect(() => encodeSicBoAtomicBatch(bets)).toThrow('Invalid bet type');
    });
  });
});

describe('encodeAtomicBatchPayload Dispatcher', () => {
  it('should dispatch to baccarat encoder', () => {
    const bets = [{ type: 'PLAYER' as const, amount: 100n }];
    const result = encodeAtomicBatchPayload('baccarat', bets);

    expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
    expect(result[1]).toBe(BaccaratMove.AtomicBatch);
  });

  it('should dispatch to roulette encoder', () => {
    const bets = [{ type: 'RED' as const, amount: 100n }];
    const result = encodeAtomicBatchPayload('roulette', bets);

    expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
    expect(result[1]).toBe(RouletteMove.AtomicBatch);
  });

  it('should dispatch to craps encoder', () => {
    const bets = [{ type: 'PASS' as const, amount: 100n }];
    const result = encodeAtomicBatchPayload('craps', bets);

    expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
    expect(result[1]).toBe(CrapsMove.AtomicBatch);
  });

  it('should dispatch to sic bo encoder', () => {
    const bets = [{ type: 'SMALL' as const, amount: 100n }];
    const result = encodeAtomicBatchPayload('sicbo', bets);

    expect(result[0]).toBe(CURRENT_PROTOCOL_VERSION); // version header
    expect(result[1]).toBe(SicBoMove.AtomicBatch);
  });
});

describe('Batch Size Limits', () => {
  it('should handle maximum realistic bet count for baccarat', () => {
    // Baccarat has 10 bet types, so max reasonable is 10
    const bets: BaccaratAtomicBetInput[] = [
      { type: 'PLAYER', amount: 100n },
      { type: 'BANKER', amount: 100n },
      { type: 'TIE', amount: 100n },
      { type: 'P_PAIR', amount: 100n },
      { type: 'B_PAIR', amount: 100n },
      { type: 'LUCKY6', amount: 100n },
      { type: 'P_DRAGON', amount: 100n },
      { type: 'B_DRAGON', amount: 100n },
      { type: 'PANDA8', amount: 100n },
      { type: 'PERFECT_PAIR', amount: 100n },
    ];

    const result = encodeBaccaratAtomicBatch(bets);
    expect(result[2]).toBe(10); // count at offset 2 (after version + opcode)
    expect(result.length).toBe(3 + 10 * 9); // version + opcode + count + bets
  });

  it('should handle maximum realistic bet count for roulette', () => {
    // Multiple bets across different numbers
    const bets: RouletteAtomicBetInput[] = [];
    for (let i = 0; i < 37; i++) {
      bets.push({ type: 'STRAIGHT', amount: 100n, value: i });
    }

    const result = encodeRouletteAtomicBatch(bets);
    expect(result[2]).toBe(37); // count at offset 2
  });
});

describe('Binary Encoding Correctness', () => {
  it('should encode amounts in big-endian format', () => {
    const bets: BaccaratAtomicBetInput[] = [
      { type: 'PLAYER', amount: 0x0102030405060708n },
    ];

    const result = encodeBaccaratAtomicBatch(bets);

    // Amount starts at offset 4 (version + opcode + count + bet type)
    // Big-endian means most significant byte first
    const view = new DataView(result.buffer, result.byteOffset, result.length);
    const encodedAmount = view.getBigUint64(4, false);

    expect(encodedAmount).toBe(0x0102030405060708n);
  });

  it('should encode bet type correctly', () => {
    // Baccarat PLAYER should be type 0
    const playerBets: BaccaratAtomicBetInput[] = [
      { type: 'PLAYER', amount: 100n },
    ];
    const playerResult = encodeBaccaratAtomicBatch(playerBets);
    // Type is at offset 3 (version + opcode + count)
    expect(playerResult[3]).toBe(0);

    // Baccarat BANKER should be type 1
    const bankerBets: BaccaratAtomicBetInput[] = [
      { type: 'BANKER', amount: 100n },
    ];
    const bankerResult = encodeBaccaratAtomicBatch(bankerBets);
    expect(bankerResult[3]).toBe(1);
  });
});

describe('Duplicate Bet Handling', () => {
  it('should allow duplicate bet types (same bet placed multiple times)', () => {
    const bets: BaccaratAtomicBetInput[] = [
      { type: 'PLAYER', amount: 100n },
      { type: 'PLAYER', amount: 200n },
    ];

    // This should encode without error - validation is done on-chain
    const result = encodeBaccaratAtomicBatch(bets);
    expect(result[2]).toBe(2); // count at offset 2
  });

  it('should allow same roulette number to be bet multiple times', () => {
    const bets: RouletteAtomicBetInput[] = [
      { type: 'STRAIGHT', amount: 100n, value: 17 },
      { type: 'STRAIGHT', amount: 50n, value: 17 },
    ];

    const result = encodeRouletteAtomicBatch(bets);
    expect(result[2]).toBe(2); // count at offset 2
  });
});
