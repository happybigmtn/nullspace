/**
 * WebSocket connection manager with reconnection logic
 *
 * ## Idempotency Guarantees (US-098)
 *
 * This module provides client-side idempotency for queued messages:
 *
 * 1. **Message IDs**: Each queued message gets a unique ID (`{timestamp}-{counter}`)
 * 2. **Sent Tracking**: Successfully sent message IDs are tracked in `sentMessageIdsRef`
 * 3. **Deduplication**: On reconnect, messages already in `sentMessageIdsRef` are skipped
 * 4. **Cleanup**: Old sent IDs (>60s) are cleaned up on each connect to prevent memory leaks
 *
 * ### Why Client-Side Idempotency?
 *
 * The server uses sequential nonces for idempotency, but client-side deduplication:
 * - Reduces unnecessary network traffic on reconnect
 * - Provides immediate feedback (no round-trip needed to detect duplicate)
 * - Prevents UI confusion from duplicate sends
 *
 * ### Race Condition Scenario (prevented)
 *
 * ```
 * 1. User places bet while connected
 * 2. send() succeeds, message ID tracked
 * 3. Connection drops immediately after
 * 4. User sees "reconnecting" but bet was sent
 * 5. On reconnect, queue flush skips the bet (already tracked as sent)
 * 6. No double-bet!
 * ```
 *
 * ## Message Drop Notifications (US-099)
 *
 * When messages are dropped (queue overflow or expiration), callers can be notified:
 *
 * 1. **droppedMessage state**: Contains the last dropped message (for UI display)
 * 2. **onMessageDropped callback**: Called immediately for each dropped message
 *
 * ### Callback Usage
 *
 * ```typescript
 * const { send, droppedMessage } = useWebSocket(url, {
 *   onMessageDropped: (dropped, isCritical) => {
 *     if (isCritical) {
 *       // Show alert: "Your bet may have been lost. Please try again."
 *       showNotification(`Message lost: ${dropped.reason}`);
 *     }
 *   }
 * });
 * ```
 *
 * ### Design Note: send() Return Value
 *
 * `send()` returns `true` when the NEW message is queued, even if an OLDER message
 * was dropped to make room. This is semantically correct - the caller's message was
 * accepted. Use the callback to know about previously-queued messages being lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { GameMessageSchema, type GameMessage as ProtocolGameMessage } from '@nullspace/protocol/mobile';
import { track } from './analytics';

// Base message type for all game communications
export interface GameMessage {
  type: string;
  [key: string]: unknown;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface DroppedMessage {
  message: object;
  reason: 'queue_full' | 'expired';
}

/**
 * Callback invoked when a message is dropped from the queue.
 * Use this to notify users about lost critical messages (bets, game actions).
 *
 * @param dropped - The dropped message details
 * @param isCritical - True if the message type is bet, game_action, or request_faucet
 */
export type OnMessageDroppedCallback = (
  dropped: DroppedMessage,
  isCritical: boolean
) => void;

export interface WebSocketOptions {
  /**
   * Optional callback invoked when a message is dropped from the queue.
   * Called both for queue overflow (oldest dropped) and message expiration.
   */
  onMessageDropped?: OnMessageDroppedCallback;
}

export interface WebSocketManager<T = GameMessage> {
  isConnected: boolean;
  connectionState: ConnectionState;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  lastMessage: T | null;
  send: (message: object) => boolean;
  reconnect: () => void;
  disconnect: () => void;
  isReconnecting: boolean;
  droppedMessage: DroppedMessage | null;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY_MS = 30000;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_QUEUE_SIZE = 50;
const MESSAGE_TIMEOUT_MS = 30000; // 30 seconds
const SENT_ID_RETENTION_MS = 60000; // Keep sent IDs for 1 minute to prevent duplicates

// Counter for generating unique message IDs
let messageIdCounter = 0;

/**
 * Generate a unique message ID for idempotency tracking.
 * Format: {timestamp}-{counter} ensures uniqueness within this session.
 */
function generateMessageId(): string {
  return `${Date.now()}-${++messageIdCounter}`;
}

interface QueuedMessage {
  id: string; // Unique message ID for idempotency
  message: object;
  timestamp: number;
}

// Helper to check if a message type is critical (affects user funds/actions)
function isCriticalMessageType(type: string | undefined): boolean {
  return ['bet', 'game_action', 'request_faucet'].includes(type ?? '');
}

/**
 * WebSocket hook with automatic reconnection and type-safe messages
 */
export function useWebSocket<T extends GameMessage = GameMessage>(
  url: string,
  options?: WebSocketOptions
): WebSocketManager<T> {
  const onMessageDroppedRef = useRef(options?.onMessageDropped);

  // Keep callback ref updated when options change
  useEffect(() => {
    onMessageDroppedRef.current = options?.onMessageDropped;
  }, [options?.onMessageDropped]);

  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<T | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [droppedMessage, setDroppedMessage] = useState<DroppedMessage | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  // Track if we're currently in the process of connecting to prevent double-reconnect races
  const isReconnectingRef = useRef(false);
  // Track sent message IDs for idempotency (prevents duplicate sends on reconnect)
  const sentMessageIdsRef = useRef<Map<string, number>>(new Map());

  const connect = useCallback(() => {
    // Prevent double-reconnect races
    if (isReconnectingRef.current) {
      if (__DEV__) {
        console.log('[WebSocket] Already reconnecting, skipping duplicate connect()');
      }
      return;
    }
    isReconnectingRef.current = true;

    // Security: Enforce wss:// in production
    if (!__DEV__ && !url.startsWith('wss://')) {
      const error = new Error(
        `Production requires secure WebSocket (wss://). Got: ${url}`
      );
      console.error('[WebSocket Security]', error.message);
      setConnectionState('failed');
      isReconnectingRef.current = false;
      throw error;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutId.current) {
      clearTimeout(reconnectTimeoutId.current);
      reconnectTimeoutId.current = null;
    }

    // Close existing connection
    if (ws.current) {
      ws.current.close();
    }

    setConnectionState('connecting');

    try {
      ws.current = new WebSocket(url);
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to create WebSocket:', error);
      }
      setConnectionState('failed');
      isReconnectingRef.current = false;
      return;
    }

    ws.current.onopen = () => {
      isReconnectingRef.current = false;
      setIsConnected(true);
      setConnectionState('connected');
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);

      // Cleanup old sent IDs to prevent memory leak
      const now = Date.now();
      for (const [id, timestamp] of sentMessageIdsRef.current.entries()) {
        if (now - timestamp > SENT_ID_RETENTION_MS) {
          sentMessageIdsRef.current.delete(id);
        }
      }

      // Flush queued messages (with idempotency check)
      const validMessages = messageQueueRef.current.filter(
        (item) => now - item.timestamp < MESSAGE_TIMEOUT_MS
      );
      const expiredMessages = messageQueueRef.current.filter(
        (item) => now - item.timestamp >= MESSAGE_TIMEOUT_MS
      );

      // Filter out already-sent messages (idempotency)
      const unsentMessages = validMessages.filter(
        (item) => !sentMessageIdsRef.current.has(item.id)
      );
      const duplicateCount = validMessages.length - unsentMessages.length;

      // Notify about expired messages
      if (expiredMessages.length > 0) {
        // Set state for the last expired message (for UI display)
        const lastExpired = expiredMessages[expiredMessages.length - 1];
        if (lastExpired) {
          setDroppedMessage({ message: lastExpired.message, reason: 'expired' });
        }
        if (__DEV__) {
          console.warn(
            `[WebSocket] ${expiredMessages.length} queued message(s) expired (older than ${MESSAGE_TIMEOUT_MS / 1000}s)`
          );
        }
        // Track expired messages for metrics/analytics
        const criticalCount = expiredMessages.filter((item) => {
          const type = (item.message as { type?: string }).type;
          return isCriticalMessageType(type);
        }).length;
        track('websocket_queue_overflow', {
          reason: 'expired',
          expiredCount: expiredMessages.length,
          criticalCount,
          timeoutMs: MESSAGE_TIMEOUT_MS,
        }).catch(() => {}); // Fire and forget
        // Invoke callback for each expired message
        for (const item of expiredMessages) {
          const dropped: DroppedMessage = { message: item.message, reason: 'expired' };
          const type = (item.message as { type?: string }).type;
          onMessageDroppedRef.current?.(dropped, isCriticalMessageType(type));
        }
      }

      if (unsentMessages.length > 0 || duplicateCount > 0) {
        if (__DEV__) {
          console.log(
            `[WebSocket] Flushing ${unsentMessages.length} queued messages (${expiredMessages.length} expired, ${duplicateCount} duplicates skipped)`
          );
        }
        for (const item of unsentMessages) {
          try {
            ws.current?.send(JSON.stringify(item.message));
            // Track this message as sent for idempotency
            sentMessageIdsRef.current.set(item.id, now);
          } catch (error) {
            if (__DEV__) {
              console.error('[WebSocket] Failed to send queued message:', error);
            }
          }
        }
      }

      // Clear the queue
      messageQueueRef.current = [];
    };

    ws.current.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        // US-103: Full schema validation to prevent runtime crashes from malformed messages
        const validationResult = GameMessageSchema.safeParse(raw);
        if (!validationResult.success) {
          if (__DEV__) {
            console.error(
              'Invalid message format:',
              validationResult.error.message,
              '\nRaw message:',
              JSON.stringify(raw).slice(0, 200)
            );
          }
          // Track validation failures for monitoring
          track('websocket_invalid_message', {
            messageType: typeof raw === 'object' && raw !== null ? (raw as { type?: string }).type : 'unknown',
            error: validationResult.error.message.slice(0, 100),
          }).catch(() => {}); // Fire and forget
          return;
        }
        // Message validated successfully - safe to use with type narrowing
        setLastMessage(validationResult.data as T);
      } catch (e) {
        if (__DEV__) {
          console.error('Failed to parse WebSocket message:', e);
        }
      }
    };

    ws.current.onerror = (error) => {
      if (__DEV__) {
        console.error('WebSocket error:', {
          url,
          readyState: ws.current?.readyState,
          error,
        });
      }
    };

    ws.current.onclose = (event) => {
      // Clear reconnecting flag so subsequent attempts can proceed
      isReconnectingRef.current = false;
      setIsConnected(false);

      // Don't reconnect if it was a clean close
      if (event.wasClean) {
        setConnectionState('disconnected');
        if (__DEV__) {
          console.log('WebSocket closed cleanly', {
            url,
            code: event.code,
            reason: event.reason,
          });
        }
        return;
      }

      // Check if we've exceeded max attempts
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionState('failed');
        if (__DEV__) {
          console.error('WebSocket reconnection failed after max attempts', {
            url,
            code: event.code,
            reason: event.reason,
          });
        }
        return;
      }

      setConnectionState('disconnected');

      // Exponential backoff reconnection
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current),
        MAX_RECONNECT_DELAY_MS
      );

      reconnectTimeoutId.current = setTimeout(() => {
        reconnectAttemptsRef.current++;
        setReconnectAttempt(reconnectAttemptsRef.current);
        connect();
      }, delay);

      if (__DEV__) {
        console.log('WebSocket disconnected, scheduling reconnect', {
          url,
          code: event.code,
          reason: event.reason,
          attempt: reconnectAttemptsRef.current + 1,
          delay,
        });
      }
    };
  }, [url]);

  const send = useCallback((message: object): boolean => {
    const messageId = generateMessageId();

    if (ws.current?.readyState !== WebSocket.OPEN) {
      // Queue message if we're connecting (will be flushed on reconnect)
      if (connectionState === 'connecting' || connectionState === 'disconnected') {
        if (messageQueueRef.current.length >= MAX_QUEUE_SIZE) {
          if (__DEV__) {
            console.warn(
              `[WebSocket] Message queue full (${MAX_QUEUE_SIZE}), dropping oldest message`
            );
          }
          const droppedItem = messageQueueRef.current.shift(); // Remove oldest message
          if (droppedItem) {
            const dropped: DroppedMessage = { message: droppedItem.message, reason: 'queue_full' };
            setDroppedMessage(dropped);
            // Track queue overflow for metrics/analytics
            const droppedType = (droppedItem.message as { type?: string }).type;
            const isCritical = isCriticalMessageType(droppedType);
            track('websocket_queue_overflow', {
              reason: 'queue_full',
              messageType: droppedType ?? 'unknown',
              isCritical,
              queueSize: MAX_QUEUE_SIZE,
            }).catch(() => {}); // Fire and forget
            // Invoke callback for immediate notification
            onMessageDroppedRef.current?.(dropped, isCritical);
          }
        }

        messageQueueRef.current.push({
          id: messageId,
          message,
          timestamp: Date.now(),
        });

        if (__DEV__) {
          console.log(
            `[WebSocket] Message queued (${messageQueueRef.current.length}/${MAX_QUEUE_SIZE}), id=${messageId}`
          );
        }
        return true; // Return true since message is queued
      }

      if (__DEV__) {
        console.warn('[WebSocket] Not connected and not reconnecting, message dropped');
      }
      return false;
    }

    try {
      ws.current.send(JSON.stringify(message));
      // Track direct sends for idempotency (in case message gets re-queued somehow)
      sentMessageIdsRef.current.set(messageId, Date.now());
      return true;
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to send WebSocket message:', error);
      }
      return false;
    }
  }, [connectionState]);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setReconnectAttempt(0);
    connect();
  }, [connect]);

  const disconnect = useCallback(() => {
    // Cancel any pending reconnect
    if (reconnectTimeoutId.current) {
      clearTimeout(reconnectTimeoutId.current);
      reconnectTimeoutId.current = null;
    }
    // Clear the message queue
    messageQueueRef.current = [];
    // Close the connection cleanly (wasClean=true prevents auto-reconnect)
    if (ws.current) {
      ws.current.close(1000, 'session_expired');
    }
    setConnectionState('disconnected');
    setIsConnected(false);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutId.current) {
        clearTimeout(reconnectTimeoutId.current);
      }
      ws.current?.close();
    };
  }, [connect]);

  return {
    isConnected,
    connectionState,
    reconnectAttempt,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    send,
    lastMessage,
    reconnect,
    disconnect,
    isReconnecting: isReconnectingRef.current,
    droppedMessage,
  };
}

/**
 * Get WebSocket URL from environment
 */
export function getWebSocketUrl(): string {
  const configured = process.env.EXPO_PUBLIC_WS_URL;
  if (configured) return configured;

  if (__DEV__) {
    const hostUri =
      Constants.expoConfig?.hostUri ||
      (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ||
      (Constants.manifest as { debuggerHost?: string } | undefined)?.debuggerHost ||
      '';
    if (hostUri) {
      let host = hostUri;
      if (host.includes('://')) {
        const [, rest] = host.split('://');
        host = rest ?? '';
      }
      host = host.split('/')[0] ?? '';
      host = host.split(':')[0] ?? '';
      if (host) {
        return `ws://${host}:9010`;
      }
    }
  }

  return 'wss://api.nullspace.casino/ws';
}
