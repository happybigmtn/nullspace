// Type declaration for test mocks
declare global {
  // eslint-disable-next-line no-var
  var __testMocks__: {
    secureStore: Map<string, string>;
    mmkv: Map<string, string>;
    asyncStorage: Map<string, string>;
    mmkvShouldThrow: boolean;
    secureStoreGetShouldThrow: boolean;
    secureStoreSetShouldThrow: boolean;
    asyncStorageGetAllKeysShouldThrow: boolean;
    asyncStorageSetShouldThrow: boolean;
  };
}

/**
 * Storage fallback integration tests
 *
 * These tests verify the storage service behavior using the global test mocks
 * from jest/setup.js. The storage module uses a singleton pattern, so tests
 * use _resetStorageForTesting() to reset state between tests.
 *
 * Acceptance Criteria Covered:
 * 1. Test MMKV → AsyncStorage fallback behavior in Expo Go
 * 2. Test storage initialization error handling
 * 3. Test tutorial state persistence across app restarts
 * 4. Test encryption key generation failures
 */
describe('storage fallback integration tests', () => {
  // Import storage module once - uses mocks from jest/setup.js
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const storage = require('../storage') as typeof import('../storage');

  beforeEach(() => {
    // Reset storage singleton for fresh test state
    storage._resetStorageForTesting();
  });

  describe('MMKV fallback behavior', () => {
    it('MMKV failure triggers AsyncStorage fallback and logs warning', async () => {
      globalThis.__testMocks__.mmkvShouldThrow = true;

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const instance = await storage.initializeStorage();

      expect(instance).toBeDefined();
      expect(instance.constructor.name).toBe('AsyncStorageAdapter');

      // Verify fallback was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[storage] MMKV unavailable'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('AsyncStorage adapter initialization', () => {
    it('handles getAllKeys failure gracefully during init', async () => {
      // Both flags needed: MMKV throws, then AsyncStorage init throws
      globalThis.__testMocks__.mmkvShouldThrow = true;
      globalThis.__testMocks__.asyncStorageGetAllKeysShouldThrow = true;

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const instance = await storage.initializeStorage();

      // Should not throw - continues with empty cache
      expect(instance).toBeDefined();

      // Init failure should be logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[storage] AsyncStorage init failed'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('SecureStore error handling', () => {
    it('SecureStore failure causes fallback to AsyncStorage', async () => {
      globalThis.__testMocks__.secureStoreGetShouldThrow = true;

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const instance = await storage.initializeStorage();

      expect(instance).toBeDefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[storage] MMKV unavailable'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('tutorial state persistence', () => {
    it('tutorial API works correctly through storage service', async () => {
      await storage.initializeStorage();

      // Clear any existing tutorial state
      storage.resetAllTutorials();

      // Use games defined in STORAGE_KEYS so resetAllTutorials works
      // Initially not completed
      expect(storage.isTutorialCompleted('hilo')).toBe(false);
      expect(storage.isTutorialCompleted('blackjack')).toBe(false);

      // Mark as completed
      storage.markTutorialCompleted('hilo');
      expect(storage.isTutorialCompleted('hilo')).toBe(true);

      // Reset specific tutorial
      storage.resetTutorial('hilo');
      expect(storage.isTutorialCompleted('hilo')).toBe(false);

      // Mark multiple tutorials and reset all
      storage.markTutorialCompleted('hilo');
      storage.markTutorialCompleted('blackjack');
      expect(storage.isTutorialCompleted('hilo')).toBe(true);
      expect(storage.isTutorialCompleted('blackjack')).toBe(true);

      storage.resetAllTutorials();
      expect(storage.isTutorialCompleted('hilo')).toBe(false);
      expect(storage.isTutorialCompleted('blackjack')).toBe(false);
    });
  });

  describe('encryption key management', () => {
    it('generates and stores new encryption key', async () => {
      // Clear any existing key
      globalThis.__testMocks__.secureStore.clear();

      await storage.initializeStorage();

      // Key should have been generated and stored
      const storedKey = globalThis.__testMocks__.secureStore.get('mmkv_encryption_key');
      expect(storedKey).toBeDefined();
      expect(storedKey?.length).toBe(64); // 32 bytes as hex
      expect(/^[0-9a-f]+$/.test(storedKey || '')).toBe(true);
    });

    it('reuses existing encryption key', async () => {
      const existingKey = 'b'.repeat(64);
      globalThis.__testMocks__.secureStore.set('mmkv_encryption_key', existingKey);

      await storage.initializeStorage();

      // Key should not have been overwritten
      expect(globalThis.__testMocks__.secureStore.get('mmkv_encryption_key')).toBe(existingKey);
    });

    it('encryption key failure triggers AsyncStorage fallback', async () => {
      globalThis.__testMocks__.secureStoreGetShouldThrow = true;

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const instance = await storage.initializeStorage();

      expect(instance).toBeDefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[storage] MMKV unavailable'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });
  });

});

/**
 * Storage service web tests - uses isolated module loading with doMock
 *
 * IMPORTANT: These tests must run AFTER the integration tests above,
 * as jest.isolateModules with doMock can corrupt global mock state.
 */
describe('storage service (web)', () => {
  const originalDev = (global as typeof globalThis & { __DEV__?: boolean }).__DEV__;
  const originalCrypto = global.crypto;

  const buildLocalStorage = () => {
    const store = new Map<string, string>();
    const storageObj: Record<string, unknown> = {};
    return Object.assign(storageObj, {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
        (storageObj as Record<string, string>)[key] = value;
      },
      removeItem: (key: string) => {
        store.delete(key);
        delete (storageObj as Record<string, string>)[key];
      },
      clear: () => {
        store.forEach((_value, key) => {
          delete (storageObj as Record<string, string>)[key];
        });
        store.clear();
      },
    });
  };

  // Use isolateModules to avoid polluting global mock state
  const getWebStorageModule = () => {
    let storageModule: typeof import('../storage');
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      storageModule = require('../storage');
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return storageModule!;
  };

  beforeEach(() => {
    global.localStorage = buildLocalStorage() as unknown as Storage;
    Object.defineProperty(global, '__DEV__', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, '__DEV__', {
      configurable: true,
      value: originalDev,
    });
    global.crypto = originalCrypto;
  });

  it('stores and retrieves values on web', async () => {
    const storageModule = getWebStorageModule();
    await storageModule.initializeStorage();

    storageModule.setBoolean(storageModule.STORAGE_KEYS.HAPTICS_ENABLED, true);
    storageModule.setString(storageModule.STORAGE_KEYS.LAST_GAME, 'hi_lo');
    storageModule.setNumber(storageModule.STORAGE_KEYS.CACHED_BALANCE, 250);

    expect(storageModule.getBoolean(storageModule.STORAGE_KEYS.HAPTICS_ENABLED)).toBe(true);
    expect(storageModule.getString(storageModule.STORAGE_KEYS.LAST_GAME)).toBe('hi_lo');
    expect(storageModule.getNumber(storageModule.STORAGE_KEYS.CACHED_BALANCE)).toBe(250);
  });

  it('handles object parsing and clearing', async () => {
    const storageModule = getWebStorageModule();
    await storageModule.initializeStorage();

    storageModule.setObject('object.test', { value: 12 });
    expect(storageModule.getObject('object.test', { value: 0 })).toEqual({ value: 12 });

    storageModule.setString('object.bad', '{bad json');
    expect(storageModule.getObject('object.bad', { ok: false })).toEqual({ ok: false });

    expect(storageModule.hasKey('object.test')).toBe(true);
    storageModule.deleteKey('object.test');
    expect(storageModule.hasKey('object.test')).toBe(false);

    storageModule.setString('misc.key', 'value');
    storageModule.clearAll();
    expect(storageModule.hasKey('misc.key')).toBe(false);
  });

  it('marks and resets tutorial completion', async () => {
    const storageModule = getWebStorageModule();
    await storageModule.initializeStorage();

    storageModule.markTutorialCompleted('hilo');
    expect(storageModule.isTutorialCompleted('hilo')).toBe(true);

    storageModule.resetTutorial('hilo');
    expect(storageModule.isTutorialCompleted('hilo')).toBe(false);

    storageModule.markTutorialCompleted('blackjack');
    storageModule.resetAllTutorials();
    expect(storageModule.isTutorialCompleted('blackjack')).toBe(false);
  });

  it('WebStorage.set() throws when localStorage quota exceeded', async () => {
    // Create localStorage that throws on setItem
    const quotaExceededStorage = buildLocalStorage();
    const originalSetItem = quotaExceededStorage.setItem;
    let setItemCalled = false;

    quotaExceededStorage.setItem = (key: string, value: string) => {
      if (setItemCalled) {
        const error = new DOMException('QuotaExceededError', 'QuotaExceededError');
        throw error;
      }
      setItemCalled = true;
      originalSetItem.call(quotaExceededStorage, key, value);
    };

    global.localStorage = quotaExceededStorage as unknown as Storage;

    const storageModule = getWebStorageModule();
    await storageModule.initializeStorage();

    // First set works
    storageModule.setString('first.key', 'value');
    expect(storageModule.getString('first.key')).toBe('value');

    // Second set throws - WebStorage has NO try-catch, so this propagates
    expect(() => {
      storageModule.setString('second.key', 'value');
    }).toThrow();
  });

  it('WebStorage quota exceeded can crash the app silently', async () => {
    // This documents that WebStorage.set() has no error handling
    // If localStorage.setItem throws, the error propagates up

    const throwingStorage = buildLocalStorage();
    throwingStorage.setItem = () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    };

    global.localStorage = throwingStorage as unknown as Storage;

    const storageModule = getWebStorageModule();
    await storageModule.initializeStorage();

    // CRITICAL: This will throw and could crash the app
    // Unlike AsyncStorageAdapter, WebStorage has no try-catch
    expect(() => {
      storageModule.setBoolean(storageModule.STORAGE_KEYS.HAPTICS_ENABLED, true);
    }).toThrow('QuotaExceededError');
  });

  it('throws when native storage is accessed before init', () => {
    let storageModule: typeof import('../storage');
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      storageModule = require('../storage');
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(() => storageModule!.getStorage()).toThrow('Storage not initialized');
  });

  // US-165: Bet history tests
  describe('bet history (US-165)', () => {
    it('stores and retrieves bet history', async () => {
      const storageModule = getWebStorageModule();
      await storageModule.initializeStorage();

      // Clear any existing history
      storageModule.clearBetHistory();
      expect(storageModule.getBetHistory()).toEqual([]);
      expect(storageModule.getSessionStats().totalBets).toBe(0);

      // Add a winning bet
      storageModule.addBetToHistory({
        gameId: 'blackjack',
        gameName: 'Blackjack',
        bet: 100,
        payout: 200,
        won: true,
        timestamp: Date.now(),
        outcome: 'Blackjack!',
      });

      const history = storageModule.getBetHistory();
      expect(history.length).toBe(1);
      expect(history[0].gameId).toBe('blackjack');
      expect(history[0].bet).toBe(100);
      expect(history[0].payout).toBe(200);
      expect(history[0].won).toBe(true);

      // Check session stats
      const stats = storageModule.getSessionStats();
      expect(stats.totalBets).toBe(1);
      expect(stats.wins).toBe(1);
      expect(stats.totalWagered).toBe(100);
      expect(stats.totalPayout).toBe(200);
      expect(stats.biggestWin).toBe(100); // net profit

      // Add a losing bet
      storageModule.addBetToHistory({
        gameId: 'roulette',
        gameName: 'Roulette',
        bet: 50,
        payout: 0,
        won: false,
        timestamp: Date.now(),
      });

      const updatedStats = storageModule.getSessionStats();
      expect(updatedStats.totalBets).toBe(2);
      expect(updatedStats.wins).toBe(1);
      expect(updatedStats.losses).toBe(1);
      expect(updatedStats.biggestLoss).toBe(50);
    });

    it('filters history by date range', async () => {
      const storageModule = getWebStorageModule();
      await storageModule.initializeStorage();
      storageModule.clearBetHistory();

      const now = Date.now();
      const yesterday = now - 24 * 60 * 60 * 1000;
      const lastWeek = now - 7 * 24 * 60 * 60 * 1000;

      // Add bets with different timestamps
      storageModule.addBetToHistory({
        gameId: 'hi_lo',
        gameName: 'Hi-Lo',
        bet: 10,
        payout: 20,
        won: true,
        timestamp: now,
      });

      storageModule.addBetToHistory({
        gameId: 'hi_lo',
        gameName: 'Hi-Lo',
        bet: 20,
        payout: 0,
        won: false,
        timestamp: lastWeek - 1000, // Just before last week
      });

      // Filter should only return recent bet
      const todayBets = storageModule.getBetHistoryByDateRange(
        new Date(yesterday),
        new Date(now + 1000)
      );
      expect(todayBets.length).toBe(1);
      expect(todayBets[0].bet).toBe(10);
    });

    it('filters history by game', async () => {
      const storageModule = getWebStorageModule();
      await storageModule.initializeStorage();
      storageModule.clearBetHistory();

      storageModule.addBetToHistory({
        gameId: 'blackjack',
        gameName: 'Blackjack',
        bet: 100,
        payout: 200,
        won: true,
        timestamp: Date.now(),
      });

      storageModule.addBetToHistory({
        gameId: 'roulette',
        gameName: 'Roulette',
        bet: 50,
        payout: 0,
        won: false,
        timestamp: Date.now(),
      });

      const blackjackBets = storageModule.getBetHistoryByGame('blackjack');
      expect(blackjackBets.length).toBe(1);
      expect(blackjackBets[0].gameId).toBe('blackjack');
    });
  });

  // NOTE: This test is skipped because jest.doMock inside isolateModules
  // doesn't reliably apply mocks when the module has already been loaded elsewhere.
  // The native storage initialization is covered by the integration tests above.
  it.skip('initializes native storage with secure store key', async () => {
    const getItemAsync = jest.fn(async () => null);
    const setItemAsync = jest.fn(async () => undefined);
    const mmkv = jest.fn(() => ({
      getBoolean: jest.fn(),
      getString: jest.fn(),
      getNumber: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      contains: jest.fn(),
      clearAll: jest.fn(),
    }));

    global.crypto = {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_value, index) => {
          bytes[index] = (index + 1) % 255;
        });
        return bytes;
      },
    } as typeof crypto;

    let storageModule: typeof import('../storage');
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
      jest.doMock('expo-secure-store', () => ({
        getItemAsync,
        setItemAsync,
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when_unlocked',
      }));
      jest.doMock('react-native-mmkv', () => ({ MMKV: mmkv }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      storageModule = require('../storage');
    });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const instance = await storageModule!.initializeStorage();

    expect(instance).toBeDefined();
    expect(getItemAsync).toHaveBeenCalled();
    expect(setItemAsync).toHaveBeenCalled();
    expect(mmkv).toHaveBeenCalledWith(expect.objectContaining({ id: 'nullspace-storage' }));
  });
});
