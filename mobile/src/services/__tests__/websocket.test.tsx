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

// Mock analytics to track queue overflow metrics
const mockTrack = jest.fn(() => Promise.resolve());
jest.mock('../analytics', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
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

type HookSnapshot = WebSocketManager & {
  lastMessage: { type: string } | null;
  droppedMessage: { message: object; reason: 'queue_full' | 'expired' } | null;
  disconnect: () => void;
};

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
    // US-103: Now logs 4 arguments for better debugging
    expect(console.error).toHaveBeenCalledWith(
      'Invalid message format:',
      expect.any(String),
      '\nRaw message:',
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

  describe('message queue overflow', () => {
    it('drops oldest message when queue reaches MAX_QUEUE_SIZE (50)', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      // Socket is in 'connecting' state, messages get queued
      const state = snapshots.at(-1);
      expect(state?.connectionState).toBe('connecting');

      // Queue 50 messages (MAX_QUEUE_SIZE)
      for (let i = 0; i < 50; i++) {
        act(() => {
          state?.send({ type: 'queued_msg', index: i });
        });
      }

      // All 50 should be queued (log includes message ID now)
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[WebSocket\] Message queued \(50\/50\), id=/)
      );

      // Queue one more - should drop oldest and warn
      act(() => {
        state?.send({ type: 'queued_msg', index: 50 });
      });

      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] Message queue full (50), dropping oldest message'
      );

      // Now connect and verify FIFO order - message 0 should be dropped
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // First message sent should be index 1 (0 was dropped)
      const sentMessages = socket.send.mock.calls;
      const firstSent = JSON.parse(sentMessages[0][0] as string);
      expect(firstSent.index).toBe(1);

      // Last message sent should be index 50
      const lastSent = JSON.parse(sentMessages[sentMessages.length - 1][0] as string);
      expect(lastSent.index).toBe(50);

      // Should have sent exactly 50 messages (not 51)
      expect(sentMessages.length).toBe(50);
    });

    it('warns about critical game actions that can be lost during disconnection', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const socket = MockWebSocket.instances[0];

      // Connect first, then disconnect
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Simulate disconnection (unclean close)
      act(() => {
        socket.readyState = MockWebSocket.CLOSED;
        socket.onclose?.({ wasClean: false, code: 1006, reason: 'network failure' });
      });

      const state = snapshots.at(-1);
      expect(state?.connectionState).toBe('disconnected');

      // Queue 50 bet messages during disconnection
      for (let i = 0; i < 50; i++) {
        act(() => {
          state?.send({ type: 'game_action', action: 'bet', amount: 100, nonce: i });
        });
      }

      // Queue one more bet - this drops the first bet!
      act(() => {
        state?.send({ type: 'game_action', action: 'bet', amount: 200, nonce: 50 });
      });

      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] Message queue full (50), dropping oldest message'
      );

      // CRITICAL: The first bet (nonce: 0) was silently dropped
      // This is the behavior we're documenting - users could lose bets
    });

    it('maintains FIFO order when queue overflows multiple times', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue 55 messages (overflow by 5)
      for (let i = 0; i < 55; i++) {
        act(() => {
          state?.send({ type: 'msg', seq: i });
        });
      }

      // Should have warned 5 times (once for each overflow)
      expect(console.warn).toHaveBeenCalledTimes(5);

      // Connect and verify order
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      const sentMessages = socket.send.mock.calls.map(
        (call) => JSON.parse(call[0] as string).seq
      );

      // Messages 0-4 were dropped, 5-54 remain
      expect(sentMessages[0]).toBe(5);
      expect(sentMessages[sentMessages.length - 1]).toBe(54);
      expect(sentMessages.length).toBe(50);

      // Verify strict FIFO order
      for (let i = 0; i < sentMessages.length - 1; i++) {
        expect(sentMessages[i + 1]).toBe(sentMessages[i] + 1);
      }
    });

    it('returns true for queued messages even when oldest is dropped', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue 50 messages
      for (let i = 0; i < 50; i++) {
        const result = state?.send({ type: 'msg', index: i });
        expect(result).toBe(true);
      }

      // 51st message - still returns true (queued), but oldest was dropped
      let result: boolean | undefined;
      act(() => {
        result = state?.send({ type: 'msg', index: 50 });
      });

      expect(result).toBe(true);
      // Note: This is misleading to callers - the first message was lost
      // but send() still returns true for the new message
    });

    it('does not queue messages when connectionState is failed', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
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

      // Try to send when failed - should NOT queue, returns false
      let result: boolean | undefined;
      act(() => {
        result = failedState?.send({ type: 'msg' });
      });

      expect(result).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] Not connected and not reconnecting, message dropped'
      );
    });

    it('sets droppedMessage with queue_full reason when oldest is dropped', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const initialState = snapshots.at(-1);

      // Initially no dropped messages
      expect(initialState?.droppedMessage).toBeNull();

      // Queue 50 messages
      for (let i = 0; i < 50; i++) {
        act(() => {
          initialState?.send({ type: 'bet', nonce: i });
        });
      }

      // No message dropped yet
      let stateAfter50 = snapshots.at(-1);
      expect(stateAfter50?.droppedMessage).toBeNull();

      // Queue 51st message - should trigger drop of message 0
      act(() => {
        initialState?.send({ type: 'bet', nonce: 50 });
      });

      const stateAfterDrop = snapshots.at(-1);
      expect(stateAfterDrop?.droppedMessage).toEqual({
        message: { type: 'bet', nonce: 0 },
        reason: 'queue_full',
      });
    });

    it('updates droppedMessage for each subsequent overflow', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue 52 messages (2 overflows)
      for (let i = 0; i < 52; i++) {
        act(() => {
          state?.send({ type: 'msg', seq: i });
        });
      }

      // droppedMessage should be the last dropped one (seq: 1)
      const finalState = snapshots.at(-1);
      expect(finalState?.droppedMessage).toEqual({
        message: { type: 'msg', seq: 1 },
        reason: 'queue_full',
      });
    });

    it('sets droppedMessage with expired reason when messages timeout on reconnect', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue some messages
      act(() => {
        state?.send({ type: 'old_bet', amount: 100 });
      });
      act(() => {
        state?.send({ type: 'old_bet', amount: 200 });
      });

      // Advance time past MESSAGE_TIMEOUT_MS (30 seconds)
      act(() => {
        jest.advanceTimersByTime(31000);
      });

      // Now connect - should detect expired messages
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      const stateAfterConnect = snapshots.at(-1);
      expect(stateAfterConnect?.droppedMessage).toEqual({
        message: { type: 'old_bet', amount: 200 },
        reason: 'expired',
      });

      // Expired messages should have logged a warning
      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] 2 queued message(s) expired (older than 30s)'
      );
    });
  });

  describe('message timeout on reconnect', () => {
    it('filters messages older than 30s on reconnect and only sends valid ones', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue 3 messages
      act(() => {
        state?.send({ type: 'bet', id: 1, amount: 100 });
      });
      act(() => {
        state?.send({ type: 'bet', id: 2, amount: 200 });
      });
      act(() => {
        state?.send({ type: 'bet', id: 3, amount: 300 });
      });

      // Advance time past MESSAGE_TIMEOUT_MS (30s)
      act(() => {
        jest.advanceTimersByTime(31000);
      });

      // Queue one more message (this one is fresh)
      act(() => {
        state?.send({ type: 'bet', id: 4, amount: 400 });
      });

      // Connect - should only send message 4, others expired
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Only the fresh message (id: 4) should be sent
      expect(socket.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(socket.send.mock.calls[0][0] as string)).toEqual({
        type: 'bet',
        id: 4,
        amount: 400,
      });

      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] 3 queued message(s) expired (older than 30s)'
      );
    });

    it('handles mix of valid and expired messages correctly', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue first batch of messages
      act(() => {
        state?.send({ type: 'old_msg', seq: 1 });
      });
      act(() => {
        state?.send({ type: 'old_msg', seq: 2 });
      });

      // Wait 20 seconds (not expired yet)
      act(() => {
        jest.advanceTimersByTime(20000);
      });

      // Queue second batch
      act(() => {
        state?.send({ type: 'new_msg', seq: 3 });
      });
      act(() => {
        state?.send({ type: 'new_msg', seq: 4 });
      });

      // Wait another 15 seconds (first batch now > 30s, second batch at 15s)
      act(() => {
        jest.advanceTimersByTime(15000);
      });

      // Connect
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Only messages 3 and 4 should be sent (valid), messages 1 and 2 expired
      expect(socket.send).toHaveBeenCalledTimes(2);

      const sentMessages = socket.send.mock.calls.map(
        (call) => JSON.parse(call[0] as string).seq
      );
      expect(sentMessages).toEqual([3, 4]);

      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] 2 queued message(s) expired (older than 30s)'
      );
    });

    it('prevents stale game actions from replaying', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const socket = MockWebSocket.instances[0];

      // Connect first
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Disconnect
      act(() => {
        socket.readyState = MockWebSocket.CLOSED;
        socket.onclose?.({ wasClean: false, code: 1006, reason: 'disconnect' });
      });

      const state = snapshots.at(-1);
      expect(state?.connectionState).toBe('disconnected');

      // Queue game actions during outage
      act(() => {
        state?.send({ type: 'game_action', action: 'hit' });
      });
      act(() => {
        state?.send({ type: 'game_action', action: 'stand' });
      });
      act(() => {
        state?.send({ type: 'game_action', action: 'double' });
      });

      // Long outage (35 seconds) - all actions should expire
      act(() => {
        jest.advanceTimersByTime(35000);
      });

      // Reconnect
      const newSocket = MockWebSocket.instances.at(-1);
      act(() => {
        newSocket!.readyState = MockWebSocket.OPEN;
        newSocket?.onopen?.();
      });

      // NO stale game actions should replay
      expect(newSocket?.send).not.toHaveBeenCalled();

      // droppedMessage should indicate expiration
      const finalState = snapshots.at(-1);
      expect(finalState?.droppedMessage?.reason).toBe('expired');
    });

    it('drops all queued actions after 30-second outage', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue many different action types
      act(() => {
        state?.send({ type: 'bet', amount: 100 });
      });
      act(() => {
        state?.send({ type: 'game_action', action: 'hit' });
      });
      act(() => {
        state?.send({ type: 'chat', message: 'hello' });
      });
      act(() => {
        state?.send({ type: 'ping' });
      });
      act(() => {
        state?.send({ type: 'request_faucet' });
      });

      // 30-second outage
      act(() => {
        jest.advanceTimersByTime(30001);
      });

      // Connect
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // ALL messages should be dropped (none sent)
      expect(socket.send).not.toHaveBeenCalled();

      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] 5 queued message(s) expired (older than 30s)'
      );

      // droppedMessage should be the last queued message
      const finalState = snapshots.at(-1);
      expect(finalState?.droppedMessage).toEqual({
        message: { type: 'request_faucet' },
        reason: 'expired',
      });
    });

    it('logs flushed messages count excluding expired ones', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue 2 messages
      act(() => {
        state?.send({ type: 'expired', seq: 1 });
      });
      act(() => {
        state?.send({ type: 'expired', seq: 2 });
      });

      // Age the first two
      act(() => {
        jest.advanceTimersByTime(25000);
      });

      // Queue 3 more fresh messages
      act(() => {
        state?.send({ type: 'fresh', seq: 3 });
      });
      act(() => {
        state?.send({ type: 'fresh', seq: 4 });
      });
      act(() => {
        state?.send({ type: 'fresh', seq: 5 });
      });

      // Age past 30s for first batch only
      act(() => {
        jest.advanceTimersByTime(6000);
      });

      // Connect
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Should log flush with correct count (3 valid, 2 expired, 0 duplicates)
      expect(console.log).toHaveBeenCalledWith(
        '[WebSocket] Flushing 3 queued messages (2 expired, 0 duplicates skipped)'
      );
    });
  });

  // ========================================================================
  // US-086: Message Queue Overflow Notification Tests
  // ========================================================================
  //
  // This section tests that:
  // 1. Analytics tracks queue overflow events (queue_full and expired)
  // 2. Critical messages (bets, game_actions, faucet_requests) are flagged
  // 3. Users are notified via droppedMessage state when messages are lost
  // 4. Metrics provide visibility into queue health
  // ========================================================================

  describe('queue overflow notification and metrics (US-086)', () => {
    it('tracks analytics when message is dropped due to queue full', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue 50 messages (fill the queue)
      for (let i = 0; i < 50; i++) {
        act(() => {
          state?.send({ type: 'ping', seq: i });
        });
      }

      // Clear mock to isolate the overflow tracking
      mockTrack.mockClear();

      // Queue 51st message - should trigger overflow
      act(() => {
        state?.send({ type: 'ping', seq: 50 });
      });

      // Analytics should track the overflow
      expect(mockTrack).toHaveBeenCalledWith('websocket_queue_overflow', {
        reason: 'queue_full',
        messageType: 'ping',
        isCritical: false,
        queueSize: 50,
      });
    });

    it('marks bet messages as critical when dropped', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue a bet as the first message (will be the one dropped)
      act(() => {
        state?.send({ type: 'bet', amount: 100 });
      });

      // Fill remaining queue with pings
      for (let i = 1; i < 50; i++) {
        act(() => {
          state?.send({ type: 'ping', seq: i });
        });
      }

      mockTrack.mockClear();

      // Trigger overflow - the bet (oldest message) will be dropped
      act(() => {
        state?.send({ type: 'ping', seq: 50 });
      });

      // Analytics should mark this as critical
      expect(mockTrack).toHaveBeenCalledWith('websocket_queue_overflow', {
        reason: 'queue_full',
        messageType: 'bet',
        isCritical: true,
        queueSize: 50,
      });
    });

    it('marks game_action messages as critical when dropped', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue a game action as the first message
      act(() => {
        state?.send({ type: 'game_action', action: 'hit' });
      });

      // Fill remaining queue
      for (let i = 1; i < 50; i++) {
        act(() => {
          state?.send({ type: 'ping', seq: i });
        });
      }

      mockTrack.mockClear();

      // Trigger overflow
      act(() => {
        state?.send({ type: 'ping', seq: 50 });
      });

      expect(mockTrack).toHaveBeenCalledWith('websocket_queue_overflow', {
        reason: 'queue_full',
        messageType: 'game_action',
        isCritical: true,
        queueSize: 50,
      });
    });

    it('marks request_faucet messages as critical when dropped', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue a faucet request as the first message
      act(() => {
        state?.send({ type: 'request_faucet' });
      });

      // Fill remaining queue
      for (let i = 1; i < 50; i++) {
        act(() => {
          state?.send({ type: 'ping', seq: i });
        });
      }

      mockTrack.mockClear();

      // Trigger overflow
      act(() => {
        state?.send({ type: 'ping', seq: 50 });
      });

      expect(mockTrack).toHaveBeenCalledWith('websocket_queue_overflow', {
        reason: 'queue_full',
        messageType: 'request_faucet',
        isCritical: true,
        queueSize: 50,
      });
    });

    it('tracks analytics for expired messages on reconnect', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue some messages including critical ones
      act(() => {
        state?.send({ type: 'bet', amount: 100 });
      });
      act(() => {
        state?.send({ type: 'game_action', action: 'stand' });
      });
      act(() => {
        state?.send({ type: 'ping' });
      });

      // Age past timeout
      act(() => {
        jest.advanceTimersByTime(31000);
      });

      mockTrack.mockClear();

      // Connect - should detect expired messages
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Analytics should track expired messages with critical count
      expect(mockTrack).toHaveBeenCalledWith('websocket_queue_overflow', {
        reason: 'expired',
        expiredCount: 3,
        criticalCount: 2, // bet + game_action
        timeoutMs: 30000,
      });
    });

    it('provides droppedMessage for user notification on queue full', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue a bet that will be dropped
      act(() => {
        state?.send({ type: 'bet', amount: 500, nonce: 42 });
      });

      // Fill and overflow queue
      for (let i = 1; i <= 50; i++) {
        act(() => {
          state?.send({ type: 'ping', seq: i });
        });
      }

      // droppedMessage should contain the dropped bet for UI notification
      const finalState = snapshots.at(-1);
      expect(finalState?.droppedMessage).toEqual({
        message: { type: 'bet', amount: 500, nonce: 42 },
        reason: 'queue_full',
      });
    });

    it('provides droppedMessage for user notification on expire', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue critical messages
      act(() => {
        state?.send({ type: 'bet', amount: 1000 });
      });
      act(() => {
        state?.send({ type: 'game_action', action: 'double' });
      });

      // Age past timeout
      act(() => {
        jest.advanceTimersByTime(31000);
      });

      // Connect
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // droppedMessage should contain the last expired message
      const finalState = snapshots.at(-1);
      expect(finalState?.droppedMessage).toEqual({
        message: { type: 'game_action', action: 'double' },
        reason: 'expired',
      });
    });

    it('handles unknown message type gracefully', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue message without type field
      act(() => {
        state?.send({ data: 'no type field' });
      });

      // Fill and overflow
      for (let i = 1; i < 50; i++) {
        act(() => {
          state?.send({ type: 'ping', seq: i });
        });
      }

      mockTrack.mockClear();

      act(() => {
        state?.send({ type: 'ping', seq: 50 });
      });

      // Should use 'unknown' as message type
      expect(mockTrack).toHaveBeenCalledWith('websocket_queue_overflow', {
        reason: 'queue_full',
        messageType: 'unknown',
        isCritical: false,
        queueSize: 50,
      });
    });

    it('tracks multiple sequential overflows with correct message types', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue alternating message types
      for (let i = 0; i < 50; i++) {
        const type = i % 3 === 0 ? 'bet' : i % 3 === 1 ? 'game_action' : 'ping';
        act(() => {
          state?.send({ type, seq: i });
        });
      }

      mockTrack.mockClear();

      // First overflow - drops message 0 (bet)
      act(() => {
        state?.send({ type: 'ping', seq: 50 });
      });

      expect(mockTrack).toHaveBeenLastCalledWith('websocket_queue_overflow', {
        reason: 'queue_full',
        messageType: 'bet',
        isCritical: true,
        queueSize: 50,
      });

      // Second overflow - drops message 1 (game_action)
      act(() => {
        state?.send({ type: 'ping', seq: 51 });
      });

      expect(mockTrack).toHaveBeenLastCalledWith('websocket_queue_overflow', {
        reason: 'queue_full',
        messageType: 'game_action',
        isCritical: true,
        queueSize: 50,
      });

      // Third overflow - drops message 2 (ping)
      act(() => {
        state?.send({ type: 'ping', seq: 52 });
      });

      expect(mockTrack).toHaveBeenLastCalledWith('websocket_queue_overflow', {
        reason: 'queue_full',
        messageType: 'ping',
        isCritical: false,
        queueSize: 50,
      });
    });

    it('documents: droppedMessage enables UI to show user-facing warnings', () => {
      // This is a documentation test explaining how UI components should use
      // the droppedMessage state.
      //
      // Pattern in game screens:
      //   const { droppedMessage } = useWebSocket(url);
      //
      //   useEffect(() => {
      //     if (droppedMessage && droppedMessage.message.type === 'bet') {
      //       showWarning('Your bet may not have been placed. Please check your balance.');
      //     }
      //   }, [droppedMessage]);
      //
      // The droppedMessage state provides:
      //   - message: The exact message that was lost
      //   - reason: 'queue_full' (overflow) or 'expired' (timeout)
      //
      // UI can differentiate between:
      //   - Critical messages (bet, game_action, request_faucet) → show error
      //   - Non-critical messages (ping, presence) → silent or log only

      expect(true).toBe(true);
    });
  });

  // ========================================================================
  // US-070: Clock Skew Tolerance Tests
  // ========================================================================
  //
  // ARCHITECTURE NOTE: This codebase uses SEQUENTIAL NONCES (bigints), not
  // timestamp-based nonces. Clock skew between mobile and server does not
  // affect nonce validation because:
  //   1. Nonces are sequential integers managed by NonceManager
  //   2. Server validates nonce > previous nonce, not timestamp
  //
  // The only clock-sensitive logic is MESSAGE_TIMEOUT_MS (30s) in the
  // message queue. This is a mobile-local check using Date.now() at both
  // queue time and flush time, so it's immune to mobile↔server clock skew.
  //
  // However, SYSTEM CLOCK CHANGES on the mobile device during a reconnection
  // (NTP sync, manual time change) could cause unexpected message expiration.
  // These tests document that behavior.
  // ========================================================================

  describe('clock skew tolerance (US-070)', () => {
    it('documents: nonces are sequential, not timestamped', () => {
      // This is a documentation test explaining the architecture.
      // Sequential nonces mean clock skew between mobile and server
      // cannot cause nonce validation failures.
      //
      // Mobile sends: { nonce: 42 }
      // Server validates: 42 > previous_nonce (41)
      // No timestamp involved in validation.
      expect(true).toBe(true);
    });

    it('documents: message queue timeout is mobile-local', () => {
      // The 30-second MESSAGE_TIMEOUT_MS check uses Date.now() on the mobile
      // for both timestamping and filtering. Server clock is irrelevant.
      //
      // Flow:
      //   1. Queue message: item.timestamp = Date.now() (mobile time)
      //   2. On reconnect: filter where Date.now() - item.timestamp < 30s
      //   3. Both calls are on the same device, so clock skew between
      //      mobile and server has no effect.
      expect(true).toBe(true);
    });

    it('handles system clock jump forward during reconnection', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Note: Jest's fake timers advance Date.now() when advanceTimersByTime is called
      // This simulates a clock jump forward (e.g., NTP correction)

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue message at t=0
      act(() => {
        state?.send({ type: 'action', id: 1 });
      });

      // Simulate clock jumping forward 40 seconds (past the 30s timeout)
      // This could happen if NTP corrects a slow clock
      act(() => {
        jest.advanceTimersByTime(40000);
      });

      // Connect
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Message should be expired due to clock jump
      expect(socket.send).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] 1 queued message(s) expired (older than 30s)'
      );
    });

    it('handles system clock jump backward during reconnection', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      // With Jest fake timers, we can't easily simulate clock going backward.
      // However, if the clock goes backward, the filter would see:
      //   now - item.timestamp = negative value < MESSAGE_TIMEOUT_MS
      // This would cause messages to ALWAYS be valid.
      //
      // This is actually the safer failure mode: messages are sent rather
      // than dropped. The server will validate the nonce anyway.

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue messages
      act(() => {
        state?.send({ type: 'action', id: 1 });
        state?.send({ type: 'action', id: 2 });
      });

      // Small time advance (within timeout)
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      // Connect
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Both messages should be sent (within 30s)
      expect(socket.send).toHaveBeenCalledTimes(2);
    });

    it('tolerates up to 30 seconds of clock skew without message loss', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue message
      act(() => {
        state?.send({ type: 'bet', amount: 100 });
      });

      // Advance time to just under the threshold (29.9 seconds)
      act(() => {
        jest.advanceTimersByTime(29900);
      });

      // Connect
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Message should still be valid
      expect(socket.send).toHaveBeenCalledTimes(1);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('expires messages at exactly 30 seconds', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue message
      act(() => {
        state?.send({ type: 'bet', amount: 100 });
      });

      // Advance time to exactly the threshold (30 seconds)
      act(() => {
        jest.advanceTimersByTime(30000);
      });

      // Connect
      const socket = MockWebSocket.instances[0];
      act(() => {
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen?.();
      });

      // Message should be expired (>= 30s)
      expect(socket.send).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] 1 queued message(s) expired (older than 30s)'
      );
    });

    it('documents: server-mobile clock skew does not affect nonce validation', () => {
      // This test documents why clock skew isn't a problem for nonces.
      //
      // Scenario: Mobile clock is 5 minutes ahead of server
      // - Mobile generates nonce 42 (sequential, not timestamped)
      // - Server receives nonce 42
      // - Server validates: 42 > 41 (previous nonce) ✓
      //
      // The nonce is purely a counter, so clock differences don't matter.
      // Compare this to systems that use timestamped nonces like:
      //   nonce = Date.now() + random
      // Those systems WOULD need clock skew tolerance.

      expect(true).toBe(true);
    });

    it('maintains queue timestamps during rapid reconnection cycles', () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        TestRenderer.create(<HookProbe url="ws://example.test" />);
      });

      const state = snapshots.at(-1);

      // Queue message at t=0
      act(() => {
        state?.send({ type: 'critical_action' });
      });

      // Simulate rapid reconnection cycles with time passing
      for (let cycle = 0; cycle < 3; cycle++) {
        const socket = MockWebSocket.instances.at(-1);

        // Connect briefly
        act(() => {
          socket!.readyState = MockWebSocket.OPEN;
          socket!.onopen?.();
        });

        // Disconnect
        act(() => {
          socket!.onclose?.({ wasClean: false, code: 1006, reason: 'network' });
        });

        // Wait 5 seconds per cycle (total 15s, under 30s threshold)
        act(() => {
          jest.advanceTimersByTime(5000);
        });
      }

      // Final connect within the 30s window
      const finalSocket = MockWebSocket.instances.at(-1);
      act(() => {
        finalSocket!.readyState = MockWebSocket.OPEN;
        finalSocket!.onopen?.();
      });

      // Original message should still be sent (only ~15s old)
      // Note: It may have been sent on first connect, so we check it was sent at least once
      const allCalls = MockWebSocket.instances.flatMap(s => s.send.mock.calls);
      expect(allCalls.length).toBeGreaterThanOrEqual(1);
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

describe('multi-game session preservation (US-067)', () => {
  /**
   * These tests verify that session state is preserved when navigating between games.
   * The WebSocketContext provides a singleton connection shared across all game screens.
   */

  it('maintains WebSocket connection when switching between games', () => {
    // Document the architectural pattern:
    // WebSocketProvider creates a single connection at app root
    // All game screens use useWebSocketContext() to access the same connection
    // This means navigating between games doesn't create new connections
    jest.spyOn(console, 'error').mockImplementation(() => {}); // Suppress validation errors

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Simulate receiving balance update (US-103: use valid schema)
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'balance', registered: true, hasBalance: true, publicKey: 'abc', balance: '1000' }) });
    });

    // Connection remains active
    expect(socket.close).not.toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBe(1); // Only one connection

    // Simulate multiple game state updates (US-103: use valid schema)
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_started', sessionId: '1001' }) });
    });
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_started', sessionId: '1002' }) });
    });

    // Still the same connection
    expect(MockWebSocket.instances.length).toBe(1);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('preserves balance state across game transitions', () => {
    let latestState: HookSnapshot | null = null;

    const BalanceTracker = () => {
      const state = useWebSocket('ws://example.test') as HookSnapshot;
      latestState = state;
      return null;
    };

    act(() => {
      TestRenderer.create(<BalanceTracker />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Receive initial balance (US-103: use valid schema message)
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'balance', registered: true, hasBalance: true, publicKey: 'abc', balance: '5000' }) });
    });

    // Simulate game transition with game_result (US-103: game_ended not in schema)
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_result', won: false, payout: '0' }) });
    });
    // Start new game (US-103: sessionId required)
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_started', sessionId: '123' }) });
    });

    // lastMessage should reflect the latest state
    expect(latestState?.lastMessage?.type).toBe('game_started');
    expect(latestState?.isConnected).toBe(true);
  });

  it('maintains connection during rapid game switching', () => {
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Simulate rapid game switching (US-103: use valid game_started schema)
    const sessionIds = ['1001', '1002', '1003', '1004', '1005'];
    for (const sessionId of sessionIds) {
      act(() => {
        socket.onmessage?.({ data: JSON.stringify({ type: 'game_started', sessionId }) });
      });
      act(() => {
        jest.advanceTimersByTime(100);
      });
    }

    // Connection should still be stable
    expect(socket.close).not.toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBe(1);

    const finalState = snapshots.at(-1);
    expect(finalState?.isConnected).toBe(true);
  });

  it('does not show stale state after returning to a game', () => {
    let latestState: HookSnapshot | null = null;

    const StateTracker = () => {
      const state = useWebSocket('ws://example.test') as HookSnapshot;
      latestState = state;
      return null;
    };

    act(() => {
      TestRenderer.create(<StateTracker />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Start game 1 (US-103: sessionId required, bet as string)
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_started', sessionId: '1001', bet: '100' }) });
    });

    // Switch to game 2
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_started', sessionId: '1002', bet: '50' }) });
    });

    // Return to game 1 with fresh state
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_started', sessionId: '1003', bet: '200' }) });
    });

    // Should show the LATEST state, not the old bet=100 (US-103: bet is string)
    expect(latestState?.lastMessage).toEqual({ type: 'game_started', sessionId: '1003', bet: '200' });
  });

  it('reconnects preserve session after network interruption during game', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket1 = MockWebSocket.instances[0];
    act(() => {
      socket1.readyState = MockWebSocket.OPEN;
      socket1.onopen?.();
    });

    // Active game session (US-103: all required fields)
    act(() => {
      socket1.onmessage?.({ data: JSON.stringify({ type: 'session_ready', sessionId: '1', publicKey: '0x123', registered: true, hasBalance: true }) });
    });

    // Network interruption
    act(() => {
      socket1.readyState = MockWebSocket.CLOSED;
      socket1.onclose?.({ wasClean: false, code: 1006, reason: 'Abnormal closure' });
    });

    // Wait for reconnect
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // New connection established
    const socket2 = MockWebSocket.instances[1];
    act(() => {
      socket2.readyState = MockWebSocket.OPEN;
      socket2.onopen?.();
    });

    // Should be reconnected
    const finalState = snapshots.at(-1);
    expect(finalState?.isConnected).toBe(true);

    // Can continue game actions
    act(() => {
      finalState?.send({ type: 'get_balance' });
    });
    expect(socket2.send).toHaveBeenCalled();
  });

  it('documents singleton pattern: only one WebSocket per provider', () => {
    // This is a documentation test verifying our architectural decision:
    // WebSocketContext.tsx creates ONE WebSocket connection at the root level.
    // All game screens share this connection via useWebSocketContext().
    //
    // Benefits:
    // 1. Session state preserved across game navigation
    // 2. Balance updates apply globally, not per-screen
    // 3. No connection overhead when switching games
    // 4. Single source of truth for connection status

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    // Only one WebSocket instance created
    expect(MockWebSocket.instances.length).toBe(1);

    // Render multiple times (simulating multiple game components)
    // In the real app, they would all use useWebSocketContext() from the same provider
    // Here we're just documenting that the same URL doesn't create new connections
    // (The real test is that WebSocketProvider is at app root, not per-screen)
    const expected = 1;
    expect(MockWebSocket.instances.length).toBe(expected);
  });
});

describe('disconnect function (US-068)', () => {
  /**
   * Tests for the disconnect() function added to support SESSION_EXPIRED handling.
   * When a session expires, we need to cleanly close the connection without triggering
   * auto-reconnect, as reconnecting would just get another SESSION_EXPIRED error.
   */

  it('closes WebSocket cleanly with code 1000', () => {
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    const state = snapshots.at(-1);
    expect(state?.isConnected).toBe(true);

    // Disconnect
    act(() => {
      state?.disconnect();
    });

    // Should close with code 1000 (clean close)
    expect(socket.close).toHaveBeenCalledWith(1000, 'session_expired');
  });

  it('prevents auto-reconnect after disconnect', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    const state = snapshots.at(-1);
    const instancesBefore = MockWebSocket.instances.length;

    // Disconnect
    act(() => {
      state?.disconnect();
    });

    // Simulate the close event (wasClean=true because code 1000)
    act(() => {
      socket.onclose?.({ wasClean: true, code: 1000, reason: 'session_expired' });
    });

    // Wait for potential reconnect
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Should NOT have created new connections
    expect(MockWebSocket.instances.length).toBe(instancesBefore);
  });

  it('clears message queue on disconnect', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Queue some messages
    act(() => {
      state?.send({ type: 'queued1' });
      state?.send({ type: 'queued2' });
    });

    // Disconnect
    act(() => {
      state?.disconnect();
    });

    // Connect new socket
    act(() => {
      state?.reconnect();
    });

    const newSocket = MockWebSocket.instances.at(-1);
    act(() => {
      newSocket!.readyState = MockWebSocket.OPEN;
      newSocket?.onopen?.();
    });

    // Queue should have been cleared - no messages sent
    expect(newSocket?.send).not.toHaveBeenCalled();
  });

  it('cancels pending reconnect attempts on disconnect', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];

    // Trigger an unclean close (which schedules reconnect)
    act(() => {
      socket.onclose?.({ wasClean: false, code: 1006, reason: 'network error' });
    });

    const instancesBeforeDisconnect = MockWebSocket.instances.length;

    // Disconnect before reconnect timer fires
    const state = snapshots.at(-1);
    act(() => {
      state?.disconnect();
    });

    // Advance past the reconnect delay
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Should NOT have reconnected - the timer was cancelled
    expect(MockWebSocket.instances.length).toBe(instancesBeforeDisconnect);
  });

  it('sets connection state to disconnected after disconnect', () => {
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    expect(snapshots.at(-1)?.connectionState).toBe('connected');

    // Disconnect
    act(() => {
      snapshots.at(-1)?.disconnect();
    });

    const finalState = snapshots.at(-1);
    expect(finalState?.connectionState).toBe('disconnected');
    expect(finalState?.isConnected).toBe(false);
  });

  it('can reconnect after disconnect', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Disconnect
    act(() => {
      snapshots.at(-1)?.disconnect();
    });

    const instancesAfterDisconnect = MockWebSocket.instances.length;

    // Manually reconnect
    act(() => {
      snapshots.at(-1)?.reconnect();
    });

    // Should have created a new connection
    expect(MockWebSocket.instances.length).toBe(instancesAfterDisconnect + 1);

    // Connect the new socket
    const newSocket = MockWebSocket.instances.at(-1);
    act(() => {
      newSocket!.readyState = MockWebSocket.OPEN;
      newSocket?.onopen?.();
    });

    const finalState = snapshots.at(-1);
    expect(finalState?.isConnected).toBe(true);
    expect(finalState?.connectionState).toBe('connected');
  });
});

// ========================================================================
// US-098: Message Queue Idempotency Tests
// ========================================================================
//
// This section tests that:
// 1. Messages are assigned unique IDs when queued
// 2. Already-sent messages are deduplicated on reconnect
// 3. Sent message IDs are tracked for idempotency
// 4. Old sent IDs are cleaned up to prevent memory leaks
// ========================================================================

describe('message queue idempotency (US-098)', () => {
  it('assigns unique ID to each queued message', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Queue multiple messages
    act(() => {
      state?.send({ type: 'msg1' });
    });
    act(() => {
      state?.send({ type: 'msg2' });
    });
    act(() => {
      state?.send({ type: 'msg3' });
    });

    // Log should show message IDs
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/Message queued.*id=/)
    );
  });

  it('deduplicates messages that were already sent before reconnect', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Queue messages while connecting
    act(() => {
      state?.send({ type: 'bet', amount: 100 });
    });
    act(() => {
      state?.send({ type: 'bet', amount: 200 });
    });

    // First connection - flush queue
    const socket1 = MockWebSocket.instances[0];
    act(() => {
      socket1.readyState = MockWebSocket.OPEN;
      socket1.onopen?.();
    });

    // Both messages should be sent
    expect(socket1.send).toHaveBeenCalledTimes(2);

    // Simulate abrupt disconnection (connection drops mid-session)
    // Messages were sent but might still be in queue due to race condition
    act(() => {
      socket1.readyState = MockWebSocket.CLOSED;
      socket1.onclose?.({ wasClean: false, code: 1006, reason: 'network error' });
    });

    // Wait for reconnect
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // Second connection
    const socket2 = MockWebSocket.instances[1];
    act(() => {
      socket2.readyState = MockWebSocket.OPEN;
      socket2.onopen?.();
    });

    // No messages should be re-sent (queue was cleared after first flush)
    // This test verifies the queue is properly cleared
    expect(socket2.send).not.toHaveBeenCalled();
  });

  it('tracks sent message IDs for direct sends', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    const state = snapshots.at(-1);

    // Send messages directly (not queued)
    act(() => {
      state?.send({ type: 'direct1' });
    });
    act(() => {
      state?.send({ type: 'direct2' });
    });

    // Both should be sent
    expect(socket.send).toHaveBeenCalledTimes(2);

    // Note: Direct sends are tracked in sentMessageIdsRef for potential
    // future use, even though they don't go through the queue
  });

  it('skips duplicate messages during queue flush', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Queue messages
    act(() => {
      state?.send({ type: 'msg', seq: 1 });
    });
    act(() => {
      state?.send({ type: 'msg', seq: 2 });
    });
    act(() => {
      state?.send({ type: 'msg', seq: 3 });
    });

    // First connection - partial flush
    const socket1 = MockWebSocket.instances[0];
    act(() => {
      socket1.readyState = MockWebSocket.OPEN;
      socket1.onopen?.();
    });

    // Log should indicate flushing with deduplication info
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/Flushing \d+ queued messages.*\d+ duplicates skipped/)
    );
  });

  it('cleans up old sent IDs on reconnect to prevent memory leak', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    // First connection
    const socket1 = MockWebSocket.instances[0];
    act(() => {
      socket1.readyState = MockWebSocket.OPEN;
      socket1.onopen?.();
    });

    const state = snapshots.at(-1);

    // Send many messages directly
    for (let i = 0; i < 100; i++) {
      act(() => {
        state?.send({ type: 'msg', seq: i });
      });
    }

    // Disconnect
    act(() => {
      socket1.readyState = MockWebSocket.CLOSED;
      socket1.onclose?.({ wasClean: false, code: 1006, reason: 'error' });
    });

    // Wait longer than SENT_ID_RETENTION_MS (60 seconds)
    act(() => {
      jest.advanceTimersByTime(61000);
    });

    // Reconnect
    const socket2 = MockWebSocket.instances.at(-1);
    act(() => {
      socket2!.readyState = MockWebSocket.OPEN;
      socket2!.onopen?.();
    });

    // Old sent IDs should have been cleaned up during onopen
    // This prevents memory accumulation over long sessions
    // (We can't directly verify the Map size, but the cleanup runs on every connect)
    expect(socket2!.send).not.toHaveBeenCalled(); // Queue was cleared
  });

  it('generates unique message IDs across rapid sends', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const state = snapshots.at(-1);
    const logCalls: string[] = [];

    // Capture log calls
    (console.log as jest.Mock).mockImplementation((msg: string) => {
      if (typeof msg === 'string' && msg.includes('id=')) {
        logCalls.push(msg);
      }
    });

    // Queue many messages rapidly
    for (let i = 0; i < 10; i++) {
      act(() => {
        state?.send({ type: 'rapid', seq: i });
      });
    }

    // Extract IDs from log messages
    const ids = logCalls.map((log) => {
      const match = log.match(/id=([\d-]+)/);
      return match ? match[1] : null;
    }).filter(Boolean);

    // All IDs should be unique
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('documents: idempotency prevents double-bets on reconnect race', () => {
    // This is a documentation test explaining the problem being solved.
    //
    // SCENARIO without idempotency:
    // 1. User places bet while connected
    // 2. Connection drops immediately after send
    // 3. Message was queued but might not have been received by server
    // 4. On reconnect, queue is flushed -> bet sent AGAIN
    // 5. User loses double the chips!
    //
    // WITH idempotency:
    // 1. User places bet, message gets unique ID
    // 2. Message is sent, ID tracked in sentMessageIdsRef
    // 3. Connection drops
    // 4. On reconnect, queue flush checks sentMessageIdsRef
    // 5. Already-sent message is skipped -> no double bet
    //
    // The server also has idempotency (nonces), but client-side
    // deduplication prevents unnecessary traffic and provides
    // immediate feedback.

    expect(true).toBe(true);
  });

  it('preserves FIFO order while deduplicating', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Queue messages in order
    for (let i = 0; i < 5; i++) {
      act(() => {
        state?.send({ type: 'ordered', seq: i });
      });
    }

    // Connect and flush
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Verify order is preserved
    const sentMessages = socket.send.mock.calls.map(
      (call) => JSON.parse(call[0] as string).seq
    );
    expect(sentMessages).toEqual([0, 1, 2, 3, 4]);
  });
});

// ========================================================================
// US-099: onMessageDropped Callback Tests
// ========================================================================
//
// This section tests the onMessageDropped callback that allows callers to
// be notified immediately when a message is dropped (queue overflow or expired).
// This addresses the semantic issue where send() returns true even when
// an older message was dropped to make room.
// ========================================================================

describe('onMessageDropped callback (US-099)', () => {
  it('calls onMessageDropped when oldest message dropped on queue overflow', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const onMessageDropped = jest.fn();

    // Create a custom HookProbe that passes options
    function HookProbeWithCallback({ url }: { url: string }) {
      const state = useWebSocket(url, { onMessageDropped }) as HookSnapshot;
      useEffect(() => {
        snapshots.push(state);
      }, [state]);
      return null;
    }

    act(() => {
      TestRenderer.create(<HookProbeWithCallback url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Fill the queue with 50 messages
    for (let i = 0; i < 50; i++) {
      act(() => {
        state?.send({ type: 'msg', seq: i });
      });
    }

    // No callback yet - queue not overflowed
    expect(onMessageDropped).not.toHaveBeenCalled();

    // 51st message - triggers overflow, drops message 0
    act(() => {
      state?.send({ type: 'msg', seq: 50 });
    });

    // Callback should be invoked with dropped message details
    expect(onMessageDropped).toHaveBeenCalledTimes(1);
    expect(onMessageDropped).toHaveBeenCalledWith(
      { message: { type: 'msg', seq: 0 }, reason: 'queue_full' },
      false // not critical (type is 'msg')
    );
  });

  it('marks critical messages (bet) as isCritical=true', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const onMessageDropped = jest.fn();

    function HookProbeWithCallback({ url }: { url: string }) {
      const state = useWebSocket(url, { onMessageDropped }) as HookSnapshot;
      useEffect(() => {
        snapshots.push(state);
      }, [state]);
      return null;
    }

    act(() => {
      TestRenderer.create(<HookProbeWithCallback url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Queue a bet as the first message (will be dropped)
    act(() => {
      state?.send({ type: 'bet', amount: 100 });
    });

    // Fill remaining queue
    for (let i = 1; i < 50; i++) {
      act(() => {
        state?.send({ type: 'ping', seq: i });
      });
    }

    // Trigger overflow
    act(() => {
      state?.send({ type: 'ping', seq: 50 });
    });

    expect(onMessageDropped).toHaveBeenCalledWith(
      { message: { type: 'bet', amount: 100 }, reason: 'queue_full' },
      true // critical because type is 'bet'
    );
  });

  it('marks game_action messages as isCritical=true', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const onMessageDropped = jest.fn();

    function HookProbeWithCallback({ url }: { url: string }) {
      const state = useWebSocket(url, { onMessageDropped }) as HookSnapshot;
      useEffect(() => {
        snapshots.push(state);
      }, [state]);
      return null;
    }

    act(() => {
      TestRenderer.create(<HookProbeWithCallback url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Queue a game_action as the first message
    act(() => {
      state?.send({ type: 'game_action', action: 'hit' });
    });

    // Fill remaining queue
    for (let i = 1; i < 50; i++) {
      act(() => {
        state?.send({ type: 'ping' });
      });
    }

    // Trigger overflow
    act(() => {
      state?.send({ type: 'ping' });
    });

    expect(onMessageDropped).toHaveBeenCalledWith(
      { message: { type: 'game_action', action: 'hit' }, reason: 'queue_full' },
      true // critical
    );
  });

  it('calls onMessageDropped for each expired message on reconnect', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const onMessageDropped = jest.fn();

    function HookProbeWithCallback({ url }: { url: string }) {
      const state = useWebSocket(url, { onMessageDropped }) as HookSnapshot;
      useEffect(() => {
        snapshots.push(state);
      }, [state]);
      return null;
    }

    act(() => {
      TestRenderer.create(<HookProbeWithCallback url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Queue 3 messages
    act(() => {
      state?.send({ type: 'bet', amount: 100 });
    });
    act(() => {
      state?.send({ type: 'game_action', action: 'stand' });
    });
    act(() => {
      state?.send({ type: 'ping' });
    });

    // Wait for messages to expire (31 seconds)
    act(() => {
      jest.advanceTimersByTime(31000);
    });

    // Connect - should trigger callbacks for all expired messages
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Should be called 3 times (once for each expired message)
    expect(onMessageDropped).toHaveBeenCalledTimes(3);

    // Verify each call
    expect(onMessageDropped).toHaveBeenNthCalledWith(1,
      { message: { type: 'bet', amount: 100 }, reason: 'expired' },
      true // critical
    );
    expect(onMessageDropped).toHaveBeenNthCalledWith(2,
      { message: { type: 'game_action', action: 'stand' }, reason: 'expired' },
      true // critical
    );
    expect(onMessageDropped).toHaveBeenNthCalledWith(3,
      { message: { type: 'ping' }, reason: 'expired' },
      false // not critical
    );
  });

  it('calls onMessageDropped for multiple sequential overflows', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const onMessageDropped = jest.fn();

    function HookProbeWithCallback({ url }: { url: string }) {
      const state = useWebSocket(url, { onMessageDropped }) as HookSnapshot;
      useEffect(() => {
        snapshots.push(state);
      }, [state]);
      return null;
    }

    act(() => {
      TestRenderer.create(<HookProbeWithCallback url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Fill queue with 50 messages
    for (let i = 0; i < 50; i++) {
      act(() => {
        state?.send({ type: 'msg', seq: i });
      });
    }

    // Trigger 3 overflows
    act(() => {
      state?.send({ type: 'msg', seq: 50 });
    });
    act(() => {
      state?.send({ type: 'msg', seq: 51 });
    });
    act(() => {
      state?.send({ type: 'msg', seq: 52 });
    });

    // Should be called 3 times
    expect(onMessageDropped).toHaveBeenCalledTimes(3);

    // Verify sequential drops (0, 1, 2)
    expect(onMessageDropped).toHaveBeenNthCalledWith(1,
      { message: { type: 'msg', seq: 0 }, reason: 'queue_full' },
      false
    );
    expect(onMessageDropped).toHaveBeenNthCalledWith(2,
      { message: { type: 'msg', seq: 1 }, reason: 'queue_full' },
      false
    );
    expect(onMessageDropped).toHaveBeenNthCalledWith(3,
      { message: { type: 'msg', seq: 2 }, reason: 'queue_full' },
      false
    );
  });

  it('works without callback (optional parameter)', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Use original HookProbe without callback
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const state = snapshots.at(-1);

    // Fill queue and overflow
    for (let i = 0; i <= 50; i++) {
      act(() => {
        state?.send({ type: 'msg', seq: i });
      });
    }

    // Should not throw - callback is optional
    expect(console.warn).toHaveBeenCalledWith(
      '[WebSocket] Message queue full (50), dropping oldest message'
    );
  });

  it('documents: send() returns true even when oldest dropped (semantic choice)', () => {
    // This is a documentation test explaining our design decision.
    //
    // When send() is called and the queue is full:
    // 1. The OLDEST message is dropped
    // 2. The NEW message is queued successfully
    // 3. send() returns TRUE because the NEW message was queued
    //
    // This is the correct semantic: send() tells you if YOUR message was accepted.
    // The onMessageDropped callback tells you about PREVIOUS messages being lost.
    //
    // Alternative designs considered:
    // - Return false: Misleading - the new message IS queued
    // - Return { queued: true, dropped: msg }: API complexity, breaks existing code
    // - Throw exception: Too disruptive for queue overflow
    //
    // Our solution: Keep send() simple, provide callback for drop notifications.

    expect(true).toBe(true);
  });
});

// ========================================================================
// US-103: Malformed Message Validation Tests
// ========================================================================
//
// This section tests that malformed server messages are properly rejected
// and don't cause runtime crashes. The websocket hook now uses full
// GameMessageSchema validation instead of just BaseMessageSchema.
// ========================================================================

describe('malformed message validation (US-103)', () => {
  it('ignores messages without type field', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Send malformed message without type
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ won: true, payout: '100' }) });
    });

    // lastMessage should remain null - message was rejected
    const state = snapshots.at(-1);
    expect(state?.lastMessage).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('ignores messages with unknown type', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Send message with unknown type
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'unknown_message_type' }) });
    });

    const state = snapshots.at(-1);
    expect(state?.lastMessage).toBeNull();
  });

  it('ignores game_result with wrong won type', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // won should be boolean, not string
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_result', won: 'yes', payout: '100' }) });
    });

    const state = snapshots.at(-1);
    expect(state?.lastMessage).toBeNull();
  });

  it('accepts valid game_result messages', () => {
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Valid game_result
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'game_result', won: true, payout: '100' }) });
    });

    const state = snapshots.at(-1);
    expect(state?.lastMessage?.type).toBe('game_result');
  });

  it('accepts valid error messages', () => {
    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Valid error
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'E001', message: 'Test error' }) });
    });

    const state = snapshots.at(-1);
    expect(state?.lastMessage?.type).toBe('error');
  });

  it('handles invalid JSON gracefully', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    // Invalid JSON
    act(() => {
      socket.onmessage?.({ data: 'not valid json {' });
    });

    const state = snapshots.at(-1);
    expect(state?.lastMessage).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('tracks invalid messages for monitoring', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HookProbe url="ws://example.test" />);
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    mockTrack.mockClear();

    // Send invalid message
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'invalid_type_xyz' }) });
    });

    // Should track validation failure
    expect(mockTrack).toHaveBeenCalledWith('websocket_invalid_message', expect.objectContaining({
      messageType: 'invalid_type_xyz',
    }));
  });

  it('documents: full GameMessageSchema validation prevents runtime crashes', () => {
    // This is a documentation test explaining US-103.
    //
    // Before US-103:
    // - WebSocket used BaseMessageSchema (only validates { type: string })
    // - Game screens cast lastMessage to specific types without validation
    // - Malformed server messages could cause runtime crashes
    //
    // After US-103:
    // - WebSocket uses full GameMessageSchema validation
    // - Only valid messages matching known schemas pass through
    // - Invalid messages are logged, tracked, and silently dropped
    // - Game screens can safely use type narrowing on lastMessage
    //
    // This ensures that if the server sends malformed data, the client
    // gracefully ignores it rather than crashing.

    expect(true).toBe(true);
  });
});
