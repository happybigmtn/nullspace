/**
 * Guided Physics Engine - Core infrastructure exports
 */

// Round state and types
export {
  type RoundPhase,
  type RouletteOutcome,
  type CrapsOutcome,
  type SicBoOutcome,
  type CardOutcome,
  type BlackjackOutcome,
  type BaccaratOutcome,
  type GameOutcome,
  type GuidedRound,
  createIdleRound,
  deriveRouletteRoundId,
  deriveCrapsRoundId,
  deriveSicBoRoundId,
  deriveBlackjackRoundId,
  deriveBaccaratRoundId,
  shouldTransitionToSettle,
  transitionPhase,
} from './GuidedRound';

// Deterministic RNG
export {
  SeededRandom,
  generateRoundSeed,
  createRoundRng,
  getRoundRng,
  clearRngCache,
} from './deterministicRng';

// Deterministic replay harness
export {
  buildReplaySample,
  buildReplayFingerprint,
  type ReplayHarnessResult,
} from './replayHarness';

// Time stepping
export {
  PHYSICS_TIMESTEP,
  PHYSICS_TIMESTEP_MS,
  MAX_SUBSTEPS,
  RAPIER_CONFIG,
  FixedTimestepAccumulator,
  Easing,
  type PhaseTimingConfig,
  PHASE_TIMING,
  getPhaseTimings,
} from './timeStep';

// Zustand store
export {
  useGuidedStore,
  useRouletteRound,
  useCrapsRound,
  useSicBoRound,
  useBlackjackRound,
  useBaccaratRound,
  useTransientRound,
  useTransientSubscription,
  type GuidedStoreState,
  type GuidedStoreActions,
  type GuidedStore,
} from './GuidedStore';
