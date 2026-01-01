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

// Web-compatible secure storage fallback (uses localStorage on web)
const WebSecureStore = {
  async getItemAsync(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};

// Use appropriate storage based on platform
const KeyStore = isWeb ? WebSecureStore : SecureStore;

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
