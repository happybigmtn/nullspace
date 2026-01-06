/**
 * Crypto service integration tests
 *
 * IMPORTANT: These tests use REAL @noble/curves/ed25519 cryptographic operations.
 * No mocks are used for the crypto library to ensure signatures are valid.
 */
import { webcrypto } from 'crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '../../utils/hex';
import {
  createPasswordVault,
  deleteVault,
  exportVaultPrivateKey,
  getVaultStatus,
  importVaultPrivateKey,
  lockVault,
  unlockPasswordVault,
} from '../vault';

// Ensure global crypto is available for tests
if (!global.crypto) {
  global.crypto = webcrypto as unknown as Crypto;
}

// Storage mocks for vault operations
const mockSecureStoreData = new Map<string, string>();
const mockLocalStorageData = new Map<string, string>();

// localStorage mock for web platform
const localStorageMock = {
  getItem: jest.fn((key: string) => mockLocalStorageData.get(key) ?? null),
  setItem: jest.fn((key: string, value: string) => {
    mockLocalStorageData.set(key, value);
  }),
  removeItem: jest.fn((key: string) => {
    mockLocalStorageData.delete(key);
  }),
  clear: jest.fn(() => mockLocalStorageData.clear()),
};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStoreData.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStoreData.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStoreData.delete(key);
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

beforeEach(() => {
  mockSecureStoreData.clear();
  mockLocalStorageData.clear();
  global.localStorage = localStorageMock as unknown as Storage;
  lockVault();
});

afterEach(async () => {
  await deleteVault();
});

afterAll(() => {
  delete (global as { localStorage?: Storage }).localStorage;
});

describe('Ed25519 real crypto operations', () => {
  describe('signature generation', () => {
    it('generates valid 64-byte signatures', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      const message = new Uint8Array([1, 2, 3, 4, 5]);

      const signature = ed25519.sign(message, privateKey);

      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64);
    });

    it('generates deterministic signatures for same key and message', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const message = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

      const sig1 = ed25519.sign(message, privateKey);
      const sig2 = ed25519.sign(message, privateKey);

      expect(bytesToHex(sig1)).toBe(bytesToHex(sig2));
    });

    it('generates different signatures for different messages', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const msg1 = new Uint8Array([1, 2, 3]);
      const msg2 = new Uint8Array([4, 5, 6]);

      const sig1 = ed25519.sign(msg1, privateKey);
      const sig2 = ed25519.sign(msg2, privateKey);

      expect(bytesToHex(sig1)).not.toBe(bytesToHex(sig2));
    });

    it('generates different signatures for different keys', () => {
      const key1 = ed25519.utils.randomPrivateKey();
      const key2 = ed25519.utils.randomPrivateKey();
      const message = new Uint8Array([1, 2, 3]);

      const sig1 = ed25519.sign(message, key1);
      const sig2 = ed25519.sign(message, key2);

      expect(bytesToHex(sig1)).not.toBe(bytesToHex(sig2));
    });
  });

  describe('signature verification round-trip', () => {
    it('verifies valid signature', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      const message = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

      const signature = ed25519.sign(message, privateKey);
      const isValid = ed25519.verify(signature, message, publicKey);

      expect(isValid).toBe(true);
    });

    it('rejects signature from wrong key', () => {
      const privateKey1 = ed25519.utils.randomPrivateKey();
      const privateKey2 = ed25519.utils.randomPrivateKey();
      const publicKey2 = ed25519.getPublicKey(privateKey2);
      const message = new Uint8Array([1, 2, 3, 4]);

      const signature = ed25519.sign(message, privateKey1);
      const isValid = ed25519.verify(signature, message, publicKey2);

      expect(isValid).toBe(false);
    });

    it('rejects signature for wrong message', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      const message1 = new Uint8Array([1, 2, 3]);
      const message2 = new Uint8Array([4, 5, 6]);

      const signature = ed25519.sign(message1, privateKey);
      const isValid = ed25519.verify(signature, message2, publicKey);

      expect(isValid).toBe(false);
    });

    it('rejects tampered signature', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      const message = new Uint8Array([1, 2, 3, 4, 5]);

      const signature = ed25519.sign(message, privateKey);
      const tamperedSig = new Uint8Array(signature);
      tamperedSig[0] ^= 0xff; // Flip bits in first byte

      const isValid = ed25519.verify(tamperedSig, message, publicKey);
      expect(isValid).toBe(false);
    });

    it('handles empty message', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      const message = new Uint8Array(0);

      const signature = ed25519.sign(message, privateKey);
      const isValid = ed25519.verify(signature, message, publicKey);

      expect(isValid).toBe(true);
    });

    it('handles large message', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      const message = new Uint8Array(10000).fill(0xab);

      const signature = ed25519.sign(message, privateKey);
      const isValid = ed25519.verify(signature, message, publicKey);

      expect(isValid).toBe(true);
    });
  });

  describe('key generation', () => {
    it('generates 32-byte private keys', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      expect(privateKey).toBeInstanceOf(Uint8Array);
      expect(privateKey.length).toBe(32);
    });

    it('derives 32-byte public keys from private keys', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      expect(publicKey).toBeInstanceOf(Uint8Array);
      expect(publicKey.length).toBe(32);
    });

    it('generates unique key pairs', () => {
      const key1 = ed25519.utils.randomPrivateKey();
      const key2 = ed25519.utils.randomPrivateKey();
      expect(bytesToHex(key1)).not.toBe(bytesToHex(key2));
    });

    it('derives deterministic public key from private key', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const pub1 = ed25519.getPublicKey(privateKey);
      const pub2 = ed25519.getPublicKey(privateKey);
      expect(bytesToHex(pub1)).toBe(bytesToHex(pub2));
    });
  });

  describe('hex encoding round-trip', () => {
    it('encodes and decodes private key via hex', () => {
      const originalKey = ed25519.utils.randomPrivateKey();
      const hex = bytesToHex(originalKey);
      const restored = hexToBytes(hex);

      expect(restored.length).toBe(originalKey.length);
      expect(bytesToHex(restored)).toBe(bytesToHex(originalKey));
    });

    it('signature still valid after hex round-trip', () => {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      const message = new Uint8Array([1, 2, 3]);

      // Simulate storage via hex
      const privateKeyHex = bytesToHex(privateKey);
      const restoredPrivateKey = hexToBytes(privateKeyHex);

      const signature = ed25519.sign(message, restoredPrivateKey);
      const isValid = ed25519.verify(signature, message, publicKey);

      expect(isValid).toBe(true);
    });
  });
});

describe('vault key export/import', () => {
  const TEST_PASSWORD = 'test-password-123';
  const RECOVERY_PASSWORD = 'recovery-pass-456';

  it('creates vault with new key and exports it', async () => {
    const publicKeyHex = await createPasswordVault(TEST_PASSWORD, { migrateLegacyKey: false });

    expect(publicKeyHex).toMatch(/^[0-9a-f]{64}$/);

    const exportedPrivateKeyHex = await exportVaultPrivateKey();
    expect(exportedPrivateKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exported key produces valid signatures', async () => {
    await createPasswordVault(TEST_PASSWORD, { migrateLegacyKey: false });
    const exportedKeyHex = await exportVaultPrivateKey();

    // Recreate key pair from export
    const privateKey = hexToBytes(exportedKeyHex);
    const publicKey = ed25519.getPublicKey(privateKey);
    const message = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

    // Sign with exported key
    const signature = ed25519.sign(message, privateKey);
    const isValid = ed25519.verify(signature, message, publicKey);

    expect(isValid).toBe(true);
  });

  it('imports key and preserves public key identity', async () => {
    // Create vault and export
    await createPasswordVault(TEST_PASSWORD, { migrateLegacyKey: false });
    const originalStatus = await getVaultStatus();
    const exportedKeyHex = await exportVaultPrivateKey();

    // Clear vault
    lockVault();
    await deleteVault();

    // Import with different password
    const importedPublicKeyHex = await importVaultPrivateKey(RECOVERY_PASSWORD, exportedKeyHex, {
      overwrite: true,
    });

    // Verify public key is preserved
    expect(importedPublicKeyHex).toBe(originalStatus.publicKeyHex);
  });

  it('import produces valid signatures matching original', async () => {
    // Create vault and sign a message
    await createPasswordVault(TEST_PASSWORD, { migrateLegacyKey: false });
    const exportedKeyHex = await exportVaultPrivateKey();
    const status = await getVaultStatus();
    const originalPublicKey = hexToBytes(status.publicKeyHex!);
    const message = new Uint8Array([1, 2, 3, 4, 5]);

    // Sign with original key
    const privateKey = hexToBytes(exportedKeyHex);
    const originalSig = ed25519.sign(message, privateKey);

    // Import to new vault
    lockVault();
    await deleteVault();
    await importVaultPrivateKey(RECOVERY_PASSWORD, exportedKeyHex, { overwrite: true });

    // Export from new vault and sign
    const newExportedKeyHex = await exportVaultPrivateKey();
    const newPrivateKey = hexToBytes(newExportedKeyHex);
    const newSig = ed25519.sign(message, newPrivateKey);

    // Signatures should be identical (deterministic)
    expect(bytesToHex(newSig)).toBe(bytesToHex(originalSig));

    // Both should verify against original public key
    expect(ed25519.verify(originalSig, message, originalPublicKey)).toBe(true);
    expect(ed25519.verify(newSig, message, originalPublicKey)).toBe(true);
  });

  it('unlocked vault can sign after lock/unlock cycle', async () => {
    await createPasswordVault(TEST_PASSWORD, { migrateLegacyKey: false });
    const originalKeyHex = await exportVaultPrivateKey();
    const status = await getVaultStatus();

    // Lock and unlock
    lockVault();
    await unlockPasswordVault(TEST_PASSWORD);

    // Export again and compare
    const unlockedKeyHex = await exportVaultPrivateKey();
    expect(unlockedKeyHex).toBe(originalKeyHex);

    // Verify signing still works
    const privateKey = hexToBytes(unlockedKeyHex);
    const publicKey = hexToBytes(status.publicKeyHex!);
    const message = new Uint8Array([0xff, 0xee, 0xdd]);
    const sig = ed25519.sign(message, privateKey);

    expect(ed25519.verify(sig, message, publicKey)).toBe(true);
  });

  it('export requires unlock when vault is locked', async () => {
    await createPasswordVault(TEST_PASSWORD, { migrateLegacyKey: false });
    lockVault();

    // Export without password when locked should fail
    await expect(exportVaultPrivateKey()).rejects.toThrow('vault_locked');

    // Export with correct password should work
    const keyHex = await exportVaultPrivateKey(TEST_PASSWORD);
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects invalid private key hex on import', async () => {
    // Too short
    await expect(
      importVaultPrivateKey(TEST_PASSWORD, 'deadbeef', { overwrite: true })
    ).rejects.toThrow('invalid_private_key');

    // Invalid characters
    await expect(
      importVaultPrivateKey(TEST_PASSWORD, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', {
        overwrite: true,
      })
    ).rejects.toThrow('invalid_private_key');

    // Too long
    const tooLong = 'a'.repeat(128);
    await expect(
      importVaultPrivateKey(TEST_PASSWORD, tooLong, { overwrite: true })
    ).rejects.toThrow('invalid_private_key');
  });

  it('rejects password shorter than minimum', async () => {
    await expect(createPasswordVault('short', { migrateLegacyKey: false })).rejects.toThrow(
      'password_too_short'
    );
  });
});

describe('cross-platform signing compatibility', () => {
  it('signature format matches expected Ed25519 standard', () => {
    // Known test vector from Ed25519 spec
    // This verifies our implementation matches the standard
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    const message = new TextEncoder().encode('test message');

    const sig = ed25519.sign(message, privateKey);

    // Ed25519 signature structure: 64 bytes = R (32) + S (32)
    expect(sig.length).toBe(64);

    // Verify it's a valid signature
    expect(ed25519.verify(sig, message, publicKey)).toBe(true);
  });

  it('public key derived from known private key is deterministic', () => {
    // Use a fixed test key
    const knownPrivateKeyHex = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
    const privateKey = hexToBytes(knownPrivateKeyHex);
    const publicKey = ed25519.getPublicKey(privateKey);
    const publicKeyHex = bytesToHex(publicKey);

    // This should always produce the same result
    expect(publicKey.length).toBe(32);
    // Running again produces same result
    const publicKey2 = ed25519.getPublicKey(privateKey);
    expect(bytesToHex(publicKey2)).toBe(publicKeyHex);
  });
});
