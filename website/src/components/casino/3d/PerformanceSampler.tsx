import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { track } from '../../../services/telemetry';

const SAMPLE_INTERVAL_MS = 15000;
const MIN_FRAMES = 10;

export const PerformanceSampler: React.FC<{ game?: string }> = ({ game }) => {
  const frameCountRef = useRef(0);
  const lastSampleRef = useRef<number | null>(null);

  useFrame(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      frameCountRef.current = 0;
      lastSampleRef.current = performance.now();
      return;
    }

    const now = performance.now();
    if (lastSampleRef.current === null) {
      lastSampleRef.current = now;
      return;
    }

    frameCountRef.current += 1;
    const elapsed = now - lastSampleRef.current;
    if (elapsed < SAMPLE_INTERVAL_MS) return;
    if (frameCountRef.current < MIN_FRAMES) {
      frameCountRef.current = 0;
      lastSampleRef.current = now;
      return;
    }

    const fps = (frameCountRef.current * 1000) / elapsed;
    const payload: Record<string, unknown> = {
      fps: Math.round(fps * 10) / 10,
      sampleMs: Math.round(elapsed),
    };
    if (game) payload.game = game;

    const memory = (performance as any).memory;
    if (memory && typeof memory.usedJSHeapSize === 'number') {
      payload.usedHeapMB = Math.round(memory.usedJSHeapSize / 1048576);
    }

    track('casino.3d.perf_sample', payload);
    frameCountRef.current = 0;
    lastSampleRef.current = now;
  });

  return null;
};

export default PerformanceSampler;
