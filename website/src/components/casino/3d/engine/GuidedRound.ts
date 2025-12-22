/**
 * GuidedRound - Core types for guided physics animations
 *
 * The chain is the single source of truth. These types model the round lifecycle
 * where physics appears chaotic but must converge to chain-determined outcomes.
 */

import type { Vector3 } from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Round Phases
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Round phases model the lifecycle of a guided physics animation:
 * - idle: Waiting for user action or chain event
 * - launch: Initial chaotic motion (throw, spin, deal)
 * - decay: Free physics with collisions and natural deceleration
 * - settle: Guided convergence to chain outcome (attractors active)
 * - reveal: Final state, waiting for next round
 */
export type RoundPhase = 'idle' | 'launch' | 'decay' | 'settle' | 'reveal';

// ─────────────────────────────────────────────────────────────────────────────
// Game-Specific Outcomes
// ─────────────────────────────────────────────────────────────────────────────

export interface RouletteOutcome {
  number: number;
  color: 'red' | 'black' | 'green';
}

export interface CrapsOutcome {
  die1: number;
  die2: number;
  total: number;
}

export interface SicBoOutcome {
  dice: [number, number, number];
  total: number;
}

export interface CardOutcome {
  rank: string;
  suit: string;
}

export interface BlackjackOutcome {
  card: CardOutcome;
  handType: 'player' | 'dealer';
  handIndex: number;
}

export interface BaccaratOutcome {
  card: CardOutcome;
  handType: 'player' | 'banker';
  cardIndex: number;
}

export interface CardRevealOutcome {
  card: CardOutcome;
  slotId: string;
}

export type CasinoWarOutcome = CardRevealOutcome;
export type ThreeCardOutcome = CardRevealOutcome;
export type UltimateHoldemOutcome = CardRevealOutcome;
export type HiLoOutcome = CardRevealOutcome;
export type VideoPokerOutcome = CardRevealOutcome;

// Union type for all outcomes
export type GameOutcome =
  | RouletteOutcome
  | CrapsOutcome
  | SicBoOutcome
  | BlackjackOutcome
  | BaccaratOutcome
  | CasinoWarOutcome
  | ThreeCardOutcome
  | UltimateHoldemOutcome
  | HiLoOutcome
  | VideoPokerOutcome;

// ─────────────────────────────────────────────────────────────────────────────
// Guided Round State
// ─────────────────────────────────────────────────────────────────────────────

export interface GuidedRound<TOutcome> {
  /** Unique identifier derived from chain state (e.g., history length) */
  roundId: number;

  /** Current phase of the animation lifecycle */
  phase: RoundPhase;

  /** Deterministic seed derived from roundId for reproducible randomness */
  seed: number;

  /** Timestamp when round started (ms since epoch) */
  startTime: number;

  /** Timestamp when current phase started (ms since epoch) */
  phaseStartTime: number;

  /** Initial impulse vector for launch phase (game-specific) */
  launchImpulse?: Vector3;

  /** Chain-provided outcome to guide physics toward (set when chain confirms) */
  targetOutcome?: TOutcome;

  /** Outcome received while still animating (held until min animation time) */
  pendingOutcome?: TOutcome;

  /** Final settled outcome (should match targetOutcome) */
  actualOutcome?: TOutcome;

  /** Minimum animation time before settling (ms) - prevents jarring snaps */
  minAnimationDuration: number;

  /** Maximum animation time before forcing settle (ms) - safety net */
  maxAnimationDuration: number;

  /** True while animation blocks UI interactions */
  isAnimationBlocking: boolean;

  /** User requested skip - collapse animation while respecting chain */
  skipRequested: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

export function createIdleRound<T>(roundId: number, seed: number): GuidedRound<T> {
  const now = Date.now();
  return {
    roundId,
    phase: 'idle',
    seed,
    startTime: now,
    phaseStartTime: now,
    minAnimationDuration: 2000,
    maxAnimationDuration: 8000,
    isAnimationBlocking: false,
    skipRequested: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Round ID Derivation (per game type)
// ─────────────────────────────────────────────────────────────────────────────

export function deriveRouletteRoundId(historyLength: number): number {
  return historyLength;
}

export function deriveCrapsRoundId(rollHistoryLength: number): number {
  return rollHistoryLength;
}

export function deriveSicBoRoundId(historyLength: number): number {
  return historyLength;
}

export function deriveBlackjackRoundId(sessionId: number, moveNumber: number): number {
  return sessionId * 1000 + moveNumber;
}

export function deriveBaccaratRoundId(sessionId: number, cardNumber: number): number {
  return sessionId * 1000 + cardNumber;
}

export function deriveSessionRoundId(sessionId: number, moveNumber: number): number {
  return sessionId * 1000 + moveNumber;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase Transition Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function shouldTransitionToSettle<T>(round: GuidedRound<T>): boolean {
  const now = Date.now();
  const elapsed = now - round.startTime;

  // Must have a target outcome to settle toward
  if (!round.targetOutcome && !round.pendingOutcome) return false;

  // Skip requested - immediate transition
  if (round.skipRequested) return true;

  // Minimum animation time elapsed
  if (elapsed >= round.minAnimationDuration) return true;

  // Maximum time exceeded - force settle
  if (elapsed >= round.maxAnimationDuration) return true;

  return false;
}

export function transitionPhase<T>(
  round: GuidedRound<T>,
  newPhase: RoundPhase
): GuidedRound<T> {
  return {
    ...round,
    phase: newPhase,
    phaseStartTime: Date.now(),
    // Promote pending outcome when entering settle
    targetOutcome:
      newPhase === 'settle' && round.pendingOutcome
        ? round.pendingOutcome
        : round.targetOutcome,
  };
}
