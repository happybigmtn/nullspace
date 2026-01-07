/**
 * Tests for EncryptedWebStore
 *
 * These tests verify the encrypted web storage implementation using
 * mocked IndexedDB and SubtleCrypto APIs.
 */

import {
  EncryptedWebStore,
  isEncryptedStorageAvailable,
  clearEncryptedStorage,
  resetEncryptedStoreState,
} from '../encryptedWebStore';

// Mock data stores
let mockKeyStore: Map<string, { id: string; key: JsonWebKey }>;
let mockDataStore: Map<string, { key: string; value: string }>;

// Mock CryptoKey for testing
class MockCryptoKey {
  algorithm: { name: string; length: number };
  extractable: boolean;
  type: string;
  usages: string[];

  constructor(
    algorithm: { name: string; length: number },
    extractable: boolean,
    usages: string[]
  ) {
    this.algorithm = algorithm;
    this.extractable = extractable;
    this.type = 'secret';
    this.usages = usages;
  }
}

// Mock encryption/decryption (simple XOR for testing - NOT secure!)
function mockEncrypt(data: Uint8Array, iv: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ iv[i % iv.length];
  }
  return result;
}

function mockDecrypt(data: Uint8Array, iv: Uint8Array): Uint8Array {
  // XOR is symmetric
  return mockEncrypt(data, iv);
}

// Track generated key for consistent encryption/decryption
let mockGeneratedKey: JsonWebKey | null = null;

// Mock SubtleCrypto
const mockSubtleCrypto = {
  generateKey: jest.fn(async (algorithm: { name: string; length: number }, extractable: boolean, usages: string[]) => {
    mockGeneratedKey = {
      kty: 'oct',
      k: 'mock-key-base64-' + Math.random().toString(36).substring(7),
      alg: 'A256GCM',
      ext: extractable,
      key_ops: usages,
    };
    return new MockCryptoKey(algorithm, extractable, usages);
  }),
  importKey: jest.fn(async (
    _format: string,
    keyData: JsonWebKey,
    algorithm: { name: string; length: number },
    extractable: boolean,
    usages: string[]
  ) => {
    mockGeneratedKey = keyData;
    return new MockCryptoKey(algorithm, extractable, usages);
  }),
  exportKey: jest.fn(async (_format: string, _key: CryptoKey) => {
    return mockGeneratedKey;
  }),
  encrypt: jest.fn(async (algorithm: { name: string; iv: Uint8Array }, _key: CryptoKey, data: ArrayBuffer) => {
    const encrypted = mockEncrypt(new Uint8Array(data), algorithm.iv);
    return encrypted.buffer;
  }),
  decrypt: jest.fn(async (algorithm: { name: string; iv: Uint8Array }, _key: CryptoKey, data: ArrayBuffer) => {
    const decrypted = mockDecrypt(new Uint8Array(data), algorithm.iv);
    return decrypted.buffer;
  }),
};

// Mock IDBRequest
class MockIDBRequest<T> {
  result: T | null = null;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  succeed(result: T) {
    this.result = result;
    if (this.onsuccess) {
      this.onsuccess({ target: this } as unknown as Event);
    }
  }

  fail(error: DOMException) {
    this.error = error;
    if (this.onerror) {
      this.onerror({ target: this } as unknown as Event);
    }
  }
}

// Mock IDBObjectStore
class MockIDBObjectStore {
  name: string;
  private store: Map<string, unknown>;

  constructor(name: string, store: Map<string, unknown>) {
    this.name = name;
    this.store = store;
  }

  get(key: string): MockIDBRequest<unknown> {
    const request = new MockIDBRequest<unknown>();
    setTimeout(() => {
      request.succeed(this.store.get(key) ?? null);
    }, 0);
    return request;
  }

  put(value: { key?: string; id?: string; [k: string]: unknown }): MockIDBRequest<IDBValidKey> {
    const request = new MockIDBRequest<IDBValidKey>();
    setTimeout(() => {
      const key = value.key ?? value.id ?? '';
      this.store.set(key, value);
      request.succeed(key);
    }, 0);
    return request;
  }

  delete(key: string): MockIDBRequest<undefined> {
    const request = new MockIDBRequest<undefined>();
    setTimeout(() => {
      this.store.delete(key);
      request.succeed(undefined);
    }, 0);
    return request;
  }
}

// Mock IDBTransaction
class MockIDBTransaction {
  private stores: Map<string, MockIDBObjectStore>;

  constructor(stores: Map<string, MockIDBObjectStore>) {
    this.stores = stores;
  }

  objectStore(name: string): MockIDBObjectStore {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`Object store ${name} not found`);
    }
    return store;
  }
}

// Mock IDBDatabase
class MockIDBDatabase {
  objectStoreNames: DOMStringList;
  private stores: Map<string, MockIDBObjectStore>;

  constructor() {
    this.stores = new Map();
    this.objectStoreNames = {
      contains: (name: string) => this.stores.has(name),
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    } as unknown as DOMStringList;
  }

  createObjectStore(name: string): MockIDBObjectStore {
    let dataStore: Map<string, unknown>;
    if (name === 'encryption_keys') {
      dataStore = mockKeyStore as Map<string, unknown>;
    } else if (name === 'encrypted_data') {
      dataStore = mockDataStore as Map<string, unknown>;
    } else {
      dataStore = new Map();
    }
    const store = new MockIDBObjectStore(name, dataStore);
    this.stores.set(name, store);
    return store;
  }

  transaction(storeNames: string | string[], _mode?: IDBTransactionMode): MockIDBTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const txStores = new Map<string, MockIDBObjectStore>();
    for (const name of names) {
      const store = this.stores.get(name);
      if (store) {
        txStores.set(name, store);
      }
    }
    return new MockIDBTransaction(txStores);
  }

  close(): void {
    // No-op
  }
}

// Mock IDBOpenDBRequest
class MockIDBOpenDBRequest extends MockIDBRequest<IDBDatabase> {
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null = null;
}

// Mock indexedDB
const mockIndexedDB = {
  open: jest.fn((name: string, version?: number) => {
    const request = new MockIDBOpenDBRequest();
    setTimeout(() => {
      const db = new MockIDBDatabase();
      // Trigger onupgradeneeded if stores don't exist
      if (request.onupgradeneeded) {
        request.onupgradeneeded({
          target: { result: db },
          oldVersion: 0,
          newVersion: version ?? 1,
        } as unknown as IDBVersionChangeEvent);
      }
      request.succeed(db as unknown as IDBDatabase);
    }, 0);
    return request;
  }),
  deleteDatabase: jest.fn((_name: string) => {
    const request = new MockIDBRequest<undefined>();
    setTimeout(() => {
      mockKeyStore.clear();
      mockDataStore.clear();
      request.succeed(undefined);
    }, 0);
    return request;
  }),
};

// Setup global mocks
beforeAll(() => {
  // Mock crypto
  (global as unknown as { crypto: { subtle: typeof mockSubtleCrypto; getRandomValues: (arr: Uint8Array) => Uint8Array } }).crypto = {
    subtle: mockSubtleCrypto as unknown as SubtleCrypto,
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    },
  };

  // Mock indexedDB
  (global as unknown as { indexedDB: typeof mockIndexedDB }).indexedDB = mockIndexedDB as unknown as IDBFactory;

  // Mock TextEncoder/TextDecoder
  if (typeof global.TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util');
    (global as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
    (global as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
  }
});

beforeEach(() => {
  // Reset stores
  mockKeyStore = new Map();
  mockDataStore = new Map();
  mockGeneratedKey = null;

  // Reset module state
  resetEncryptedStoreState();

  // Clear mock calls
  jest.clearAllMocks();
});

describe('EncryptedWebStore', () => {
  describe('isEncryptedStorageAvailable()', () => {
    it('returns true when SubtleCrypto and IndexedDB are available', () => {
      expect(isEncryptedStorageAvailable()).toBe(true);
    });

    it('returns false when SubtleCrypto is unavailable', () => {
      const originalCrypto = global.crypto;
      (global as unknown as { crypto: undefined }).crypto = undefined;

      expect(isEncryptedStorageAvailable()).toBe(false);

      (global as unknown as { crypto: typeof originalCrypto }).crypto = originalCrypto;
    });

    it('returns false when IndexedDB is unavailable', () => {
      const originalIndexedDB = global.indexedDB;
      (global as unknown as { indexedDB: undefined }).indexedDB = undefined;

      expect(isEncryptedStorageAvailable()).toBe(false);

      (global as unknown as { indexedDB: typeof originalIndexedDB }).indexedDB = originalIndexedDB;
    });
  });

  describe('basic storage operations', () => {
    it('stores and retrieves a value', async () => {
      const key = 'test_key';
      const value = 'test_value';

      await EncryptedWebStore.setItemAsync(key, value);
      const retrieved = await EncryptedWebStore.getItemAsync(key);

      expect(retrieved).toBe(value);
    });

    it('returns null for non-existent key', async () => {
      const retrieved = await EncryptedWebStore.getItemAsync('non_existent');
      expect(retrieved).toBeNull();
    });

    it('deletes a stored value', async () => {
      const key = 'delete_test';
      const value = 'to_be_deleted';

      await EncryptedWebStore.setItemAsync(key, value);
      expect(await EncryptedWebStore.getItemAsync(key)).toBe(value);

      await EncryptedWebStore.deleteItemAsync(key);
      expect(await EncryptedWebStore.getItemAsync(key)).toBeNull();
    });

    it('overwrites existing value', async () => {
      const key = 'overwrite_test';

      await EncryptedWebStore.setItemAsync(key, 'original');
      await EncryptedWebStore.setItemAsync(key, 'updated');

      const retrieved = await EncryptedWebStore.getItemAsync(key);
      expect(retrieved).toBe('updated');
    });
  });

  describe('encryption behavior', () => {
    it('generates encryption key on first use', async () => {
      await EncryptedWebStore.setItemAsync('key1', 'value1');

      expect(mockSubtleCrypto.generateKey).toHaveBeenCalledWith(
        { name: 'AES-GCM', length: 256 },
        true, // extractable for storage
        ['encrypt', 'decrypt']
      );
    });

    it('reuses existing encryption key on subsequent calls', async () => {
      await EncryptedWebStore.setItemAsync('key1', 'value1');
      await EncryptedWebStore.setItemAsync('key2', 'value2');

      // Key should only be generated once
      expect(mockSubtleCrypto.generateKey).toHaveBeenCalledTimes(1);
    });

    it('encrypts data before storage', async () => {
      await EncryptedWebStore.setItemAsync('secure_key', 'sensitive_data');

      // Data in store should be encrypted (base64 encoded)
      const storedRecord = mockDataStore.get('secure_key');
      expect(storedRecord).toBeDefined();
      expect((storedRecord as { value: string }).value).not.toBe('sensitive_data');
      // Should be base64 encoded
      expect((storedRecord as { value: string }).value).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('decrypts data on retrieval', async () => {
      const originalValue = 'my_secret_value';
      await EncryptedWebStore.setItemAsync('decrypt_test', originalValue);

      const retrieved = await EncryptedWebStore.getItemAsync('decrypt_test');
      expect(retrieved).toBe(originalValue);
    });
  });

  describe('complex data handling', () => {
    it('stores and retrieves JSON strings', async () => {
      const jsonData = JSON.stringify({
        version: 1,
        kind: 'password',
        saltHex: 'abc123',
        publicKeyHex: 'def456',
      });

      await EncryptedWebStore.setItemAsync('json_test', jsonData);
      const retrieved = await EncryptedWebStore.getItemAsync('json_test');

      expect(retrieved).toBe(jsonData);
      expect(JSON.parse(retrieved!)).toEqual(JSON.parse(jsonData));
    });

    it('handles empty string value', async () => {
      await EncryptedWebStore.setItemAsync('empty', '');
      const retrieved = await EncryptedWebStore.getItemAsync('empty');
      expect(retrieved).toBe('');
    });

    it('handles unicode characters', async () => {
      const unicode = 'Hello 世界 🎰 émojis';
      await EncryptedWebStore.setItemAsync('unicode', unicode);
      const retrieved = await EncryptedWebStore.getItemAsync('unicode');
      expect(retrieved).toBe(unicode);
    });

    it('handles large values', async () => {
      const largeValue = 'x'.repeat(100000);
      await EncryptedWebStore.setItemAsync('large', largeValue);
      const retrieved = await EncryptedWebStore.getItemAsync('large');
      expect(retrieved).toBe(largeValue);
    });
  });

  describe('clearEncryptedStorage()', () => {
    it('clears all stored data', async () => {
      await EncryptedWebStore.setItemAsync('key1', 'value1');
      await EncryptedWebStore.setItemAsync('key2', 'value2');

      await clearEncryptedStorage();

      // Need to reset state after clear
      resetEncryptedStoreState();

      // Data should be gone (will generate new key on next access)
      const retrieved = await EncryptedWebStore.getItemAsync('key1');
      expect(retrieved).toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws when storage unavailable', async () => {
      const originalIndexedDB = global.indexedDB;
      (global as unknown as { indexedDB: undefined }).indexedDB = undefined;

      await expect(EncryptedWebStore.setItemAsync('key', 'value')).rejects.toThrow(
        'encrypted_storage_unavailable'
      );
      await expect(EncryptedWebStore.getItemAsync('key')).rejects.toThrow(
        'encrypted_storage_unavailable'
      );
      await expect(EncryptedWebStore.deleteItemAsync('key')).rejects.toThrow(
        'encrypted_storage_unavailable'
      );

      (global as unknown as { indexedDB: typeof originalIndexedDB }).indexedDB = originalIndexedDB;
    });
  });

  describe('key persistence', () => {
    it('stores encryption key in IndexedDB', async () => {
      await EncryptedWebStore.setItemAsync('test', 'value');

      // Key should be stored (check that generateKey was called)
      expect(mockSubtleCrypto.generateKey).toHaveBeenCalled();
      expect(mockSubtleCrypto.exportKey).toHaveBeenCalled();
    });

    it('reuses stored key after module reset', async () => {
      // First session - creates key
      await EncryptedWebStore.setItemAsync('persistent', 'data');

      // Verify key was generated
      expect(mockSubtleCrypto.generateKey).toHaveBeenCalledTimes(1);

      // Simulate new session (module reload) but keep the stores
      resetEncryptedStoreState();

      // Pre-populate the key store to simulate persisted key
      const testKey: JsonWebKey = {
        kty: 'oct',
        k: 'test-persisted-key',
        alg: 'A256GCM',
        ext: true,
        key_ops: ['encrypt', 'decrypt'],
      };
      mockKeyStore.set('vault_encryption_key', { id: 'vault_encryption_key', key: testKey });

      // Clear mock calls to verify importKey is called
      jest.clearAllMocks();

      // Second session - should import existing key
      await EncryptedWebStore.setItemAsync('new_item', 'new_data');

      // Should have imported existing key, not generated new one
      expect(mockSubtleCrypto.importKey).toHaveBeenCalled();
      expect(mockSubtleCrypto.generateKey).not.toHaveBeenCalled();
    });
  });
});

describe('vault.ts web storage exports', () => {
  // These tests verify that vault.ts correctly exports the new functions
  // Using require() since dynamic import is not supported in Jest without --experimental-vm-modules

  it('exports isUsingWebFallbackStorage function', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vault = require('../vault');
    expect(typeof vault.isUsingWebFallbackStorage).toBe('function');
  });

  it('exports isWebStorageAvailable function', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vault = require('../vault');
    expect(typeof vault.isWebStorageAvailable).toBe('function');
  });
});
