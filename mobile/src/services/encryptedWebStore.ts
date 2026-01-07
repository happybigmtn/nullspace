/**
 * Encrypted Web Storage Module
 *
 * Provides an encrypted storage layer for web platform using IndexedDB + SubtleCrypto AES-GCM.
 * This replaces the insecure localStorage fallback for vault storage.
 *
 * SECURITY MODEL:
 * - A per-browser encryption key is generated and stored in IndexedDB
 * - All vault data is encrypted with this key before storage
 * - The key never leaves the browser (no export capability)
 * - If IndexedDB is cleared, the encryption key is lost and vault must be re-imported
 *
 * FALLBACK BEHAVIOR:
 * - If SubtleCrypto is unavailable (rare), storage operations will fail
 * - If IndexedDB is unavailable, storage operations will fail
 * - UI should detect this via isEncryptedStorageAvailable() and warn user
 */

const DB_NAME = 'nullspace_vault_db';
const DB_VERSION = 1;
const KEY_STORE_NAME = 'encryption_keys';
const DATA_STORE_NAME = 'encrypted_data';
const ENCRYPTION_KEY_ID = 'vault_encryption_key';

const AES_KEY_LENGTH = 256;
const IV_BYTES = 12; // 96 bits for AES-GCM

let dbInstance: IDBDatabase | null = null;
let encryptionKeyInstance: CryptoKey | null = null;

function isSubtleCryptoAvailable(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  );
}

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function isEncryptedStorageAvailable(): boolean {
  return isSubtleCryptoAvailable() && isIndexedDBAvailable();
}

async function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('indexed_db_open_failed'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Store for the encryption key
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME, { keyPath: 'id' });
      }

      // Store for encrypted data
      if (!db.objectStoreNames.contains(DATA_STORE_NAME)) {
        db.createObjectStore(DATA_STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  if (encryptionKeyInstance) {
    return encryptionKeyInstance;
  }

  const db = await openDatabase();

  // Try to load existing key
  const storedKey = await new Promise<{ id: string; key: JsonWebKey } | null>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readonly');
    const store = tx.objectStore(KEY_STORE_NAME);
    const request = store.get(ENCRYPTION_KEY_ID);

    request.onerror = () => reject(new Error('key_load_failed'));
    request.onsuccess = () => resolve(request.result ?? null);
  });

  if (storedKey) {
    // Import existing key
    encryptionKeyInstance = await crypto.subtle.importKey(
      'jwk',
      storedKey.key,
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      false, // not extractable
      ['encrypt', 'decrypt']
    );
    return encryptionKeyInstance;
  }

  // Generate new key
  const newKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true, // extractable for storage only
    ['encrypt', 'decrypt']
  );

  // Export and store the key
  const exportedKey = await crypto.subtle.exportKey('jwk', newKey);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(KEY_STORE_NAME);
    const request = store.put({ id: ENCRYPTION_KEY_ID, key: exportedKey });

    request.onerror = () => reject(new Error('key_store_failed'));
    request.onsuccess = () => resolve();
  });

  // Re-import as non-extractable for use
  encryptionKeyInstance = await crypto.subtle.importKey(
    'jwk',
    exportedKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false, // not extractable
    ['encrypt', 'decrypt']
  );

  return encryptionKeyInstance;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function encryptData(plaintext: string): Promise<string> {
  const key = await getOrCreateEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return arrayBufferToBase64(combined.buffer);
}

async function decryptData(encryptedBase64: string): Promise<string> {
  const key = await getOrCreateEncryptionKey();
  const combined = new Uint8Array(base64ToArrayBuffer(encryptedBase64));

  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

/**
 * Encrypted storage compatible with SecureStore interface.
 * Uses IndexedDB + AES-GCM encryption for secure web vault storage.
 */
export const EncryptedWebStore = {
  async getItemAsync(key: string): Promise<string | null> {
    if (!isEncryptedStorageAvailable()) {
      throw new Error('encrypted_storage_unavailable');
    }

    const db = await openDatabase();

    const record = await new Promise<{ key: string; value: string } | null>((resolve, reject) => {
      const tx = db.transaction(DATA_STORE_NAME, 'readonly');
      const store = tx.objectStore(DATA_STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(new Error('data_load_failed'));
      request.onsuccess = () => resolve(request.result ?? null);
    });

    if (!record) {
      return null;
    }

    try {
      return await decryptData(record.value);
    } catch {
      // Decryption failed - data corrupted or key changed
      return null;
    }
  },

  async setItemAsync(key: string, value: string): Promise<void> {
    if (!isEncryptedStorageAvailable()) {
      throw new Error('encrypted_storage_unavailable');
    }

    const encryptedValue = await encryptData(value);
    const db = await openDatabase();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DATA_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DATA_STORE_NAME);
      const request = store.put({ key, value: encryptedValue });

      request.onerror = () => reject(new Error('data_store_failed'));
      request.onsuccess = () => resolve();
    });
  },

  async deleteItemAsync(key: string): Promise<void> {
    if (!isEncryptedStorageAvailable()) {
      throw new Error('encrypted_storage_unavailable');
    }

    const db = await openDatabase();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DATA_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DATA_STORE_NAME);
      const request = store.delete(key);

      request.onerror = () => reject(new Error('data_delete_failed'));
      request.onsuccess = () => resolve();
    });
  },
};

/**
 * Clears all encrypted storage including the encryption key.
 * Use with caution - vault data will be unrecoverable after this.
 */
export async function clearEncryptedStorage(): Promise<void> {
  if (!isIndexedDBAvailable()) {
    return;
  }

  // Close existing connection
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  encryptionKeyInstance = null;

  // Delete the entire database
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onerror = () => reject(new Error('db_delete_failed'));
    request.onsuccess = () => resolve();
  });
}

// For testing: reset in-memory state
export function resetEncryptedStoreState(): void {
  if (dbInstance) {
    dbInstance.close();
  }
  dbInstance = null;
  encryptionKeyInstance = null;
}
