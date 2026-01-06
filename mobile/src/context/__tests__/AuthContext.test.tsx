import React from 'react';
import { act, create } from 'react-test-renderer';

const mockStorage = {
  initializeStorage: jest.fn(async () => undefined),
  getBoolean: jest.fn(() => false),
  setBoolean: jest.fn(),
  getNumber: jest.fn(() => 0),
  setNumber: jest.fn(),
  deleteKey: jest.fn(),
  STORAGE_KEYS: {
    SESSION_ACTIVE: 'auth.session_active',
    SESSION_CREATED_AT: 'auth.session_created_at',
  },
};

jest.mock('../../services/storage', () => mockStorage);

const { AuthProvider, useAuth } = require('../AuthContext');

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('AuthContext', () => {
  beforeEach(() => {
    mockStorage.getBoolean.mockReset();
    mockStorage.setBoolean.mockReset();
    mockStorage.getNumber.mockReset();
    mockStorage.setNumber.mockReset();
    mockStorage.deleteKey.mockReset();
    // Reset getNumber to return 0 by default (no session timestamp)
    mockStorage.getNumber.mockReturnValue(0);
  });

  it('hydrates auth state and allows login/logout', async () => {
    mockStorage.getBoolean.mockReturnValueOnce(true);

    let ctx: ReturnType<typeof useAuth> | null = null;
    const Consumer = () => {
      ctx = useAuth();
      return null;
    };

    await act(async () => {
      create(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
      await flushPromises();
    });

    await act(async () => {
      await flushPromises();
    });

    expect(mockStorage.initializeStorage).toHaveBeenCalled();
    expect(mockStorage.getBoolean).toHaveBeenCalledWith(
      mockStorage.STORAGE_KEYS.SESSION_ACTIVE,
      false
    );
    expect(ctx?.isLoading).toBe(false);

    // logout() is async - need to await it
    await act(async () => {
      await ctx?.logout();
    });

    expect(ctx?.isAuthenticated).toBe(false);

    // authenticate() is also async
    await act(async () => {
      await ctx?.authenticate();
    });

    expect(ctx?.isAuthenticated).toBe(true);
    // Should store session timestamp
    expect(mockStorage.setNumber).toHaveBeenCalledWith(
      mockStorage.STORAGE_KEYS.SESSION_CREATED_AT,
      expect.any(Number)
    );
  });

  it('expires session after 24 hours', async () => {
    // Session was created 25 hours ago
    const TWENTY_FIVE_HOURS_AGO = Date.now() - 25 * 60 * 60 * 1000;
    mockStorage.getBoolean.mockReturnValue(true); // Has active session
    mockStorage.getNumber.mockReturnValue(TWENTY_FIVE_HOURS_AGO); // But it's expired

    let ctx: ReturnType<typeof useAuth> | null = null;
    const Consumer = () => {
      ctx = useAuth();
      return null;
    };

    await act(async () => {
      create(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
      await flushPromises();
    });

    await act(async () => {
      await flushPromises();
    });

    // Should clear the expired session
    expect(ctx?.isAuthenticated).toBe(false);
    expect(ctx?.sessionExpired).toBe(true);
    expect(mockStorage.deleteKey).toHaveBeenCalledWith(
      mockStorage.STORAGE_KEYS.SESSION_ACTIVE
    );
    expect(mockStorage.deleteKey).toHaveBeenCalledWith(
      mockStorage.STORAGE_KEYS.SESSION_CREATED_AT
    );
  });

  it('keeps valid session that is less than 24 hours old', async () => {
    // Session was created 12 hours ago
    const TWELVE_HOURS_AGO = Date.now() - 12 * 60 * 60 * 1000;
    mockStorage.getBoolean.mockReturnValue(true);
    mockStorage.getNumber.mockReturnValue(TWELVE_HOURS_AGO);

    let ctx: ReturnType<typeof useAuth> | null = null;
    const Consumer = () => {
      ctx = useAuth();
      return null;
    };

    await act(async () => {
      create(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
      await flushPromises();
    });

    await act(async () => {
      await flushPromises();
    });

    // Session should still be valid
    expect(ctx?.isAuthenticated).toBe(true);
    expect(ctx?.sessionExpired).toBe(false);
  });
});
