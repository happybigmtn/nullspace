import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SeededRandom } from '../engine/deterministicRng';

export interface ChipDenomination {
  value: number;
  color: string;
}

export interface ChipStackConfig {
  id: string;
  amount: number;
  position: [number, number, number];
  seed?: number;
}

export interface ChipStack3DProps extends ChipStackConfig {
  chipRadius?: number;
  chipHeight?: number;
  maxChips?: number;
  denominations?: ChipDenomination[];
}

export const CHIP_DENOMINATIONS: ChipDenomination[] = [
  { value: 1, color: '#f8f8f8' },
  { value: 5, color: '#d33b3b' },
  { value: 25, color: '#2ecc71' },
  { value: 100, color: '#1f1f1f' },
  { value: 500, color: '#f4c542' },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildStack = (
  amount: number,
  denominations: ChipDenomination[],
  maxChips: number,
  rng: SeededRandom,
  chipHeight: number
) => {
  const ordered = [...denominations].sort((a, b) => a.value - b.value);
  const result: Array<{ color: string; y: number; rotation: number }> = [];
  let remaining = Math.max(0, Math.floor(amount));

  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const denom = ordered[i];
    while (remaining >= denom.value && result.length < maxChips) {
      const rotation = (rng.next() - 0.5) * 0.35;
      const y = result.length * chipHeight;
      result.push({ color: denom.color, y, rotation });
      remaining -= denom.value;
    }
  }

  return result;
};

export const ChipStack3D: React.FC<ChipStack3DProps> = ({
  amount,
  position,
  seed,
  chipRadius = 0.2,
  chipHeight = 0.05,
  maxChips = 30,
  denominations = CHIP_DENOMINATIONS,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(
    () => new THREE.CylinderGeometry(chipRadius, chipRadius, chipHeight, 24),
    [chipHeight, chipRadius]
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.4,
        metalness: 0.2,
        envMapIntensity: 0.6,
        vertexColors: true,
      }),
    []
  );

  const stacks = useMemo(() => {
    const stackSeed = seed ?? ((amount * 2654435761) >>> 0);
    const rng = new SeededRandom(stackSeed);
    return buildStack(amount, denominations, maxChips, rng, chipHeight);
  }, [amount, chipHeight, denominations, maxChips, seed]);

  useEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const [x, y, z] = position;

    stacks.forEach((chip, index) => {
      dummy.position.set(x, y + chip.y, z);
      dummy.rotation.set(0, chip.rotation, 0);
      dummy.updateMatrix();
      meshRef.current?.setMatrixAt(index, dummy.matrix);
      color.set(chip.color);
      meshRef.current?.setColorAt(index, color);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [position, stacks]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (stacks.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, clamp(stacks.length, 1, maxChips)]}
      castShadow
      receiveShadow
    />
  );
};

export default ChipStack3D;
