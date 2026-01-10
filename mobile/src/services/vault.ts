import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ed25519 } from '@noble/curves/ed25519';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes } from '../utils/hex';
import {
  EncryptedWebStore,
  isEncryptedStorageAvailable,
} from './encryptedWebStore';

const VAULT_RECORD_KEY = 'nullspace_vault_record_v1';
const LEGACY_PRIVATE_KEY_KEY = 'nullspace_private_key';
const PASSWORD_MIN_LENGTH = 12;

/**
 * Reasons why a vault might be corrupted.
 * Used to provide specific user guidance for recovery.
 */
export type VaultCorruptionReason =
  | 'invalid_json' // Storage contains data that isn't valid JSON
  | 'wrong_version' // JSON valid but version !== 1
  | 'wrong_kind' // JSON valid but kind !== 'password'
  | 'missing_fields' // Required fields are missing
  | null; // No corruption detected (or no vault exists)
const DEFAULT_PASSWORD_KDF_ITERATIONS = 250_000;

// Allow tests (or controlled environments) to lower KDF cost via env var so
// suites don't hang on expensive PBKDF2. Production defaults remain unchanged.
const PASSWORD_KDF_ITERATIONS = (() => {
  const raw = process.env.VAULT_KDF_ITERATIONS ?? process.env.EXPO_PUBLIC_VAULT_KDF_ITERATIONS;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    // Clamp to a reasonable minimum to avoid accidental zero/negative values
    return Math.max(1_000, Math.floor(parsed));
  }
  return DEFAULT_PASSWORD_KDF_ITERATIONS;
})();
const SALT_BYTES = 32;
const NONCE_BYTES = 24;
const PRIVATE_KEY_BYTES = 32;

const isWeb = Platform.OS === 'web';

/**
 * Storage implementation for web platform.
 * Uses IndexedDB + AES-GCM encryption for secure storage.
 *
 * SECURITY: This replaces the previous insecure localStorage fallback.
 * The vault data is now encrypted at rest with a per-browser key.
 */
const VaultStore = isWeb ? EncryptedWebStore : SecureStore;
const LegacyStore = isWeb ? EncryptedWebStore : SecureStore;

/**
 * Returns true if the vault is using encrypted web storage (IndexedDB + AES-GCM).
 * This can be used by UI to display a warning that storage may be less secure
 * than native SecureStore (e.g., no hardware-backed keychain).
 */
export function isUsingWebFallbackStorage(): boolean {
  return isWeb;
}

/**
 * Returns true if encrypted web storage is available and functional.
 * If false on web platform, vault operations will fail.
 */
export function isWebStorageAvailable(): boolean {
  if (!isWeb) {
    return true; // Native platforms use SecureStore
  }
  return isEncryptedStorageAvailable();
}

type VaultRecord = {
  version: 1;
  kind: 'password';
  kdf: {
    name: 'PBKDF2';
    iterations: number;
    hash: 'SHA-256';
  };
  saltHex: string;
  nonceHex: string;
  ciphertextHex: string;
  publicKeyHex: string;
  createdAtMs: number;
  updatedAtMs: number;
};

let unlockedPrivateKey: Uint8Array | null = null;
let unlockedPublicKeyHex: string | null = null;

function getRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('random_unavailable');
  }
  crypto.getRandomValues(out);
  return out;
}

function encodePassword(password: string): Uint8Array {
  if (typeof TextEncoder === 'undefined') {
    throw new Error('text_encoder_unavailable');
  }
  return new TextEncoder().encode(password);
}

function normalizeKeyHex(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  let trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    trimmed = trimmed.slice(2);
  }
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length !== PRIVATE_KEY_BYTES * 2) {
    return null;
  }
  return trimmed.toLowerCase();
}

function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  const passwordBytes = encodePassword(password);
  return pbkdf2(sha256, passwordBytes, salt, {
    c: PASSWORD_KDF_ITERATIONS,
    dkLen: 32,
  });
}

function encryptPrivateKey(privateKey: Uint8Array, password: string) {
  const salt = getRandomBytes(SALT_BYTES);
  const nonce = getRandomBytes(NONCE_BYTES);
  const key = deriveKey(password, salt);
  const cipher = xchacha20poly1305(key, nonce).encrypt(privateKey);
  return {
    saltHex: bytesToHex(salt),
    nonceHex: bytesToHex(nonce),
    ciphertextHex: bytesToHex(cipher),
  };
}

function decryptPrivateKey(record: VaultRecord, password: string): Uint8Array {
  const salt = hexToBytes(record.saltHex);
  const nonce = hexToBytes(record.nonceHex);
  const ciphertext = hexToBytes(record.ciphertextHex);
  const key = deriveKey(password, salt);
  try {
    return xchacha20poly1305(key, nonce).decrypt(ciphertext);
  } catch {
    throw new Error('vault_password_invalid');
  }
}

async function readVaultRecord(): Promise<VaultRecord | null> {
  const raw = await VaultStore.getItemAsync(VAULT_RECORD_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VaultRecord;
    if (parsed?.version !== 1 || parsed.kind !== 'password') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Checks if vault data exists but is corrupted.
 * This helps distinguish between "no vault" and "lost vault due to corruption".
 *
 * Returns null if no corruption detected (either no vault exists, or vault is valid).
 * Returns a VaultCorruptionReason if data exists but cannot be used.
 */
export async function checkVaultCorruption(): Promise<VaultCorruptionReason> {
  const raw = await VaultStore.getItemAsync(VAULT_RECORD_KEY);

  // No data at all = not corrupted (just missing)
  if (!raw) return null;

  // Try to parse as JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalid_json';
  }

  // Must be an object
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'invalid_json';
  }

  const record = parsed as Record<string, unknown>;

  // Check version
  if (record.version !== 1) {
    return 'wrong_version';
  }

  // Check kind
  if (record.kind !== 'password') {
    return 'wrong_kind';
  }

  // Check required fields exist
  const requiredFields = [
    'saltHex',
    'nonceHex',
    'ciphertextHex',
    'publicKeyHex',
    'createdAtMs',
    'updatedAtMs',
  ];
  for (const field of requiredFields) {
    if (!(field in record)) {
      return 'missing_fields';
    }
  }

  // All checks passed - not corrupted
  return null;
}

async function writeVaultRecord(record: VaultRecord): Promise<void> {
  await VaultStore.setItemAsync(VAULT_RECORD_KEY, JSON.stringify(record));
}

async function deleteVaultRecord(): Promise<void> {
  await VaultStore.deleteItemAsync(VAULT_RECORD_KEY);
}

async function readLegacyPrivateKey(): Promise<string | null> {
  const raw = await LegacyStore.getItemAsync(LEGACY_PRIVATE_KEY_KEY);
  return normalizeKeyHex(raw);
}

async function clearLegacyPrivateKey(): Promise<void> {
  await LegacyStore.deleteItemAsync(LEGACY_PRIVATE_KEY_KEY);
}

export async function isVaultEnabled(): Promise<boolean> {
  return (await readVaultRecord()) !== null;
}

export async function getVaultPublicKeyHex(): Promise<string | null> {
  const record = await readVaultRecord();
  return record?.publicKeyHex ?? null;
}

export function getUnlockedVaultPrivateKey(): Uint8Array | null {
  return unlockedPrivateKey;
}

export async function getVaultStatus(): Promise<{
  enabled: boolean;
  unlocked: boolean;
  publicKeyHex: string | null;
  corrupted: VaultCorruptionReason;
}> {
  const record = await readVaultRecord();
  const publicKeyHex = record?.publicKeyHex ?? null;
  const unlocked = !!unlockedPrivateKey && unlockedPublicKeyHex === publicKeyHex;
  const corrupted = await checkVaultCorruption();
  return {
    enabled: !!record,
    unlocked,
    publicKeyHex,
    corrupted,
  };
}

export async function createPasswordVault(
  password: string,
  options: { migrateLegacyKey?: boolean; overwrite?: boolean } = {}
): Promise<string> {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error('password_too_short');
  }

  const existing = await readVaultRecord();
  if (existing && !options.overwrite) {
    throw new Error('vault_exists');
  }

  let privateKey: Uint8Array;
  if (options.migrateLegacyKey) {
    const legacyHex = await readLegacyPrivateKey();
    if (legacyHex) {
      privateKey = hexToBytes(legacyHex);
    } else {
      privateKey = ed25519.utils.randomPrivateKey();
    }
  } else {
    privateKey = ed25519.utils.randomPrivateKey();
  }

  if (privateKey.length !== PRIVATE_KEY_BYTES) {
    throw new Error('invalid_private_key');
  }

  const publicKey = ed25519.getPublicKey(privateKey);
  const publicKeyHex = bytesToHex(publicKey);
  const { saltHex, nonceHex, ciphertextHex } = encryptPrivateKey(privateKey, password);
  const now = Date.now();
  const record: VaultRecord = {
    version: 1,
    kind: 'password',
    kdf: {
      name: 'PBKDF2',
      iterations: PASSWORD_KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    saltHex,
    nonceHex,
    ciphertextHex,
    publicKeyHex,
    createdAtMs: now,
    updatedAtMs: now,
  };

  await writeVaultRecord(record);
  if (options.migrateLegacyKey) {
    await clearLegacyPrivateKey();
  }

  unlockedPrivateKey = privateKey;
  unlockedPublicKeyHex = publicKeyHex;

  return publicKeyHex;
}

export async function unlockPasswordVault(password: string): Promise<string> {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error('password_too_short');
  }

  const record = await readVaultRecord();
  if (!record) {
    throw new Error('vault_missing');
  }

  const privateKey = decryptPrivateKey(record, password);
  if (privateKey.length !== PRIVATE_KEY_BYTES) {
    throw new Error('invalid_private_key');
  }

  unlockedPrivateKey = privateKey;
  unlockedPublicKeyHex = record.publicKeyHex;
  return record.publicKeyHex;
}

export function lockVault(): void {
  unlockedPrivateKey = null;
  unlockedPublicKeyHex = null;
}

export async function deleteVault(): Promise<void> {
  await deleteVaultRecord();
  lockVault();
}

export async function exportVaultPrivateKey(password?: string): Promise<string> {
  if (unlockedPrivateKey) {
    return bytesToHex(unlockedPrivateKey);
  }

  if (!password) {
    throw new Error('vault_locked');
  }

  const record = await readVaultRecord();
  if (!record) {
    throw new Error('vault_missing');
  }

  const privateKey = decryptPrivateKey(record, password);
  return bytesToHex(privateKey);
}

export async function importVaultPrivateKey(
  password: string,
  privateKeyHex: string,
  options: { overwrite?: boolean } = {}
): Promise<string> {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error('password_too_short');
  }

  const normalized = normalizeKeyHex(privateKeyHex);
  if (!normalized) {
    throw new Error('invalid_private_key');
  }

  const existing = await readVaultRecord();
  if (existing && !options.overwrite) {
    throw new Error('vault_exists');
  }

  const privateKey = hexToBytes(normalized);
  if (privateKey.length !== PRIVATE_KEY_BYTES) {
    throw new Error('invalid_private_key');
  }

  const publicKey = ed25519.getPublicKey(privateKey);
  const publicKeyHex = bytesToHex(publicKey);
  const { saltHex, nonceHex, ciphertextHex } = encryptPrivateKey(privateKey, password);
  const now = Date.now();
  const record: VaultRecord = {
    version: 1,
    kind: 'password',
    kdf: {
      name: 'PBKDF2',
      iterations: PASSWORD_KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    saltHex,
    nonceHex,
    ciphertextHex,
    publicKeyHex,
    createdAtMs: now,
    updatedAtMs: now,
  };

  await writeVaultRecord(record);
  await clearLegacyPrivateKey();
  unlockedPrivateKey = privateKey;
  unlockedPublicKeyHex = publicKeyHex;
  return publicKeyHex;
}

export const VAULT_PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;

/**
 * Returns user-friendly guidance message for vault corruption.
 * Call this when getVaultStatus().corrupted is not null.
 */
export function getVaultCorruptionGuidance(reason: VaultCorruptionReason): string | null {
  switch (reason) {
    case 'invalid_json':
      return 'Your vault data appears to be corrupted. If you have a recovery key backup, you can use it to restore your account. Otherwise, you may need to create a new account.';
    case 'wrong_version':
      return 'Your vault was created with an incompatible app version. Please update to the latest version, or restore from a recovery key backup.';
    case 'wrong_kind':
      return 'Your vault uses an unsupported authentication method. Please restore from a recovery key backup or create a new account.';
    case 'missing_fields':
      return 'Your vault data is incomplete. This may be due to storage corruption. If you have a recovery key backup, you can use it to restore your account.';
    case null:
      return null;
    default:
      return 'An unexpected error occurred with your vault. Please contact support.';
  }
}
