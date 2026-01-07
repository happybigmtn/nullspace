import React from 'react';
import { act, create } from 'react-test-renderer';
import { SplashScreen } from '../SplashScreen';
import { getPublicKey } from '../../services/crypto';
import { initializeStorage } from '../../services';
import { authenticateWithBiometrics, initializeAuth } from '../../services/auth';

const mockAuthenticate = jest.fn();
const mockInitializeStorage = initializeStorage as jest.Mock;
const mockGetPublicKey = getPublicKey as jest.Mock;
const mockInitializeAuth = initializeAuth as jest.Mock;
const mockAuthenticateWithBiometrics = authenticateWithBiometrics as jest.Mock;

jest.mock('../../context', () => ({
  useAuth: () => ({ authenticate: mockAuthenticate }),
}));

const mockIsOnboardingCompleted = jest.fn();
jest.mock('../../services', () => ({
  initializeStorage: jest.fn(),
  isOnboardingCompleted: () => mockIsOnboardingCompleted(),
}));

jest.mock('../../services/crypto', () => ({
  getPublicKey: jest.fn(),
}));

jest.mock('../../services/auth', () => ({
  initializeAuth: jest.fn(),
  authenticateWithBiometrics: jest.fn(),
}));

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('SplashScreen', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockInitializeStorage.mockReset();
    mockGetPublicKey.mockReset();
    mockInitializeAuth.mockReset();
    mockAuthenticateWithBiometrics.mockReset();
    mockIsOnboardingCompleted.mockReset();
    // Default: onboarding is completed (returning user)
    mockIsOnboardingCompleted.mockReturnValue(true);
  });

  it('navigates to lobby when biometrics succeed', async () => {
    mockInitializeStorage.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue('pubkey');
    mockInitializeAuth.mockResolvedValue({ available: true });
    mockAuthenticateWithBiometrics.mockResolvedValue(true);

    const navigation = { replace: jest.fn() };
    const route = { key: 'Splash', name: 'Splash' as const };
    create(<SplashScreen navigation={navigation as any} route={route as any} />);

    await act(async () => {
      await flushPromises();
    });

    expect(mockInitializeStorage).toHaveBeenCalled();
    expect(mockGetPublicKey).toHaveBeenCalled();
    expect(mockAuthenticateWithBiometrics).toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('Lobby');
  });

  it('navigates to auth when biometrics fail or unavailable', async () => {
    mockInitializeStorage.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue('pubkey');
    mockInitializeAuth.mockResolvedValue({ available: true });
    mockAuthenticateWithBiometrics.mockResolvedValue(false);

    const navigation = { replace: jest.fn() };
    const route = { key: 'Splash', name: 'Splash' as const };
    create(<SplashScreen navigation={navigation as any} route={route as any} />);

    await act(async () => {
      await flushPromises();
    });

    expect(navigation.replace).toHaveBeenCalledWith('Auth');

    mockInitializeAuth.mockResolvedValue({ available: false });
    mockAuthenticateWithBiometrics.mockResolvedValue(true);
    create(<SplashScreen navigation={navigation as any} route={route as any} />);
    await act(async () => {
      await flushPromises();
    });
    expect(navigation.replace).toHaveBeenCalledWith('Auth');
  });

  it('falls back to auth on initialization error', async () => {
    mockInitializeStorage.mockRejectedValue(new Error('fail'));
    const navigation = { replace: jest.fn() };
    const route = { key: 'Splash', name: 'Splash' as const };
    create(<SplashScreen navigation={navigation as any} route={route as any} />);

    await act(async () => {
      await flushPromises();
    });

    expect(navigation.replace).toHaveBeenCalledWith('Auth');
  });

  it('navigates to onboarding for first-time users after biometric success', async () => {
    mockInitializeStorage.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue('pubkey');
    mockInitializeAuth.mockResolvedValue({ available: true });
    mockAuthenticateWithBiometrics.mockResolvedValue(true);
    mockIsOnboardingCompleted.mockReturnValue(false);

    const navigation = { replace: jest.fn() };
    const route = { key: 'Splash', name: 'Splash' as const };

    await act(async () => {
      create(<SplashScreen navigation={navigation as any} route={route as any} />);
      await flushPromises();
    });

    expect(mockAuthenticate).toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('Onboarding');
  });
});
