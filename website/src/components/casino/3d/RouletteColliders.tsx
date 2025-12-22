import React, { useMemo } from 'react';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { ROULETTE_GEOMETRY, ROULETTE_PHYSICS } from './physics';

interface RouletteCollidersProps {
  pocketCount: number;
  collisionGroups?: number;
}

export const RouletteColliders: React.FC<RouletteCollidersProps> = ({
  pocketCount,
  collisionGroups,
}) => {
  const deflectors = useMemo(() => {
    const positions: Array<{ x: number; z: number }> = [];
    const radius = ROULETTE_GEOMETRY.ROTOR_RADIUS - 0.12;
    for (let i = 0; i < ROULETTE_GEOMETRY.DEFLECTOR_COUNT; i++) {
      const angle = (i / ROULETTE_GEOMETRY.DEFLECTOR_COUNT) * Math.PI * 2;
      positions.push({
        x: Math.sin(angle) * radius,
        z: Math.cos(angle) * radius,
      });
    }
    return positions;
  }, []);

  const frets = useMemo(() => {
    const entries: Array<{ position: THREE.Vector3; rotationY: number }> = [];
    const radius = ROULETTE_GEOMETRY.ROTOR_RADIUS - 0.05;
    for (let i = 0; i < pocketCount; i++) {
      const angle = (i / pocketCount) * Math.PI * 2;
      entries.push({
        position: new THREE.Vector3(
          Math.sin(angle) * radius,
          ROULETTE_GEOMETRY.FRET_HEIGHT / 2,
          Math.cos(angle) * radius
        ),
        rotationY: angle,
      });
    }
    return entries;
  }, [pocketCount]);

  return (
    <RigidBody type="fixed" colliders={false}>
      <CylinderCollider
        args={[ROULETTE_GEOMETRY.BOWL_DEPTH / 2, ROULETTE_GEOMETRY.BOWL_RADIUS]}
        position={[0, ROULETTE_GEOMETRY.BOWL_DEPTH / 2, 0]}
        friction={ROULETTE_PHYSICS.BOWL_FRICTION}
        restitution={ROULETTE_PHYSICS.ROTOR_RESTITUTION}
        collisionGroups={collisionGroups}
      />
      <CylinderCollider
        args={[ROULETTE_GEOMETRY.FRET_HEIGHT / 2, ROULETTE_GEOMETRY.ROTOR_RADIUS]}
        position={[0, ROULETTE_GEOMETRY.FRET_HEIGHT / 2, 0]}
        restitution={ROULETTE_PHYSICS.ROTOR_RESTITUTION}
        collisionGroups={collisionGroups}
      />
      {deflectors.map((pos, index) => (
        <CylinderCollider
          key={`deflector-${index}`}
          args={[ROULETTE_GEOMETRY.DEFLECTOR_HEIGHT / 2, 0.06]}
          position={[pos.x, ROULETTE_GEOMETRY.DEFLECTOR_HEIGHT / 2, pos.z]}
          restitution={ROULETTE_PHYSICS.DEFLECTOR_RESTITUTION}
          collisionGroups={collisionGroups}
        />
      ))}
      {frets.map((fret, index) => (
        <CuboidCollider
          key={`fret-${index}`}
          args={[0.02, ROULETTE_GEOMETRY.FRET_HEIGHT / 2, 0.08]}
          position={[fret.position.x, fret.position.y, fret.position.z]}
          rotation={[0, fret.rotationY, 0]}
          restitution={ROULETTE_PHYSICS.BALL_RESTITUTION}
          collisionGroups={collisionGroups}
        />
      ))}
    </RigidBody>
  );
};

export default RouletteColliders;
