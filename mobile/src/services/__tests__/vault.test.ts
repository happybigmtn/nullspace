import * as vault from '../vault';

// Mock SecureStore
const mockSecureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore[key] ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    delete mockSecureStore[key];
    return Promise.resolve();
  }),
}));

// Mock react-native Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// Setup crypto for tests
import { webcrypto } from 'crypto';
if (typeof global.crypto === 'undefined') {
  (global as unknown as { crypto: typeof webcrypto }).crypto = webcrypto;
}
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  (global as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
  (global as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
}

const VAULT_RECORD_KEY = 'nullspace_vault_record_v1';

// Helper to create a valid vault record for testing
async function createTestVault(password: string = 'testpassword123'): Promise<string> {
  return vault.createPasswordVault(password);
}

// Helper to get the raw vault record from storage
function getRawVaultRecord(): string | null {
  return mockSecureStore[VAULT_RECORD_KEY] ?? null;
}

// Helper to set raw vault record in storage
function setRawVaultRecord(value: string): void {
  mockSecureStore[VAULT_RECORD_KEY] = value;
}

describe('vault', () => {
  beforeEach(() => {
    // Clear mock storage
    Object.keys(mockSecureStore).forEach((key) => delete mockSecureStore[key]);
    // Lock any unlocked vault
    vault.lockVault();
  });

  describe('basic vault operations', () => {
    it('creates a vault with valid password', async () => {
      const publicKeyHex = await createTestVault();
      expect(publicKeyHex).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    it('unlocks vault with correct password', async () => {
      const password = 'correctpassword1';
      const publicKeyHex = await createTestVault(password);
      vault.lockVault();

      const unlockedKey = await vault.unlockPasswordVault(password);
      expect(unlockedKey).toBe(publicKeyHex);
    });

    it('rejects wrong password', async () => {
      await createTestVault('correctpassword1');
      vault.lockVault();

      await expect(vault.unlockPasswordVault('wrongpassword1')).rejects.toThrow(
        'vault_password_invalid'
      );
    });
  });

  describe('readVaultRecord() with invalid JSON', () => {
    it('returns null for completely invalid JSON', async () => {
      setRawVaultRecord('not valid json at all {{{');

      const status = await vault.getVaultStatus();
      // Currently returns null (no vault) instead of indicating corruption
      expect(status.enabled).toBe(false);
      expect(status.publicKeyHex).toBeNull();
    });

    it('returns null for truncated JSON', async () => {
      setRawVaultRecord('{"version":1,"kind":"password"');

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
    });

    it('returns null for empty string', async () => {
      setRawVaultRecord('');

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
    });

    it('returns null for JSON array instead of object', async () => {
      setRawVaultRecord('[1, 2, 3]');

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
    });

    it('returns null for JSON null', async () => {
      setRawVaultRecord('null');

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
    });
  });

  describe('readVaultRecord() with wrong schema version', () => {
    it('returns null for version 0', async () => {
      setRawVaultRecord(
        JSON.stringify({
          version: 0,
          kind: 'password',
          saltHex: 'abc',
          nonceHex: 'def',
          ciphertextHex: '123',
          publicKeyHex: '456',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        })
      );

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
    });

    it('returns null for version 2 (future version)', async () => {
      setRawVaultRecord(
        JSON.stringify({
          version: 2,
          kind: 'password',
          saltHex: 'abc',
          nonceHex: 'def',
          ciphertextHex: '123',
          publicKeyHex: '456',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        })
      );

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
    });

    it('returns null for missing version field', async () => {
      setRawVaultRecord(
        JSON.stringify({
          kind: 'password',
          saltHex: 'abc',
          nonceHex: 'def',
          ciphertextHex: '123',
          publicKeyHex: '456',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        })
      );

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
    });

    it('returns null for wrong kind value', async () => {
      setRawVaultRecord(
        JSON.stringify({
          version: 1,
          kind: 'biometric', // Not 'password'
          saltHex: 'abc',
          nonceHex: 'def',
          ciphertextHex: '123',
          publicKeyHex: '456',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        })
      );

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
    });
  });

  describe('vault corruption detection', () => {
    it('detects corrupted ciphertext (decryption fails)', async () => {
      const password = 'testpassword123';
      await createTestVault(password);
      vault.lockVault();

      // Corrupt the ciphertext
      const raw = getRawVaultRecord();
      expect(raw).not.toBeNull();
      const record = JSON.parse(raw!);
      record.ciphertextHex = 'ff'.repeat(48); // Wrong ciphertext
      setRawVaultRecord(JSON.stringify(record));

      // Vault appears enabled but unlock fails
      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(true);

      await expect(vault.unlockPasswordVault(password)).rejects.toThrow('vault_password_invalid');
    });

    it('detects corrupted salt (decryption fails)', async () => {
      const password = 'testpassword123';
      await createTestVault(password);
      vault.lockVault();

      const raw = getRawVaultRecord();
      const record = JSON.parse(raw!);
      record.saltHex = 'aa'.repeat(32); // Wrong salt
      setRawVaultRecord(JSON.stringify(record));

      await expect(vault.unlockPasswordVault(password)).rejects.toThrow('vault_password_invalid');
    });

    it('detects corrupted nonce (decryption fails)', async () => {
      const password = 'testpassword123';
      await createTestVault(password);
      vault.lockVault();

      const raw = getRawVaultRecord();
      const record = JSON.parse(raw!);
      record.nonceHex = 'bb'.repeat(24); // Wrong nonce
      setRawVaultRecord(JSON.stringify(record));

      await expect(vault.unlockPasswordVault(password)).rejects.toThrow('vault_password_invalid');
    });

    it('handles invalid hex in ciphertextHex', async () => {
      const password = 'testpassword123';
      await createTestVault(password);
      vault.lockVault();

      const raw = getRawVaultRecord();
      const record = JSON.parse(raw!);
      record.ciphertextHex = 'not-valid-hex!!!';
      setRawVaultRecord(JSON.stringify(record));

      // hexToBytes throws on invalid hex
      await expect(vault.unlockPasswordVault(password)).rejects.toThrow();
    });

    it('handles truncated ciphertext', async () => {
      const password = 'testpassword123';
      await createTestVault(password);
      vault.lockVault();

      const raw = getRawVaultRecord();
      const record = JSON.parse(raw!);
      record.ciphertextHex = record.ciphertextHex.slice(0, 10); // Truncate
      setRawVaultRecord(JSON.stringify(record));

      await expect(vault.unlockPasswordVault(password)).rejects.toThrow();
    });
  });

  describe('vault export for backup/recovery', () => {
    it('exports private key when unlocked', async () => {
      const password = 'testpassword123';
      await createTestVault(password);

      const privateKeyHex = await vault.exportVaultPrivateKey();
      expect(privateKeyHex).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    it('exports private key with password when locked', async () => {
      const password = 'testpassword123';
      await createTestVault(password);
      vault.lockVault();

      const privateKeyHex = await vault.exportVaultPrivateKey(password);
      expect(privateKeyHex).toHaveLength(64);
    });

    it('throws when locked without password', async () => {
      await createTestVault('testpassword123');
      vault.lockVault();

      await expect(vault.exportVaultPrivateKey()).rejects.toThrow('vault_locked');
    });

    it('can reimport exported key to recover vault', async () => {
      const password = 'testpassword123';
      const originalPublicKey = await createTestVault(password);
      const exportedPrivateKey = await vault.exportVaultPrivateKey();
      vault.lockVault();

      // Simulate corruption by deleting vault
      await vault.deleteVault();

      // Re-import the exported key
      const recoveredPublicKey = await vault.importVaultPrivateKey(password, exportedPrivateKey);
      expect(recoveredPublicKey).toBe(originalPublicKey);
    });

    it('preserves identity across export/import cycle', async () => {
      const password = 'originalpassword';
      const newPassword = 'newpassword123';

      const originalPublicKey = await createTestVault(password);
      const exportedPrivateKey = await vault.exportVaultPrivateKey();

      // Delete and reimport with different password
      await vault.deleteVault();
      const recoveredPublicKey = await vault.importVaultPrivateKey(newPassword, exportedPrivateKey);

      // Public key (identity) is preserved
      expect(recoveredPublicKey).toBe(originalPublicKey);

      // Can unlock with new password
      vault.lockVault();
      const unlocked = await vault.unlockPasswordVault(newPassword);
      expect(unlocked).toBe(originalPublicKey);
    });
  });

  describe('checkVaultCorruption()', () => {
    it('returns null for valid vault', async () => {
      await createTestVault('testpassword123');

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBeNull();
    });

    it('returns null for no vault (storage empty)', async () => {
      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBeNull();
    });

    it('returns invalid_json for non-JSON data', async () => {
      setRawVaultRecord('not valid json {{{');

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('invalid_json');
    });

    it('returns invalid_json for JSON array', async () => {
      setRawVaultRecord('[1, 2, 3]');

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('invalid_json');
    });

    it('returns invalid_json for JSON null', async () => {
      setRawVaultRecord('null');

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('invalid_json');
    });

    it('returns wrong_version for version 0', async () => {
      setRawVaultRecord(
        JSON.stringify({
          version: 0,
          kind: 'password',
          saltHex: 'a',
          nonceHex: 'b',
          ciphertextHex: 'c',
          publicKeyHex: 'd',
          createdAtMs: 1,
          updatedAtMs: 2,
        })
      );

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('wrong_version');
    });

    it('returns wrong_version for version 2', async () => {
      setRawVaultRecord(
        JSON.stringify({
          version: 2,
          kind: 'password',
          saltHex: 'a',
          nonceHex: 'b',
          ciphertextHex: 'c',
          publicKeyHex: 'd',
          createdAtMs: 1,
          updatedAtMs: 2,
        })
      );

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('wrong_version');
    });

    it('returns wrong_kind for kind "biometric"', async () => {
      setRawVaultRecord(
        JSON.stringify({
          version: 1,
          kind: 'biometric',
          saltHex: 'a',
          nonceHex: 'b',
          ciphertextHex: 'c',
          publicKeyHex: 'd',
          createdAtMs: 1,
          updatedAtMs: 2,
        })
      );

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('wrong_kind');
    });

    it('returns missing_fields when saltHex is missing', async () => {
      setRawVaultRecord(
        JSON.stringify({
          version: 1,
          kind: 'password',
          // saltHex missing
          nonceHex: 'b',
          ciphertextHex: 'c',
          publicKeyHex: 'd',
          createdAtMs: 1,
          updatedAtMs: 2,
        })
      );

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('missing_fields');
    });

    it('returns missing_fields when publicKeyHex is missing', async () => {
      setRawVaultRecord(
        JSON.stringify({
          version: 1,
          kind: 'password',
          saltHex: 'a',
          nonceHex: 'b',
          ciphertextHex: 'c',
          // publicKeyHex missing
          createdAtMs: 1,
          updatedAtMs: 2,
        })
      );

      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('missing_fields');
    });
  });

  describe('getVaultStatus() corruption field', () => {
    it('includes corrupted: null for valid vault', async () => {
      await createTestVault('testpassword123');

      const status = await vault.getVaultStatus();
      expect(status.corrupted).toBeNull();
      expect(status.enabled).toBe(true);
    });

    it('includes corrupted: null for no vault', async () => {
      const status = await vault.getVaultStatus();
      expect(status.corrupted).toBeNull();
      expect(status.enabled).toBe(false);
    });

    it('includes corrupted: invalid_json for corrupted data', async () => {
      setRawVaultRecord('corrupted {{{}}}');

      const status = await vault.getVaultStatus();
      expect(status.corrupted).toBe('invalid_json');
      expect(status.enabled).toBe(false);
    });

    it('includes corrupted: wrong_version for version mismatch', async () => {
      setRawVaultRecord(JSON.stringify({ version: 99, kind: 'password' }));

      const status = await vault.getVaultStatus();
      expect(status.corrupted).toBe('wrong_version');
      expect(status.enabled).toBe(false);
    });
  });

  describe('getVaultCorruptionGuidance()', () => {
    it('returns appropriate message for invalid_json', () => {
      const guidance = vault.getVaultCorruptionGuidance('invalid_json');
      expect(guidance).toContain('corrupted');
      expect(guidance).toContain('recovery key');
    });

    it('returns appropriate message for wrong_version', () => {
      const guidance = vault.getVaultCorruptionGuidance('wrong_version');
      expect(guidance).toContain('incompatible app version');
      expect(guidance).toContain('update');
    });

    it('returns appropriate message for wrong_kind', () => {
      const guidance = vault.getVaultCorruptionGuidance('wrong_kind');
      expect(guidance).toContain('unsupported authentication');
    });

    it('returns appropriate message for missing_fields', () => {
      const guidance = vault.getVaultCorruptionGuidance('missing_fields');
      expect(guidance).toContain('incomplete');
      expect(guidance).toContain('recovery key');
    });

    it('returns null for no corruption', () => {
      const guidance = vault.getVaultCorruptionGuidance(null);
      expect(guidance).toBeNull();
    });
  });

  describe('vault corruption user guidance (legacy tests)', () => {
    it('isVaultEnabled returns false for corrupted vault', async () => {
      setRawVaultRecord('corrupted data here');

      const enabled = await vault.isVaultEnabled();
      expect(enabled).toBe(false);

      // NEW: Now we CAN distinguish corruption from missing!
      const corruption = await vault.checkVaultCorruption();
      expect(corruption).toBe('invalid_json');
    });

    it('getVaultPublicKeyHex returns null for corrupted vault', async () => {
      setRawVaultRecord('{"version":1,"kind":"password"}'); // Missing required fields

      const publicKey = await vault.getVaultPublicKeyHex();
      expect(publicKey).toBeNull();

      // NEW: corruption detected
      const status = await vault.getVaultStatus();
      expect(status.corrupted).toBe('missing_fields');
    });

    it('getVaultStatus provides corruption info for schema mismatch', async () => {
      // Valid JSON but wrong schema
      setRawVaultRecord(
        JSON.stringify({
          version: 2,
          kind: 'password',
          publicKeyHex: 'abc123',
        })
      );

      const status = await vault.getVaultStatus();
      expect(status.enabled).toBe(false);
      expect(status.unlocked).toBe(false);
      expect(status.publicKeyHex).toBeNull();
      // NEW: corruption reason available
      expect(status.corrupted).toBe('wrong_version');
    });
  });

  describe('password validation', () => {
    it('rejects password shorter than minimum', async () => {
      await expect(vault.createPasswordVault('short')).rejects.toThrow('password_too_short');
    });

    it('accepts password at minimum length', async () => {
      const password = 'a'.repeat(vault.VAULT_PASSWORD_MIN_LENGTH);
      const publicKey = await vault.createPasswordVault(password);
      expect(publicKey).toHaveLength(64);
    });

    it('rejects empty password on unlock', async () => {
      await createTestVault('validpassword1');
      vault.lockVault();

      await expect(vault.unlockPasswordVault('')).rejects.toThrow('password_too_short');
    });
  });
});
