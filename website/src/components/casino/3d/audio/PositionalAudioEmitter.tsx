import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import AudioManager from './AudioManager';
import { createRollingLoop, createSpinningLoop } from './proceduralSounds';

interface PositionalAudioEmitterProps {
  soundType: 'roll' | 'spin' | 'tumble';
  enabled?: boolean;
  volume?: number;
  distanceModel?: 'linear' | 'inverse' | 'exponential';
  refDistance?: number;
  maxDistance?: number;
  velocityRef?: React.MutableRefObject<THREE.Vector3>;
  pitchScale?: number;
  position?: [number, number, number];
}

interface ActiveNodes {
  ctx: AudioContext;
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode;
}

const tempVector = new THREE.Vector3();

export const PositionalAudioEmitter: React.FC<PositionalAudioEmitterProps> = ({
  soundType,
  enabled = true,
  volume = 0.6,
  distanceModel = 'inverse',
  refDistance = 1.8,
  maxDistance = 18,
  velocityRef,
  pitchScale = 0.03,
  position = [0, 0, 0],
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const nodesRef = useRef<ActiveNodes | null>(null);
  const manager = useMemo(() => AudioManager.getInstance(), []);

  useEffect(() => {
    if (!enabled) return;
    const ctx = manager.getContext();
    const master = manager.getMasterGain();
    if (!ctx || !master) return;

    void manager.unlock();

    const loop = soundType === 'spin'
      ? createSpinningLoop(ctx)
      : createRollingLoop(ctx, soundType === 'tumble' ? 520 : 420);

    const panner = ctx.createPanner();
    panner.distanceModel = distanceModel;
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = 1;

    loop.gain.gain.value = volume;
    loop.gain.connect(panner);
    panner.connect(master);

    loop.source.start();

    nodesRef.current = {
      ctx,
      source: loop.source,
      gain: loop.gain,
      panner,
    };

    return () => {
      loop.source.stop();
      loop.source.disconnect();
      loop.gain.disconnect();
      panner.disconnect();
      nodesRef.current = null;
    };
  }, [
    enabled,
    distanceModel,
    manager,
    maxDistance,
    refDistance,
    soundType,
    volume,
  ]);

  useFrame(() => {
    const nodes = nodesRef.current;
    if (!nodes || !groupRef.current) return;

    groupRef.current.getWorldPosition(tempVector);
    const now = nodes.ctx.currentTime;

    nodes.panner.positionX.setValueAtTime(tempVector.x, now);
    nodes.panner.positionY.setValueAtTime(tempVector.y, now);
    nodes.panner.positionZ.setValueAtTime(tempVector.z, now);

    if (velocityRef?.current) {
      const speed = velocityRef.current.length();
      const rate = 1 + speed * pitchScale;
      nodes.source.playbackRate.setTargetAtTime(rate, now, 0.05);
      nodes.gain.gain.setTargetAtTime(volume * Math.min(1.4, 0.4 + speed * 0.2), now, 0.1);
    }
  });

  return <group ref={groupRef} position={position} />;
};

export default PositionalAudioEmitter;
