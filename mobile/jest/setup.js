/* eslint-env jest */
import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const { View } = require('react-native');

  const SkiaMock = ({ children }) => React.createElement(View, null, children);

  return {
    Canvas: SkiaMock,
    Group: SkiaMock,
    Circle: SkiaMock,
    Line: SkiaMock,
    Path: SkiaMock,
    RadialGradient: SkiaMock,
    Blur: SkiaMock,
    Paint: SkiaMock,
    BlendMode: {},
    vec: (x, y) => ({ x, y }),
    // Skia factory mock for Path.MakeFromSVGString
    Skia: {
      Path: {
        MakeFromSVGString: (svg) => ({ svg }),
      },
    },
  };
});

process.env.EXPO_PUBLIC_BILLING_URL ||= 'https://billing.test';
process.env.EXPO_PUBLIC_OPS_URL ||= 'https://ops.test';
process.env.EXPO_PUBLIC_WEBSITE_URL ||= 'https://site.test';

const { webcrypto } = require('crypto');

if (!global.crypto) {
  global.crypto = webcrypto;
}

const mockSecureStoreData = new Map();
const mockMmkvData = new Map();
const mockAsyncStorageData = new Map();

// Export mock data maps for test access
globalThis.__testMocks__ = {
  secureStore: mockSecureStoreData,
  mmkv: mockMmkvData,
  asyncStorage: mockAsyncStorageData,
  // Failure simulation flags
  mmkvShouldThrow: false,
  secureStoreGetShouldThrow: false,
  secureStoreSetShouldThrow: false,
  asyncStorageGetAllKeysShouldThrow: false,
  asyncStorageSetShouldThrow: false,
};

beforeEach(() => {
  mockSecureStoreData.clear();
  mockMmkvData.clear();
  mockAsyncStorageData.clear();
  // Reset failure flags
  globalThis.__testMocks__.mmkvShouldThrow = false;
  globalThis.__testMocks__.secureStoreGetShouldThrow = false;
  globalThis.__testMocks__.secureStoreSetShouldThrow = false;
  globalThis.__testMocks__.asyncStorageGetAllKeysShouldThrow = false;
  globalThis.__testMocks__.asyncStorageSetShouldThrow = false;
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key) => {
    if (globalThis.__testMocks__?.secureStoreGetShouldThrow) {
      throw new Error('SecureStore auth required');
    }
    return mockSecureStoreData.get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key, value) => {
    if (globalThis.__testMocks__?.secureStoreSetShouldThrow) {
      throw new Error('SecureStore set auth required');
    }
    mockSecureStoreData.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key) => {
    mockSecureStoreData.delete(key);
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

jest.mock('react-native-mmkv', () => ({
  MMKV: class MMKV {
    constructor() {
      if (globalThis.__testMocks__?.mmkvShouldThrow) {
        throw new Error('TurboModules unavailable (Expo Go)');
      }
    }
    getBoolean(key) {
      const value = mockMmkvData.get(key);
      if (value === undefined) return undefined;
      return value === 'true';
    }
    getString(key) {
      const value = mockMmkvData.get(key);
      return value === undefined ? undefined : String(value);
    }
    getNumber(key) {
      const value = mockMmkvData.get(key);
      if (value === undefined) return undefined;
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    }
    set(key, value) {
      mockMmkvData.set(key, String(value));
    }
    delete(key) {
      mockMmkvData.delete(key);
    }
    contains(key) {
      return mockMmkvData.has(key);
    }
    clearAll() {
      mockMmkvData.clear();
    }
  },
}));

jest.mock('expo-constants', () => ({
  appOwnership: 'standalone',
  expoConfig: {
    hostUri: 'localhost:19000',
    runtimeVersion: 'test',
    version: '0.0.0',
    sdkVersion: '54.0.0',
    ios: { buildNumber: '1' },
    android: { versionCode: 1 },
    extra: { eas: { projectId: 'test-project' } },
  },
  easConfig: { projectId: 'test-project' },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

jest.mock('expo-linking', () => ({
  createURL: jest.fn((path = '') => `nullspace://${path}`),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  AndroidImportance: { DEFAULT: 'default' },
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: {
    Light: 'Light',
    Medium: 'Medium',
    Heavy: 'Heavy',
  },
  NotificationFeedbackType: {
    Success: 'Success',
    Warning: 'Warning',
    Error: 'Error',
  },
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
}));

jest.mock('expo-av', () => {
  const createSound = () => ({
    setStatusAsync: jest.fn(async () => undefined),
    stopAsync: jest.fn(async () => undefined),
    unloadAsync: jest.fn(async () => undefined),
  });

  return {
    Audio: {
      setAudioModeAsync: jest.fn(async () => undefined),
      Sound: {
        createAsync: jest.fn(async () => ({ sound: createSound() })),
      },
    },
  };
});

// Mock AsyncStorage for Expo Go fallback in storage.ts
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: jest.fn(async (key) => mockAsyncStorageData.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      if (globalThis.__testMocks__?.asyncStorageSetShouldThrow) {
        throw new Error('Storage quota exceeded');
      }
      mockAsyncStorageData.set(key, value);
    }),
    removeItem: jest.fn(async (key) => {
      mockAsyncStorageData.delete(key);
    }),
    clear: jest.fn(async () => {
      mockAsyncStorageData.clear();
    }),
    getAllKeys: jest.fn(async () => {
      if (globalThis.__testMocks__?.asyncStorageGetAllKeysShouldThrow) {
        throw new Error('AsyncStorage corrupted');
      }
      return Array.from(mockAsyncStorageData.keys());
    }),
    multiGet: jest.fn(async (keys) =>
      keys.map((key) => [key, mockAsyncStorageData.get(key) ?? null])
    ),
    multiSet: jest.fn(async (pairs) => {
      pairs.forEach(([key, value]) => mockAsyncStorageData.set(key, value));
    }),
    multiRemove: jest.fn(async (keys) => {
      keys.forEach((key) => mockAsyncStorageData.delete(key));
    }),
  },
}));
