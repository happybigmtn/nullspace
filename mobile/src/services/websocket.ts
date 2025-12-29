/**
 * WebSocket connection manager with reconnection logic
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
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
}

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY_MS = 30000;
const BASE_RECONNECT_DELAY_MS = 1000;

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

  const connect = useCallback(() => {
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
      console.error('Failed to create WebSocket:', error);
      setConnectionState('failed');
      return;
    }

    ws.current.onopen = () => {
      setIsConnected(true);
      setConnectionState('connected');
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);
    };

    ws.current.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        // Validate that the message has the required base structure
        const baseResult = BaseMessageSchema.safeParse(raw);
        if (!baseResult.success) {
          console.error('Invalid message format:', baseResult.error.message);
          return;
        }
        // Message has valid base structure, pass it through
        setLastMessage(raw as T);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.current.onclose = (event) => {
      setIsConnected(false);

      // Don't reconnect if it was a clean close
      if (event.wasClean) {
        setConnectionState('disconnected');
        return;
      }

      // Check if we've exceeded max attempts
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionState('failed');
        console.error('WebSocket reconnection failed after max attempts');
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
    };
  }, [url]);

  const send = useCallback((message: object): boolean => {
    if (ws.current?.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, message not sent');
      return false;
    }
    try {
      ws.current.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
      return false;
    }
  }, []);

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
  };
}

/**
 * Get WebSocket URL from environment
 */
export function getWebSocketUrl(): string {
  return process.env.EXPO_PUBLIC_WS_URL ?? 'wss://api.nullspace.casino/ws';
}
