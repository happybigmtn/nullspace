/**
 * Fixed Timestep Helpers
 *
 * Rapier uses fixed timestep physics (1/60s by default). These helpers ensure
 * consistent physics behavior regardless of frame rate.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Physics timestep in seconds (60 Hz) */
export const PHYSICS_TIMESTEP = 1 / 60;

/** Physics timestep in milliseconds */
export const PHYSICS_TIMESTEP_MS = 1000 / 60;

/** Maximum physics steps per frame (prevents spiral of death) */
export const MAX_SUBSTEPS = 4;

/** Rapier configuration for deterministic physics */
export const RAPIER_CONFIG = {
  timeStep: PHYSICS_TIMESTEP,
  updateLoop: 'independent' as const,
  maxCcdSubsteps: 4,
  numSolverIterations: 8,
  numAdditionalFrictionIterations: 4,
  numInternalPgsIterations: 1,
  predictionDistance: 0.002,
};

// ─────────────────────────────────────────────────────────────────────────────
// Accumulator Pattern
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accumulator for fixed timestep updates.
 * Handles variable frame rates while maintaining consistent physics.
 */
export class FixedTimestepAccumulator {
  private accumulator = 0;
  private lastTime = 0;
  private initialized = false;

  constructor(private readonly timestep: number = PHYSICS_TIMESTEP) {}

  /**
   * Update accumulator and return number of fixed steps to execute.
   * @param currentTime Current time in seconds (from useFrame clock)
   * @returns Number of physics steps to execute this frame
   */
  update(currentTime: number): number {
    if (!this.initialized) {
      this.lastTime = currentTime;
      this.initialized = true;
      return 0;
    }

    const frameTime = Math.min(currentTime - this.lastTime, this.timestep * MAX_SUBSTEPS);
    this.lastTime = currentTime;
    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= this.timestep && steps < MAX_SUBSTEPS) {
      this.accumulator -= this.timestep;
      steps++;
    }

    return steps;
  }

  /**
   * Get interpolation alpha for smooth rendering between physics steps.
   * Use this to interpolate visual positions.
   */
  getAlpha(): number {
    return this.accumulator / this.timestep;
  }

  /**
   * Reset accumulator (call on scene reset)
   */
  reset(): void {
    this.accumulator = 0;
    this.initialized = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation Timing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Easing functions for non-physics animations
 */
export const Easing = {
  /** Linear interpolation */
  linear: (t: number) => t,

  /** Quadratic ease out (decelerating) */
  easeOutQuad: (t: number) => t * (2 - t),

  /** Cubic ease out (smooth deceleration) */
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),

  /** Quintic ease out (very smooth) */
  easeOutQuint: (t: number) => 1 - Math.pow(1 - t, 5),

  /** Exponential ease out */
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  /** Elastic ease out (bounce at end) */
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },

  /** Bounce ease out */
  easeOutBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },

  /** Smooth step (Hermite interpolation) */
  smoothStep: (t: number) => t * t * (3 - 2 * t),

  /** Smoother step (Ken Perlin's improved version) */
  smootherStep: (t: number) => t * t * t * (t * (t * 6 - 15) + 10),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Phase Timing Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface PhaseTimingConfig {
  /** Minimum duration before phase can transition (ms) */
  minDuration: number;
  /** Maximum duration before forcing transition (ms) */
  maxDuration: number;
  /** Default duration if no other conditions trigger (ms) */
  defaultDuration: number;
}

export const PHASE_TIMING: Record<string, PhaseTimingConfig> = {
  roulette: {
    minDuration: 3000,
    maxDuration: 12000,
    defaultDuration: 6000,
  },
  craps: {
    minDuration: 1500,
    maxDuration: 6000,
    defaultDuration: 3000,
  },
  sicbo: {
    minDuration: 2000,
    maxDuration: 8000,
    defaultDuration: 4000,
  },
  blackjack: {
    minDuration: 400,
    maxDuration: 1500,
    defaultDuration: 600,
  },
  baccarat: {
    minDuration: 400,
    maxDuration: 2000,
    defaultDuration: 800,
  },
  casinowar: {
    minDuration: 400,
    maxDuration: 1500,
    defaultDuration: 700,
  },
  threecard: {
    minDuration: 500,
    maxDuration: 2000,
    defaultDuration: 900,
  },
  ultimateholdem: {
    minDuration: 500,
    maxDuration: 2500,
    defaultDuration: 1200,
  },
  hilo: {
    minDuration: 400,
    maxDuration: 1500,
    defaultDuration: 700,
  },
  videopoker: {
    minDuration: 400,
    maxDuration: 1500,
    defaultDuration: 700,
  },
};

/**
 * Get timing configuration for a game type
 */
export function getPhaseTimings(gameType: string): PhaseTimingConfig {
  return (
    PHASE_TIMING[gameType.toLowerCase()] ?? {
      minDuration: 1000,
      maxDuration: 5000,
      defaultDuration: 2000,
    }
  );
}
