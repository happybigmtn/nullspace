import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  calculateAlignmentTorque,
  calculateAttractorForce,
  type AttractorConfig,
  type GuidanceState,
} from './guidedForces';

const baseConfig: AttractorConfig = {
  falloffCurve: 'linear',
  baseStrength: 10,
  effectiveRadius: 1,
  velocityGate: 1,
  forceClamp: 5,
  noiseAmplitude: 0,
  noiseFrequency: 1,
};

const baseGuidance: GuidanceState = {
  targetPosition: new Vector3(0, 0, 0),
  phase: 'settle',
  noiseOffset: 0,
};

describe('calculateAttractorForce', () => {
  it('returns null when phase gate blocks', () => {
    const force = calculateAttractorForce(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      { ...baseGuidance, phase: 'cruise' },
      baseConfig,
      123,
      0,
      new Vector3()
    );
    expect(force).toBeNull();
  });

  it('returns null when velocity exceeds gate', () => {
    const force = calculateAttractorForce(
      new Vector3(0, 0, 0),
      new Vector3(2, 0, 0),
      baseGuidance,
      baseConfig,
      123,
      0,
      new Vector3()
    );
    expect(force).toBeNull();
  });

  it('returns null when height gate blocks', () => {
    const force = calculateAttractorForce(
      new Vector3(0, 2, 0),
      new Vector3(0, 0, 0),
      { ...baseGuidance, heightGate: 1 },
      baseConfig,
      123,
      0,
      new Vector3()
    );
    expect(force).toBeNull();
  });

  it('returns null outside effective radius', () => {
    const force = calculateAttractorForce(
      new Vector3(2, 0, 0),
      new Vector3(0, 0, 0),
      baseGuidance,
      baseConfig,
      123,
      0,
      new Vector3()
    );
    expect(force).toBeNull();
  });

  it('returns a clamped force toward target inside radius', () => {
    const force = calculateAttractorForce(
      new Vector3(0.2, 0, 0),
      new Vector3(0, 0, 0),
      { ...baseGuidance, targetPosition: new Vector3(0.7, 0, 0) },
      baseConfig,
      123,
      0,
      new Vector3()
    );

    expect(force).not.toBeNull();
    const length = force?.length() ?? 0;
    expect(length).toBeGreaterThan(0);
    expect(length).toBeCloseTo(5, 6);

    const direction = new Vector3(0.7, 0, 0).sub(new Vector3(0.2, 0, 0)).normalize();
    const dot = force?.clone().normalize().dot(direction) ?? 0;
    expect(dot).toBeGreaterThan(0.99);
  });
});

describe('calculateAlignmentTorque', () => {
  it('returns zero angle when already aligned', () => {
    const torque = calculateAlignmentTorque(
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: 0, z: 0, w: 1 },
      1
    );
    expect(torque.angle).toBe(0);
  });

  it('returns expected angle for 180-degree rotation', () => {
    const torque = calculateAlignmentTorque(
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 1, y: 0, z: 0, w: 0 },
      1
    );
    expect(Math.abs(Math.abs(torque.angle) - Math.PI)).toBeLessThan(1e-6);
    expect(Math.abs(torque.axis.length() - 1)).toBeLessThan(1e-6);
  });
});
