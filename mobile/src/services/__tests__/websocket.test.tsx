import React, { useEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useWebSocket, type WebSocketManager } from '../websocket';

const mockConstants: {
  expoConfig?: { hostUri?: string };
  expoGoConfig?: { debuggerHost?: string };
  manifest?: { debuggerHost?: string };
} = {};

const originalDevDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
const originalDevValue = (globalThis as { __DEV__?: boolean }).__DEV__;

const setDevMode = (value: boolean) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(globalThis, '__DEV__', {
      value,
      configurable: true,
      writable: true,
    });
    return true;
  }
  if (descriptor.writable) {
    (globalThis as { __DEV__?: boolean }).__DEV__ = value;
    return true;
  }
  return false;
};

const restoreDevMode = () => {
  if (!originalDevDescriptor) {
    delete (globalThis as { __DEV__?: boolean }).__DEV__;
    return;
  }
  if (originalDevDescriptor.configurable) {
    Object.defineProperty(globalThis, '__DEV__', originalDevDescriptor);
    return;
  }
  if (originalDevDescriptor.writable) {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDevValue;
  }
};

jest.mock('expo-constants', () => ({
  default: mockConstants,
}));

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { wasClean: boolean; code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send = jest.fn();
  close = jest.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

type HookSnapshot = WebSocketManager & { lastMessage: { type: string } | null };

const snapshots: HookSnapshot[] = [];

function HookProbe({ url }: { url: string }) {
  const state = useWebSocket(url) as HookSnapshot;
  useEffect(() => {
    snapshots.push(state);
  }, [state]);
  return null;
}

beforeEach(() => {
  snapshots.length = 0;
  MockWebSocket.instances.length = 0;
  (global as { WebSocket?: typeof MockWebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket;
  setDevMode(true); // Default to dev mode to allow ws:// URLs in tests
  mockConstants.expoConfig = undefined;
  mockConstants.expoGoConfig = undefined;
  mockConstants.manifest = undefined;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_WS_URL;
  restoreDevMode();
});

afterAll(() => {
  delete (global as { WebSocket?: typeof MockWebSocket }).WebSocket;
});

describe('useWebSocket', () => {
  it('connects, receives messages, and sends payloads', () => {
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    const connected = snapshots.at(-1);
    expect(connected?.isConnected).toBe(true);
    expect(connected?.connectionState).toBe('connected');

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'state_update', balance: 10 }) });
    });

    const withMessage = snapshots.at(-1);
    expect(withMessage?.lastMessage).toEqual({ type: 'state_update', balance: 10 });

    expect(withMessage?.send({ type: 'ping' })).toBe(true);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
  });

  it('reconnects after an unclean close with backoff', () => {
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
    });

    const disconnected = snapshots.at(-1);
    expect(disconnected?.connectionState).toBe('disconnected');

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    const afterReconnect = snapshots.at(-1);
    expect(afterReconnect?.reconnectAttempt).toBe(1);
  });

  it('handles clean close without scheduling reconnects', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    const instanceCount = MockWebSocket.instances.length;

    act(() => {
      socket.onclose?.({ wasClean: true, code: 1000, reason: 'done' });
    });

    const closed = snapshots.at(-1);
    expect(closed?.connectionState).toBe('disconnected');
    // Clean close message is logged via console.log in __DEV__ mode
    expect(console.log).toHaveBeenCalledWith(
      'WebSocket closed cleanly',
      expect.objectContaining({ code: 1000, reason: 'done' })
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances.length).toBe(instanceCount);
  });

  it('queues messages when connecting and logs invalid messages', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    const state = snapshots.at(-1);
    // Messages are queued when connecting (not dropped), returns true
    expect(state?.send({ type: 'ping' })).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/Message queued/)
    );

    act(() => {
      socket.onmessage?.({ data: '{not-json' });
    });
    expect(console.error).toHaveBeenCalledWith(
      'Failed to parse WebSocket message:',
      expect.any(Error)
    );

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ nope: true }) });
    });
    expect(console.error).toHaveBeenCalledWith(
      'Invalid message format:',
      expect.any(String)
    );
  });

  describe('max reconnect attempts', () => {
    it('transitions to failed state after 10 reconnect attempts', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      // Simulate 10 unclean disconnections and reconnect attempts
      for (let attempt = 0; attempt < 10; attempt++) {
        const socket = MockWebSocket.instances.at(-1);

        // Trigger unclean close
        act(() => {
          socket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
        });

        // Calculate expected delay with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);

        // Advance time to trigger reconnect
        act(() => {
          jest.advanceTimersByTime(delay);
        });
      }

      // The 11th socket attempt will not happen - instead state becomes 'failed'
      const socket = MockWebSocket.instances.at(-1);
      act(() => {
        socket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
      });

      const finalState = snapshots.at(-1);
      expect(finalState?.connectionState).toBe('failed');
      expect(finalState?.reconnectAttempt).toBe(10);
    });

    it('exposes maxReconnectAttempts constant as 10', () => {
      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);
      expect(state?.maxReconnectAttempts).toBe(10);
    });
  });

  describe('exponential backoff calculation', () => {
    it('doubles delay each attempt up to 30 second cap', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      // Expected delays: 1s, 2s, 4s, 8s, 16s, 30s (capped), 30s, 30s, 30s, 30s
      const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000];
      const reconnectTimes: number[] = [];

      for (let attempt = 0; attempt < 10; attempt++) {
        const socket = MockWebSocket.instances.at(-1);
        const instancesBefore = MockWebSocket.instances.length;

        act(() => {
          socket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
        });

        // Record what the expected delay is
        const expectedDelay = expectedDelays[attempt];

        // Advance by expected delay - 1ms (should NOT reconnect yet)
        act(() => {
          jest.advanceTimersByTime(expectedDelay - 1);
        });

        if (attempt < 9) {
          // Should not have reconnected yet
          expect(MockWebSocket.instances.length).toBe(instancesBefore);
        }

        // Advance the final 1ms
        act(() => {
          jest.advanceTimersByTime(1);
        });

        if (attempt < 9) {
          // Now should have reconnected
          expect(MockWebSocket.instances.length).toBe(instancesBefore + 1);
        }

        reconnectTimes.push(expectedDelay);
      }

      expect(reconnectTimes).toEqual(expectedDelays);
    });
  });

  describe('manual reconnect from failed state', () => {
    it('resets attempt counter when reconnect() called from failed state', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      // Exhaust reconnect attempts to reach failed state
      for (let attempt = 0; attempt < 10; attempt++) {
        const socket = MockWebSocket.instances.at(-1);
        act(() => {
          socket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
        });
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        act(() => {
          jest.advanceTimersByTime(delay);
        });
      }

      // Final close to trigger failed state
      const failedSocket = MockWebSocket.instances.at(-1);
      act(() => {
        failedSocket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
      });

      const failedState = snapshots.at(-1);
      expect(failedState?.connectionState).toBe('failed');
      expect(failedState?.reconnectAttempt).toBe(10);

      const instancesBeforeReconnect = MockWebSocket.instances.length;

      // Call manual reconnect()
      act(() => {
        failedState?.reconnect();
      });

      // Should create a new connection
      expect(MockWebSocket.instances.length).toBe(instancesBeforeReconnect + 1);

      // Attempt counter should be reset
      const reconnectingState = snapshots.at(-1);
      expect(reconnectingState?.reconnectAttempt).toBe(0);
      expect(reconnectingState?.connectionState).toBe('connecting');
    });

    it('allows successful connection after manual reconnect from failed', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      // Exhaust reconnects to failed state
      for (let attempt = 0; attempt < 10; attempt++) {
        const socket = MockWebSocket.instances.at(-1);
        act(() => {
          socket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
        });
        act(() => {
          jest.advanceTimersByTime(Math.min(1000 * Math.pow(2, attempt), 30000));
        });
      }
      const failedSocket = MockWebSocket.instances.at(-1);
      act(() => {
        failedSocket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
      });

      const failedState = snapshots.at(-1);
      expect(failedState?.connectionState).toBe('failed');

      // Manual reconnect
      act(() => {
        failedState?.reconnect();
      });

      // Simulate successful connection
      const newSocket = MockWebSocket.instances.at(-1);
      act(() => {
        newSocket!.readyState = MockWebSocket.OPEN;
        newSocket?.onopen?.();
      });

      const connectedState = snapshots.at(-1);
      expect(connectedState?.connectionState).toBe('connected');
      expect(connectedState?.reconnectAttempt).toBe(0);
      expect(connectedState?.isConnected).toBe(true);
    });
  });

  describe('UI feedback for max attempts', () => {
    it('provides reconnectAttempt and maxReconnectAttempts for UI display', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      // Initially 0 attempts
      const initialState = snapshots.at(-1);
      expect(initialState?.reconnectAttempt).toBe(0);
      expect(initialState?.maxReconnectAttempts).toBe(10);

      // After first disconnect and reconnect attempt
      const socket = MockWebSocket.instances.at(-1);
      act(() => {
        socket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
      });
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      const afterFirstAttempt = snapshots.at(-1);
      expect(afterFirstAttempt?.reconnectAttempt).toBe(1);
      expect(afterFirstAttempt?.maxReconnectAttempts).toBe(10);
    });

    it('logs error when max attempts reached', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      // Exhaust all attempts
      for (let attempt = 0; attempt < 10; attempt++) {
        const socket = MockWebSocket.instances.at(-1);
        act(() => {
          socket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
        });
        act(() => {
          jest.advanceTimersByTime(Math.min(1000 * Math.pow(2, attempt), 30000));
        });
      }

      // Final close triggers failed state with error log
      const failedSocket = MockWebSocket.instances.at(-1);
      act(() => {
        failedSocket?.onclose?.({ wasClean: false, code: 1006, reason: 'reset' });
      });

      expect(console.error).toHaveBeenCalledWith(
        'WebSocket reconnection failed after max attempts',
        expect.objectContaining({ url: 'ws://example.test' })
      );
    });
  });
});

describe('getWebSocketUrl', () => {
  const getUrl = () => {
    let result = '';
    let devValue = false;
    jest.isolateModules(() => {
      const { getWebSocketUrl } = require('../websocket');
      result = getWebSocketUrl();
      devValue = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);
    });
    return { result, devValue };
  };

  it('prefers the explicit environment URL', () => {
    process.env.EXPO_PUBLIC_WS_URL = 'wss://example.test/ws';
    expect(getUrl().result).toBe('wss://example.test/ws');
  });

  it('ignores the Expo host when dev mode is disabled', () => {
    setDevMode(false);
    mockConstants.expoConfig = {
      hostUri: 'http://192.168.1.55:19000',
    };

    const { result } = getUrl();
    expect(result).toBe('wss://api.nullspace.casino/ws');
  });

  it('falls back to the hosted gateway', () => {
    setDevMode(false);
    mockConstants.expoConfig = undefined;
    mockConstants.expoGoConfig = undefined;
    mockConstants.manifest = undefined;

    expect(getUrl().result).toBe('wss://api.nullspace.casino/ws');
  });
});
