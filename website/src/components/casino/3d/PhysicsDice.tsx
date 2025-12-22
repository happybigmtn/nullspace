/**
 * Physics-enabled dice using Rapier
 *
 * Features:
 * - Realistic rigid body physics
 * - Outcome targeting (gently corrects to land on chain-determined face)
 * - Throw impulse based on power/direction
 * - Rest detection for animation completion
 */
import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { CollisionEnterPayload, RigidBody, RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { DiceModel } from './DiceModel';
import ImpactParticles, { ImpactParticlesHandle } from './ImpactParticles';
import {
  getTargetQuaternion,
  getCurrentTopFaceFromQuaternion,
  calculateThrowImpulse,
  isDiceAtRest,
  type RandomSource,
} from './diceUtils';
import { ATTRACTOR_PRESETS, calculateAlignmentTorque, DICE_PHYSICS } from './physics';

export interface PhysicsDiceRef {
  throw: (
    power: number,
    direction: { x: number; z: number },
    verticalImpulse?: number,
    randomSource?: RandomSource
  ) => void;
  reset: () => void;
  getPosition: (target: THREE.Vector3) => boolean;
  nudgeTo: (next: THREE.Vector3) => void;
  lock: () => void;
  forceSettle: () => void;
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
  /** Clamp dice onto the felt when settling */
  settleBounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    settleY: number;
  };
  /** Collision group mask (optional) */
  collisionGroups?: number;
}

export const PhysicsDice = forwardRef<PhysicsDiceRef, PhysicsDiceProps>(
  ({ position = [0, 2, 0], targetValue, onRest, size = 0.8, index = 0, settleBounds, collisionGroups }, ref) => {
    const safeTargetValue =
      typeof targetValue === 'number' && targetValue >= 1 && targetValue <= 6
        ? targetValue
        : undefined;
    const rigidBodyRef = useRef<RapierRigidBody>(null);
    const isThrownRef = useRef(false);
    const hasRestedRef = useRef(false);
    const restCheckCountRef = useRef(0);
    const throwStartRef = useRef<number | null>(null);
    const forcedSettleRef = useRef(false);
    const targetQuatRef = useRef<THREE.Quaternion | null>(null);
    const linVelRef = useRef(new THREE.Vector3());
    const angVelRef = useRef(new THREE.Vector3());
    const currentQuatRef = useRef(new THREE.Quaternion());
    const smoothQuatRef = useRef(new THREE.Quaternion());
    const smoothPosRef = useRef(new THREE.Vector3());
    const wobbleQuatRef = useRef(new THREE.Quaternion());
    const wobbleAxisRef = useRef(new THREE.Vector3());
    const localUpRef = useRef(new THREE.Vector3());
    const topFaceInverseQuatRef = useRef(new THREE.Quaternion());
    const staggerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const impactParticlesRef = useRef<ImpactParticlesHandle>(null);
    const lastImpactMsRef = useRef(0);
    const impactPointRef = useRef(new THREE.Vector3());
    const smoothSettleRef = useRef<{
      startMs: number;
      durationMs: number;
      fromQuat: THREE.Quaternion;
      toQuat: THREE.Quaternion;
      fromPos: THREE.Vector3;
      toPos: THREE.Vector3;
      targetValue: number;
    } | null>(null);

    const softSettleAfterMs = 900;
    const hardSettleAfterMs = 1700;
    const forceSettleHeight = 0.8;
    const smoothSettleDurationMs = 640;
    const impactCooldownMs = 90;

    const clampToBounds = (translation: { x: number; y: number; z: number }) => {
      if (!settleBounds) return translation;
      const clampedX = Math.min(settleBounds.maxX, Math.max(settleBounds.minX, translation.x));
      const clampedZ = Math.min(settleBounds.maxZ, Math.max(settleBounds.minZ, translation.z));
      return { x: clampedX, y: settleBounds.settleY, z: clampedZ };
    };

    const enableDynamic = () => {
      if (!rigidBodyRef.current) return;
      rigidBodyRef.current.setGravityScale(1, true);
      rigidBodyRef.current.setEnabledTranslations(true, true, true, true);
      rigidBodyRef.current.setEnabledRotations(true, true, true, true);
    };

    const freezeBody = () => {
      if (!rigidBodyRef.current) return;
      rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rigidBodyRef.current.setGravityScale(0, true);
      rigidBodyRef.current.setEnabledTranslations(false, false, false, true);
      rigidBodyRef.current.setEnabledRotations(false, false, false, true);
    };

    const completeSettle = (value: number, translation: { x: number; y: number; z: number }) => {
      if (!rigidBodyRef.current) return;
      rigidBodyRef.current.setEnabledTranslations(true, true, true, true);
      rigidBodyRef.current.setEnabledRotations(true, true, true, true);
      const clamped = clampToBounds(translation);
      const targetQuat = getTargetQuaternion(value);
      rigidBodyRef.current.setTranslation(clamped, true);
      rigidBodyRef.current.setRotation(targetQuat, true);
      rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rigidBodyRef.current.setGravityScale(0, true);
      rigidBodyRef.current.setEnabledTranslations(false, false, false, true);
      rigidBodyRef.current.setEnabledRotations(false, false, false, true);
      forcedSettleRef.current = true;
      hasRestedRef.current = true;
      onRest?.(value);
    };

    const beginSmoothSettle = (value: number, translation: { x: number; y: number; z: number }) => {
      if (!rigidBodyRef.current || smoothSettleRef.current) return;
      const clamped = clampToBounds(translation);
      const rot = rigidBodyRef.current.rotation();
      smoothSettleRef.current = {
        startMs: performance.now(),
        durationMs: smoothSettleDurationMs,
        fromQuat: new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w),
        toQuat: getTargetQuaternion(value),
        fromPos: new THREE.Vector3(translation.x, translation.y, translation.z),
        toPos: new THREE.Vector3(clamped.x, clamped.y, clamped.z),
        targetValue: value,
      };
      rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rigidBodyRef.current.setGravityScale(0, true);
      rigidBodyRef.current.setEnabledTranslations(true, true, true, true);
      rigidBodyRef.current.setEnabledRotations(true, true, true, true);
      forcedSettleRef.current = true;
    };

    // Reset state when target changes (new roll)
    useEffect(() => {
      hasRestedRef.current = false;
      restCheckCountRef.current = 0;
      smoothSettleRef.current = null;
      targetQuatRef.current = safeTargetValue ? getTargetQuaternion(safeTargetValue) : null;
    }, [safeTargetValue]);

    // Expose throw and reset methods
    useImperativeHandle(ref, () => ({
      throw: (
        power: number,
        direction: { x: number; z: number },
        verticalImpulse?: number,
        randomSource?: RandomSource
      ) => {
        if (!rigidBodyRef.current) return;

        isThrownRef.current = true;
        hasRestedRef.current = false;
        restCheckCountRef.current = 0;
        throwStartRef.current = performance.now();
        forcedSettleRef.current = false;
        smoothSettleRef.current = null;

        // Wake up the body
        rigidBodyRef.current.wakeUp();
        enableDynamic();

        // Calculate impulse with slight delay offset for multiple dice
        const impulse = calculateThrowImpulse(power, direction, randomSource);
        if (typeof verticalImpulse === 'number') {
          impulse.linear.y = verticalImpulse;
        }

        // Apply stagger offset for second die
        const staggerDelay = index * 0.03;
        const staggerOffset = index * 0.35;

        if (staggerTimeoutRef.current) {
          clearTimeout(staggerTimeoutRef.current);
        }
        staggerTimeoutRef.current = setTimeout(() => {
          if (!rigidBodyRef.current) return;

          rigidBodyRef.current.applyImpulse(
            { x: impulse.linear.x + staggerOffset, y: impulse.linear.y, z: impulse.linear.z },
            true
          );
          rigidBodyRef.current.applyTorqueImpulse(
            { x: impulse.angular.x, y: impulse.angular.y, z: impulse.angular.z },
            true
          );
        }, staggerDelay * 1000);
      },

      reset: () => {
        if (!rigidBodyRef.current) return;
        if (staggerTimeoutRef.current) {
          clearTimeout(staggerTimeoutRef.current);
          staggerTimeoutRef.current = null;
        }

        isThrownRef.current = false;
        hasRestedRef.current = false;
        throwStartRef.current = null;
        forcedSettleRef.current = false;
        smoothSettleRef.current = null;

        // Reset position and velocity
        enableDynamic();
        rigidBodyRef.current.setTranslation(
          { x: position[0], y: position[1], z: position[2] },
          true
        );
        rigidBodyRef.current.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      },
      getPosition: (target: THREE.Vector3) => {
        if (!rigidBodyRef.current) return false;
        const translation = rigidBodyRef.current.translation();
        target.set(translation.x, translation.y, translation.z);
        return true;
      },
      nudgeTo: (next: THREE.Vector3) => {
        if (!rigidBodyRef.current) return;
        rigidBodyRef.current.setGravityScale(0, true);
        rigidBodyRef.current.setEnabledTranslations(true, true, true, true);
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        rigidBodyRef.current.setTranslation({ x: next.x, y: next.y, z: next.z }, true);
      },
      lock: () => {
        if (!rigidBodyRef.current) return;
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        rigidBodyRef.current.setGravityScale(0, true);
        rigidBodyRef.current.setEnabledTranslations(false, false, false, true);
        rigidBodyRef.current.setEnabledRotations(false, false, false, true);
      },
      forceSettle: () => {
        if (!rigidBodyRef.current || !safeTargetValue) return;
        const translation = rigidBodyRef.current.translation();
        completeSettle(safeTargetValue, translation);
      },
    }));

    useEffect(() => {
      return () => {
        if (staggerTimeoutRef.current) {
          clearTimeout(staggerTimeoutRef.current);
        }
      };
    }, []);

    const handleCollisionEnter = useCallback((payload: CollisionEnterPayload) => {
      if (!impactParticlesRef.current || !rigidBodyRef.current) return;
      const now = performance.now();
      if (now - lastImpactMsRef.current < impactCooldownMs) return;

      const linvel = rigidBodyRef.current.linvel();
      const speed = Math.sqrt(linvel.x * linvel.x + linvel.y * linvel.y + linvel.z * linvel.z);
      if (speed < 2.2) return;

      const contact = payload.manifold?.solverContactPoint(0);
      if (!contact) return;
      impactPointRef.current.set(contact.x, contact.y, contact.z);
      const intensity = Math.min(1, speed / 9);
      impactParticlesRef.current.emit(impactPointRef.current, intensity);
      lastImpactMsRef.current = now;
    }, []);

    // Physics frame update for outcome targeting and rest detection
    useFrame(() => {
      if (!rigidBodyRef.current) return;
      if (smoothSettleRef.current) {
        const settle = smoothSettleRef.current;
        const elapsed = performance.now() - settle.startMs;
        const t = Math.min(1, elapsed / settle.durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        const nextQuat = smoothQuatRef.current.copy(settle.fromQuat).slerp(settle.toQuat, eased);
        const nextPos = smoothPosRef.current.copy(settle.fromPos).lerp(settle.toPos, eased);
        if (t < 0.18) {
          const wobbleT = t / 0.18;
          const wobbleAmount = Math.sin(wobbleT * Math.PI * 4) * (1 - wobbleT) * 0.08;
          wobbleAxisRef.current.set(0.6, 1, 0.4).normalize();
          wobbleQuatRef.current.setFromAxisAngle(wobbleAxisRef.current, wobbleAmount);
          nextQuat.multiply(wobbleQuatRef.current);
        }
        rigidBodyRef.current.setTranslation({ x: nextPos.x, y: nextPos.y, z: nextPos.z }, true);
        rigidBodyRef.current.setRotation(nextQuat, true);
        if (t >= 1) {
          smoothSettleRef.current = null;
          completeSettle(settle.targetValue, { x: nextPos.x, y: nextPos.y, z: nextPos.z });
        }
        return;
      }
      if (!isThrownRef.current || hasRestedRef.current) return;

      const linVel = rigidBodyRef.current.linvel();
      const angVel = rigidBodyRef.current.angvel();
      const linVelVec = linVelRef.current.set(linVel.x, linVel.y, linVel.z);
      const angVelVec = angVelRef.current.set(angVel.x, angVel.y, angVel.z);

      const speed = linVelVec.length();
      const angSpeed = angVelVec.length();
      const translation = rigidBodyRef.current.translation();
      const elapsedMs = throwStartRef.current ? performance.now() - throwStartRef.current : 0;
      const softSettleReady = elapsedMs > softSettleAfterMs && translation.y < forceSettleHeight;
      const hardSettleReady = elapsedMs > hardSettleAfterMs && translation.y < forceSettleHeight;

      // Get current rotation state
      const rot = rigidBodyRef.current.rotation();
      const currentQuat = currentQuatRef.current.set(rot.x, rot.y, rot.z, rot.w);
      const currentTop = getCurrentTopFaceFromQuaternion(
        currentQuat,
        localUpRef.current,
        topFaceInverseQuatRef.current
      );

      // Apply gentle correction when dice is slow and not showing target face
      const guidanceConfig = ATTRACTOR_PRESETS.DICE_SETTLE;
      if (
        speed < guidanceConfig.velocityGate &&
        angSpeed < guidanceConfig.velocityGate * 1.7 &&
        safeTargetValue &&
        currentTop !== safeTargetValue
      ) {
        const targetQuat = targetQuatRef.current;
        if (!targetQuat) {
          // Target quaternion not ready yet; skip correction this frame.
        } else {
          const { axis, angle } = calculateAlignmentTorque(currentQuat, targetQuat, 0.85);
          if (angle > 0.1) {
            const speedFactor = Math.min(1, Math.max(0.35, speed / guidanceConfig.velocityGate));
            const nudgeStrength = Math.min(angle * speedFactor, guidanceConfig.forceClamp);
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
      }

      if (forcedSettleRef.current && safeTargetValue && !hasRestedRef.current) {
        beginSmoothSettle(safeTargetValue, translation);
        return;
      }

      if (softSettleReady && !forcedSettleRef.current) {
        if (safeTargetValue) {
          beginSmoothSettle(safeTargetValue, translation);
          return;
        }
      }

      if (hardSettleReady && !forcedSettleRef.current) {
        if (safeTargetValue) {
          beginSmoothSettle(safeTargetValue, translation);
          return;
        }

        freezeBody();
        forcedSettleRef.current = true;
      }

      // Rest detection - REQUIRE targetValue to be defined before declaring settled
      // This ensures dice don't "complete" before the chain response arrives
      const isAtRest = isDiceAtRest(linVelVec, angVelVec, 0.3);

      // Only consider "showing correct face" if we have a target value
      // If no target, we must wait for the chain response
      if (!safeTargetValue) {
        // No target yet - keep physics running but don't settle
        // Reset counter so we'll need fresh rest frames once target arrives
        if (isAtRest) {
          restCheckCountRef.current = 0;
        }
        return;
      }

      const showingCorrectFace = currentTop === safeTargetValue;

      if (isAtRest && showingCorrectFace) {
        restCheckCountRef.current++;
        // Settle faster - 8 frames (~0.13 seconds at 60fps)
        if (restCheckCountRef.current > 8) {
          beginSmoothSettle(safeTargetValue, translation);
        }
      } else if (isAtRest && !showingCorrectFace) {
        // At rest but wrong face - give it a nudge
        restCheckCountRef.current = 0;
      } else {
        restCheckCountRef.current = 0;
      }
    });

    return (
      <>
        <RigidBody
          ref={rigidBodyRef}
          position={position}
          colliders="cuboid"
          collisionGroups={collisionGroups}
          restitution={DICE_PHYSICS.RESTITUTION}
          friction={DICE_PHYSICS.STATIC_FRICTION}
          mass={DICE_PHYSICS.MASS}
          linearDamping={DICE_PHYSICS.LINEAR_DAMPING}
          angularDamping={DICE_PHYSICS.ANGULAR_DAMPING}
          ccd
          onCollisionEnter={handleCollisionEnter}
        >
          <DiceModel size={size} />
        </RigidBody>
        <ImpactParticles ref={impactParticlesRef} />
      </>
    );
  }
);

PhysicsDice.displayName = 'PhysicsDice';

export default PhysicsDice;
