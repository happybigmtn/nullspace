import { describe, it, expect } from 'vitest';
import { buildReplayFingerprint } from '../engine/replayHarness';

describe('deterministic replay harness', () => {
  it('returns stable fingerprints for the same inputs', () => {
    const first = buildReplayFingerprint('roulette', 42, 16);
    const second = buildReplayFingerprint('roulette', 42, 16);
    expect(first).toBe(second);
  });

  it('changes fingerprints when the round id changes', () => {
    const first = buildReplayFingerprint('roulette', 42, 16);
    const second = buildReplayFingerprint('roulette', 43, 16);
    expect(first).not.toBe(second);
  });
});
