import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../engine/deterministicRng';
import {
  buildRoulettePockets,
  computeRouletteLaunch,
  getPocketAngle,
} from './RoulettePhysics';

describe('RoulettePhysics', () => {
  it('computes pocket angles based on index', () => {
    const angle = getPocketAngle(1, 4);
    expect(angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('builds pocket positions with expected radius and height', () => {
    const pockets = buildRoulettePockets([0, 1, 2, 3], 2, 0.5);
    expect(pockets).toHaveLength(4);
    const radial = Math.sqrt(
      pockets[0].position.x * pockets[0].position.x +
        pockets[0].position.z * pockets[0].position.z
    );
    expect(radial).toBeCloseTo(2, 6);
    expect(pockets[0].position.y).toBeCloseTo(0.5, 6);
  });

  it('computes deterministic launch params for fixed config', () => {
    const rng = new SeededRandom(123);
    const launch = computeRouletteLaunch(rng, {
      baseDurationMs: 4000,
      durationJitterMs: 0,
      wheelSpeedBase: 3.5,
      wheelSpeedJitter: 0,
      ballSpeedBase: 6.2,
      ballSpeedJitter: 0,
      extraWheelRevsMin: 2,
      extraWheelRevsJitter: 0,
      extraBallRevsMin: 3,
      extraBallRevsJitter: 0,
    });

    expect(launch.durationMs).toBe(4000);
    expect(launch.wheelSpeed).toBe(3.5);
    expect(launch.ballSpeed).toBe(-6.2);
    expect(launch.extraWheelRevs).toBe(2);
    expect(launch.extraBallRevs).toBe(3);
  });

  it('keeps launch params within configured ranges', () => {
    const rng = new SeededRandom(999);
    const launch = computeRouletteLaunch(rng, {
      baseDurationMs: 3000,
      durationJitterMs: 1000,
      wheelSpeedBase: 2.5,
      wheelSpeedJitter: 1.0,
      ballSpeedBase: 5.5,
      ballSpeedJitter: 2.0,
      extraWheelRevsMin: 2,
      extraWheelRevsJitter: 2,
      extraBallRevsMin: 3,
      extraBallRevsJitter: 2,
    });

    expect(launch.durationMs).toBeGreaterThanOrEqual(3000);
    expect(launch.durationMs).toBeLessThanOrEqual(4000);
    expect(Math.abs(launch.wheelSpeed)).toBeGreaterThanOrEqual(2.5);
    expect(Math.abs(launch.wheelSpeed)).toBeLessThanOrEqual(3.5);
    expect(Math.abs(launch.ballSpeed)).toBeGreaterThanOrEqual(5.5);
    expect(Math.abs(launch.ballSpeed)).toBeLessThanOrEqual(7.5);
    expect(launch.extraWheelRevs).toBeGreaterThanOrEqual(2);
    expect(launch.extraWheelRevs).toBeLessThanOrEqual(4);
    expect(launch.extraBallRevs).toBeGreaterThanOrEqual(3);
    expect(launch.extraBallRevs).toBeLessThanOrEqual(5);
  });
});
