/**
 * Ed25519 cryptographic signing service
 * Uses @noble/curves for pure JS implementation (no WASM dependency)
 *
 * Security: Private keys are kept internal and never exposed.
 * Only signing operations and public key access are exported.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '../utils/hex';
import {
  getUnlockedVaultPrivateKey,
  getVaultPublicKeyHex,
  isVaultEnabled,
} from './vault';

const PRIVATE_KEY_KEY = 'nullspace_private_key';
const isWeb = Platform.OS === 'web';

/**
 * Web Crypto API encrypted storage
 * Uses password-derived encryption key with AES-GCM for secure storage
 */
class WebCryptoStore {
  private static STORAGE_KEY_PREFIX = 'nullspace_encrypted_';
  private static SALT_KEY = 'nullspace_salt';
  private static derivationKey: CryptoKey | null = null;

  /**
   * Derive encryption key from password using PBKDF2
   */
  private static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations: 500000, // 500k iterations for security
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Get or create salt for key derivation
   */
  private static async getSalt(): Promise<Uint8Array> {
    const stored = localStorage.getItem(this.SALT_KEY);
    if (stored) {
      return new Uint8Array(JSON.parse(stored));
    }

    // Generate new salt
    const salt = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(this.SALT_KEY, JSON.stringify(Array.from(salt)));
    return salt;
  }

  /**
   * Initialize with password (required for web platform in production)
   * In development mode, allows shorter passwords for testing
   */
  static async initialize(password: string): Promise<void> {
    // In production, enforce strong password requirement
    // In development, allow any non-empty password for testing
    if (!__DEV__ && (!password || password.length < 12)) {
      throw new Error('Web platform requires password of at least 12 characters');
    }

    if (!password) {
      throw new Error('Password is required');
    }

    const salt = await this.getSalt();
    this.derivationKey = await this.deriveKey(password, salt);
  }

  /**
   * Encrypt and store value
   */
  static async setItemAsync(key: string, value: string): Promise<void> {
    if (!this.derivationKey) {
      throw new Error('WebCryptoStore not initialized. Call initialize() with password first.');
    }

    const enc = new TextEncoder();
    const data = enc.encode(value);

    // Generate random IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt data
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.derivationKey,
      data
    );

    // Store IV + encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    localStorage.setItem(
      this.STORAGE_KEY_PREFIX + key,
      JSON.stringify(Array.from(combined))
    );
  }

  /**
   * Retrieve and decrypt value
   */
  static async getItemAsync(key: string): Promise<string | null> {
    if (!this.derivationKey) {
      throw new Error('WebCryptoStore not initialized. Call initialize() with password first.');
    }

    const stored = localStorage.getItem(this.STORAGE_KEY_PREFIX + key);
    if (!stored) {
      return null;
    }

    try {
      const combined = new Uint8Array(JSON.parse(stored));

      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      // Decrypt
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.derivationKey,
        encrypted
      );

      const dec = new TextDecoder();
      return dec.decode(decrypted);
    } catch (error) {
      if (__DEV__) {
        console.error('[WebCryptoStore] Decryption failed:', error);
      }
      return null;
    }
  }

  /**
   * Delete encrypted value
   */
  static async deleteItemAsync(key: string): Promise<void> {
    localStorage.removeItem(this.STORAGE_KEY_PREFIX + key);
  }

  /**
   * Check if initialized
   */
  static isInitialized(): boolean {
    return this.derivationKey !== null;
  }

  /**
   * Clear all (for logout)
   */
  static clear(): void {
    this.derivationKey = null;
    // Note: We keep the salt, only clear the derived key
  }
}

/**
 * Web-compatible secure storage fallback
 * SECURITY: For web platform, we REQUIRE vault mode with password encryption
 * Unencrypted localStorage is NOT SECURE and should never be used for private keys
 */
const WebSecureStore = {
  async getItemAsync(key: string): Promise<string | null> {
    if (!WebCryptoStore.isInitialized()) {
      // Not initialized - check if user should use vault mode
      if (__DEV__) {
        console.warn('[crypto] Web platform requires password-protected vault for security');
      }
      return null;
    }
    return WebCryptoStore.getItemAsync(key);
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    if (!WebCryptoStore.isInitialized()) {
      throw new Error('Web platform requires password initialization. Use vault mode for secure key storage.');
    }
    return WebCryptoStore.setItemAsync(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    return WebCryptoStore.deleteItemAsync(key);
  },
};

// Use appropriate storage based on platform
const KeyStore = isWeb ? WebSecureStore : SecureStore;

/**
 * Initialize web crypto storage with password (web platform only)
 * This MUST be called before any key operations on web
 */
export async function initializeWebCrypto(password: string): Promise<void> {
  if (!isWeb) {
    return; // No-op on native platforms
  }
  await WebCryptoStore.initialize(password);
}

/**
 * Check if web crypto is initialized (web platform only)
 */
export function isWebCryptoInitialized(): boolean {
  if (!isWeb) {
    return true; // Native platforms don't need initialization
  }
  return WebCryptoStore.isInitialized();
}

/**
 * Clear web crypto session (logout)
 */
export function clearWebCrypto(): void {
  if (isWeb) {
    WebCryptoStore.clear();
  }
}

export { bytesToHex, hexToBytes };

/**
 * Internal: Get or create the Ed25519 key pair
 * Private key is never exposed outside this module
 */
async function getOrCreateKeyPairInternal(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  let privateKeyHex = await KeyStore.getItemAsync(PRIVATE_KEY_KEY);

  if (!privateKeyHex) {
    const privateKey = ed25519.utils.randomPrivateKey();
    privateKeyHex = bytesToHex(privateKey);
    if (isWeb) {
      await KeyStore.setItemAsync(PRIVATE_KEY_KEY, privateKeyHex);
    } else {
      await SecureStore.setItemAsync(PRIVATE_KEY_KEY, privateKeyHex, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
  }

  const privateKey = hexToBytes(privateKeyHex);
  const publicKey = ed25519.getPublicKey(privateKey);

  return { publicKey, privateKey };
}

/**
 * Get the public key (creates key pair if none exists)
 * Only the public key is returned - private key stays internal
 */
export async function getPublicKey(): Promise<Uint8Array> {
  const vaultPublicKeyHex = await getVaultPublicKeyHex();
  if (vaultPublicKeyHex) {
    return hexToBytes(vaultPublicKeyHex);
  }
  const { publicKey } = await getOrCreateKeyPairInternal();
  return publicKey;
}

/**
 * Sign a message with Ed25519
 * Private key is used internally and never exposed
 */
export async function signMessage(message: Uint8Array): Promise<Uint8Array> {
  const vaultEnabled = await isVaultEnabled();
  if (vaultEnabled) {
    const privateKey = getUnlockedVaultPrivateKey();
    if (!privateKey) {
      throw new Error('vault_locked');
    }
    return ed25519.sign(message, privateKey);
  }

  const privateKeyHex = await KeyStore.getItemAsync(PRIVATE_KEY_KEY);
  if (!privateKeyHex) {
    throw new Error('No key pair exists. Call getPublicKey() first to create one.');
  }
  const privateKey = hexToBytes(privateKeyHex);
  return ed25519.sign(message, privateKey);
}

/**
 * Verify an Ed25519 signature
 */
export function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return ed25519.verify(signature, message, publicKey);
}

/**
 * Delete the stored key pair (for account reset)
 */
export async function deleteKeyPair(): Promise<void> {
  await KeyStore.deleteItemAsync(PRIVATE_KEY_KEY);
}

/**
 * Check if a key pair exists
 */
export async function hasKeyPair(): Promise<boolean> {
  const key = await KeyStore.getItemAsync(PRIVATE_KEY_KEY);
  return key !== null;
}
