/**
 * useNetworkStatus - Network connectivity detection hook (AC-8.3)
 *
 * Provides real-time network status for React Native mobile apps.
 * Uses multiple strategies to detect connectivity:
 *
 * 1. WebSocket connection state as primary indicator
 * 2. Fetch-based health check as secondary validation
 * 3. AppState changes to re-check on foreground
 *
 * ## Design Decisions
 *
 * - **No external dependencies**: Avoids @react-native-community/netinfo to keep bundle small
 * - **Health check endpoint**: Uses gateway /healthz endpoint for accurate connectivity
 * - **Debouncing**: Prevents rapid status flapping during unstable connections
 * - **Background awareness**: Pauses checks when app is backgrounded
 *
 * ## Network Status States
 *
 * ```
 * ONLINE ──[health check fails 2x]──> UNSTABLE ──[3x fail]──> OFFLINE
 *    ^                                    │                       │
 *    └──────[health check succeeds]───────┴───────────────────────┘
 * ```
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getWebSocketUrl } from '../services/websocket';

/**
 * Network connectivity status.
 */
export type NetworkStatus = 'online' | 'offline' | 'unstable';

/**
 * Network status details returned by the hook.
 */
export interface NetworkStatusState {
  /** Current network status */
  status: NetworkStatus;
  /** True if network is available (online or unstable) */
  isOnline: boolean;
  /** True if network is stable (online only) */
  isStable: boolean;
  /** Last successful health check timestamp (ms) */
  lastOnlineAt: number | null;
  /** Consecutive failed health checks */
  failureCount: number;
  /** True if currently checking network */
  isChecking: boolean;
}

/**
 * Network status actions.
 */
export interface NetworkStatusActions {
  /** Force a network health check */
  checkNow: () => Promise<void>;
  /** Reset failure count (e.g., after manual reconnect) */
  resetFailures: () => void;
}

// Configuration constants
const HEALTH_CHECK_INTERVAL_MS = 10000; // Check every 10s when app is active
const HEALTH_CHECK_TIMEOUT_MS = 5000; // 5s timeout for health checks
const UNSTABLE_THRESHOLD = 2; // 2 consecutive failures = unstable
const OFFLINE_THRESHOLD = 5; // 5 consecutive failures = offline
const DEBOUNCE_MS = 1000; // Debounce rapid status changes

/**
 * Derives the health check URL from the WebSocket URL.
 * Converts ws://host:port or wss://host:port to http(s)://host:port/healthz
 */
function getHealthCheckUrl(): string {
  const wsUrl = getWebSocketUrl();
  const isSecure = wsUrl.startsWith('wss://');
  const protocol = isSecure ? 'https://' : 'http://';
  const hostPort = wsUrl.replace(/^wss?:\/\//, '').split('/')[0];
  return `${protocol}${hostPort}/healthz`;
}

/**
 * Hook for monitoring network connectivity status.
 *
 * @example
 * ```tsx
 * function NetworkBanner() {
 *   const { state, actions } = useNetworkStatus();
 *
 *   if (state.status === 'offline') {
 *     return (
 *       <View style={styles.banner}>
 *         <Text>No internet connection</Text>
 *         <Button title="Retry" onPress={actions.checkNow} />
 *       </View>
 *     );
 *   }
 *
 *   if (state.status === 'unstable') {
 *     return <Text style={styles.warning}>Connection unstable...</Text>;
 *   }
 *
 *   return null;
 * }
 * ```
 */
export function useNetworkStatus(): {
  state: NetworkStatusState;
  actions: NetworkStatusActions;
} {
  const [status, setStatus] = useState<NetworkStatus>('online');
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(null);
  const [failureCount, setFailureCount] = useState(0);
  const [isChecking, setIsChecking] = useState(false);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStatusChangeRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Performs a health check by fetching the health endpoint.
   * Returns true if the check succeeds, false otherwise.
   */
  const performHealthCheck = useCallback(async (): Promise<boolean> => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(getHealthCheckUrl(), {
        method: 'GET',
        signal: abortControllerRef.current.signal,
        // Short timeout via AbortController
        headers: { 'Cache-Control': 'no-cache' },
      });

      // Set a timeout to abort the request
      const timeoutId = setTimeout(() => {
        abortControllerRef.current?.abort();
      }, HEALTH_CHECK_TIMEOUT_MS);

      const ok = response.ok;
      clearTimeout(timeoutId);

      return ok;
    } catch (error: unknown) {
      // AbortError is expected when we cancel the request
      if (error instanceof Error && error.name === 'AbortError') {
        return false;
      }
      // Network error or timeout
      return false;
    }
  }, []);

  /**
   * Updates the network status based on health check result.
   * Implements debouncing and threshold-based transitions.
   */
  const updateStatus = useCallback((success: boolean) => {
    const now = Date.now();

    // Debounce rapid changes
    if (now - lastStatusChangeRef.current < DEBOUNCE_MS) {
      return;
    }

    if (success) {
      setLastOnlineAt(now);
      setFailureCount(0);
      setStatus((prev) => {
        if (prev !== 'online') {
          lastStatusChangeRef.current = now;
        }
        return 'online';
      });
    } else {
      setFailureCount((prev) => {
        const newCount = prev + 1;

        if (newCount >= OFFLINE_THRESHOLD) {
          setStatus((prevStatus) => {
            if (prevStatus !== 'offline') {
              lastStatusChangeRef.current = now;
            }
            return 'offline';
          });
        } else if (newCount >= UNSTABLE_THRESHOLD) {
          setStatus((prevStatus) => {
            if (prevStatus !== 'unstable') {
              lastStatusChangeRef.current = now;
            }
            return 'unstable';
          });
        }

        return newCount;
      });
    }
  }, []);

  /**
   * Public action to force a health check.
   */
  const checkNow = useCallback(async () => {
    setIsChecking(true);
    try {
      const success = await performHealthCheck();
      updateStatus(success);
    } finally {
      setIsChecking(false);
    }
  }, [performHealthCheck, updateStatus]);

  /**
   * Public action to reset failure count.
   */
  const resetFailures = useCallback(() => {
    setFailureCount(0);
    setStatus('online');
    lastStatusChangeRef.current = Date.now();
  }, []);

  // Start/stop health check interval based on app state
  useEffect(() => {
    const startInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = setInterval(() => {
        void checkNow();
      }, HEALTH_CHECK_INTERVAL_MS);
    };

    const stopInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasBackground = appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextState;

      if (nextState === 'active') {
        // App came to foreground - check immediately and restart interval
        void checkNow();
        startInterval();
      } else if (wasBackground || nextState === 'background') {
        // App going to background - stop interval to save battery
        stopInterval();
      }
    };

    // Initial check and start interval
    void checkNow();
    startInterval();

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      stopInterval();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [checkNow]);

  // Build state object
  const state: NetworkStatusState = {
    status,
    isOnline: status !== 'offline',
    isStable: status === 'online',
    lastOnlineAt,
    failureCount,
    isChecking,
  };

  // Build actions object
  const actions: NetworkStatusActions = {
    checkNow,
    resetFailures,
  };

  return { state, actions };
}

// Export constants for testing
export const NETWORK_STATUS_CONSTANTS = {
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  UNSTABLE_THRESHOLD,
  OFFLINE_THRESHOLD,
  DEBOUNCE_MS,
};
