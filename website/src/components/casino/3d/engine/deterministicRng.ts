/**
 * Deterministic RNG - Mulberry32 PRNG for reproducible randomness
 *
 * All visual randomness (launch angles, noise offsets, particle variations)
 * derives from chain-provided roundId to ensure identical replays across clients.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mulberry32 PRNG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mulberry32 is a fast, high-quality 32-bit PRNG with good statistical properties.
 * Period: 2^32, passes BigCrush and PractRand tests.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // Ensure unsigned 32-bit integer
    this.state = seed >>> 0;
    // Warm up the generator (skip first few values for better distribution)
    for (let i = 0; i < 3; i++) this.next();
  }

  /**
   * Generate next random number in [0, 1)
   */
  next(): number {
    let z = (this.state += 0x6d2b79f5);
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Random float in [min, max)
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Random integer in [min, max] (inclusive)
   */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Random boolean with given probability of true
   */
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /**
   * Pick random element from array
   */
  pick<T>(array: T[]): T {
    return array[this.int(0, array.length - 1)];
  }

  /**
   * Shuffle array in place (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Normal distribution using Box-Muller transform
   * Returns value with mean 0 and stddev 1
   */
  gaussian(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Normal distribution with specified mean and stddev
   */
  normal(mean: number, stddev: number): number {
    return mean + this.gaussian() * stddev;
  }

  /**
   * Get current state (for debugging/serialization)
   */
  getState(): number {
    return this.state;
  }

  /**
   * Clone with current state
   */
  clone(): SeededRandom {
    const clone = new SeededRandom(0);
    clone.state = this.state;
    return clone;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed Generation
// ─────────────────────────────────────────────────────────────────────────────

/** Game type hashes for seed isolation */
const GAME_HASHES: Record<string, number> = {
  roulette: 0x1234,
  craps: 0x5678,
  sicbo: 0x9abc,
  blackjack: 0xdef0,
  baccarat: 0x1357,
  casinowar: 0x1a2b,
  hilo: 0x2468,
  videopoker: 0x3579,
  threecard: 0x3b6c,
  threecardpoker: 0x468a,
  ultimateholdem: 0x579b,
};

/**
 * Generate deterministic seed from game type and round ID.
 * Combines game hash (16 bits) with round ID (16 bits) for unique seeds.
 */
export function generateRoundSeed(gameType: string, roundId: number): number {
  const gameHash = GAME_HASHES[gameType.toLowerCase()] ?? 0xffff;
  return ((gameHash << 16) | (roundId & 0xffff)) >>> 0;
}

/**
 * Create a SeededRandom instance for a specific game round
 */
export function createRoundRng(gameType: string, roundId: number): SeededRandom {
  return new SeededRandom(generateRoundSeed(gameType, roundId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions (for use without class instantiation)
// ─────────────────────────────────────────────────────────────────────────────

/** Cache for round-scoped RNG instances */
const rngCache = new Map<string, SeededRandom>();

/**
 * Get or create RNG for a game round (cached per round)
 */
export function getRoundRng(gameType: string, roundId: number): SeededRandom {
  const key = `${gameType}:${roundId}`;
  let rng = rngCache.get(key);
  if (!rng) {
    rng = createRoundRng(gameType, roundId);
    rngCache.set(key, rng);
    // Limit cache size to prevent memory leaks
    if (rngCache.size > 100) {
      const firstKey = rngCache.keys().next().value;
      if (firstKey) rngCache.delete(firstKey);
    }
  }
  return rng;
}

/**
 * Clear RNG cache (call when game session ends)
 */
export function clearRngCache(): void {
  rngCache.clear();
}
