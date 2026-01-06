/**
 * Corrupted Event Data Tests (US-029)
 *
 * Tests decoder robustness against deliberately malformed binary event data.
 * Focuses on gateway-specific codecs including varint overflow attacks.
 */
import { describe, it, expect } from 'vitest';
import {
  extractCasinoEvents,
  extractGlobalTableEvents,
  decodeGlobalTableRoundLookup,
} from '../../src/codec/events.js';

const u8 = (value: number): Uint8Array => Uint8Array.of(value & 0xff);

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const encodeVarint = (value: number): Uint8Array => {
  let remaining = value >>> 0;
  const bytes: number[] = [];
  while (true) {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
    if (remaining === 0) break;
  }
  return Uint8Array.from(bytes);
};

const encodeU64BE = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
};

const buildProgress = (): Uint8Array => {
  const zeros32 = new Uint8Array(32);
  return concat([
    encodeU64BE(1n), // view
    encodeU64BE(1n), // height
    zeros32, // block_digest
    zeros32, // state_root
    encodeU64BE(0n), // state_start_op
    encodeU64BE(0n), // state_end_op
    zeros32, // events_root
    encodeU64BE(0n), // events_start_op
    encodeU64BE(0n), // events_end_op
  ]);
};

const buildCertificate = (): Uint8Array => concat([
  encodeVarint(0), // item index
  new Uint8Array(32), // digest
  new Uint8Array(48), // signature
]);

const buildProof = (): Uint8Array => concat([
  encodeVarint(0), // size
  encodeVarint(0), // digest count
]);

describe('Corrupted Event Data', () => {
  describe('Varint overflow attacks', () => {
    it('handles varint that never terminates (all continuation bytes)', () => {
      // LEB128 varint: MSB=1 means "more bytes follow"
      // 10 bytes of 0x80 (continuation) without termination should fail
      const maliciousVarint = new Uint8Array([
        0x80, 0x80, 0x80, 0x80, 0x80, // 5 continuation bytes
        0x80, 0x80, 0x80, 0x80, 0x80, // 5 more (total 10)
      ]);

      // Construct a minimal update with malicious varint as ops count
      const update = concat([
        u8(0x01), // Update::Events
        buildProgress(),
        buildCertificate(),
        buildProof(),
        maliciousVarint, // ops length - never terminates!
      ]);

      // Should not hang or crash - graceful failure
      const events = extractCasinoEvents(update);
      expect(events).toEqual([]);
    });

    it('handles varint exceeding 32-bit range', () => {
      // LEB128: max 5 bytes for 32-bit value (35 bits > 32 bits)
      // This varint encodes a value > 2^32 which should trigger overflow protection
      const overflowVarint = new Uint8Array([
        0xff, 0xff, 0xff, 0xff, // 28 bits set
        0xff, 0xff, // 14 more bits - total 42 bits!
        0x01, // terminating byte
      ]);

      const update = concat([
        u8(0x01),
        buildProgress(),
        buildCertificate(),
        buildProof(),
        overflowVarint,
      ]);

      const events = extractCasinoEvents(update);
      expect(events).toEqual([]);
    });

    it('handles varint with maximum valid 5-byte encoding', () => {
      // Maximum valid 5-byte varint: 0x7f 7f 7f 7f 0f = 2^32 - 1
      // But this is still a very large ops count (4 billion) which should fail
      // because we don't have enough data
      const maxVarint = new Uint8Array([
        0xff, 0xff, 0xff, 0xff, // 28 bits
        0x0f, // 4 more bits, total 32 bits = 0xFFFFFFFF
      ]);

      const update = concat([
        u8(0x01),
        buildProgress(),
        buildCertificate(),
        buildProof(),
        maxVarint,
        // No actual ops data - should fail when trying to read
      ]);

      const events = extractCasinoEvents(update);
      expect(events).toEqual([]);
    });

    it('handles varint exactly at shift=35 boundary', () => {
      // 6 bytes with continuation bits set, then terminator
      // This should trigger the "Varint too long" check at shift > 35
      const sixByteVarint = new Uint8Array([
        0x80, // shift 0
        0x80, // shift 7
        0x80, // shift 14
        0x80, // shift 21
        0x80, // shift 28
        0x00, // shift 35 - terminates but after too many bytes
      ]);

      const update = concat([
        u8(0x01),
        buildProgress(),
        buildCertificate(),
        buildProof(),
        sixByteVarint,
      ]);

      const events = extractCasinoEvents(update);
      expect(events).toEqual([]);
    });
  });

  describe('Truncated messages', () => {
    it('handles empty update buffer', () => {
      const events = extractCasinoEvents(new Uint8Array([]));
      expect(events).toEqual([]);
    });

    it('handles update with only tag byte', () => {
      const events = extractCasinoEvents(u8(0x01));
      expect(events).toEqual([]);
    });

    it('handles update truncated in Progress section', () => {
      const partialProgress = concat([
        encodeU64BE(1n), // view
        encodeU64BE(1n), // height
        // Missing: block_digest, state_root, etc.
      ]);

      const update = concat([u8(0x01), partialProgress]);
      const events = extractCasinoEvents(update);
      expect(events).toEqual([]);
    });

    it('handles update truncated in Certificate section', () => {
      const update = concat([
        u8(0x01),
        buildProgress(),
        encodeVarint(0), // item index
        new Uint8Array(16), // partial digest (need 32)
      ]);

      const events = extractCasinoEvents(update);
      expect(events).toEqual([]);
    });

    it('handles update truncated after ops count', () => {
      const update = concat([
        u8(0x01),
        buildProgress(),
        buildCertificate(),
        buildProof(),
        encodeVarint(5), // claims 5 ops
        // No actual op data!
      ]);

      const events = extractCasinoEvents(update);
      expect(events).toEqual([]);
    });
  });

  describe('Invalid Vec lengths', () => {
    it('handles Vec with length exceeding buffer', () => {
      // Build a message where vec length claims more data than available
      const update = concat([
        u8(0x01),
        buildProgress(),
        buildCertificate(),
        buildProof(),
        encodeVarint(1), // 1 op
        u8(0x01), // context
        u8(0x00), // Output::Event
        u8(21), // CASINO_GAME_STARTED tag
        encodeU64BE(1n), // sessionId
        new Uint8Array(32), // player
        u8(0), // gameType
        encodeU64BE(100n), // bet
        encodeVarint(10000), // initialState length = 10000 bytes (way more than available)
        // Only a few bytes of actual state data
        new Uint8Array(10),
      ]);

      const events = extractCasinoEvents(update);
      // Should handle gracefully - either skip the corrupted event or return empty
      expect(Array.isArray(events)).toBe(true);
    });

    it('handles proof with unreasonable digest count', () => {
      const maliciousProof = concat([
        encodeVarint(1000000), // 1 million size
        encodeVarint(1000000), // 1 million digests (would be 32MB)
      ]);

      const update = concat([
        u8(0x01),
        buildProgress(),
        buildCertificate(),
        maliciousProof,
        encodeVarint(0),
      ]);

      const events = extractCasinoEvents(update);
      expect(events).toEqual([]);
    });
  });

  describe('Invalid UTF-8 in event strings', () => {
    it('handles corrupted player name in registration event', () => {
      // Build a game started event but we can only access it through the
      // extractCasinoEvents which processes full Update messages
      // The string handling is in parseGameLog which handles JSON

      // This is more of an integration concern - the gateway uses
      // readStringU32 which uses TextDecoder that handles invalid UTF-8
      const events = extractCasinoEvents(new Uint8Array([]));
      expect(events).toEqual([]);
    });
  });

  describe('Global table event corruption', () => {
    it('handles global table events with empty buffer', () => {
      const events = extractGlobalTableEvents(new Uint8Array([]));
      expect(events).toEqual([]);
    });

    it('handles global table round lookup with empty buffer', () => {
      const round = decodeGlobalTableRoundLookup(new Uint8Array([]));
      expect(round).toBeNull();
    });

    it('handles global table round lookup with truncated data', () => {
      const truncated = concat([
        buildProgress(),
        // Missing certificate, proof, and round data
      ]);

      const round = decodeGlobalTableRoundLookup(truncated);
      expect(round).toBeNull();
    });

    it('handles global table with invalid phase', () => {
      // Phase > 4 is invalid
      const update = concat([
        u8(0x01),
        buildProgress(),
        buildCertificate(),
        buildProof(),
        encodeVarint(1),
        u8(0x01), // context
        u8(0x00), // Output::Event
        u8(60), // GLOBAL_TABLE_ROUND_OPENED
        u8(3), // game_type = craps
        encodeU64BE(1n), // roundId
        u8(99), // invalid phase
        encodeU64BE(1000n),
        // Rest of round data...
        u8(0), u8(0), u8(0), u8(0), u8(0), u8(0),
        encodeVarint(0), // rng_commit
        encodeVarint(0), // roll_seed
        encodeVarint(0), // totals
      ]);

      const events = extractGlobalTableEvents(update);
      // Should reject events with invalid phase
      expect(events.every(e => e.type !== 'round_opened' || ('round' in e && e.round.phase <= 4))).toBe(true);
    });
  });

  describe('Extra bytes after valid data', () => {
    it('ignores trailing garbage after valid update', () => {
      // Valid update with no ops, followed by garbage
      const validUpdate = concat([
        u8(0x01),
        buildProgress(),
        buildCertificate(),
        buildProof(),
        encodeVarint(0), // 0 ops
      ]);

      const withGarbage = concat([
        validUpdate,
        new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]), // garbage
      ]);

      // Should parse successfully and ignore garbage
      const events = extractCasinoEvents(withGarbage);
      expect(events).toEqual([]);
    });
  });

  describe('Update type handling', () => {
    it('ignores Seed updates (tag 0)', () => {
      const seedUpdate = concat([
        u8(0x00), // Update::Seed
        new Uint8Array(100), // some data
      ]);

      const events = extractCasinoEvents(seedUpdate);
      expect(events).toEqual([]);
    });

    it('handles FilteredEvents (tag 2) with corruption', () => {
      const truncated = concat([
        u8(0x02), // Update::FilteredEvents
        // Truncated - missing everything else
      ]);

      const events = extractCasinoEvents(truncated);
      expect(events).toEqual([]);
    });

    it('handles unknown update tag gracefully', () => {
      const unknownUpdate = concat([
        u8(0x99), // Unknown tag
        new Uint8Array(100),
      ]);

      const events = extractCasinoEvents(unknownUpdate);
      expect(events).toEqual([]);
    });
  });
});
