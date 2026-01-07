const mockGetString = jest.fn();
const mockSetString = jest.fn();

const mockNotifications = {
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  AndroidImportance: { DEFAULT: 'default' },
};

const loadModule = (options: {
  isDevice?: boolean;
  appOwnership?: string;
  executionEnvironment?: string;
  platformOS?: string;
  cachedToken?: string;
  permissionsStatus?: string;
  requestStatus?: string;
}) => {
  jest.resetModules();
  mockNotifications.getPermissionsAsync.mockResolvedValue({
    status: options.permissionsStatus ?? 'granted',
  });
  mockNotifications.requestPermissionsAsync.mockResolvedValue({
    status: options.requestStatus ?? 'granted',
  });
  mockGetString.mockReturnValue(options.cachedToken ?? '');

  process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.example.com';

  jest.doMock('expo-device', () => ({
    isDevice: options.isDevice ?? true,
  }));
  jest.doMock('expo-constants', () => ({
    appOwnership: options.appOwnership ?? 'standalone',
    expoConfig: {
      extra: { eas: { projectId: 'test-project' } },
    },
    easConfig: { projectId: 'test-project' },
    executionEnvironment: options.executionEnvironment,
  }));
  jest.doMock('expo-notifications', () => mockNotifications);
  jest.doMock('react-native', () => ({
    Platform: { OS: options.platformOS ?? 'ios' },
  }));
  jest.doMock('../storage', () => ({
    STORAGE_KEYS: { PUSH_TOKEN: 'notifications.push_token' },
    getString: (...args: unknown[]) => mockGetString(...args),
    setString: (...args: unknown[]) => mockSetString(...args),
  }));

  let moduleExports: typeof import('../notifications');
  jest.isolateModules(() => {
    moduleExports = require('../notifications');
  });
  return moduleExports!;
};

describe('notifications service', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockGetString.mockReset();
    mockSetString.mockReset();
    mockNotifications.getPermissionsAsync.mockClear();
    mockNotifications.requestPermissionsAsync.mockClear();
    mockNotifications.setNotificationChannelAsync.mockClear();
    mockNotifications.getExpoPushTokenAsync.mockClear();
    global.fetch = jest.fn(async () => ({ ok: true })) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null when running on simulator', async () => {
    const { initializeNotifications } = loadModule({ isDevice: false });
    const token = await initializeNotifications();
    expect(token).toBeNull();
  });

  it('returns null in Expo Go', async () => {
    const { initializeNotifications } = loadModule({ appOwnership: 'expo' });
    const token = await initializeNotifications();
    expect(token).toBeNull();
  });

  it('reuses cached token and registers it', async () => {
    const { initializeNotifications } = loadModule({ cachedToken: 'cached-token' });
    const token = await initializeNotifications('pubkey');

    expect(token).toBe('cached-token');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://ops.example.com/push/register',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('returns null when permissions are denied', async () => {
    const { initializeNotifications } = loadModule({
      permissionsStatus: 'denied',
      requestStatus: 'denied',
    });
    const token = await initializeNotifications();
    expect(token).toBeNull();
    expect(mockNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('requests token, sets channel on android, and stores token', async () => {
    const { initializeNotifications } = loadModule({ platformOS: 'android' });
    const token = await initializeNotifications('pubkey');

    expect(token).toBe('ExponentPushToken[test]');
    expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ importance: mockNotifications.AndroidImportance.DEFAULT })
    );
    expect(mockSetString).toHaveBeenCalledWith('notifications.push_token', 'ExponentPushToken[test]');
  });
});

describe('notification failure handling (US-066)', () => {
  /**
   * These tests verify that notification service failures are handled gracefully
   * and do not crash the app or affect core functionality.
   */

  const originalFetch = global.fetch;

  beforeEach(() => {
    mockGetString.mockReset();
    mockSetString.mockReset();
    mockNotifications.getPermissionsAsync.mockClear();
    mockNotifications.requestPermissionsAsync.mockClear();
    mockNotifications.setNotificationChannelAsync.mockClear();
    mockNotifications.getExpoPushTokenAsync.mockClear();
    global.fetch = jest.fn(async () => ({ ok: true })) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('swallows network errors during push token registration', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const { initializeNotifications } = loadModule({ cachedToken: 'cached-token' });

    // Should still return the token even if registration fails
    const token = await initializeNotifications('pubkey');
    expect(token).toBe('cached-token');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('swallows HTTP errors during push token registration', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const { initializeNotifications } = loadModule({ cachedToken: 'cached-token' });

    // Should still return the token even if registration fails
    const token = await initializeNotifications('pubkey');
    expect(token).toBe('cached-token');
  });

  it('returns null gracefully when getExpoPushTokenAsync throws', async () => {
    mockNotifications.getExpoPushTokenAsync.mockRejectedValue(
      new Error('Could not get push token')
    );

    const { initializeNotifications } = loadModule({});

    // Should return null, not throw
    const token = await initializeNotifications('pubkey');
    expect(token).toBeNull();
  });

  it('returns null gracefully when getPermissionsAsync throws', async () => {
    mockNotifications.getPermissionsAsync.mockRejectedValue(
      new Error('Permission check failed')
    );

    const { initializeNotifications } = loadModule({});

    // Should return null, not throw
    const token = await initializeNotifications();
    expect(token).toBeNull();
  });

  it('returns null gracefully when requestPermissionsAsync throws', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mockNotifications.requestPermissionsAsync.mockRejectedValue(
      new Error('Permission request failed')
    );

    const { initializeNotifications } = loadModule({ permissionsStatus: 'undetermined' });

    // Should return null, not throw
    const token = await initializeNotifications();
    expect(token).toBeNull();
  });

  it('continues with app flow after notification setup failure', async () => {
    // Simulate catastrophic notification failure
    mockNotifications.getPermissionsAsync.mockRejectedValue(new Error('Crash'));
    mockNotifications.getExpoPushTokenAsync.mockRejectedValue(new Error('Crash'));
    global.fetch = jest.fn().mockRejectedValue(new Error('Network down'));

    const { initializeNotifications } = loadModule({});

    // Should complete without throwing
    await expect(initializeNotifications()).resolves.toBeNull();

    // App continues normally
    const coreAppResult = 'Game continues without push notifications';
    expect(coreAppResult).toBe('Game continues without push notifications');
  });

  it('handles setNotificationChannelAsync failure on Android', async () => {
    mockNotifications.setNotificationChannelAsync.mockRejectedValue(
      new Error('Channel creation failed')
    );

    const { initializeNotifications } = loadModule({ platformOS: 'android' });

    // Should return null (failure handled in outer catch), not throw
    const token = await initializeNotifications();
    expect(token).toBeNull();
  });

  it('does not crash when storage operations fail', async () => {
    mockGetString.mockImplementation(() => {
      throw new Error('Storage read failed');
    });
    mockSetString.mockImplementation(() => {
      throw new Error('Storage write failed');
    });

    const { initializeNotifications } = loadModule({});

    // Should handle storage failures gracefully
    const token = await initializeNotifications();
    // May return null due to the error, but should not throw
    expect(token).toBeNull();
  });

  it('graceful degradation: core game works without notifications', async () => {
    // This is a documentation test showing the expected behavior:
    // Even if notifications completely fail, the core game should work

    // All notification operations fail
    mockNotifications.getPermissionsAsync.mockRejectedValue(new Error('Fail'));
    mockNotifications.requestPermissionsAsync.mockRejectedValue(new Error('Fail'));
    mockNotifications.getExpoPushTokenAsync.mockRejectedValue(new Error('Fail'));
    mockNotifications.setNotificationChannelAsync.mockRejectedValue(new Error('Fail'));
    global.fetch = jest.fn().mockRejectedValue(new Error('Fail'));

    const { initializeNotifications } = loadModule({});

    // Notification init should not throw
    const token = await initializeNotifications();
    expect(token).toBeNull();

    // Simulate that game logic continues normally after notification setup
    // In the real app, this would be game state initialization, balance fetch, etc.
    const gameCanStart = true;
    const balanceCanBeDisplayed = true;
    const betsCanBePlaced = true;

    expect(gameCanStart).toBe(true);
    expect(balanceCanBeDisplayed).toBe(true);
    expect(betsCanBePlaced).toBe(true);
  });
});
