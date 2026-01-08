import { useState, useCallback, useRef, type MouseEvent } from 'react';
import { useSpring, animated, type SpringConfig } from '@react-spring/web';
import { SPRING_CONFIGS } from '../utils/motion';
import { useReducedMotion } from './useReducedMotion';

export interface RippleConfig {
  /** Duration of the ripple animation in ms */
  duration?: number;
  /** Color of the ripple */
  color?: string;
  /** Maximum scale of the ripple (relative to container) */
  maxScale?: number;
  /** Spring config preset */
  springPreset?: keyof typeof SPRING_CONFIGS;
}

export interface Ripple {
  id: string;
  x: number;
  y: number;
  size: number;
}

const defaultConfig: Required<RippleConfig> = {
  duration: 600,
  color: 'rgba(255, 255, 255, 0.3)',
  maxScale: 2.5,
  springPreset: 'button',
};

/**
 * Hook for liquid ripple effect on click/touch
 * Creates water-like ripples that expand from the click point
 * Respects prefers-reduced-motion accessibility setting
 */
export function useRipple(config: RippleConfig = {}) {
  const prefersReducedMotion = useReducedMotion();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const containerRef = useRef<HTMLElement | null>(null);
  const mergedConfig = { ...defaultConfig, ...config };

  const addRipple = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      // Skip ripple for reduced motion
      if (prefersReducedMotion) return;

      const container = event.currentTarget;
      containerRef.current = container;

      const rect = container.getBoundingClientRect();

      // Calculate click position relative to container
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // Calculate ripple size to cover the entire container
      const maxDimension = Math.max(rect.width, rect.height);
      const size = maxDimension * mergedConfig.maxScale;

      const id = `ripple-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      setRipples((prev) => [...prev, { id, x, y, size }]);

      // Remove ripple after animation completes
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, mergedConfig.duration + 100);
    },
    [mergedConfig.duration, mergedConfig.maxScale, prefersReducedMotion]
  );

  return {
    ripples,
    addRipple,
    containerRef,
    config: mergedConfig,
    prefersReducedMotion,
  };
}

/**
 * Individual ripple animation component
 * Uses spring physics for organic expansion
 */
export function RippleAnimation({
  ripple,
  config,
}: {
  ripple: Ripple;
  config: Required<RippleConfig>;
}) {
  const springConfig: SpringConfig = {
    ...SPRING_CONFIGS[config.springPreset],
    // Override for softer, more liquid feel
    tension: 120,
    friction: 14,
  };

  const spring = useSpring({
    from: { scale: 0, opacity: 0.6 },
    to: { scale: 1, opacity: 0 },
    config: springConfig,
  });

  return (
    <animated.span
      style={{
        position: 'absolute',
        left: ripple.x - ripple.size / 2,
        top: ripple.y - ripple.size / 2,
        width: ripple.size,
        height: ripple.size,
        borderRadius: '50%',
        backgroundColor: config.color,
        pointerEvents: 'none',
        transform: spring.scale.to((s) => `scale(${s})`),
        opacity: spring.opacity,
      }}
    />
  );
}

export type { SpringConfig };
