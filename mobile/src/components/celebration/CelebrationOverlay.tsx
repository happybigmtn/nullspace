/**
 * CelebrationOverlay - Orchestrates all win celebration effects
 *
 * Combines gold particles, balance animation triggers, and haptics
 * into a single overlay that game screens can use.
 */
import React from 'react';
import { GoldParticles } from './GoldParticles';
import type { CelebrationState } from '../../hooks/useCelebration';

interface CelebrationOverlayProps {
  /** Current celebration state */
  state: CelebrationState;
  /** Optional callback when celebration ends */
  onComplete?: () => void;
}

/**
 * Overlay that renders celebration effects
 * Place this at the top level of game layouts
 */
export function CelebrationOverlay({ state, onComplete }: CelebrationOverlayProps) {
  return (
    <GoldParticles
      isActive={state.isActive}
      intensity={state.intensity}
      onComplete={onComplete}
    />
  );
}
