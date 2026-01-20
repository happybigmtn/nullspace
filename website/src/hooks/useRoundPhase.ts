import { useEffect, useState, useRef, useCallback } from 'react';
import type { CasinoClient } from '../api/client';

/**
 * Round phase constants matching gateway GlobalTableRound.phase
 * @see gateway/src/codec/events.ts GlobalTableRound interface
 */
export const ROUND_PHASE = {
  BETTING: 0,
  LOCKED: 1,
  REVEALING: 2,
  SETTLING: 3,
  FINALIZED: 4,
} as const;

export type RoundPhaseValue = (typeof ROUND_PHASE)[keyof typeof ROUND_PHASE];

export type RoundPhaseLabel = 'BETTING' | 'LOCKED' | 'REVEALING' | 'SETTLING' | 'FINALIZED' | 'IDLE';

export interface RoundPhaseState {
  /** Current round ID */
  roundId: bigint | null;
  /** Numeric phase value (0-4) */
  phase: RoundPhaseValue | null;
  /** Human-readable phase label */
  phaseLabel: RoundPhaseLabel;
  /** Server timestamp (ms) when the current phase ends */
  phaseEndsAtMs: number | null;
  /** Countdown in milliseconds until phase ends */
  countdownMs: number;
  /** Whether the round is in a betting-open state */
  canBet: boolean;
  /** Whether we have received any round data */
  hasRoundData: boolean;
}

const initialState: RoundPhaseState = {
  roundId: null,
  phase: null,
  phaseLabel: 'IDLE',
  phaseEndsAtMs: null,
  countdownMs: 0,
  canBet: false,
  hasRoundData: false,
};

/**
 * Convert numeric phase to human-readable label
 */
export function getPhaseLabel(phase: number | null): RoundPhaseLabel {
  switch (phase) {
    case ROUND_PHASE.BETTING:
      return 'BETTING';
    case ROUND_PHASE.LOCKED:
      return 'LOCKED';
    case ROUND_PHASE.REVEALING:
      return 'REVEALING';
    case ROUND_PHASE.SETTLING:
      return 'SETTLING';
    case ROUND_PHASE.FINALIZED:
      return 'FINALIZED';
    default:
      return 'IDLE';
  }
}

/**
 * Format milliseconds into a countdown string (e.g., "1:30" or "0:05")
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Calculate server time offset for accurate countdown synchronization.
 * Uses the Date header from HTTP responses to estimate server time.
 */
function calculateServerTimeOffset(serverTimestamp: number): number {
  const clientTime = Date.now();
  // Positive offset means server is ahead of client
  return serverTimestamp - clientTime;
}

interface UseRoundPhaseOptions {
  /** Casino client instance to subscribe to events */
  client: CasinoClient | null;
  /** Server time offset in ms (positive = server ahead) */
  serverTimeOffsetMs?: number;
  /** Countdown update interval in ms (default: 100 for smooth updates) */
  updateIntervalMs?: number;
}

/**
 * Hook to track round phase from gateway events with server-synchronized countdown.
 *
 * Subscribes to:
 * - `round_opened`: New round started, betting is open
 * - `locked`: Betting closed, revealing starting
 * - `outcome`: Outcome revealed, settling
 * - `finalized`: Round complete
 *
 * AC-PQ.1: Countdown matches server phase within 250ms
 *
 * @example
 * ```tsx
 * const { phaseLabel, countdownMs, canBet } = useRoundPhase({ client });
 * ```
 */
export function useRoundPhase({
  client,
  serverTimeOffsetMs = 0,
  updateIntervalMs = 100,
}: UseRoundPhaseOptions): RoundPhaseState {
  const [state, setState] = useState<RoundPhaseState>(initialState);
  const phaseEndsAtRef = useRef<number | null>(null);
  const serverOffsetRef = useRef<number>(serverTimeOffsetMs);

  // Update server offset ref when prop changes
  useEffect(() => {
    serverOffsetRef.current = serverTimeOffsetMs;
  }, [serverTimeOffsetMs]);

  // Handle round_opened event
  const handleRoundOpened = useCallback((event: any) => {
    const round = event?.round;
    if (!round) return;

    const phaseEndsAtMs = Number(round.phaseEndsAtMs);
    phaseEndsAtRef.current = phaseEndsAtMs;

    setState({
      roundId: round.roundId,
      phase: round.phase as RoundPhaseValue,
      phaseLabel: getPhaseLabel(round.phase),
      phaseEndsAtMs,
      countdownMs: Math.max(0, phaseEndsAtMs - Date.now() - serverOffsetRef.current),
      canBet: round.phase === ROUND_PHASE.BETTING,
      hasRoundData: true,
    });
  }, []);

  // Handle locked event
  const handleLocked = useCallback((event: any) => {
    const phaseEndsAtMs = Number(event?.phaseEndsAtMs ?? 0);
    phaseEndsAtRef.current = phaseEndsAtMs;

    setState((prev) => ({
      ...prev,
      roundId: event?.roundId ?? prev.roundId,
      phase: ROUND_PHASE.LOCKED,
      phaseLabel: 'LOCKED',
      phaseEndsAtMs,
      countdownMs: Math.max(0, phaseEndsAtMs - Date.now() - serverOffsetRef.current),
      canBet: false,
      hasRoundData: true,
    }));
  }, []);

  // Handle outcome event
  const handleOutcome = useCallback((event: any) => {
    const round = event?.round;
    if (!round) return;

    const phaseEndsAtMs = Number(round.phaseEndsAtMs);
    phaseEndsAtRef.current = phaseEndsAtMs;

    setState((prev) => ({
      ...prev,
      roundId: round.roundId,
      phase: round.phase as RoundPhaseValue,
      phaseLabel: getPhaseLabel(round.phase),
      phaseEndsAtMs,
      countdownMs: Math.max(0, phaseEndsAtMs - Date.now() - serverOffsetRef.current),
      canBet: false,
      hasRoundData: true,
    }));
  }, []);

  // Handle finalized event
  const handleFinalized = useCallback((event: any) => {
    phaseEndsAtRef.current = null;

    setState((prev) => ({
      ...prev,
      roundId: event?.roundId ?? prev.roundId,
      phase: ROUND_PHASE.FINALIZED,
      phaseLabel: 'FINALIZED',
      phaseEndsAtMs: null,
      countdownMs: 0,
      canBet: false,
      hasRoundData: true,
    }));
  }, []);

  // Subscribe to client events
  useEffect(() => {
    if (!client?.onEvent) return;

    const unsubRoundOpened = client.onEvent('round_opened', handleRoundOpened);
    const unsubLocked = client.onEvent('locked', handleLocked);
    const unsubOutcome = client.onEvent('outcome', handleOutcome);
    const unsubFinalized = client.onEvent('finalized', handleFinalized);

    return () => {
      unsubRoundOpened?.();
      unsubLocked?.();
      unsubOutcome?.();
      unsubFinalized?.();
    };
  }, [client, handleRoundOpened, handleLocked, handleOutcome, handleFinalized]);

  // Countdown timer - updates at high frequency for smooth display
  // AC-PQ.1: Must be within 250ms of server phase
  useEffect(() => {
    const interval = setInterval(() => {
      const phaseEndsAt = phaseEndsAtRef.current;
      if (phaseEndsAt === null) {
        setState((prev) => (prev.countdownMs !== 0 ? { ...prev, countdownMs: 0 } : prev));
        return;
      }

      // Account for server time offset for accurate sync
      const adjustedNow = Date.now() + serverOffsetRef.current;
      const remaining = Math.max(0, phaseEndsAt - adjustedNow);

      setState((prev) => {
        // Only update if countdown changed significantly (avoid unnecessary renders)
        if (Math.abs(prev.countdownMs - remaining) < updateIntervalMs / 2) {
          return prev;
        }
        return { ...prev, countdownMs: remaining };
      });
    }, updateIntervalMs);

    return () => clearInterval(interval);
  }, [updateIntervalMs]);

  return state;
}

/**
 * Hook to calculate server time offset from clock sync messages.
 * Uses gateway ClockSync messages to maintain accurate time sync.
 */
export function useServerTimeSync(client: CasinoClient | null): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!client?.onEvent) return;

    const handleClockSync = (event: any) => {
      if (event?.serverTimestamp) {
        const newOffset = calculateServerTimeOffset(Number(event.serverTimestamp));
        setOffset(newOffset);
      }
    };

    const unsub = client.onEvent('clock_sync', handleClockSync);
    return () => unsub?.();
  }, [client]);

  return offset;
}
