import { describe, it, expect } from 'vitest';
import {
  encodeCasinoRegister,
  encodeCasinoDeposit,
  encodeCasinoStartGame,
  encodeCasinoGameMove,
  encodeCasinoPlayerAction,
  GameType,
  PlayerAction,
  InstructionTag,
  SubmissionTag,
} from '../../src/codec/index.js';
import { encodeGameActionPayload, encodeGameMovePayload } from '@nullspace/protocol';
import {
  buildTransaction,
  wrapSubmission,
  generateSessionId,
  verifyTransaction,
  ed25519,
} from '../../src/codec/transactions.js';

describe('Instruction Encoders', () => {
  describe('encodeCasinoRegister', () => {
    it('encodes player name correctly', () => {
      const encoded = encodeCasinoRegister('Alice');
      const view = new DataView(encoded.buffer);

      expect(encoded[0]).toBe(InstructionTag.CasinoRegister);  // tag 10
      expect(view.getUint32(1, false)).toBe(5);  // name length
      expect(new TextDecoder().decode(encoded.slice(5))).toBe('Alice');
    });

    it('handles empty name', () => {
      const encoded = encodeCasinoRegister('');
      expect(encoded.length).toBe(5);  // tag + length
      expect(new DataView(encoded.buffer).getUint32(1, false)).toBe(0);
    });

    it('handles unicode names', () => {
      const encoded = encodeCasinoRegister('游戏者');
      const nameBytes = new TextEncoder().encode('游戏者');
      expect(new DataView(encoded.buffer).getUint32(1, false)).toBe(nameBytes.length);
    });
  });

  describe('encodeCasinoDeposit', () => {
    it('encodes amount correctly', () => {
      const encoded = encodeCasinoDeposit(10000n);
      const view = new DataView(encoded.buffer);

      expect(encoded[0]).toBe(InstructionTag.CasinoDeposit);  // tag 11
      expect(view.getBigUint64(1, false)).toBe(10000n);
    });

    it('handles large amounts', () => {
      const largeAmount = 1000000000000n;  // 1 trillion
      const encoded = encodeCasinoDeposit(largeAmount);
      const view = new DataView(encoded.buffer);

      expect(view.getBigUint64(1, false)).toBe(largeAmount);
    });
  });

  describe('encodeCasinoStartGame', () => {
    it('encodes blackjack start correctly', () => {
      const encoded = encodeCasinoStartGame(GameType.Blackjack, 100n, 12345n);
      const view = new DataView(encoded.buffer);

      expect(encoded[0]).toBe(InstructionTag.CasinoStartGame);  // tag 12
      expect(encoded[1]).toBe(GameType.Blackjack);  // 1
      expect(view.getBigUint64(2, false)).toBe(100n);  // bet
      expect(view.getBigUint64(10, false)).toBe(12345n);  // sessionId
    });

    it('encodes all game types', () => {
      for (const [name, type] of Object.entries(GameType)) {
        if (typeof type !== 'number') continue;

        const encoded = encodeCasinoStartGame(type, 50n, 1n);
        expect(encoded[1]).toBe(type);
      }
    });

    it('uses big endian for multi-byte values', () => {
      const encoded = encodeCasinoStartGame(GameType.Blackjack, 256n, 0x0102030405060708n);

      // Verify bet (256 = 0x100) at offset 2
      expect(encoded[2]).toBe(0);
      expect(encoded[3]).toBe(0);
      expect(encoded[4]).toBe(0);
      expect(encoded[5]).toBe(0);
      expect(encoded[6]).toBe(0);
      expect(encoded[7]).toBe(0);
      expect(encoded[8]).toBe(1);  // 0x100 high byte
      expect(encoded[9]).toBe(0);  // 0x100 low byte

      // Verify sessionId at offset 10
      expect(encoded[10]).toBe(0x01);
      expect(encoded[11]).toBe(0x02);
      expect(encoded[12]).toBe(0x03);
      expect(encoded[13]).toBe(0x04);
      expect(encoded[14]).toBe(0x05);
      expect(encoded[15]).toBe(0x06);
      expect(encoded[16]).toBe(0x07);
      expect(encoded[17]).toBe(0x08);
    });
  });

  describe('encodeCasinoGameMove', () => {
    it('encodes move with payload', () => {
      const payload = new Uint8Array([1, 2, 3]);
      const encoded = encodeCasinoGameMove(999n, payload);
      const view = new DataView(encoded.buffer);

      expect(encoded[0]).toBe(InstructionTag.CasinoGameMove);  // tag 13
      expect(view.getBigUint64(1, false)).toBe(999n);  // sessionId
      expect(view.getUint32(9, false)).toBe(3);  // payload length
      expect(encoded.slice(13)).toEqual(payload);
    });

    it('handles empty payload', () => {
      const encoded = encodeCasinoGameMove(1n, new Uint8Array(0));
      expect(encoded.length).toBe(13);  // tag + sessionId + length
    });
  });

  describe('encodeCasinoPlayerAction', () => {
    it('encodes all actions', () => {
      expect(encodeCasinoPlayerAction(PlayerAction.Hit)).toEqual(new Uint8Array([14, 0]));
      expect(encodeCasinoPlayerAction(PlayerAction.Stand)).toEqual(new Uint8Array([14, 1]));
      expect(encodeCasinoPlayerAction(PlayerAction.Double)).toEqual(new Uint8Array([14, 2]));
      expect(encodeCasinoPlayerAction(PlayerAction.Split)).toEqual(new Uint8Array([14, 3]));
    });
  });
});

describe('Protocol Payload Builders', () => {
  describe('encodeGameMovePayload (blackjack)', () => {
    it('encodes all moves', () => {
      // All payloads now include version header (01) as first byte (US-149)
      expect(encodeGameMovePayload({ game: 'blackjack', move: 'hit' })).toEqual(new Uint8Array([1, 0]));
      expect(encodeGameMovePayload({ game: 'blackjack', move: 'stand' })).toEqual(new Uint8Array([1, 1]));
      expect(encodeGameMovePayload({ game: 'blackjack', move: 'double' })).toEqual(new Uint8Array([1, 2]));
      expect(encodeGameMovePayload({ game: 'blackjack', move: 'split' })).toEqual(new Uint8Array([1, 3]));
    });
  });

  describe('encodeGameActionPayload (hilo)', () => {
    it('encodes all guesses', () => {
      // All payloads now include version header (01) as first byte (US-149)
      expect(encodeGameActionPayload({ game: 'hilo', action: 'higher' })).toEqual(new Uint8Array([1, 0]));
      expect(encodeGameActionPayload({ game: 'hilo', action: 'lower' })).toEqual(new Uint8Array([1, 1]));
      // Same = 3 in Rust (2 is unused/reserved)
      expect(encodeGameActionPayload({ game: 'hilo', action: 'same' })).toEqual(new Uint8Array([1, 3]));
    });
  });
});

describe('Transaction Building', () => {
  const privateKey = ed25519.utils.randomPrivateKey();

  describe('buildTransaction', () => {
    it('creates valid transaction structure', () => {
      const instruction = encodeCasinoDeposit(100n);
      const tx = buildTransaction(0n, instruction, privateKey);

      // Transaction = nonce(8) + instruction + pubkey(32) + signature(64)
      const expectedLen = 8 + instruction.length + 32 + 64;
      expect(tx.length).toBe(expectedLen);
    });

    it('includes correct nonce', () => {
      const instruction = encodeCasinoDeposit(100n);
      const tx = buildTransaction(42n, instruction, privateKey);

      const view = new DataView(tx.buffer);
      expect(view.getBigUint64(0, false)).toBe(42n);
    });

    it('produces verifiable signature', () => {
      const instruction = encodeCasinoDeposit(100n);
      const tx = buildTransaction(0n, instruction, privateKey);

      expect(verifyTransaction(tx, instruction.length)).toBe(true);
    });

    it('signature changes with different nonce', () => {
      const instruction = encodeCasinoDeposit(100n);
      const tx1 = buildTransaction(0n, instruction, privateKey);
      const tx2 = buildTransaction(1n, instruction, privateKey);

      // Signatures should differ
      const sig1 = tx1.slice(-64);
      const sig2 = tx2.slice(-64);
      expect(sig1).not.toEqual(sig2);
    });

    it('signature changes with different instruction', () => {
      const tx1 = buildTransaction(0n, encodeCasinoDeposit(100n), privateKey);
      const tx2 = buildTransaction(0n, encodeCasinoDeposit(200n), privateKey);

      const sig1 = tx1.slice(-64);
      const sig2 = tx2.slice(-64);
      expect(sig1).not.toEqual(sig2);
    });
  });

  describe('wrapSubmission', () => {
    it('uses tag 1 for Transactions', () => {
      const tx = new Uint8Array(100);
      const wrapped = wrapSubmission(tx);

      expect(wrapped[0]).toBe(SubmissionTag.Transactions);  // CRITICAL: 1, not 0
    });

    it('includes vec length as varint', () => {
      const tx = new Uint8Array(100);
      const wrapped = wrapSubmission(tx);

      // Vec length 1 is encoded as a single byte varint: 0x01
      expect(wrapped[1]).toBe(1);
    });

    it('includes transaction bytes after header', () => {
      const tx = new Uint8Array([1, 2, 3, 4, 5]);
      const wrapped = wrapSubmission(tx);

      // Header is: tag (1 byte) + varint len (1 byte for len=1) = 2 bytes
      expect(wrapped.slice(2)).toEqual(tx);
    });

    it('has correct total length', () => {
      const tx = new Uint8Array(100);
      const wrapped = wrapSubmission(tx);

      // tag (1) + varint len (1 for small counts) + tx (100) = 102
      expect(wrapped.length).toBe(1 + 1 + 100);
    });
  });

  describe('generateSessionId', () => {
    it('produces different IDs for different counters', () => {
      const publicKey = ed25519.getPublicKey(privateKey);

      const id1 = generateSessionId(publicKey, 0n);
      const id2 = generateSessionId(publicKey, 1n);

      expect(id1).not.toBe(id2);
    });

    it('produces different IDs for different keys', () => {
      const pk1 = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());
      const pk2 = ed25519.getPublicKey(ed25519.utils.randomPrivateKey());

      const id1 = generateSessionId(pk1, 0n);
      const id2 = generateSessionId(pk2, 0n);

      expect(id1).not.toBe(id2);
    });

    it('produces consistent results', () => {
      const publicKey = ed25519.getPublicKey(privateKey);

      const id1 = generateSessionId(publicKey, 42n);
      const id2 = generateSessionId(publicKey, 42n);

      expect(id1).toBe(id2);
    });
  });
});
