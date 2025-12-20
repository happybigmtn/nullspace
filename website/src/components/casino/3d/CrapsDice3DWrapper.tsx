/**
 * Craps 3D Dice Wrapper
 *
 * Lazy-loaded wrapper that integrates the 3D dice scene with
 * the existing craps game flow. Handles:
 * - Lazy loading of heavy 3D deps
 * - Fallback to 2D dice
 * - Mode toggle (3D/2D)
 * - Syncing animation with blockchain state
 */
import React, { Suspense, lazy, useState, useCallback, useEffect, useRef } from 'react';
import { DiceRender } from '../GameComponents';

// Lazy load the heavy 3D scene
const CrapsScene3D = lazy(() =>
  import('./CrapsScene3D').then((mod) => ({ default: mod.CrapsScene3D }))
);

interface CrapsDice3DWrapperProps {
  /** Current dice values from chain */
  diceValues: number[];
  /** Whether we're waiting for chain response */
  isRolling?: boolean;
  /** Callback to trigger the roll action */
  onRoll: () => void;
  /** Mobile mode detection */
  isMobile?: boolean;
}

// Loading skeleton for 3D scene
const Scene3DLoader: React.FC = () => (
  <div className="w-full h-64 sm:h-80 flex items-center justify-center bg-terminal-dim/30 rounded border border-terminal-green/20">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-terminal-green border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-mono text-gray-500">LOADING 3D...</span>
    </div>
  </div>
);

// 2D Dice fallback (original implementation)
const Dice2D: React.FC<{ values: number[] }> = ({ values }) => (
  <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
    {values.length > 0 && (
      <div className="flex flex-col gap-2 items-center">
        <span className="text-xs uppercase tracking-widest text-gray-500">ROLL</span>
        <div className="flex gap-4">
          {values.map((d, i) => (
            <DiceRender key={i} value={d} delayMs={i * 60} />
          ))}
        </div>
      </div>
    )}
  </div>
);

export const CrapsDice3DWrapper: React.FC<CrapsDice3DWrapperProps> = ({
  diceValues,
  isRolling = false,
  onRoll,
  isMobile = false,
}) => {
  // Feature flag for 3D mode - stored in localStorage for persistence
  const [is3DMode, setIs3DMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('craps-3d-mode') === 'true';
  });

  // Track pending dice values from chain
  const [pendingDiceValues, setPendingDiceValues] = useState<[number, number] | undefined>();
  const prevDiceRef = useRef<number[]>([]);
  const hasRolledRef = useRef(false);

  // Detect when chain returns new dice values
  useEffect(() => {
    if (diceValues.length === 2) {
      const [d1, d2] = diceValues;
      const [prev1, prev2] = prevDiceRef.current;

      // If dice values changed, this is a new result
      if (d1 !== prev1 || d2 !== prev2) {
        setPendingDiceValues([d1, d2]);
        prevDiceRef.current = diceValues;
      }
    }
  }, [diceValues]);

  // Toggle 3D mode
  const toggle3DMode = useCallback(() => {
    setIs3DMode((prev) => {
      const newValue = !prev;
      localStorage.setItem('craps-3d-mode', String(newValue));
      return newValue;
    });
  }, []);

  // Handle roll trigger from 3D scene
  const handleRollTrigger = useCallback(() => {
    hasRolledRef.current = true;
    onRoll();
  }, [onRoll]);

  // Handle animation complete
  const handleAnimationComplete = useCallback((values: [number, number]) => {
    // Animation finished, clear pending state
    hasRolledRef.current = false;
    // The actual dice values are already in gameState from chain
  }, []);

  return (
    <div className="relative">
      {/* Mode Toggle Button */}
      <button
        type="button"
        onClick={toggle3DMode}
        className="absolute top-0 right-0 z-10 px-2 py-1 text-[10px] font-mono
                   bg-terminal-dim border border-terminal-green/30 rounded
                   text-terminal-green/70 hover:text-terminal-green hover:border-terminal-green/50
                   transition-colors"
        title={is3DMode ? 'Switch to 2D dice' : 'Switch to 3D dice'}
      >
        {is3DMode ? '2D' : '3D'}
      </button>

      {is3DMode ? (
        <Suspense fallback={<Scene3DLoader />}>
          <CrapsScene3D
            targetValues={pendingDiceValues}
            isRolling={isRolling}
            onAnimationComplete={handleAnimationComplete}
            onRollTrigger={handleRollTrigger}
            isMobile={isMobile}
          />
        </Suspense>
      ) : (
        <Dice2D values={diceValues} />
      )}

      {/* 3D Mode Beta Badge */}
      {is3DMode && (
        <div className="absolute top-0 left-0">
          <span className="px-1.5 py-0.5 text-[9px] font-mono bg-purple-600/80 text-white rounded">
            BETA
          </span>
        </div>
      )}
    </div>
  );
};

export default CrapsDice3DWrapper;
