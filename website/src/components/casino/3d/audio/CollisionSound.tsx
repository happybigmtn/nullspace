import React, { useEffect, useRef } from 'react';
import { useRapier, useRigidBodyContext, type CollisionEnterPayload } from '@react-three/rapier';
import AudioManager from './AudioManager';
import { createBallBounce, createCardSnap, createDiceImpact, type ImpactMaterial } from './proceduralSounds';

interface CollisionSoundProps {
  enabled?: boolean;
  material?: ImpactMaterial;
  velocityThreshold?: number;
  cooldownMs?: number;
  volume?: number;
  mode?: 'impact' | 'bounce' | 'snap';
}

const getNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const CollisionSound: React.FC<CollisionSoundProps> = ({
  enabled = true,
  material = 'plastic',
  velocityThreshold = 1.5,
  cooldownMs = 90,
  volume = 1,
  mode = 'impact',
}) => {
  const { getRigidBody, options } = useRigidBodyContext();
  const { rigidBodyEvents } = useRapier();
  const configRef = useRef({ enabled, material, velocityThreshold, cooldownMs, volume, mode });
  const lastPlayedRef = useRef(0);
  const managerRef = useRef(AudioManager.getInstance());

  useEffect(() => {
    configRef.current = { enabled, material, velocityThreshold, cooldownMs, volume, mode };
  }, [enabled, material, velocityThreshold, cooldownMs, volume, mode]);

  useEffect(() => {
    const rigidBody = getRigidBody();
    const handle = rigidBody.handle;
    const existing = rigidBodyEvents.get(handle);
    const fallbackHandlers = {
      onWake: options.onWake,
      onSleep: options.onSleep,
      onCollisionEnter: options.onCollisionEnter,
      onCollisionExit: options.onCollisionExit,
      onIntersectionEnter: options.onIntersectionEnter,
      onIntersectionExit: options.onIntersectionExit,
      onContactForce: options.onContactForce,
    };
    const baseHandlers = existing ?? fallbackHandlers;

    const onCollisionEnter = (payload: CollisionEnterPayload) => {
      baseHandlers?.onCollisionEnter?.(payload);
      const config = configRef.current;
      if (!config.enabled) return;

      const now = getNow();
      if (now - lastPlayedRef.current < config.cooldownMs) return;

      const targetVel = payload.target.rigidBody?.linvel();
      const otherVel = payload.other.rigidBody?.linvel();
      let speed = 0;
      if (targetVel && otherVel) {
        speed = Math.hypot(
          targetVel.x - otherVel.x,
          targetVel.y - otherVel.y,
          targetVel.z - otherVel.z
        );
      } else if (targetVel) {
        speed = Math.hypot(targetVel.x, targetVel.y, targetVel.z);
      } else if (otherVel) {
        speed = Math.hypot(otherVel.x, otherVel.y, otherVel.z);
      }

      if (speed < config.velocityThreshold) return;
      lastPlayedRef.current = now;

      const manager = managerRef.current;
      const ctx = manager.getContext();
      const master = manager.getMasterGain();
      if (!ctx || !master) return;
      void manager.unlock();

      const node = config.mode === 'bounce'
        ? createBallBounce(ctx, speed, config.material === 'metal' ? 'metal' : 'felt')
        : config.mode === 'snap'
          ? createCardSnap(ctx)
          : createDiceImpact(ctx, {
            velocity: speed,
            material: config.material,
            volume: config.volume,
          });
      node.connect(master);
    };

    const mergedHandlers = {
      ...baseHandlers,
      onCollisionEnter,
    };

    rigidBodyEvents.set(handle, mergedHandlers);

    return () => {
      const current = rigidBodyEvents.get(handle);
      if (current === mergedHandlers) {
        if (existing) {
          rigidBodyEvents.set(handle, existing);
        } else {
          rigidBodyEvents.delete(handle);
        }
      }
    };
  }, [getRigidBody, options, rigidBodyEvents]);

  return null;
};

export default CollisionSound;
