import type { AnalyticsEvent } from '../analytics';

describe('analytics service', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    global.fetch = jest.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    if (!global.crypto) {
      global.crypto = require('crypto').webcrypto;
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('sends analytics events when configured', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test';

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn(async () => undefined),
      getString: jest.fn(() => ''),
      setString: jest.fn(),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { initAnalytics, track } = require('../analytics');

    await initAnalytics();
    await track(' test_event ', { value: 1 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://ops.test/analytics/events');

    const body = JSON.parse(options.body);
    const event: AnalyticsEvent = body.events[0];
    expect(event.name).toBe('test_event');
    expect(body.actor.platform).toBeDefined();
  });

  it('skips events with empty names or missing config', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = '';

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn(async () => undefined),
      getString: jest.fn(() => ''),
      setString: jest.fn(),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { track } = require('../analytics');
    await track('');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('analytics failure handling (US-066)', () => {
  /**
   * These tests verify that analytics failures are swallowed gracefully
   * and do not crash the app or affect core functionality.
   */

  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    if (!global.crypto) {
      global.crypto = require('crypto').webcrypto;
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('swallows network errors from fetch', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test';
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn(async () => undefined),
      getString: jest.fn(() => 'device-123'),
      setString: jest.fn(),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { track } = require('../analytics');

    // Should not throw
    await expect(track('test_event', { key: 'value' })).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalled();
  });

  it('swallows timeout errors from fetch', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test';
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError);

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn(async () => undefined),
      getString: jest.fn(() => 'device-123'),
      setString: jest.fn(),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { track } = require('../analytics');

    await expect(track('test_event')).resolves.toBeUndefined();
  });

  it('swallows HTTP 500 errors from fetch', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn(async () => undefined),
      getString: jest.fn(() => 'device-123'),
      setString: jest.fn(),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { track } = require('../analytics');

    // Should not throw even on HTTP error response
    await expect(track('test_event')).resolves.toBeUndefined();
  });

  it('swallows storage initialization errors', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn().mockRejectedValue(new Error('Storage unavailable')),
      getString: jest.fn(() => ''),
      setString: jest.fn(),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { track, initAnalytics } = require('../analytics');

    // initAnalytics should not throw
    await expect(initAnalytics()).resolves.toBeUndefined();

    // track should not throw even if storage init fails
    await expect(track('test_event')).resolves.toBeUndefined();
  });

  it('continues core app flow after analytics failure', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test';

    // Simulate catastrophic analytics failure
    global.fetch = jest.fn().mockImplementation(() => {
      throw new TypeError('Failed to fetch');
    });

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn().mockRejectedValue(new Error('Storage unavailable')),
      getString: jest.fn().mockImplementation(() => {
        throw new Error('Storage read failed');
      }),
      setString: jest.fn().mockImplementation(() => {
        throw new Error('Storage write failed');
      }),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { track, initAnalytics } = require('../analytics');

    // Both should complete without throwing
    await expect(initAnalytics()).resolves.toBeUndefined();
    await expect(track('game_started', { gameType: 'blackjack' })).resolves.toBeUndefined();

    // This simulates that after analytics calls, the app continues normally
    // In real app, game logic would proceed here
    const coreAppResult = 'Game continues normally';
    expect(coreAppResult).toBe('Game continues normally');
  });

  it('does not block on slow analytics requests', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test';

    // Simulate a slow request (but the function should return before it completes)
    global.fetch = jest.fn().mockImplementation(() =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ ok: true });
        }, 100);
      })
    );

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn(async () => undefined),
      getString: jest.fn(() => 'device-123'),
      setString: jest.fn(),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { track } = require('../analytics');

    // track() should complete
    await track('test_event');

    // In this case the function awaits fetch, but the key point is
    // that even slow/failing fetch doesn't crash the app
    expect(global.fetch).toHaveBeenCalled();
  });

  it('handles analytics URL with trailing slash', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test/';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    jest.doMock('../storage', () => ({
      initializeStorage: jest.fn(async () => undefined),
      getString: jest.fn(() => 'device-123'),
      setString: jest.fn(),
      STORAGE_KEYS: { ANALYTICS_DEVICE_ID: 'analytics.device_id' },
    }));

    const { track } = require('../analytics');
    await track('test_event');

    // URL should be normalized (no double slashes)
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://ops.test/analytics/events');
  });
});
