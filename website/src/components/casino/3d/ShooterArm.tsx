import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface ShooterArmState {
  yaw: number;
  pitch: number;
  swingStartMs: number | null;
}

interface ShooterArmProps {
  origin: [number, number, number];
  stateRef: React.MutableRefObject<ShooterArmState>;
  swingDurationMs?: number;
  armLength?: number;
  armRadius?: number;
  accentColor?: string;
  enabled?: boolean;
}

export const ShooterArm: React.FC<ShooterArmProps> = ({
  origin,
  stateRef,
  swingDurationMs = 600,
  armLength = 1.1,
  armRadius = 0.08,
  accentColor = '#c5a56a',
  enabled = true,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const pivotRef = useRef<THREE.Group>(null);
  const baseGeometry = useMemo(() => new THREE.CylinderGeometry(armRadius * 1.2, armRadius * 1.2, 0.2, 16), [armRadius]);
  const armGeometry = useMemo(() => new THREE.CylinderGeometry(armRadius, armRadius, armLength, 16), [armLength, armRadius]);

  useFrame(() => {
    if (!enabled || !pivotRef.current) return;
    const now = performance.now();
    const { yaw, pitch, swingStartMs } = stateRef.current;
    let swing = 0;
    if (swingStartMs !== null) {
      const t = Math.min(1, (now - swingStartMs) / swingDurationMs);
      swing = Math.sin(t * Math.PI);
    }
    pivotRef.current.rotation.y = yaw;
    pivotRef.current.rotation.x = pitch - swing * 0.65;
  });

  return (
    <group ref={groupRef} position={origin}>
      <mesh geometry={baseGeometry} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color={accentColor} metalness={0.6} roughness={0.35} />
      </mesh>
      <group ref={pivotRef} position={[0, 0, 0]}>
        <mesh geometry={armGeometry} position={[0, 0, -armLength / 2]}>
          <meshStandardMaterial color={accentColor} metalness={0.55} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, -armLength]}>
          <sphereGeometry args={[armRadius * 1.1, 16, 16]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.55} metalness={0.2} />
        </mesh>
      </group>
    </group>
  );
};

export default ShooterArm;
