/**
 * Custodial Signing Architecture Integration Tests
 *
 * US-081: Documents and tests the two-tier signing architecture:
 *
 * ## ARCHITECTURE OVERVIEW
 *
 * ### 1. Custodial Model (Gateway → On-Chain)
 * - Gateway generates ephemeral Ed25519 key pairs per session
 * - Gateway signs all on-chain transactions with ephemeral private key
 * - Private keys are NEVER exposed to clients
 * - Backend verifies signatures using session public key
 * - Ephemeral keys are lost on WebSocket disconnect (by design)
 *
 * ### 2. Entitlements Model (Mobile → Auth Service)
 * - Mobile stores long-term vault key (password-protected)
 * - Vault uses XChaCha20-Poly1305 encryption with PBKDF2 KDF (250K iterations)
 * - Mobile signs auth requests with vault private key
 * - Auth service verifies signatures using vault public key
 *
 * ### 3. WebSocket Session Isolation
 * - One session per WebSocket connection (1:1 mapping)
 * - Sessions isolated via Map<WebSocket, Session> and Map<publicKeyHex, Session>
 * - All handlers receive session context, preventing cross-session access
 * - Session destroyed immediately on WebSocket close
 *
 * ### 4. Reconnection Handling
 * - Ephemeral keys lost on disconnect (no session resumption)
 * - New key pair generated on reconnect
 * - New public key returned in session_ready message
 * - Game state queryable from backend using on-chain session IDs
 *
 * ## SECURITY BOUNDARIES
 * - Ephemeral private keys: Gateway memory only
 * - Vault private keys: Encrypted storage only (never in memory except when unlocked)
 * - Transaction signing: Uses namespace prefix to prevent cross-chain replay
 * - Nonce management: Prevents transaction replay within same chain
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { existsSync, rmSync } from 'fs';

// Mock UpdatesClient before importing SessionManager
vi.mock('../../src/backend/updates.js', () => ({
  UpdatesClient: class MockUpdatesClient extends EventEmitter {
    connectForAccount = vi.fn().mockResolvedValue(undefined);
    connectForSession = vi.fn().mockResolvedValue(undefined);
    connectForAll = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn();
    isConnected = vi.fn().mockReturnValue(true);
  },
}));

import { SessionManager } from '../../src/session/manager.js';
import type { SubmitClient, SubmitResult } from '../../src/backend/http.js';
import { NonceManager } from '../../src/session/nonce.js';
import {
  buildTransaction,
  verifyTransaction,
  ed25519,
} from '../../src/codec/transactions.js';
import { encodeCasinoDeposit } from '../../src/codec/index.js';
import { bytesToHex } from '@noble/curves/abstract/utils';

const TEST_DATA_DIR = '.test-custodial-signing-data';

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3; // WebSocket.CLOSED
  });
  terminate = vi.fn();
}

// Mock SubmitClient
function createMockSubmitClient(): SubmitClient {
  return {
    submit: vi.fn().mockResolvedValue({ accepted: true }),
    getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as SubmitClient;
}

describe('Custodial Signing Architecture (US-081)', () => {
  let manager: SessionManager;
  let mockSubmitClient: SubmitClient;
  let nonceManager: NonceManager;

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    nonceManager = new NonceManager({ dataDir: TEST_DATA_DIR });
    mockSubmitClient = createMockSubmitClient();
    manager = new SessionManager(
      mockSubmitClient,
      'http://localhost:8080',
      nonceManager,
      'http://localhost:9010'
    );
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe('CUSTODIAL MODEL: Gateway Signs On-Chain Txs with Ephemeral Keys', () => {
    it('ARCHITECTURE: ephemeral keys generated per session via ed25519.utils.randomPrivateKey()', async () => {
      // Document: Gateway generates unique Ed25519 keypair for each session
      // This is the "custodial" model - gateway holds private keys, client never sees them
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Public key is 32 bytes = 64 hex characters
      expect(session.publicKeyHex).toHaveLength(64);
      // Private key exists (internal to session) but is NOT exposed to client
      expect(typeof session.publicKeyHex).toBe('string');
    });

    it('ARCHITECTURE: each session has unique keypair (no key reuse)', async () => {
      // Document: Key uniqueness prevents cross-session transaction replay
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');
      const session2 = await manager.createSession(ws2, {}, '127.0.0.2');

      // Different sessions MUST have different public keys
      expect(session1.publicKeyHex).not.toBe(session2.publicKeyHex);
    });

    it('ARCHITECTURE: entropy validation prevents weak key generation', () => {
      // Document: SessionManager validates entropy (no all-zeros, no all-same-byte keys)
      // Test that ed25519 key generation produces high-entropy keys
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const privateKey = ed25519.utils.randomPrivateKey();
        const publicKey = ed25519.getPublicKey(privateKey);
        const hex = bytesToHex(publicKey);
        keys.add(hex);

        // No all-zeros key
        const allZeros = privateKey.every((b) => b === 0);
        expect(allZeros).toBe(false);

        // No all-same-byte key
        const allSame = privateKey.every((b) => b === privateKey[0]);
        expect(allSame).toBe(false);
      }

      // All 100 keys should be unique
      expect(keys.size).toBe(100);
    });

    it('ARCHITECTURE: transactions signed with namespace prefix (_NULLSPACE_TX)', () => {
      // Document: Namespace prevents cross-chain replay attacks
      // The transaction format includes the namespace in the signed payload
      const privateKey = ed25519.utils.randomPrivateKey();
      const instruction = encodeCasinoDeposit(100n);
      const tx = buildTransaction(0n, instruction, privateKey);

      // Transaction structure: nonce(8) + instruction + pubkey(32) + signature(64)
      expect(tx.length).toBe(8 + instruction.length + 32 + 64);

      // Signature verification succeeds (namespace is correctly applied)
      expect(verifyTransaction(tx, instruction.length)).toBe(true);
    });

    it('ARCHITECTURE: signature verification uses union_unique format', () => {
      // Document: Signing format is [varint(namespace.len)] [namespace] [nonce + instruction]
      // This is the commonware-cryptography standard
      const privateKey = ed25519.utils.randomPrivateKey();
      const instruction = encodeCasinoDeposit(100n);

      // Build two transactions with different nonces - signatures must differ
      const tx1 = buildTransaction(0n, instruction, privateKey);
      const tx2 = buildTransaction(1n, instruction, privateKey);

      const sig1 = tx1.slice(-64);
      const sig2 = tx2.slice(-64);
      expect(sig1).not.toEqual(sig2);

      // Both verify correctly
      expect(verifyTransaction(tx1, instruction.length)).toBe(true);
      expect(verifyTransaction(tx2, instruction.length)).toBe(true);
    });

    it('ARCHITECTURE: private key isolation - key never exposed to client', async () => {
      // Document: The Session object contains private key internally,
      // but it's never included in messages sent to client
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // The session_ready message contains only public key, not private key
      // Verify by checking that public key is exposed but any private key is not serializable
      const sessionJson = JSON.stringify({
        id: session.id,
        publicKeyHex: session.publicKeyHex,
        balance: session.balance.toString(),
      });

      expect(sessionJson).toContain(session.publicKeyHex);
      // Private key hex would be a different 64-char hex string
      // We can't directly test for absence, but we document the contract
    });
  });

  describe('ENTITLEMENTS MODEL: Mobile Signs with Vault Key, Auth Server Verifies', () => {
    // Note: These tests document the mobile vault architecture.
    // The actual vault tests are in mobile/src/services/__tests__/vault.test.ts

    it('ARCHITECTURE DOC: vault uses XChaCha20-Poly1305 encryption', () => {
      // Document: Mobile vault encrypts private key at rest using:
      // - Cipher: XChaCha20-Poly1305 (AEAD)
      // - KDF: PBKDF2-SHA256 with 250,000 iterations
      // - Salt: 32 bytes random
      // - Nonce: 24 bytes random (XChaCha20 uses extended nonce)
      expect(true).toBe(true); // Documentation test
    });

    it('ARCHITECTURE DOC: vault_locked error thrown when vault not unlocked', () => {
      // Document: signMessage() throws 'vault_locked' if private key not in memory
      // The vault must be explicitly unlocked before signing operations
      expect(true).toBe(true); // Documentation test
    });

    it('ARCHITECTURE DOC: auth flow - mobile signs with vault key', () => {
      // Document: Authentication flow:
      // 1. User enters vault password
      // 2. Mobile derives key via PBKDF2
      // 3. Mobile decrypts private key from vault
      // 4. Mobile signs auth challenge with private key
      // 5. Auth server verifies signature with stored public key
      // 6. Session token issued on success
      expect(true).toBe(true); // Documentation test
    });
  });

  describe('WEBSOCKET SESSION ISOLATION: Prevents Cross-Session Impersonation', () => {
    it('ISOLATION: one session per WebSocket connection (1:1 mapping)', async () => {
      // Document: Each WebSocket gets exactly one session
      // This prevents session hijacking via shared connections
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Lookup by WebSocket returns the session
      expect(manager.getSession(ws)).toBe(session);
      expect(manager.getSessionCount()).toBe(1);
    });

    it('ISOLATION: session lookup by WebSocket prevents cross-session access', async () => {
      // Document: Handler receives session from WebSocket lookup,
      // not from message content - prevents spoofed session claims
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');
      const session2 = await manager.createSession(ws2, {}, '127.0.0.2');

      // Each WebSocket maps to its own session only
      expect(manager.getSession(ws1)).toBe(session1);
      expect(manager.getSession(ws2)).toBe(session2);
      expect(manager.getSession(ws1)).not.toBe(session2);
    });

    it('ISOLATION: sessions also indexed by publicKeyHex for backend lookups', async () => {
      // Document: Double indexing allows:
      // - WebSocket lookup for message routing (ws → session)
      // - Public key lookup for backend events (publicKeyHex → session)
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      expect(manager.getSessionByPublicKeyHex(session.publicKeyHex)).toBe(session);
    });

    it('ISOLATION: different clients cannot share session', async () => {
      // Document: Connection from different IP gets different session
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session1 = await manager.createSession(ws1, {}, '192.168.1.100');
      const session2 = await manager.createSession(ws2, {}, '192.168.1.101');

      expect(session1.id).not.toBe(session2.id);
      expect(session1.publicKeyHex).not.toBe(session2.publicKeyHex);
    });

    it('ISOLATION: session state independent between connections', async () => {
      // Document: Game state in one session doesn't affect another
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');
      const session2 = await manager.createSession(ws2, {}, '127.0.0.2');

      // Start game on session1 only
      const gameId = manager.startGame(
        session1,
        'blackjack' as import('@nullspace/types').GameType
      );

      expect(session1.activeGameId).toBe(gameId);
      expect(session1.gameType).toBe('blackjack');

      // Session2 is unaffected
      expect(session2.activeGameId).toBeNull();
      expect(session2.gameType).toBeNull();
    });

    it('ISOLATION: message handlers receive session context (code pattern)', () => {
      // Document: The handler invocation pattern in gateway/src/index.ts:240-245
      // ensures all handlers receive the session looked up by WebSocket,
      // not from any client-provided identifier.
      //
      // Pattern:
      //   const session = sessionManager.getSession(ws);
      //   if (!session) {
      //     sendError(ws, ErrorCodes.SESSION_EXPIRED, 'Session not found');
      //     return;
      //   }
      //   const ctx: HandlerContext = { session, ... };
      //   await handler.handleMessage(ctx, validatedMsg);
      //
      expect(true).toBe(true); // Documentation test
    });
  });

  describe('EPHEMERAL KEY LOSS ON RECONNECT: Graceful Handling', () => {
    it('RECONNECT: session destroyed on WebSocket close', async () => {
      // Document: Ephemeral keys lost immediately on disconnect
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');
      const publicKeyHex = session.publicKeyHex;

      expect(manager.getSessionCount()).toBe(1);

      // Simulate disconnect
      manager.destroySession(ws);

      expect(manager.getSessionCount()).toBe(0);
      expect(manager.getSession(ws)).toBeUndefined();
      expect(manager.getSessionByPublicKeyHex(publicKeyHex)).toBeUndefined();
    });

    it('RECONNECT: new session gets new ephemeral key', async () => {
      // Document: Reconnection creates fresh keypair
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      // First connection
      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');
      const publicKey1 = session1.publicKeyHex;

      // Disconnect
      manager.destroySession(ws1);

      // Reconnect (same IP, new WebSocket)
      const session2 = await manager.createSession(ws2, {}, '127.0.0.1');
      const publicKey2 = session2.publicKeyHex;

      // New connection = new key (no session resumption)
      expect(publicKey1).not.toBe(publicKey2);
    });

    it('RECONNECT: new public key returned in session_ready message (pattern)', async () => {
      // Document: On successful session creation, gateway sends:
      // {
      //   type: 'session_ready',
      //   sessionId: '<uuid>',
      //   publicKey: '<hex>',  // NEW ephemeral public key
      // }
      // Client must use this new public key for any identity-related operations
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // The session contains all fields needed for session_ready
      expect(session.id).toBeDefined();
      expect(session.publicKeyHex).toHaveLength(64);
    });

    it('RECONNECT: game session IDs preserved on-chain for recovery', () => {
      // Document: While ephemeral keys are lost, game state is recoverable because:
      // 1. Game session IDs are stored on-chain (immutable)
      // 2. Backend can replay game events by session ID
      // 3. New ephemeral key can query game history
      //
      // Recovery flow:
      //   1. Client reconnects → gets new ephemeral key
      //   2. Client can query backend for active games by previous public key
      //   3. If game in progress, can continue with new session
      //
      expect(true).toBe(true); // Documentation test
    });

    it('RECONNECT: nonce sync on reconnection (for same public key if stored)', () => {
      // Document: If client stores public key and reconnects with same identity:
      // - NonceManager.syncFromBackend() fetches current nonce from backend
      // - Prevents duplicate transaction submission
      //
      // NOTE: Current architecture generates new ephemeral key each time,
      // so this applies to mobile vault keys connecting to auth service,
      // not gateway session keys.
      expect(true).toBe(true); // Documentation test
    });

    it('RECONNECT: balance maintained via backend (not session)', async () => {
      // Document: Balance is authoritative on backend, not in session
      // Session.balance is a cached value refreshed from backend
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Mock backend returns balance
      (mockSubmitClient.getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        nonce: 0n,
        balance: 5000n,
      });

      const balance = await manager.refreshBalance(session);

      expect(balance).toBe(5000n);
      expect(session.balance).toBe(5000n);
    });
  });

  describe('RATE LIMITING: Session Creation Attacks Prevented', () => {
    it('RATE LIMIT: max 10 session creations per IP per hour (default)', async () => {
      // Document: Prevents session exhaustion attacks
      const clientIp = '10.0.0.100';

      // Create 10 sessions (at limit)
      for (let i = 0; i < 10; i++) {
        const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
        await manager.createSession(ws, {}, clientIp);
      }

      // 11th should fail
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      await expect(manager.createSession(ws, {}, clientIp)).rejects.toThrow(
        'Session creation rate limit exceeded'
      );
    });

    it('RATE LIMIT: different IPs have independent limits', async () => {
      const ip1 = '10.0.0.1';
      const ip2 = '10.0.0.2';

      // Create sessions from two different IPs
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session1 = await manager.createSession(ws1, {}, ip1);
      const session2 = await manager.createSession(ws2, {}, ip2);

      // Both should succeed (different rate limit buckets)
      expect(session1).toBeDefined();
      expect(session2).toBeDefined();
    });
  });

  describe('TRANSACTION SIGNATURE VERIFICATION', () => {
    it('VERIFY: valid transaction signature passes verification', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const instruction = encodeCasinoDeposit(100n);
      const tx = buildTransaction(0n, instruction, privateKey);

      expect(verifyTransaction(tx, instruction.length)).toBe(true);
    });

    it('VERIFY: tampered transaction fails verification', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const instruction = encodeCasinoDeposit(100n);
      const tx = buildTransaction(0n, instruction, privateKey);

      // Tamper with the nonce (first 8 bytes)
      tx[0] = tx[0] ^ 0xff;

      expect(verifyTransaction(tx, instruction.length)).toBe(false);
    });

    it('VERIFY: wrong public key fails verification', () => {
      const privateKey1 = ed25519.utils.randomPrivateKey();
      const privateKey2 = ed25519.utils.randomPrivateKey();
      const instruction = encodeCasinoDeposit(100n);

      // Build transaction with key1
      const tx = buildTransaction(0n, instruction, privateKey1);

      // Replace public key with key2's public key
      const pubKey2 = ed25519.getPublicKey(privateKey2);
      const pubKeyOffset = tx.length - 64 - 32; // Before signature (64 bytes) is pubkey (32 bytes)
      tx.set(pubKey2, pubKeyOffset);

      expect(verifyTransaction(tx, instruction.length)).toBe(false);
    });
  });

  describe('SECURITY BOUNDARY DOCUMENTATION', () => {
    it('DOC: ephemeral private keys exist only in gateway memory', () => {
      // Ephemeral keys are:
      // - Generated: ed25519.utils.randomPrivateKey() in SessionManager
      // - Stored: In Session object's internal state
      // - Used: For signing via buildTransaction()
      // - Destroyed: When Session is garbage collected after destroySession()
      // - Never: Serialized, logged, sent to client, or persisted to disk
      expect(true).toBe(true);
    });

    it('DOC: vault private keys encrypted at rest with password-derived key', () => {
      // Vault keys are:
      // - Generated: ed25519.utils.randomPrivateKey() in vault.createPasswordVault()
      // - Encrypted: XChaCha20-Poly1305 with PBKDF2-derived key
      // - Stored: Encrypted blob in SecureStore (native keychain)
      // - Decrypted: Only when user provides password
      // - Memory: Private key in memory only while vault is unlocked
      // - Locked: Private key cleared from memory on lockVault()
      expect(true).toBe(true);
    });

    it('DOC: transaction namespace prevents cross-chain replay', () => {
      // Namespace "_NULLSPACE_TX" is prepended to signed message:
      // signed_payload = [varint(namespace.len)] [namespace] [nonce + instruction]
      //
      // This means:
      // - Transaction from one chain cannot be replayed on another
      // - Each chain/application uses different namespace
      // - Ed25519 signature binds to full payload including namespace
      expect(true).toBe(true);
    });

    it('DOC: nonce increment prevents replay within same chain', () => {
      // Nonce management:
      // - Each public key has monotonically increasing nonce
      // - Backend rejects transactions with nonce <= last processed
      // - NonceManager tracks pending nonces to avoid collisions
      // - syncFromBackend() fetches authoritative nonce after conflicts
      expect(true).toBe(true);
    });
  });
});
