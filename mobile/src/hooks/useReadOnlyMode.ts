/**
 * useReadOnlyMode - Read-only mode state management hook (AC-8.4)
 *
 * Determines when the app should enter read-only mode based on connectivity
 * and connection state. In read-only mode, users can view game state and
 * history but cannot place bets or submit actions.
 *
 * ## When Read-Only Mode is Active
 *
 * 1. **Offline**: Network is completely unavailable
 * 2. **Reconnecting**: WebSocket connection lost, attempting to reconnect
 * 3. **Failed**: Max reconnection attempts exceeded
 * 4. **Connecting** (initial): First connection attempt (brief, acceptable)
 *
 * ## Design Decisions
 *
 * - Uses `useWebSocketReconnect` for unified connectivity state
 * - Provides human-readable reason strings for UI display
 * - Exposes `canSubmit` boolean for simple action gating
 * - Includes transition awareness for animation coordination
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketReconnect, type ReconnectStatus } from './useWebSocketReconnect';

/**
 * Reason why the app is in read-only mode.
 */
export type ReadOnlyReason =
  | 'offline'           // Network unavailable
  | 'reconnecting'      // Connection lost, attempting to reconnect
  | 'failed'            // Max reconnection attempts exceeded
  | 'connecting'        // Initial connection in progress
  | null;               // Not in read-only mode

/**
 * Read-only mode state returned by the hook.
 */
export interface ReadOnlyModeState {
  /** True when app is in read-only mode */
  isReadOnly: boolean;
  /** Reason for read-only mode (null if not read-only) */
  reason: ReadOnlyReason;
  /** True when user can submit bets/actions (inverse of isReadOnly) */
  canSubmit: boolean;
  /** Human-readable message for UI display */
  message: string;
  /** Short message for banner display */
  shortMessage: string;
  /** Underlying connection status from useWebSocketReconnect */
  connectionStatus: ReconnectStatus;
  /** True if recently transitioned into read-only mode (for animations) */
  justEnteredReadOnly: boolean;
  /** True if recently transitioned out of read-only mode (for animations) */
  justExitedReadOnly: boolean;
  /** Reconnect attempt count (for progress display) */
  reconnectAttempt: number;
  /** Max reconnect attempts (for progress display) */
  maxReconnectAttempts: number;
  /** Seconds until next reconnect attempt (null if not scheduled) */
  nextReconnectIn: number | null;
}

/**
 * Read-only mode actions returned by the hook.
 */
export interface ReadOnlyModeActions {
  /** Force immediate reconnection attempt */
  reconnect: () => void;
  /** Reset and reconnect (clears failure state) */
  resetAndReconnect: () => void;
  /** Check network status immediately */
  checkNetwork: () => Promise<void>;
}

// Transition tracking duration (ms)
const TRANSITION_DURATION_MS = 500;

/**
 * Maps connection status to read-only reason.
 */
function statusToReason(status: ReconnectStatus): ReadOnlyReason {
  switch (status) {
    case 'offline':
      return 'offline';
    case 'reconnecting':
      return 'reconnecting';
    case 'failed':
      return 'failed';
    case 'connecting':
      return 'connecting';
    case 'connected':
    case 'disconnected':
    default:
      return null;
  }
}

/**
 * Gets human-readable message for a read-only reason.
 */
function getReadOnlyMessage(reason: ReadOnlyReason): string {
  switch (reason) {
    case 'offline':
      return 'No internet connection. Viewing in read-only mode.';
    case 'reconnecting':
      return 'Connection lost. Attempting to reconnect...';
    case 'failed':
      return 'Unable to connect. Please check your connection and try again.';
    case 'connecting':
      return 'Connecting to server...';
    default:
      return '';
  }
}

/**
 * Gets short message for banner display.
 */
function getShortMessage(reason: ReadOnlyReason): string {
  switch (reason) {
    case 'offline':
      return 'Offline - Read Only';
    case 'reconnecting':
      return 'Reconnecting...';
    case 'failed':
      return 'Connection Failed';
    case 'connecting':
      return 'Connecting...';
    default:
      return '';
  }
}

/**
 * Hook for managing read-only mode based on connectivity state.
 *
 * @example
 * ```tsx
 * function BetButton() {
 *   const { state: readOnly } = useReadOnlyMode();
 *
 *   return (
 *     <>
 *       {readOnly.isReadOnly && (
 *         <ReadOnlyBanner message={readOnly.shortMessage} />
 *       )}
 *       <Button
 *         onPress={submitBet}
 *         disabled={!readOnly.canSubmit}
 *       >
 *         Place Bet
 *       </Button>
 *     </>
 *   );
 * }
 * ```
 */
export function useReadOnlyMode(): {
  state: ReadOnlyModeState;
  actions: ReadOnlyModeActions;
} {
  const { state: reconnectState, actions: reconnectActions } = useWebSocketReconnect();

  // Track transitions for animation coordination
  const [justEnteredReadOnly, setJustEnteredReadOnly] = useState(false);
  const [justExitedReadOnly, setJustExitedReadOnly] = useState(false);
  const prevReadOnlyRef = useRef<boolean | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive read-only state
  const reason = useMemo(
    () => statusToReason(reconnectState.status),
    [reconnectState.status]
  );

  const isReadOnly = reason !== null;
  const canSubmit = !isReadOnly;

  // Track transitions
  useEffect(() => {
    const wasReadOnly = prevReadOnlyRef.current;

    // Clear any pending transition timer
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    if (wasReadOnly !== null) {
      if (!wasReadOnly && isReadOnly) {
        // Just entered read-only mode
        setJustEnteredReadOnly(true);
        transitionTimerRef.current = setTimeout(() => {
          setJustEnteredReadOnly(false);
        }, TRANSITION_DURATION_MS);
      } else if (wasReadOnly && !isReadOnly) {
        // Just exited read-only mode
        setJustExitedReadOnly(true);
        transitionTimerRef.current = setTimeout(() => {
          setJustExitedReadOnly(false);
        }, TRANSITION_DURATION_MS);
      }
    }

    prevReadOnlyRef.current = isReadOnly;

    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    };
  }, [isReadOnly]);

  // Memoize actions
  const reconnect = useCallback(() => {
    reconnectActions.reconnectNow();
  }, [reconnectActions]);

  const resetAndReconnect = useCallback(() => {
    reconnectActions.resetAndReconnect();
  }, [reconnectActions]);

  const checkNetwork = useCallback(async () => {
    await reconnectActions.checkNetwork();
  }, [reconnectActions]);

  // Build state object
  const state: ReadOnlyModeState = {
    isReadOnly,
    reason,
    canSubmit,
    message: getReadOnlyMessage(reason),
    shortMessage: getShortMessage(reason),
    connectionStatus: reconnectState.status,
    justEnteredReadOnly,
    justExitedReadOnly,
    reconnectAttempt: reconnectState.reconnectAttempt,
    maxReconnectAttempts: reconnectState.maxReconnectAttempts,
    nextReconnectIn: reconnectState.nextReconnectIn,
  };

  // Build actions object
  const actions: ReadOnlyModeActions = {
    reconnect,
    resetAndReconnect,
    checkNetwork,
  };

  return { state, actions };
}

/**
 * Exported constants for testing
 */
export const READ_ONLY_MODE_CONSTANTS = {
  TRANSITION_DURATION_MS,
};
