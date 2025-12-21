/**
 * Roulette 3D Wheel Wrapper
 *
 * Keeps the 3D scene mounted and provides 2D fallback.
 */
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { getRouletteColor } from '../../../utils/gameUtils';
import { COLLAPSE_DELAY_MS, getMinRemainingMs, MIN_ANIMATION_MS } from './sceneTiming';

const RouletteScene3D = lazy(() =>
  import('./RouletteScene3D').then((mod) => ({ default: mod.RouletteScene3D }))
);

interface RouletteWheel3DWrapperProps {
  targetNumber: number | null;
  resultId?: number;
  isSpinning?: boolean;
  onSpin: () => void;
  isMobile?: boolean;
  onAnimationBlockingChange?: (blocking: boolean) => void;
}

const Scene3DLoader: React.FC = () => (
  <div className="w-full h-full min-h-[320px] flex items-center justify-center bg-terminal-dim/30 rounded border border-terminal-green/20">
    <div className="flex flex-col items-center gap-3">
      <div className="w-10 h-10 border-3 border-terminal-green border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-mono text-gray-500 tracking-wider">LOADING 3D ENGINE...</span>
    </div>
  </div>
);

const Roulette2D: React.FC<{ value: number | null; spinKey: number }> = ({ value, spinKey }) => (
  <div className="min-h-[120px] flex flex-col items-center justify-center gap-4">
    {value !== null ? (
      <div
        key={spinKey}
        className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 flex items-center justify-center text-4xl sm:text-5xl font-bold shadow-[0_0_30px_rgba(0,0,0,0.5)] animate-roulette-spin ${
          getRouletteColor(value) === 'RED'
            ? 'border-terminal-accent text-terminal-accent'
            : getRouletteColor(value) === 'BLACK'
              ? 'border-gray-500 text-white'
              : 'border-terminal-green text-terminal-green'
        }`}
      >
        {value}
      </div>
    ) : (
      <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-gray-800 flex items-center justify-center text-sm text-gray-600 animate-pulse">
        SPIN
      </div>
    )}
  </div>
);

export const RouletteWheel3DWrapper: React.FC<RouletteWheel3DWrapperProps> = ({
  targetNumber,
  resultId,
  isSpinning = false,
  onSpin,
  isMobile = false,
  onAnimationBlockingChange,
}) => {
  const [is3DMode, setIs3DMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('roulette-3d-mode');
    return stored ? stored === 'true' : true;
  });

  const [isAnimating, setIsAnimating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [spinKey, setSpinKey] = useState(0);
  const [skipRequested, setSkipRequested] = useState(false);
  const prevResultRef = useRef<number | null>(null);
  const wasSpinningRef = useRef(false);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationStartMsRef = useRef<number | null>(null);
  const skipRequestedRef = useRef(false);

  useEffect(() => {
    skipRequestedRef.current = skipRequested;
  }, [skipRequested]);

  useEffect(() => {
    if (isSpinning && !wasSpinningRef.current && is3DMode) {
      setIsAnimating(true);
      setIsExpanded(true);
      animationStartMsRef.current = performance.now();
      onAnimationBlockingChange?.(true);
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
        collapseTimeoutRef.current = null;
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
    }
    wasSpinningRef.current = isSpinning;
  }, [isSpinning, is3DMode, onAnimationBlockingChange]);

  useEffect(() => {
    if (typeof resultId !== 'number') {
      if (typeof targetNumber === 'number') {
        setSpinKey((k) => k + 1);
      }
      return;
    }
    if (resultId !== prevResultRef.current) {
      prevResultRef.current = resultId;
      setSpinKey((k) => k + 1);
    }
  }, [resultId, targetNumber]);

  const toggle3DMode = useCallback(() => {
    setIs3DMode((prev) => {
      const next = !prev;
      localStorage.setItem('roulette-3d-mode', String(next));
      return next;
    });
  }, []);

  const handleSpin = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setIsExpanded(true);
    animationStartMsRef.current = performance.now();
    onAnimationBlockingChange?.(true);
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }
    onSpin();
  }, [isAnimating, onSpin, onAnimationBlockingChange]);

  const finishAnimation = useCallback(() => {
    setIsAnimating(false);
    collapseTimeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
      onAnimationBlockingChange?.(false);
      collapseTimeoutRef.current = null;
    }, COLLAPSE_DELAY_MS);
  }, [onAnimationBlockingChange]);

  const handleAnimationComplete = useCallback(() => {
    const remainingMs = skipRequestedRef.current ? 0 : getMinRemainingMs(animationStartMsRef.current, MIN_ANIMATION_MS);
    if (remainingMs <= 0) {
      finishAnimation();
      return;
    }
    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
    }
    completionTimeoutRef.current = setTimeout(() => {
      finishAnimation();
      completionTimeoutRef.current = null;
    }, remainingMs);
  }, [finishAnimation]);

  useEffect(() => {
    return () => {
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!is3DMode) {
      onAnimationBlockingChange?.(false);
    }
  }, [is3DMode, onAnimationBlockingChange]);

  useEffect(() => {
    if (!isAnimating) return;
    setSkipRequested(false);
  }, [isAnimating]);

  useEffect(() => {
    if (!isAnimating || !isExpanded || !is3DMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      setSkipRequested(true);
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isAnimating, isExpanded, is3DMode]);

  const expandedClasses = isExpanded && is3DMode
    ? 'absolute inset-0 z-[60] bg-terminal-black/95 transition-all duration-300'
    : '';

  return (
    <div className={`relative ${is3DMode ? 'flex-1 w-full min-h-[320px]' : 'w-full'} ${expandedClasses}`}>
      {!isExpanded && (
        <button
          type="button"
          onClick={toggle3DMode}
          className="absolute top-2 right-2 z-20 px-2 py-1 text-[10px] font-mono
                     bg-black/80 border border-terminal-green/50 rounded
                     text-terminal-green hover:text-white hover:bg-terminal-green/20 transition-colors"
        >
          {is3DMode ? '2D' : '3D'}
        </button>
      )}

      {is3DMode ? (
        <div className="h-full w-full">
          <Suspense fallback={<Scene3DLoader />}>
            <RouletteScene3D
              targetNumber={targetNumber}
              resultId={resultId}
              isAnimating={isAnimating}
              onSpin={handleSpin}
              onAnimationComplete={handleAnimationComplete}
              isMobile={isMobile}
              fullscreen={isExpanded}
              skipRequested={skipRequested}
            />
          </Suspense>

          {!isExpanded && (
            <div className="absolute top-2 left-2 z-20">
              <span className="px-1.5 py-0.5 text-[9px] font-mono bg-purple-600/80 text-white rounded">
                BETA
              </span>
            </div>
          )}
        </div>
      ) : (
        <Roulette2D value={targetNumber} spinKey={spinKey} />
      )}
    </div>
  );
};

export default RouletteWheel3DWrapper;
