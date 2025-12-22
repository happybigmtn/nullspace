import { Vector3 } from 'three';
import { ROULETTE_GEOMETRY } from './guidedForces';
import type { SeededRandom } from '../engine/deterministicRng';

const TWO_PI = Math.PI * 2;

export interface RoulettePocket {
  number: number;
  angle: number;
  position: Vector3;
}

export interface RouletteLaunchParams {
  durationMs: number;
  wheelSpeed: number;
  ballSpeed: number;
  wheelDirection: 1 | -1;
  ballDirection: 1 | -1;
  extraWheelRevs: number;
  extraBallRevs: number;
}

export interface RouletteLaunchConfig {
  baseDurationMs?: number;
  durationJitterMs?: number;
  wheelSpeedBase?: number;
  wheelSpeedJitter?: number;
  ballSpeedBase?: number;
  ballSpeedJitter?: number;
  extraWheelRevsMin?: number;
  extraWheelRevsJitter?: number;
  extraBallRevsMin?: number;
  extraBallRevsJitter?: number;
}

export function getPocketAngle(index: number, pocketCount: number): number {
  return (index / pocketCount) * TWO_PI;
}

export function getPocketPosition(
  angle: number,
  radius: number,
  y: number
): Vector3 {
  return new Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
}

export function buildRoulettePockets(
  numbers: number[],
  radius: number = ROULETTE_GEOMETRY.ROTOR_RADIUS,
  y: number = ROULETTE_GEOMETRY.FRET_HEIGHT
): RoulettePocket[] {
  const pocketCount = numbers.length;
  return numbers.map((num, index) => {
    const angle = getPocketAngle(index, pocketCount);
    return {
      number: num,
      angle,
      position: getPocketPosition(angle, radius, y),
    };
  });
}

export function computeRouletteLaunch(
  rng: SeededRandom,
  config: RouletteLaunchConfig = {}
): RouletteLaunchParams {
  const {
    baseDurationMs = 3800,
    durationJitterMs = 800,
    wheelSpeedBase = 3.2,
    wheelSpeedJitter = 1.2,
    ballSpeedBase = 6.4,
    ballSpeedJitter = 1.6,
    extraWheelRevsMin = 2,
    extraWheelRevsJitter = 1,
    extraBallRevsMin = 3,
    extraBallRevsJitter = 1,
  } = config;

  const wheelDirection: 1 | -1 = 1;
  const ballDirection: 1 | -1 = -1;

  return {
    durationMs: baseDurationMs + rng.range(0, durationJitterMs),
    wheelSpeed: (wheelSpeedBase + rng.range(0, wheelSpeedJitter)) * wheelDirection,
    ballSpeed: (ballSpeedBase + rng.range(0, ballSpeedJitter)) * ballDirection,
    wheelDirection,
    ballDirection,
    extraWheelRevs: extraWheelRevsMin + rng.int(0, extraWheelRevsJitter),
    extraBallRevs: extraBallRevsMin + rng.int(0, extraBallRevsJitter),
  };
}
