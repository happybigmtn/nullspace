// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

const PRIVATE_KEY_HEX = '11'.repeat(32);
const PUBLIC_KEY_HEX = '22'.repeat(32);
const TEST_TIMEOUT_MS = 10000;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

vi.mock('../api/wasm.js', () => {
  class WasmWrapper {
    privateKeyHex = PRIVATE_KEY_HEX;
    publicKeyHex = PUBLIC_KEY_HEX;

    constructor(_identity?: string) {}

    async init() {}

    createKeypair(bytes?: Uint8Array) {
      if (bytes && bytes.length) {
        this.privateKeyHex = bytesToHex(bytes);
      } else {
        this.privateKeyHex = PRIVATE_KEY_HEX;
      }
      this.publicKeyHex = PUBLIC_KEY_HEX;
    }

    getPrivateKeyHex() {
      return this.privateKeyHex;
    }

    getPublicKeyHex() {
      return this.publicKeyHex;
    }
  }

  return { WasmWrapper };
});

import {
  createPasswordVault,
  deleteVault,
  getCasinoKeyIdForStorage,
  getVaultRecord,
  getVaultStatusSync,
  lockPasskeyVault,
  unlockPasswordVault,
} from './keyVault';

const resetStorage = async () => {
  lockPasskeyVault();
  localStorage.clear();
  try {
    await deleteVault();
  } catch {
    // ignore if already cleared
  }
};

describe('password vault', () => {
  beforeAll(() => {
    if (globalThis.crypto !== webcrypto) {
      Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        configurable: true,
      });
    }
    if (globalThis.crypto?.subtle?.deriveKey) {
      const original = globalThis.crypto.subtle.deriveKey.bind(globalThis.crypto.subtle);
      vi.spyOn(globalThis.crypto.subtle, 'deriveKey').mockImplementation(
        (algorithm: AlgorithmIdentifier | Pbkdf2Params, baseKey: CryptoKey, derivedKeyType: AlgorithmIdentifier, extractable: boolean, keyUsages: KeyUsage[]) => {
          if (typeof algorithm === 'object' && 'name' in algorithm && algorithm.name === 'PBKDF2') {
            const tuned = { ...algorithm, iterations: 500 };
            return original(tuned, baseKey, derivedKeyType, extractable, keyUsages);
          }
          return original(algorithm, baseKey, derivedKeyType, extractable, keyUsages);
        },
      );
    }
  });

  beforeEach(async () => {
    await resetStorage();
  }, TEST_TIMEOUT_MS);

  it('creates and unlocks a password vault', async () => {
    const record = await createPasswordVault('correct horse battery staple');
    expect(record.version).toBe(3);
    expect(record.kind).toBe('password');
    expect(record.nullspacePublicKeyHex).toBe(PUBLIC_KEY_HEX);

    lockPasskeyVault();
    const unlocked = await unlockPasswordVault('correct horse battery staple');
    expect(unlocked.nullspacePublicKeyHex).toBe(PUBLIC_KEY_HEX);
    expect(getVaultStatusSync().enabled).toBe(true);
  }, TEST_TIMEOUT_MS);

  it('rejects invalid passwords', async () => {
    await createPasswordVault('correct horse battery staple');
    lockPasskeyVault();
    await expect(unlockPasswordVault('wrong password')).rejects.toThrow('password-invalid');
  }, TEST_TIMEOUT_MS);

  it('enforces minimum password length', async () => {
    await expect(createPasswordVault('short')).rejects.toThrow('password-too-short');
  }, TEST_TIMEOUT_MS);

  it('deletes the vault metadata', async () => {
    await createPasswordVault('correct horse battery staple');
    await deleteVault();
    const record = await getVaultRecord();
    expect(record).toBeNull();
    expect(getVaultStatusSync().enabled).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('uses the stored public key for registration flags', () => {
    localStorage.setItem('casino_public_key_hex', PUBLIC_KEY_HEX);
    expect(getCasinoKeyIdForStorage()).toBe(PUBLIC_KEY_HEX);
  }, TEST_TIMEOUT_MS);

  it('returns null when no key is available', () => {
    expect(getCasinoKeyIdForStorage()).toBeNull();
  }, TEST_TIMEOUT_MS);
});
