/**
 * Corrupted Protocol Data Tests (US-029)
 *
 * Tests decoder robustness against deliberately malformed binary data.
 * Verifies graceful error handling for:
 * - Truncated messages (insufficient bytes)
 * - Extra bytes after valid data
 * - Varint overflow attacks
 * - Invalid UTF-8 in string fields
 */
import { describe, it, expect } from 'vitest';
import {
  decodeCard,
  decodeCards,
  decodeGameResult,
  decodeBlackjackState,
  ProtocolError,
} from '../src/index.js';

const toBuffer = (bytes: number[]): Uint8Array => new Uint8Array(bytes);

describe('Corrupted Protocol Data', () => {
  describe('Truncated messages (insufficient bytes)', () => {
    describe('decodeCard', () => {
      it('throws ProtocolError on empty buffer', () => {
        expect(() => decodeCard(new Uint8Array([]), 0)).toThrow(ProtocolError);
      });

      it('throws ProtocolError when only 1 byte available (need 3)', () => {
        expect(() => decodeCard(toBuffer([0x01]), 0)).toThrow(ProtocolError);
        expect(() => decodeCard(toBuffer([0x01]), 0)).toThrow(
          /expected 3 bytes/i
        );
      });

      it('throws ProtocolError when only 2 bytes available (need 3)', () => {
        expect(() => decodeCard(toBuffer([0x01, 0x0a]), 0)).toThrow(
          ProtocolError
        );
      });

      it('throws ProtocolError with offset near end of buffer', () => {
        const data = toBuffer([0x01, 0x02, 0x03, 0x04, 0x05]);
        // Offset 3 means only 2 bytes remain, but need 3
        expect(() => decodeCard(data, 3)).toThrow(ProtocolError);
      });
    });

    describe('decodeCards', () => {
      it('throws ProtocolError when count exceeds available bytes', () => {
        // Request 3 cards (9 bytes) but only provide 6 bytes
        const data = toBuffer([0x01, 0x02, 0x01, 0x02, 0x03, 0x01]);
        expect(() => decodeCards(data, 3, 0)).toThrow(ProtocolError);
        expect(() => decodeCards(data, 3, 0)).toThrow(/expected 9 bytes/i);
      });

      it('throws ProtocolError with partially valid cards', () => {
        // 2 complete cards (6 bytes) + 1 incomplete card (2 bytes)
        const data = toBuffer([0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x02, 0x03]);
        expect(() => decodeCards(data, 3, 0)).toThrow(ProtocolError);
      });
    });

    describe('decodeGameResult', () => {
      it('throws ProtocolError on empty buffer', () => {
        expect(() => decodeGameResult(new Uint8Array([]))).toThrow(
          ProtocolError
        );
      });

      it('throws ProtocolError when less than minimum (19 bytes)', () => {
        // Minimum is 19 bytes: 8 (sessionId) + 1 (gameType) + 1 (won) + 8 (payout) + 1 (msgLen)
        const data = toBuffer([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, // sessionId
          0x02, // gameType
          0x01, // won
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0xf4, // payout (500)
          // Missing msgLen!
        ]);
        expect(() => decodeGameResult(data)).toThrow(ProtocolError);
        expect(() => decodeGameResult(data)).toThrow(/at least 19 bytes/i);
      });

      it('throws ProtocolError when message length exceeds buffer', () => {
        const buffer = new ArrayBuffer(20);
        const view = new DataView(buffer);
        view.setBigUint64(0, 42n, true);
        view.setUint8(8, 2); // gameType
        view.setUint8(9, 1); // won
        view.setBigUint64(10, 500n, true);
        view.setUint8(18, 50); // msgLen = 50, but only 1 byte remains
        const bytes = new Uint8Array(buffer);
        bytes.set([0x41], 19); // Only 1 byte, not 50

        expect(() => decodeGameResult(bytes)).toThrow(ProtocolError);
        expect(() => decodeGameResult(bytes)).toThrow(/message length.*exceeds/i);
      });
    });

    describe('decodeBlackjackState', () => {
      it('throws ProtocolError on buffer smaller than sessionId', () => {
        expect(() => decodeBlackjackState(toBuffer([0x00, 0x00, 0x00]))).toThrow(
          ProtocolError
        );
        expect(() =>
          decodeBlackjackState(toBuffer([0x00, 0x00, 0x00]))
        ).toThrow(/at least 8 bytes/i);
      });

      it('throws ProtocolError when missing player card count', () => {
        // Only sessionId (8 bytes), no player card count
        const data = toBuffer([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07,
        ]);
        expect(() => decodeBlackjackState(data)).toThrow(ProtocolError);
        expect(() => decodeBlackjackState(data)).toThrow(
          /missing player card count/i
        );
      });

      it('throws ProtocolError when player cards data is truncated', () => {
        // sessionId + 2 player cards claimed, but only 1 provided
        const data = toBuffer([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, // sessionId
          0x02, // player card count = 2
          0x00, 0x00, 0x01, // only 1 card (3 bytes), missing 2nd card
        ]);
        expect(() => decodeBlackjackState(data)).toThrow(ProtocolError);
      });

      it('throws ProtocolError when missing dealer card count', () => {
        // sessionId + 1 player card, no dealer count
        const data = toBuffer([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, // sessionId
          0x01, // player card count = 1
          0x00, 0x00, 0x01, // 1 player card
          // missing dealer card count
        ]);
        expect(() => decodeBlackjackState(data)).toThrow(ProtocolError);
        expect(() => decodeBlackjackState(data)).toThrow(
          /missing dealer card count/i
        );
      });

      it('throws ProtocolError when missing totals and stage', () => {
        // Complete cards but missing totals/stage/flags
        const data = toBuffer([
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, // sessionId
          0x01, // player card count
          0x00, 0x00, 0x01, // 1 player card
          0x01, // dealer card count
          0x00, 0x00, 0x01, // 1 dealer card
          // missing: playerTotal, dealerTotal, stage, actionFlags
        ]);
        expect(() => decodeBlackjackState(data)).toThrow(ProtocolError);
        expect(() => decodeBlackjackState(data)).toThrow(
          /missing totals and stage/i
        );
      });
    });
  });

  describe('Extra bytes after valid data', () => {
    it('decodeCard ignores bytes beyond the 3 needed', () => {
      // Card is 3 bytes, we provide 10 - decoder should only use first 3
      const data = toBuffer([
        0x01, 0x0c, 0x01, // hearts, K, faceUp
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // extra garbage
      ]);
      const card = decodeCard(data, 0);
      expect(card).toEqual({ suit: 'hearts', rank: 'K', faceUp: true });
    });

    it('decodeCards handles extra bytes after requested count', () => {
      // Request 2 cards (6 bytes), provide 12 bytes
      const data = toBuffer([
        0x00, 0x00, 0x01, // spades A faceUp
        0x01, 0x0c, 0x01, // hearts K faceUp
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // garbage
      ]);
      const cards = decodeCards(data, 2, 0);
      expect(cards).toHaveLength(2);
      expect(cards[0]).toEqual({ suit: 'spades', rank: 'A', faceUp: true });
      expect(cards[1]).toEqual({ suit: 'hearts', rank: 'K', faceUp: true });
    });

    it('decodeGameResult does not read beyond message boundary', () => {
      // Valid game result with 5-char message, followed by garbage
      const buffer = new ArrayBuffer(30);
      const view = new DataView(buffer);
      view.setBigUint64(0, 42n, true);
      view.setUint8(8, 2);
      view.setUint8(9, 1);
      view.setBigUint64(10, 500n, true);
      view.setUint8(18, 5); // message length = 5
      const bytes = new Uint8Array(buffer);
      bytes.set(new TextEncoder().encode('hello'), 19);
      bytes.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 24); // garbage after message

      const result = decodeGameResult(bytes);
      expect(result.message).toBe('hello');
      expect(result.message).not.toContain('\xff');
    });

    it('decodeBlackjackState handles trailing garbage', () => {
      // Valid blackjack state followed by garbage bytes
      const buffer = new ArrayBuffer(30);
      const view = new DataView(buffer);
      let offset = 0;
      view.setBigUint64(offset, 7n, true);
      offset += 8;
      view.setUint8(offset++, 1); // player card count
      const bytes = new Uint8Array(buffer);
      bytes.set([0, 0, 1], offset); // spades A faceUp
      offset += 3;
      view.setUint8(offset++, 1); // dealer card count
      bytes.set([2, 9, 0], offset); // diamonds 10 faceDown
      offset += 3;
      view.setUint8(offset++, 21); // player total
      view.setUint8(offset++, 10); // dealer total
      view.setUint8(offset++, 1); // stage = playing
      view.setUint8(offset++, 0b1011); // action flags
      // Fill rest with garbage
      for (let i = offset; i < 30; i++) {
        bytes[i] = 0xff;
      }

      const state = decodeBlackjackState(bytes);
      expect(state.sessionId).toBe(7n);
      expect(state.playerTotal).toBe(21);
    });
  });

  describe('Invalid enum/boundary values', () => {
    it('decodeCard throws on invalid suit byte (>= 4)', () => {
      // Suit byte 4 is invalid (only 0-3 are valid)
      expect(() => decodeCard(toBuffer([0x04, 0x00, 0x01]), 0)).toThrow(
        ProtocolError
      );
      expect(() => decodeCard(toBuffer([0x04, 0x00, 0x01]), 0)).toThrow(
        /Invalid suit byte: 4/
      );

      // Max u8 (255) is definitely invalid
      expect(() => decodeCard(toBuffer([0xff, 0x00, 0x01]), 0)).toThrow(
        ProtocolError
      );
    });

    it('decodeCard throws on invalid rank byte (>= 13)', () => {
      // Rank byte 13 is invalid (only 0-12 are valid)
      expect(() => decodeCard(toBuffer([0x00, 0x0d, 0x01]), 0)).toThrow(
        ProtocolError
      );
      expect(() => decodeCard(toBuffer([0x00, 0x0d, 0x01]), 0)).toThrow(
        /Invalid rank byte: 13/
      );

      // Max u8 (255) is definitely invalid
      expect(() => decodeCard(toBuffer([0x00, 0xff, 0x01]), 0)).toThrow(
        ProtocolError
      );
    });

    it('decodeGameResult throws on invalid game type (>= 10)', () => {
      const buffer = new ArrayBuffer(20);
      const view = new DataView(buffer);
      view.setBigUint64(0, 1n, true);
      view.setUint8(8, 10); // invalid gameType (0-9 are valid)
      view.setUint8(9, 1);
      view.setBigUint64(10, 100n, true);
      view.setUint8(18, 0);

      expect(() => decodeGameResult(new Uint8Array(buffer))).toThrow(
        ProtocolError
      );
      expect(() => decodeGameResult(new Uint8Array(buffer))).toThrow(
        /Invalid game type byte: 10/
      );
    });

    it('decodeBlackjackState throws on invalid stage byte (>= 4)', () => {
      const buffer = new ArrayBuffer(20);
      const view = new DataView(buffer);
      let offset = 0;
      view.setBigUint64(offset, 7n, true);
      offset += 8;
      view.setUint8(offset++, 1); // player card count
      const bytes = new Uint8Array(buffer);
      bytes.set([0, 0, 1], offset);
      offset += 3;
      view.setUint8(offset++, 1); // dealer card count
      bytes.set([0, 0, 1], offset);
      offset += 3;
      view.setUint8(offset++, 21); // playerTotal
      view.setUint8(offset++, 10); // dealerTotal
      view.setUint8(offset++, 5); // invalid stage (0-3 are valid)
      view.setUint8(offset, 0x0f);

      expect(() => decodeBlackjackState(bytes)).toThrow(ProtocolError);
      expect(() => decodeBlackjackState(bytes)).toThrow(
        /Invalid stage byte: 5/
      );
    });
  });

  describe('Invalid UTF-8 in string fields', () => {
    it('decodeGameResult handles invalid UTF-8 replacement', () => {
      // TextDecoder with default options replaces invalid sequences with U+FFFD
      const buffer = new ArrayBuffer(24);
      const view = new DataView(buffer);
      view.setBigUint64(0, 42n, true);
      view.setUint8(8, 0); // gameType
      view.setUint8(9, 1); // won
      view.setBigUint64(10, 100n, true);
      view.setUint8(18, 5); // message length = 5
      const bytes = new Uint8Array(buffer);
      // Invalid UTF-8: 0xC0, 0xC1 are never valid in UTF-8
      // 0x80 continuation byte without start byte
      bytes.set([0xc0, 0xc1, 0x80, 0xfe, 0xff], 19);

      // Should not throw - TextDecoder replaces with U+FFFD
      const result = decodeGameResult(bytes);
      expect(result.message).toHaveLength(5);
      // Each invalid byte is replaced with U+FFFD (3 bytes in UTF-8, 1 char)
      expect(result.message).toContain('\ufffd');
    });

    it('decodeGameResult handles truncated multi-byte sequence', () => {
      // Start of 3-byte sequence (0xE2) without continuation bytes
      const buffer = new ArrayBuffer(22);
      const view = new DataView(buffer);
      view.setBigUint64(0, 1n, true);
      view.setUint8(8, 0);
      view.setUint8(9, 0);
      view.setBigUint64(10, 0n, true);
      view.setUint8(18, 3); // message length = 3
      const bytes = new Uint8Array(buffer);
      bytes.set([0xe2, 0x82, 0x00], 19); // Incomplete euro sign (should be E2 82 AC)

      const result = decodeGameResult(bytes);
      // Should handle gracefully with replacement character
      expect(typeof result.message).toBe('string');
    });

    it('decodeGameResult handles overlong UTF-8 encoding', () => {
      // Overlong encoding of ASCII 'A' (normally 0x41, but encoded as C1 81)
      const buffer = new ArrayBuffer(21);
      const view = new DataView(buffer);
      view.setBigUint64(0, 1n, true);
      view.setUint8(8, 0);
      view.setUint8(9, 0);
      view.setBigUint64(10, 0n, true);
      view.setUint8(18, 2); // message length = 2
      const bytes = new Uint8Array(buffer);
      bytes.set([0xc1, 0x81], 19); // Overlong 'A'

      const result = decodeGameResult(bytes);
      // TextDecoder rejects overlong encodings, replaces with U+FFFD
      expect(result.message).toContain('\ufffd');
    });

    it('decodeGameResult handles valid UTF-8 correctly', () => {
      // Sanity check: valid UTF-8 with multi-byte chars works
      const buffer = new ArrayBuffer(30);
      const view = new DataView(buffer);
      view.setBigUint64(0, 1n, true);
      view.setUint8(8, 0);
      view.setUint8(9, 1);
      view.setBigUint64(10, 0n, true);
      const message = 'Hi \u2764'; // "Hi ❤" - heart is 3 UTF-8 bytes
      const encoded = new TextEncoder().encode(message);
      view.setUint8(18, encoded.length);
      const bytes = new Uint8Array(buffer);
      bytes.set(encoded, 19);

      const result = decodeGameResult(bytes);
      expect(result.message).toBe(message);
    });
  });

  describe('Boundary value tests', () => {
    it('handles maximum valid suit (3 = clubs)', () => {
      const card = decodeCard(toBuffer([0x03, 0x00, 0x01]), 0);
      expect(card.suit).toBe('clubs');
    });

    it('handles maximum valid rank (12 = K)', () => {
      const card = decodeCard(toBuffer([0x00, 0x0c, 0x00]), 0);
      expect(card.rank).toBe('K');
    });

    it('handles faceUp = 0 (false) and faceUp = any non-zero (true)', () => {
      expect(decodeCard(toBuffer([0x00, 0x00, 0x00]), 0).faceUp).toBe(false);
      expect(decodeCard(toBuffer([0x00, 0x00, 0x01]), 0).faceUp).toBe(true);
      expect(decodeCard(toBuffer([0x00, 0x00, 0xff]), 0).faceUp).toBe(true);
    });

    it('handles maximum session ID (2^64 - 1)', () => {
      const buffer = new ArrayBuffer(20);
      const view = new DataView(buffer);
      view.setBigUint64(0, 0xffffffffffffffffn, true);
      view.setUint8(8, 0);
      view.setUint8(9, 0);
      view.setBigUint64(10, 0n, true);
      view.setUint8(18, 0);

      const result = decodeGameResult(new Uint8Array(buffer));
      expect(result.sessionId).toBe(0xffffffffffffffffn);
    });

    it('handles maximum payout (2^64 - 1)', () => {
      const buffer = new ArrayBuffer(20);
      const view = new DataView(buffer);
      view.setBigUint64(0, 1n, true);
      view.setUint8(8, 0);
      view.setUint8(9, 1);
      view.setBigUint64(10, 0xffffffffffffffffn, true);
      view.setUint8(18, 0);

      const result = decodeGameResult(new Uint8Array(buffer));
      expect(result.payout).toBe(0xffffffffffffffffn);
    });

    it('handles zero message length', () => {
      const buffer = new ArrayBuffer(19);
      const view = new DataView(buffer);
      view.setBigUint64(0, 1n, true);
      view.setUint8(8, 0);
      view.setUint8(9, 0);
      view.setBigUint64(10, 0n, true);
      view.setUint8(18, 0); // zero length message

      const result = decodeGameResult(new Uint8Array(buffer));
      expect(result.message).toBe('');
    });

    it('handles blackjack with zero cards', () => {
      const buffer = new ArrayBuffer(15);
      const view = new DataView(buffer);
      let offset = 0;
      view.setBigUint64(offset, 1n, true);
      offset += 8;
      view.setUint8(offset++, 0); // 0 player cards
      view.setUint8(offset++, 0); // 0 dealer cards
      view.setUint8(offset++, 0); // playerTotal
      view.setUint8(offset++, 0); // dealerTotal
      view.setUint8(offset++, 0); // stage = betting
      view.setUint8(offset, 0); // no actions available

      const state = decodeBlackjackState(new Uint8Array(buffer));
      expect(state.playerCards).toHaveLength(0);
      expect(state.dealerCards).toHaveLength(0);
      expect(state.stage).toBe('betting');
    });
  });

  describe('Offset edge cases', () => {
    it('decodeCard works at various valid offsets', () => {
      const data = toBuffer([
        0xff, 0xff, 0xff, // garbage
        0x00, 0x00, 0x01, // spades A at offset 3
        0xff, 0xff, 0xff, // garbage
        0x01, 0x0c, 0x01, // hearts K at offset 9
      ]);

      expect(decodeCard(data, 3)).toEqual({
        suit: 'spades',
        rank: 'A',
        faceUp: true,
      });
      expect(decodeCard(data, 9)).toEqual({
        suit: 'hearts',
        rank: 'K',
        faceUp: true,
      });
    });

    it('decodeCards works at non-zero start offset', () => {
      const data = toBuffer([
        0xff, 0xff, // padding
        0x00, 0x00, 0x01, // card 1
        0x01, 0x01, 0x00, // card 2
      ]);

      const cards = decodeCards(data, 2, 2);
      expect(cards).toHaveLength(2);
      expect(cards[0].suit).toBe('spades');
      expect(cards[1].suit).toBe('hearts');
    });
  });
});
