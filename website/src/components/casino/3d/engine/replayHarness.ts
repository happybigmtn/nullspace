import { SeededRandom, generateRoundSeed } from './deterministicRng';

export interface ReplayHarnessResult {
  gameType: string;
  roundId: number;
  seed: number;
  sample: number[];
  fingerprint: string;
}

const hashSeed = 2166136261;
const hashPrime = 16777619;

const clampCount = (count: number) => Math.max(1, Math.min(128, Math.floor(count)));

export const buildReplaySample = (gameType: string, roundId: number, sampleCount = 12): ReplayHarnessResult => {
  const count = clampCount(sampleCount);
  const seed = generateRoundSeed(gameType, roundId);
  const rng = new SeededRandom(seed);
  const sample: number[] = [];
  let hash = hashSeed;

  for (let i = 0; i < count; i += 1) {
    const value = Math.floor(rng.next() * 1_000_000);
    sample.push(value);
    hash ^= value;
    hash = Math.imul(hash, hashPrime);
  }

  return {
    gameType,
    roundId,
    seed,
    sample,
    fingerprint: (hash >>> 0).toString(16).padStart(8, '0'),
  };
};

export const buildReplayFingerprint = (gameType: string, roundId: number, sampleCount = 32) =>
  buildReplaySample(gameType, roundId, sampleCount).fingerprint;
