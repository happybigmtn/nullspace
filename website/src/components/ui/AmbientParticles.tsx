/**
 * AmbientParticles - Subtle floating dust motes for atmosphere (DS-049)
 *
 * Features:
 * - Slow drifting particles (8-15s cycle)
 * - Random size, opacity, speed variation
 * - Very subtle - ambient not distracting
 * - Pauses when tab is hidden
 * - Respects prefers-reduced-motion
 *
 * Like dust in sunlight - creates atmosphere without drawing attention.
 */
import React, { useMemo, useEffect, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface Particle {
  id: number;
  /** X position as percentage (0-100) */
  x: number;
  /** Initial Y position as percentage (0-100) */
  y: number;
  /** Particle size in pixels */
  size: number;
  /** Opacity (0-1) */
  opacity: number;
  /** Animation duration in seconds */
  duration: number;
  /** Animation delay in seconds */
  delay: number;
  /** X drift amount in pixels */
  xDrift: number;
}

interface AmbientParticlesProps {
  /** Number of particles (default: 12) */
  count?: number;
  /** Color of particles (default: white with low opacity) */
  color?: string;
  /** Enable/disable the effect */
  enabled?: boolean;
  /** Container className */
  className?: string;
}

/**
 * Generate random particles with varied properties
 */
function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 2 + Math.random() * 3, // 2-5px
    opacity: 0.1 + Math.random() * 0.15, // 0.1-0.25 (very subtle)
    duration: 8 + Math.random() * 7, // 8-15s
    delay: Math.random() * 5, // 0-5s stagger
    xDrift: (Math.random() - 0.5) * 30, // -15 to +15px horizontal drift
  }));
}

/**
 * Individual floating particle
 */
function FloatingParticle({
  particle,
  color,
  isPaused,
}: {
  particle: Particle;
  color: string;
  isPaused: boolean;
}) {
  return (
    <div
      className="absolute rounded-full"
      style={{
        left: `${particle.x}%`,
        top: `${particle.y}%`,
        width: particle.size,
        height: particle.size,
        backgroundColor: color,
        opacity: particle.opacity,
        animation: `ambientFloat ${particle.duration}s ease-in-out ${particle.delay}s infinite`,
        animationPlayState: isPaused ? 'paused' : 'running',
        '--x-drift': `${particle.xDrift}px`,
      } as React.CSSProperties}
    />
  );
}

/**
 * Ambient floating particles overlay
 */
export function AmbientParticles({
  count = 12,
  color = 'rgba(255, 255, 255, 0.5)',
  enabled = true,
  className = '',
}: AmbientParticlesProps) {
  const prefersReducedMotion = useReducedMotion();
  const [isPaused, setIsPaused] = useState(false);

  // Generate particles once
  const particles = useMemo(() => generateParticles(count), [count]);

  // Pause when document is hidden (tab switching)
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPaused(document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Don't render if reduced motion or disabled
  if (prefersReducedMotion || !enabled) {
    return null;
  }

  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      aria-hidden="true"
    >
      {particles.map((particle) => (
        <FloatingParticle
          key={particle.id}
          particle={particle}
          color={color}
          isPaused={isPaused}
        />
      ))}
    </div>
  );
}

export default AmbientParticles;
