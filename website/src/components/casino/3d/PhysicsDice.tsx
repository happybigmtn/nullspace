/**
 * Physics-enabled dice using Rapier
 *
 * Features:
 * - Realistic rigid body physics
 * - Outcome targeting (gently corrects to land on chain-determined face)
 * - Throw impulse based on power/direction
 * - Rest detection for animation completion
 */
import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { DiceModel } from './DiceModel';
import {
  getTargetQuaternion,
  getCurrentTopFace,
  calculateThrowImpulse,
  isDiceAtRest,
} from './diceUtils';

export interface PhysicsDiceRef {
  throw: (power: number, direction: { x: number; z: number }) => void;
  reset: () => void;
}

interface PhysicsDiceProps {
  /** Initial position */
  position?: [number, number, number];
  /** Target face value (1-6) from blockchain */
  targetValue?: number;
  /** Callback when dice comes to rest */
  onRest?: (faceValue: number) => void;
  /** Dice size */
  size?: number;
  /** Index for staggered throws */
  index?: number;
}

export const PhysicsDice = forwardRef<PhysicsDiceRef, PhysicsDiceProps>(
  ({ position = [0, 2, 0], targetValue, onRest, size = 0.8, index = 0 }, ref) => {
    const rigidBodyRef = useRef<RapierRigidBody>(null);
    const [isThrown, setIsThrown] = useState(false);
    const [hasRested, setHasRested] = useState(false);
    const restCheckCountRef = useRef(0);
    const correctionAppliedRef = useRef(false);

    // Reset state when target changes (new roll)
    useEffect(() => {
      setHasRested(false);
      correctionAppliedRef.current = false;
      restCheckCountRef.current = 0;
    }, [targetValue]);

    // Expose throw and reset methods
    useImperativeHandle(ref, () => ({
      throw: (power: number, direction: { x: number; z: number }) => {
        if (!rigidBodyRef.current) return;

        setIsThrown(true);
        setHasRested(false);
        correctionAppliedRef.current = false;
        restCheckCountRef.current = 0;

        // Wake up the body
        rigidBodyRef.current.wakeUp();

        // Calculate impulse with slight delay offset for multiple dice
        const impulse = calculateThrowImpulse(power, direction);

        // Apply stagger offset for second die
        const staggerDelay = index * 0.05;
        const staggerOffset = index * 0.3;

        setTimeout(() => {
          if (!rigidBodyRef.current) return;

          rigidBodyRef.current.setLinvel(
            { x: impulse.linear.x + staggerOffset, y: impulse.linear.y, z: impulse.linear.z },
            true
          );
          rigidBodyRef.current.setAngvel(
            { x: impulse.angular.x, y: impulse.angular.y, z: impulse.angular.z },
            true
          );
        }, staggerDelay * 1000);
      },

      reset: () => {
        if (!rigidBodyRef.current) return;

        setIsThrown(false);
        setHasRested(false);
        correctionAppliedRef.current = false;

        // Reset position and velocity
        rigidBodyRef.current.setTranslation(
          { x: position[0], y: position[1], z: position[2] },
          true
        );
        rigidBodyRef.current.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      },
    }));

    // Physics frame update for outcome targeting and rest detection
    useFrame(() => {
      if (!rigidBodyRef.current || !isThrown || hasRested) return;

      const linVel = rigidBodyRef.current.linvel();
      const angVel = rigidBodyRef.current.angvel();
      const linVelVec = new THREE.Vector3(linVel.x, linVel.y, linVel.z);
      const angVelVec = new THREE.Vector3(angVel.x, angVel.y, angVel.z);

      // Check if dice is slowing down (ready for correction)
      const isSlowing = linVelVec.length() < 2 && angVelVec.length() < 3;

      // Apply gentle correction toward target face if needed
      if (isSlowing && targetValue && !correctionAppliedRef.current) {
        const rot = rigidBodyRef.current.rotation();
        const currentEuler = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        );
        const currentTop = getCurrentTopFace(currentEuler);

        // If not showing correct face, apply small corrective torque
        if (currentTop !== targetValue) {
          const targetQuat = getTargetQuaternion(targetValue);
          const currentQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

          // Calculate axis of rotation needed
          const correctionQuat = targetQuat.clone().multiply(currentQuat.clone().invert());
          const axis = new THREE.Vector3();
          const angle = 2 * Math.acos(Math.min(1, Math.abs(correctionQuat.w)));

          if (angle > 0.01) {
            axis.set(correctionQuat.x, correctionQuat.y, correctionQuat.z).normalize();

            // Apply gentle nudge torque (not too aggressive to look natural)
            const nudgeStrength = Math.min(angle * 2, 3);
            rigidBodyRef.current.applyTorqueImpulse(
              {
                x: axis.x * nudgeStrength,
                y: axis.y * nudgeStrength,
                z: axis.z * nudgeStrength,
              },
              true
            );
          }
        }

        correctionAppliedRef.current = true;
      }

      // Rest detection (must be at rest for several frames)
      if (isDiceAtRest(linVelVec, angVelVec, 0.05)) {
        restCheckCountRef.current++;

        if (restCheckCountRef.current > 30) {
          // ~0.5 seconds at 60fps
          setHasRested(true);

          // Get final face value
          const rot = rigidBodyRef.current.rotation();
          const finalEuler = new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
          );
          const finalFace = getCurrentTopFace(finalEuler);

          onRest?.(finalFace);
        }
      } else {
        restCheckCountRef.current = 0;
      }
    });

    return (
      <RigidBody
        ref={rigidBodyRef}
        position={position}
        colliders="cuboid"
        restitution={0.4}
        friction={0.6}
        mass={1}
        linearDamping={0.3}
        angularDamping={0.3}
      >
        <DiceModel size={size} />
      </RigidBody>
    );
  }
);

PhysicsDice.displayName = 'PhysicsDice';

export default PhysicsDice;
