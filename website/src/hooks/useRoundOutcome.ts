import { useEffect, useState, useCallback, useRef } from 'react';
import type { CasinoClient } from '../api/client';

/**
 * Bet type constants for craps (matches execution crate)
 * @see execution/src/craps/bet_types.rs
 */
export const BET_TYPES = {
  PASS_LINE: 0,
  DONT_PASS: 1,
  COME: 2,
  DONT_COME: 3,
  FIELD: 4,
  PLACE_4: 5,
  PLACE_5: 6,
  PLACE_6: 7,
  PLACE_8: 8,
  PLACE_9: 9,
  PLACE_10: 10,
  BIG_6: 11,
  BIG_8: 12,
  HARDWAY_4: 13,
  HARDWAY_6: 14,
  HARDWAY_8: 15,
  HARDWAY_10: 16,
  ANY_CRAPS: 17,
  ANY_SEVEN: 18,
  HOP: 19,
  HORN: 20,
  CE: 21,
} as const;

/**
 * Human-readable bet type labels
 */
export const BET_TYPE_LABELS: Record<number, string> = {
  [BET_TYPES.PASS_LINE]: 'Pass Line',
  [BET_TYPES.DONT_PASS]: "Don't Pass",
  [BET_TYPES.COME]: 'Come',
  [BET_TYPES.DONT_COME]: "Don't Come",
  [BET_TYPES.FIELD]: 'Field',
  [BET_TYPES.PLACE_4]: 'Place 4',
  [BET_TYPES.PLACE_5]: 'Place 5',
  [BET_TYPES.PLACE_6]: 'Place 6',
  [BET_TYPES.PLACE_8]: 'Place 8',
  [BET_TYPES.PLACE_9]: 'Place 9',
  [BET_TYPES.PLACE_10]: 'Place 10',
  [BET_TYPES.BIG_6]: 'Big 6',
  [BET_TYPES.BIG_8]: 'Big 8',
  [BET_TYPES.HARDWAY_4]: 'Hard 4',
  [BET_TYPES.HARDWAY_6]: 'Hard 6',
  [BET_TYPES.HARDWAY_8]: 'Hard 8',
  [BET_TYPES.HARDWAY_10]: 'Hard 10',
  [BET_TYPES.ANY_CRAPS]: 'Any Craps',
  [BET_TYPES.ANY_SEVEN]: 'Any Seven',
  [BET_TYPES.HOP]: 'Hop',
  [BET_TYPES.HORN]: 'Horn',
  [BET_TYPES.CE]: 'C & E',
};

/**
 * Get human-readable label for a bet type
 */
export function getBetTypeLabel(betType: number): string {
  return BET_TYPE_LABELS[betType] ?? `Bet ${betType}`;
}

/**
 * Single bet from a round
 */
export interface RoundBet {
  betType: number;
  target: number;
  amount: bigint;
}

/**
 * Aggregated total for a bet type across all players
 */
export interface RoundTotal {
  betType: number;
  target: number;
  amount: bigint;
}

/**
 * Player settlement result
 */
export interface PlayerSettlement {
  /** Player's public key */
  player: Uint8Array;
  /** Round this settlement is for */
  roundId: bigint;
  /** Net payout amount (positive = win, negative = loss, 0 = push) */
  payout: bigint;
  /** Updated balance after settlement */
  balanceSnapshot?: {
    chips: bigint;
    vusdt: bigint;
    rng: bigint;
  };
  /** Bets that were settled */
  myBets: RoundBet[];
}

/**
 * Round outcome information
 */
export interface RoundOutcome {
  /** Round ID */
  roundId: bigint;
  /** Game type identifier */
  gameType: number;
  /** Dice result (d1 + d2) */
  d1: number;
  d2: number;
  /** Total of dice */
  diceTotal: number;
  /** Main point (0 if not established) */
  mainPoint: number;
  /** Whether a point was established this epoch */
  epochPointEstablished: boolean;
  /** Aggregated totals per bet type */
  totals: RoundTotal[];
  /** RNG commit hash */
  rngCommit: Uint8Array;
  /** Roll seed used to generate outcome */
  rollSeed: Uint8Array;
  /** Timestamp when this outcome was received */
  receivedAt: number;
}

/**
 * State returned by useRoundOutcome hook
 */
export interface RoundOutcomeState {
  /** Latest round outcome (null if no outcome received yet) */
  outcome: RoundOutcome | null;
  /** Player's settlement for the current round (null if not yet settled) */
  settlement: PlayerSettlement | null;
  /** Settlement result type for display */
  settlementResult: 'win' | 'loss' | 'push' | null;
  /** Whether player has pending bets waiting for settlement */
  hasPendingSettlement: boolean;
  /** Net payout amount for display (converted to number) */
  payoutAmount: number;
  /** Total amount bet in the round (converted to number) */
  totalBetAmount: number;
  /** History of recent outcomes (for display) */
  recentOutcomes: RoundOutcome[];
  /** Whether we have received any outcome data */
  hasOutcomeData: boolean;
}

const initialState: RoundOutcomeState = {
  outcome: null,
  settlement: null,
  settlementResult: null,
  hasPendingSettlement: false,
  payoutAmount: 0,
  totalBetAmount: 0,
  recentOutcomes: [],
  hasOutcomeData: false,
};

interface UseRoundOutcomeOptions {
  /** Casino client instance to subscribe to events */
  client: CasinoClient | null;
  /** Player's public key for filtering settlements */
  playerPublicKey?: Uint8Array;
  /** Maximum number of recent outcomes to keep in history */
  maxRecentOutcomes?: number;
  /** Token decimal conversion factor (default: 1e6 for microunits) */
  tokenDecimals?: number;
}

/**
 * Compare two Uint8Arrays for equality
 */
function arePublicKeysEqual(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Hook to track round outcomes and player settlements from gateway events.
 *
 * Subscribes to:
 * - `outcome`: Round outcome revealed (dice, totals, RNG data)
 * - `player_settled`: Individual player payout after settlement
 * - `bet_accepted`: Track bets to know if we have pending settlements
 *
 * AC-5.4: Real-time updates display round outcomes and totals without manual refresh.
 *
 * @example
 * ```tsx
 * const { outcome, settlement, payoutAmount, settlementResult } = useRoundOutcome({
 *   client,
 *   playerPublicKey: keypair?.publicKey,
 * });
 *
 * // Show outcome when received
 * if (outcome) {
 *   console.log(`Dice: ${outcome.d1} + ${outcome.d2} = ${outcome.diceTotal}`);
 * }
 *
 * // Show settlement result
 * if (settlement) {
 *   console.log(`${settlementResult}: ${payoutAmount > 0 ? '+' : ''}${payoutAmount}`);
 * }
 * ```
 */
export function useRoundOutcome({
  client,
  playerPublicKey,
  maxRecentOutcomes = 10,
  tokenDecimals = 1e6,
}: UseRoundOutcomeOptions): RoundOutcomeState {
  const [state, setState] = useState<RoundOutcomeState>(initialState);
  const playerKeyRef = useRef<Uint8Array | undefined>(playerPublicKey);
  const pendingBetsRef = useRef<Map<string, RoundBet[]>>(new Map());

  // Update player key ref when prop changes
  useEffect(() => {
    playerKeyRef.current = playerPublicKey;
  }, [playerPublicKey]);

  // Handle outcome event
  const handleOutcome = useCallback(
    (event: any) => {
      const round = event?.round;
      if (!round) return;

      const outcome: RoundOutcome = {
        roundId: round.roundId,
        gameType: round.gameType,
        d1: round.d1,
        d2: round.d2,
        diceTotal: round.d1 + round.d2,
        mainPoint: round.mainPoint,
        epochPointEstablished: round.epochPointEstablished,
        totals: (round.totals ?? []).map((t: any) => ({
          betType: t.betType,
          target: t.target,
          amount: t.amount,
        })),
        rngCommit: round.rngCommit,
        rollSeed: round.rollSeed,
        receivedAt: Date.now(),
      };

      setState((prev) => {
        // Check if player has pending bets for this round
        const roundKey = round.roundId.toString();
        const hasPendingSettlement = pendingBetsRef.current.has(roundKey);

        // Calculate total bet amount for this round
        let totalBetAmount = 0;
        const pendingBets = pendingBetsRef.current.get(roundKey);
        if (pendingBets) {
          totalBetAmount = pendingBets.reduce(
            (sum, bet) => sum + Number(bet.amount) / tokenDecimals,
            0
          );
        }

        // Add to recent outcomes (keep limited history)
        const recentOutcomes = [outcome, ...prev.recentOutcomes].slice(0, maxRecentOutcomes);

        return {
          ...prev,
          outcome,
          hasPendingSettlement,
          totalBetAmount,
          recentOutcomes,
          hasOutcomeData: true,
          // Clear settlement when new outcome arrives (will be set by player_settled)
          settlement: null,
          settlementResult: null,
          payoutAmount: 0,
        };
      });
    },
    [maxRecentOutcomes, tokenDecimals]
  );

  // Handle player_settled event
  const handlePlayerSettled = useCallback(
    (event: any) => {
      // Only process settlements for the current player
      if (!arePublicKeysEqual(event?.player, playerKeyRef.current)) {
        return;
      }

      const settlement: PlayerSettlement = {
        player: event.player,
        roundId: event.roundId,
        payout: event.payout,
        balanceSnapshot: event.balanceSnapshot,
        myBets: (event.myBets ?? []).map((b: any) => ({
          betType: b.betType,
          target: b.target,
          amount: b.amount,
        })),
      };

      // Determine settlement result
      const payoutNum = Number(event.payout);
      let settlementResult: 'win' | 'loss' | 'push';
      if (payoutNum > 0) {
        settlementResult = 'win';
      } else if (payoutNum < 0) {
        settlementResult = 'loss';
      } else {
        settlementResult = 'push';
      }

      // Clear pending bets for this round
      const roundKey = event.roundId.toString();
      pendingBetsRef.current.delete(roundKey);

      setState((prev) => ({
        ...prev,
        settlement,
        settlementResult,
        payoutAmount: payoutNum / tokenDecimals,
        hasPendingSettlement: false,
      }));
    },
    [tokenDecimals]
  );

  // Handle bet_accepted event to track pending bets
  const handleBetAccepted = useCallback(
    (event: any) => {
      // Only track bets for the current player
      if (!arePublicKeysEqual(event?.player, playerKeyRef.current)) {
        return;
      }

      const roundKey = event.roundId?.toString();
      if (!roundKey) return;

      const bets: RoundBet[] = (event.bets ?? []).map((b: any) => ({
        betType: b.betType,
        target: b.target,
        amount: b.amount,
      }));

      // Add to pending bets
      const existing = pendingBetsRef.current.get(roundKey) ?? [];
      pendingBetsRef.current.set(roundKey, [...existing, ...bets]);

      setState((prev) => ({
        ...prev,
        hasPendingSettlement: true,
      }));
    },
    []
  );

  // Handle finalized event to clean up any stale state
  const handleFinalized = useCallback((event: any) => {
    const roundKey = event?.roundId?.toString();
    if (roundKey) {
      pendingBetsRef.current.delete(roundKey);
    }
  }, []);

  // Subscribe to client events
  useEffect(() => {
    if (!client?.onEvent) return;

    const unsubOutcome = client.onEvent('outcome', handleOutcome);
    const unsubPlayerSettled = client.onEvent('player_settled', handlePlayerSettled);
    const unsubBetAccepted = client.onEvent('bet_accepted', handleBetAccepted);
    const unsubFinalized = client.onEvent('finalized', handleFinalized);

    return () => {
      unsubOutcome?.();
      unsubPlayerSettled?.();
      unsubBetAccepted?.();
      unsubFinalized?.();
    };
  }, [client, handleOutcome, handlePlayerSettled, handleBetAccepted, handleFinalized]);

  return state;
}

/**
 * Calculate total amount wagered from totals array
 */
export function calculateTotalWagered(totals: RoundTotal[]): bigint {
  return totals.reduce((sum, t) => sum + t.amount, 0n);
}

/**
 * Format a bigint amount to display string with decimals
 */
export function formatAmount(amount: bigint, decimals: number = 6): string {
  const factor = 10 ** decimals;
  const num = Number(amount) / factor;
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Get the largest totals for display (top N by amount)
 */
export function getTopTotals(totals: RoundTotal[], limit: number = 5): RoundTotal[] {
  return [...totals].sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, limit);
}

export default useRoundOutcome;
