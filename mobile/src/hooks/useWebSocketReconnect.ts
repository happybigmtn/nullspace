/**
 * useWebSocketReconnect - Coordinated WebSocket reconnection with network awareness (AC-8.3)
 *
 * Integrates network status detection with WebSocket reconnection to provide
 * reliable connectivity after brief network loss.
 *
 * ## Key Features
 *
 * 1. **Network-Aware Reconnection**: Only attempts reconnect when network is available
 * 2. **Exponential Backoff**: Inherited from useWebSocket, respects network state
 * 3. **Immediate Reconnect on Network Restore**: Triggers reconnect when online status returns
 * 4. **AppState Integration**: Reconnects when app returns to foreground
 * 5. **Unified Status**: Combines network and WebSocket state into single status
 *
 * ## Reconnection Strategy
 *
 * ```
 * Network drops → Mark offline → Pause reconnects
 *                                    │
 * Network returns → Mark online → Immediate reconnect attempt
 *                                    │
 *                                    ├─> Success → Connected
 *                                    │
 *                                    └─> Failure → Exponential backoff (if network still up)
 * ```
 *
 * ## State Synchronization
 *
 * The hook prevents wasteful reconnect attempts by:
 * 1. Checking network status before each attempt
 * 2. Canceling pending reconnects when going offline
 * 3. Resetting backoff when network returns after offline period
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useWebSocketContext, type WebSocketManager } from '../context/WebSocketContext';
import { useNetworkStatus, type NetworkStatus, type NetworkStatusState } from './useNetworkStatus';

/**
 * Combined connection status that incorporates both network and WebSocket state.
 */
export type ReconnectStatus =
  | 'connected'       // WebSocket connected and network online
  | 'connecting'      // WebSocket connecting, network available
  | 'reconnecting'    // Attempting to reconnect after disconnect
  | 'offline'         // Network unavailable
  | 'failed'          // Max reconnect attempts exceeded
  | 'disconnected';   // Clean disconnect (user-initiated)

/**
 * Reconnection state returned by the hook.
 */
export interface ReconnectState {
  /** Combined connection status */
  status: ReconnectStatus;
  /** Network-level status (online/offline/unstable) */
  networkStatus: NetworkStatus;
  /** True if network is available */
  isNetworkOnline: boolean;
  /** True if WebSocket is connected */
  isWebSocketConnected: boolean;
  /** Current reconnect attempt number */
  reconnectAttempt: number;
  /** Maximum reconnect attempts allowed */
  maxReconnectAttempts: number;
  /** True if currently attempting reconnection */
  isReconnecting: boolean;
  /** Seconds until next reconnect attempt (null if not scheduled) */
  nextReconnectIn: number | null;
  /** Last successful connection timestamp */
  lastConnectedAt: number | null;
  /** Time spent disconnected (ms, null if connected) */
  disconnectedDuration: number | null;
}

/**
 * Reconnection actions returned by the hook.
 */
export interface ReconnectActions {
  /** Force immediate reconnection attempt */
  reconnectNow: () => void;
  /** Cancel pending reconnection and disconnect */
  disconnect: () => void;
  /** Reset reconnect attempts and retry */
  resetAndReconnect: () => void;
  /** Check network status immediately */
  checkNetwork: () => Promise<void>;
}

// Constants
const RECONNECT_CHECK_INTERVAL_MS = 1000; // Update countdown every second
const NETWORK_RESTORE_DELAY_MS = 500; // Short delay after network restore before reconnecting

/**
 * Hook for managing WebSocket reconnection with network awareness.
 *
 * @example
 * ```tsx
 * function ConnectionManager() {
 *   const { state, actions } = useWebSocketReconnect();
 *
 *   useEffect(() => {
 *     if (state.status === 'failed') {
 *       // Show permanent error UI after max attempts
 *       Alert.alert('Connection Failed', 'Please check your internet connection.');
 *     }
 *   }, [state.status]);
 *
 *   if (state.status === 'offline') {
 *     return <OfflineBanner />;
 *   }
 *
 *   if (state.status === 'reconnecting') {
 *     return (
 *       <View>
 *         <Text>Reconnecting... (Attempt {state.reconnectAttempt}/{state.maxReconnectAttempts})</Text>
 *         {state.nextReconnectIn && <Text>Next attempt in {state.nextReconnectIn}s</Text>}
 *         <Button title="Retry Now" onPress={actions.reconnectNow} />
 *       </View>
 *     );
 *   }
 *
 *   return <ConnectedContent />;
 * }
 * ```
 */
export function useWebSocketReconnect(): {
  state: ReconnectState;
  actions: ReconnectActions;
} {
  const ws = useWebSocketContext();
  const { state: networkState, actions: networkActions } = useNetworkStatus();

  // Track connection timing
  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);
  const [nextReconnectIn, setNextReconnectIn] = useState<number | null>(null);
  const [isManuallyDisconnected, setIsManuallyDisconnected] = useState(false);

  // Refs for tracking state across renders
  const wasOfflineRef = useRef(false);
  const wasConnectedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduledReconnectTimeRef = useRef<number | null>(null);

  // Track when we become connected
  useEffect(() => {
    if (ws.connectionState === 'connected') {
      setLastConnectedAt(Date.now());
      wasConnectedRef.current = true;
    }
  }, [ws.connectionState]);

  // Handle network status changes - trigger reconnect when coming back online
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    const isNowOnline = networkState.isOnline;

    if (wasOffline && isNowOnline && !isManuallyDisconnected) {
      // Network just came back online - trigger reconnect after short delay
      // The delay allows network stack to stabilize
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      reconnectTimerRef.current = setTimeout(() => {
        if (ws.connectionState !== 'connected' && ws.connectionState !== 'connecting') {
          ws.reconnect();
        }
      }, NETWORK_RESTORE_DELAY_MS);
    }

    wasOfflineRef.current = !isNowOnline;
  }, [networkState.isOnline, ws, isManuallyDisconnected]);

  // Handle app state changes - reconnect when returning to foreground
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        // App came to foreground - check if we need to reconnect
        if (
          networkState.isOnline &&
          ws.connectionState !== 'connected' &&
          ws.connectionState !== 'connecting' &&
          !isManuallyDisconnected
        ) {
          ws.reconnect();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [networkState.isOnline, ws, isManuallyDisconnected]);

  // Update countdown timer for next reconnect attempt
  useEffect(() => {
    // Clear any existing countdown
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    // Only show countdown when disconnected and not connected
    if (
      ws.connectionState !== 'disconnected' ||
      ws.reconnectAttempt === 0 ||
      !networkState.isOnline
    ) {
      setNextReconnectIn(null);
      scheduledReconnectTimeRef.current = null;
      return;
    }

    // Calculate when next reconnect is scheduled based on exponential backoff
    // Formula: BASE_DELAY * 2^attempt, capped at MAX_DELAY
    const BASE_DELAY_MS = 1000;
    const MAX_DELAY_MS = 30000;
    const delay = Math.min(
      BASE_DELAY_MS * Math.pow(2, ws.reconnectAttempt - 1),
      MAX_DELAY_MS
    );
    scheduledReconnectTimeRef.current = Date.now() + delay;

    const updateCountdown = () => {
      if (scheduledReconnectTimeRef.current === null) {
        setNextReconnectIn(null);
        return;
      }

      const remaining = Math.max(
        0,
        Math.ceil((scheduledReconnectTimeRef.current - Date.now()) / 1000)
      );
      setNextReconnectIn(remaining);
    };

    updateCountdown();
    countdownIntervalRef.current = setInterval(updateCountdown, RECONNECT_CHECK_INTERVAL_MS);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [ws.connectionState, ws.reconnectAttempt, networkState.isOnline]);

  // Derive combined status
  const status = useMemo((): ReconnectStatus => {
    // Check network first
    if (!networkState.isOnline) {
      return 'offline';
    }

    // Manual disconnect takes precedence
    if (isManuallyDisconnected) {
      return 'disconnected';
    }

    // Map WebSocket state
    switch (ws.connectionState) {
      case 'connected':
        return 'connected';
      case 'connecting':
        return ws.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
      case 'failed':
        return 'failed';
      case 'disconnected':
      default:
        return ws.reconnectAttempt > 0 ? 'reconnecting' : 'disconnected';
    }
  }, [networkState.isOnline, ws.connectionState, ws.reconnectAttempt, isManuallyDisconnected]);

  // Calculate disconnected duration
  const disconnectedDuration = useMemo(() => {
    if (ws.connectionState === 'connected' || lastConnectedAt === null) {
      return null;
    }
    return Date.now() - lastConnectedAt;
  }, [ws.connectionState, lastConnectedAt]);

  // Actions
  const reconnectNow = useCallback(() => {
    setIsManuallyDisconnected(false);
    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    ws.reconnect();
  }, [ws]);

  const disconnect = useCallback(() => {
    setIsManuallyDisconnected(true);
    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    ws.disconnect();
  }, [ws]);

  const resetAndReconnect = useCallback(() => {
    setIsManuallyDisconnected(false);
    networkActions.resetFailures();
    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    ws.reconnect();
  }, [ws, networkActions]);

  const checkNetwork = useCallback(async () => {
    await networkActions.checkNow();
  }, [networkActions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Build state object
  const state: ReconnectState = {
    status,
    networkStatus: networkState.status,
    isNetworkOnline: networkState.isOnline,
    isWebSocketConnected: ws.isConnected,
    reconnectAttempt: ws.reconnectAttempt,
    maxReconnectAttempts: ws.maxReconnectAttempts,
    isReconnecting: status === 'reconnecting',
    nextReconnectIn,
    lastConnectedAt,
    disconnectedDuration,
  };

  // Build actions object
  const actions: ReconnectActions = {
    reconnectNow,
    disconnect,
    resetAndReconnect,
    checkNetwork,
  };

  return { state, actions };
}
