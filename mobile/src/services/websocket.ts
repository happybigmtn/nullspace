/**
 * WebSocket connection manager with reconnection logic
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { BaseMessageSchema } from '@nullspace/protocol/mobile';

// Base message type for all game communications
export interface GameMessage {
  type: string;
  [key: string]: unknown;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface WebSocketManager<T = GameMessage> {
  isConnected: boolean;
  connectionState: ConnectionState;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  lastMessage: T | null;
  send: (message: object) => boolean;
  reconnect: () => void;
  isReconnecting: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY_MS = 30000;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_QUEUE_SIZE = 50;
const MESSAGE_TIMEOUT_MS = 30000; // 30 seconds

interface QueuedMessage {
  message: object;
  timestamp: number;
}

/**
 * WebSocket hook with automatic reconnection and type-safe messages
 */
export function useWebSocket<T extends GameMessage = GameMessage>(
  url: string
): WebSocketManager<T> {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<T | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  // Track if we're currently in the process of connecting to prevent double-reconnect races
  const isReconnectingRef = useRef(false);

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

      // Flush queued messages
      const now = Date.now();
      const validMessages = messageQueueRef.current.filter(
        (item) => now - item.timestamp < MESSAGE_TIMEOUT_MS
      );

      if (validMessages.length > 0) {
        if (__DEV__) {
          console.log(
            `[WebSocket] Flushing ${validMessages.length} queued messages (${messageQueueRef.current.length - validMessages.length} expired)`
          );
        }
        for (const item of validMessages) {
          try {
            ws.current?.send(JSON.stringify(item.message));
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
        // Validate that the message has the required base structure
        const baseResult = BaseMessageSchema.safeParse(raw);
        if (!baseResult.success) {
          if (__DEV__) {
            console.error('Invalid message format:', baseResult.error.message);
          }
          return;
        }
        // Message has valid base structure, pass it through
        setLastMessage(raw as T);
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
    if (ws.current?.readyState !== WebSocket.OPEN) {
      // Queue message if we're connecting (will be flushed on reconnect)
      if (connectionState === 'connecting' || connectionState === 'disconnected') {
        if (messageQueueRef.current.length >= MAX_QUEUE_SIZE) {
          if (__DEV__) {
            console.warn(
              `[WebSocket] Message queue full (${MAX_QUEUE_SIZE}), dropping oldest message`
            );
          }
          messageQueueRef.current.shift(); // Remove oldest message
        }

        messageQueueRef.current.push({
          message,
          timestamp: Date.now(),
        });

        if (__DEV__) {
          console.log(
            `[WebSocket] Message queued (${messageQueueRef.current.length}/${MAX_QUEUE_SIZE})`
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
    isReconnecting: isReconnectingRef.current,
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
