/**
 * Baccarat 3D Cards Wrapper
 *
 * Handles 3D toggle, fullscreen expansion, and chain-synced deal animation.
 */
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../../../types';
import { Hand } from '../GameComponents';
import { COLLAPSE_DELAY_MS, getMinRemainingMs, MIN_ANIMATION_MS } from './sceneTiming';

const BaccaratScene3D = lazy(() =>
  import('./BaccaratScene3D').then((mod) => ({ default: mod.BaccaratScene3D }))
);

interface BaccaratCards3DWrapperProps {
  playerCards: Card[];
  bankerCards: Card[];
  playerLabel: string;
  bankerLabel: string;
  playerColor: string;
  bankerColor: string;
  isPlayerSelected: boolean;
  isBankerSelected: boolean;
  isDealing: boolean;
  isMobile?: boolean;
  onAnimationBlockingChange?: (blocking: boolean) => void;
  children?: React.ReactNode;
}

const Scene3DLoader: React.FC = () => (
  <div className="w-full h-full min-h-[320px] flex items-center justify-center bg-terminal-dim/30 rounded border border-terminal-green/20">
    <div className="flex flex-col items-center gap-3">
      <div className="w-10 h-10 border-3 border-terminal-green border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-mono text-gray-500 tracking-wider">LOADING 3D ENGINE...</span>
    </div>
  </div>
);

const buildTargetKey = (playerCards: Card[], bankerCards: Card[]) => {
  if (playerCards.length === 0 && bankerCards.length === 0) return '';
  const encode = (cards: Card[]) =>
    cards.map((card) => `${card.rank}${card.suit}${card.isHidden ? 'H' : ''}`).join(',');
  return `${encode(playerCards)}|${encode(bankerCards)}`;
};

export const BaccaratCards3DWrapper: React.FC<BaccaratCards3DWrapperProps> = ({
  playerCards,
  bankerCards,
  playerLabel,
  bankerLabel,
  playerColor,
  bankerColor,
  isPlayerSelected,
  isBankerSelected,
  isDealing,
  isMobile = false,
  onAnimationBlockingChange,
  children,
}) => {
  const [is3DMode, setIs3DMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('baccarat-3d-mode');
    return stored ? stored === 'true' : true;
  });

  const [isAnimating, setIsAnimating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [dealId, setDealId] = useState(0);
  const [targetKey, setTargetKey] = useState('');
  const [skipRequested, setSkipRequested] = useState(false);
  const wasDealingRef = useRef(false);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationStartMsRef = useRef<number | null>(null);
  const skipRequestedRef = useRef(false);

  useEffect(() => {
    skipRequestedRef.current = skipRequested;
  }, [skipRequested]);

  useEffect(() => {
    if (isDealing) {
      setTargetKey('');
      return;
    }
    setTargetKey(buildTargetKey(playerCards, bankerCards));
  }, [playerCards, bankerCards, isDealing]);

  useEffect(() => {
    const started = isDealing && !wasDealingRef.current;
    if (started) {
      setDealId((prev) => prev + 1);
    }

    if (started && is3DMode) {
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

    wasDealingRef.current = isDealing;
  }, [isDealing, is3DMode, onAnimationBlockingChange]);

  useEffect(() => {
    if (!is3DMode || !isDealing || isAnimating) return;
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
  }, [is3DMode, isDealing, isAnimating, onAnimationBlockingChange]);

  const toggle3DMode = useCallback(() => {
    setIs3DMode((prev) => {
      const next = !prev;
      localStorage.setItem('baccarat-3d-mode', String(next));
      if (!next) {
        setIsAnimating(false);
        setIsExpanded(false);
        onAnimationBlockingChange?.(false);
      }
      return next;
    });
  }, [onAnimationBlockingChange]);

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

  if (!is3DMode) {
    return (
      <div className="relative w-full flex flex-col gap-6 items-center">
        <button
          type="button"
          onClick={toggle3DMode}
          className="absolute top-2 right-2 z-20 px-2 py-1 text-[10px] font-mono
                     bg-black/80 border border-terminal-green/50 rounded
                     text-terminal-green hover:text-white hover:bg-terminal-green/20 transition-colors"
        >
          3D
        </button>

        <div className={`min-h-[96px] sm:min-h-[120px] flex items-center justify-center transition-all duration-300 ${isBankerSelected ? 'scale-110 opacity-100' : 'scale-90 opacity-75'}`}>
          {bankerCards.length > 0 ? (
            <Hand cards={bankerCards} title={bankerLabel} forcedColor={bankerColor} />
          ) : (
            <div className="flex flex-col gap-2 items-center">
              <span className={`text-xl sm:text-2xl font-bold tracking-widest ${bankerColor}`}>BANKER</span>
              <div className={`w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed rounded flex items-center justify-center ${bankerColor.replace('text-', 'border-')}`}>?</div>
            </div>
          )}
        </div>

        {children}

        <div className={`min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center transition-all duration-300 ${isPlayerSelected ? 'scale-110 opacity-100' : 'scale-90 opacity-75'}`}>
          {playerCards.length > 0 ? (
            <Hand cards={playerCards} title={playerLabel} forcedColor={playerColor} />
          ) : (
            <div className="flex flex-col gap-2 items-center">
              <span className={`text-xl sm:text-2xl font-bold tracking-widest ${playerColor}`}>PLAYER</span>
              <div className={`w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed rounded flex items-center justify-center ${playerColor.replace('text-', 'border-')}`}>?</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full min-h-[320px] ${expandedClasses}`}>
      {!isExpanded && (
        <button
          type="button"
          onClick={toggle3DMode}
          className="absolute top-2 right-2 z-20 px-2 py-1 text-[10px] font-mono
                     bg-black/80 border border-terminal-green/50 rounded
                     text-terminal-green hover:text-white hover:bg-terminal-green/20 transition-colors"
        >
          2D
        </button>
      )}

      <div className="relative h-full w-full">
        <Suspense fallback={<Scene3DLoader />}>
          <BaccaratScene3D
            playerCards={playerCards}
            bankerCards={bankerCards}
            targetKey={targetKey}
            dealId={dealId}
            isAnimating={isAnimating}
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

        <div className="absolute left-0 right-0 top-4 flex justify-center pointer-events-none">
          <span className={`px-2 py-0.5 rounded border text-[10px] tracking-widest ${bankerColor.replace('text-', 'border-')} ${bankerColor} bg-black/60`}>
            {bankerLabel}
          </span>
        </div>

        <div className="absolute left-0 right-0 bottom-4 flex justify-center pointer-events-none">
          <span className={`px-2 py-0.5 rounded border text-[10px] tracking-widest ${playerColor.replace('text-', 'border-')} ${playerColor} bg-black/60`}>
            {playerLabel}
          </span>
        </div>

        {children && !isExpanded && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="max-w-xl w-full">{children}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BaccaratCards3DWrapper;
