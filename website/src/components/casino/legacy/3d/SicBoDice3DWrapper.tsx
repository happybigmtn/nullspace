/**
 * Sic Bo 3D Dice Wrapper - Full Window Animation
 */
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { DiceThrow2D } from '../GameComponents';
import { playSfx } from '../../../services/sfx';
import { track } from '../../../services/telemetry';
import { COLLAPSE_DELAY_MS, getMinRemainingMs, MIN_ANIMATION_MS } from './sceneTiming';
import { useGuidedStore } from './engine/GuidedStore';
import { getInitial3DMode, trackAbBucket } from './abDefaults';
import { use3DFeedbackPrompt } from './use3DFeedbackPrompt';

const SicBoScene3D = lazy(() =>
  import('./SicBoScene3D').then((mod) => ({ default: mod.SicBoScene3D }))
);

interface SicBoDice3DWrapperProps {
  diceValues: number[];
  resultId?: number;
  isRolling?: boolean;
  onRoll: () => void;
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

const Dice2D: React.FC<{ values: number[]; rollKey?: number }> = ({ values, rollKey }) => (
  <div className="min-h-[110px] flex items-center justify-center">
    <DiceThrow2D values={values} rollKey={rollKey} />
  </div>
);

export const SicBoDice3DWrapper: React.FC<SicBoDice3DWrapperProps> = ({
  diceValues,
  resultId,
  isRolling = false,
  onRoll,
  isMobile = false,
  onAnimationBlockingChange,
}) => {
  const [is3DMode, setIs3DMode] = useState(() => getInitial3DMode('sicbo-3d-mode'));

  const [isAnimating, setIsAnimating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [targetValues, setTargetValues] = useState<[number, number, number] | undefined>();
  const [skipRequested, setSkipRequested] = useState(false);
  const prevDiceRef = useRef<string>('');
  const wasRollingRef = useRef(false);
  const rollSoundPlayedRef = useRef(false);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationStartMsRef = useRef<number | null>(null);
  const skipRequestedRef = useRef(false);
  const outcomeSentRef = useRef<number | null>(null);
  const roundStartedRef = useRef<number | null>(null);
  const wasAnimatingRef = useRef(false);
  const startedByRef = useRef<'button' | 'chain' | null>(null);
  const feedback = use3DFeedbackPrompt('sicbo', is3DMode && isExpanded && !isAnimating);

  const startRound = useGuidedStore((s) => s.startRound);
  const receiveOutcome = useGuidedStore((s) => s.receiveOutcome);
  const requestSkip = useGuidedStore((s) => s.requestSkip);
  const setAnimationBlocking = useGuidedStore((s) => s.setAnimationBlocking);

  useEffect(() => {
    trackAbBucket('sicbo');
  }, []);

  useEffect(() => {
    skipRequestedRef.current = skipRequested;
  }, [skipRequested]);

  useEffect(() => {
    if (isRolling && !wasRollingRef.current) {
      if (!rollSoundPlayedRef.current) {
        void playSfx('dice');
        rollSoundPlayedRef.current = true;
      }
    }
    if (!isRolling && rollSoundPlayedRef.current) {
      rollSoundPlayedRef.current = false;
    }
    if (isRolling && !wasRollingRef.current && is3DMode) {
      setIsAnimating(true);
      setIsExpanded(true);
      animationStartMsRef.current = performance.now();
      onAnimationBlockingChange?.(true);
      const nextRoundId = typeof resultId === 'number' ? resultId + 1 : 0;
      roundStartedRef.current = nextRoundId;
      startedByRef.current = 'chain';
      startRound('sicbo', nextRoundId);
      setAnimationBlocking('sicbo', true);
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
        collapseTimeoutRef.current = null;
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
    }
    wasRollingRef.current = isRolling;
  }, [isRolling, is3DMode, onAnimationBlockingChange, resultId, setAnimationBlocking, startRound]);

  useEffect(() => {
    if (diceValues.length === 3) {
      const key = `${diceValues[0]}-${diceValues[1]}-${diceValues[2]}`;
      if (key !== prevDiceRef.current) {
        prevDiceRef.current = key;
        setTargetValues([diceValues[0], diceValues[1], diceValues[2]]);
      }
    }
  }, [diceValues]);

  const toggle3DMode = useCallback(() => {
    setIs3DMode((prev) => {
      const next = !prev;
      localStorage.setItem('sicbo-3d-mode', String(next));
      track('casino.3d.toggle', { game: 'sicbo', enabled: next });
      if (!next) {
        setIsAnimating(false);
        setIsExpanded(false);
        onAnimationBlockingChange?.(false);
      }
      return next;
    });
  }, [onAnimationBlockingChange, track]);

  const handleRoll = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setIsExpanded(true);
    animationStartMsRef.current = performance.now();
    onAnimationBlockingChange?.(true);
    const nextRoundId = typeof resultId === 'number' ? resultId + 1 : 0;
    roundStartedRef.current = nextRoundId;
    startedByRef.current = 'button';
    startRound('sicbo', nextRoundId);
    setAnimationBlocking('sicbo', true);
    if (!rollSoundPlayedRef.current) {
      void playSfx('dice');
      rollSoundPlayedRef.current = true;
    }
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }
    onRoll();
  }, [isAnimating, onRoll, onAnimationBlockingChange, resultId, setAnimationBlocking, startRound]);

  const finishAnimation = useCallback(() => {
    setIsAnimating(false);
    collapseTimeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
      onAnimationBlockingChange?.(false);
      setAnimationBlocking('sicbo', false);
      collapseTimeoutRef.current = null;
    }, COLLAPSE_DELAY_MS);
  }, [onAnimationBlockingChange, setAnimationBlocking]);

  const handleAnimationComplete = useCallback(() => {
    feedback.markAnimationComplete(roundStartedRef.current ?? resultId ?? 0);
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
  }, [finishAnimation, feedback, resultId]);

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
      setAnimationBlocking('sicbo', false);
    }
  }, [is3DMode, onAnimationBlockingChange, setAnimationBlocking]);

  useEffect(() => {
    if (!isAnimating) return;
    setSkipRequested(false);
  }, [isAnimating]);

  useEffect(() => {
    if (!skipRequested) return;
    track('casino.3d.skip', { game: 'sicbo', roundId: roundStartedRef.current });
    requestSkip('sicbo');
  }, [requestSkip, skipRequested, track]);

  useEffect(() => {
    if (isAnimating && !wasAnimatingRef.current) {
      track('casino.3d.animation_start', {
        game: 'sicbo',
        source: startedByRef.current ?? 'unknown',
        roundId: roundStartedRef.current,
      });
      startedByRef.current = null;
    }
    wasAnimatingRef.current = isAnimating;
  }, [isAnimating, track]);

  useEffect(() => {
    if (typeof resultId !== 'number') return;
    if (!targetValues) return;
    if (outcomeSentRef.current === resultId) return;
    if (!targetValues.every((die) => die >= 1 && die <= 6)) return;
    outcomeSentRef.current = resultId;
    receiveOutcome('sicbo', { dice: targetValues, total: targetValues.reduce((sum, value) => sum + value, 0) });
  }, [receiveOutcome, resultId, targetValues]);

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
            <SicBoScene3D
              targetValues={targetValues}
              resultId={resultId}
              isAnimating={isAnimating}
              onRoll={handleRoll}
              onAnimationComplete={handleAnimationComplete}
              isMobile={isMobile}
              fullscreen={isExpanded}
              skipRequested={skipRequested}
            />
          </Suspense>

          {feedback.show && (
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-center z-20">
              <div className="flex flex-col sm:flex-row items-center gap-2 rounded border border-terminal-green/40 bg-black/80 px-3 py-2 text-xs font-mono text-terminal-green shadow-lg">
                <span>3D feel smooth?</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => feedback.submit('positive')}
                    className="px-2 py-1 rounded border border-terminal-green/60 hover:bg-terminal-green/20"
                  >
                    YES
                  </button>
                  <button
                    type="button"
                    onClick={() => feedback.submit('negative')}
                    className="px-2 py-1 rounded border border-terminal-accent/60 text-terminal-accent hover:bg-terminal-accent/20"
                  >
                    NO
                  </button>
                  <button
                    type="button"
                    onClick={feedback.dismiss}
                    className="px-2 py-1 rounded border border-gray-600/60 text-gray-400 hover:bg-gray-600/20"
                  >
                    LATER
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Dice2D values={diceValues} rollKey={resultId} />
      )}
    </div>
  );
};

export default SicBoDice3DWrapper;
