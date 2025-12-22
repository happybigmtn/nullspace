/**
 * Card animation overlay for table games.
 *
 * Shows a fullscreen 3D deal/reveal scene during action windows.
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../../../types';
import { track } from '../../../services/telemetry';
import { CardSlotConfig } from './cardLayouts';
import { COLLAPSE_DELAY_MS, getMinRemainingMs, MIN_ANIMATION_MS } from './sceneTiming';
import type { CardHand } from './Card3D';
import { useGuidedStore } from './engine/GuidedStore';
import type { ChipStackConfig } from './chips/ChipStack3D';
import { getInitial3DMode, trackAbBucket } from './abDefaults';
import { use3DFeedbackPrompt } from './use3DFeedbackPrompt';

const CardTableScene3D = lazy(() =>
  import('./CardTableScene3D').then((mod) => ({ default: mod.CardTableScene3D }))
);

interface CardAnimationOverlayProps {
  slots: CardSlotConfig[];
  dealOrder: string[];
  cardsById: Record<string, Card | null>;
  isActionActive: boolean;
  storageKey: string;
  guidedGameType?: 'blackjack' | 'baccarat' | 'casinoWar' | 'threeCard' | 'ultimateHoldem' | 'hilo' | 'videoPoker';
  roundId?: number;
  onAnimationBlockingChange?: (blocking: boolean) => void;
  isMobile?: boolean;
  tableSize?: { width: number; depth: number; y: number };
  cardSize?: [number, number, number];
  selectedHand?: CardHand; // Which hand the player bet on - for card coloring
  revealStaggerMs?: number; // Delay between each card flip (default 130ms)
  chipStacks?: ChipStackConfig[];
  accentColor?: string;
}

const Scene3DLoader: React.FC = () => (
  <div className="w-full h-full min-h-[320px] flex items-center justify-center bg-terminal-dim/30 rounded border border-terminal-green/20">
    <div className="flex flex-col items-center gap-3">
      <div className="w-10 h-10 border-3 border-terminal-green border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-mono text-gray-500 tracking-wider">LOADING 3D ENGINE...</span>
    </div>
  </div>
);

const buildCardKey = (card: Card | null) => {
  if (!card) return '';
  return `${card.rank}${card.suit}${card.isHidden ? 'H' : ''}`;
};

export const CardAnimationOverlay: React.FC<CardAnimationOverlayProps> = ({
  slots,
  dealOrder,
  cardsById,
  isActionActive,
  storageKey,
  guidedGameType,
  roundId,
  onAnimationBlockingChange,
  isMobile = false,
  tableSize,
  cardSize,
  selectedHand,
  revealStaggerMs,
  chipStacks,
  accentColor,
}) => {
  const [is3DMode, setIs3DMode] = useState(() => getInitial3DMode(storageKey));

  const [isAnimating, setIsAnimating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [dealId, setDealId] = useState(0);
  const [dealSlots, setDealSlots] = useState<string[]>([]);
  const [revealSlots, setRevealSlots] = useState<string[]>([]);
  const [skipRequested, setSkipRequested] = useState(false);
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationStartMsRef = useRef<number | null>(null);
  const skipRequestedRef = useRef(false);
  const prevKeysRef = useRef<Record<string, string>>({});
  const didInitRef = useRef(false);
  const activeRoundRef = useRef<number | null>(null);
  const wasAnimatingRef = useRef(false);

  const telemetryGame = guidedGameType ?? storageKey.replace(/-3d-mode$/, '');
  const squeezeSlots = useMemo(
    () => (guidedGameType === 'baccarat' ? revealSlots : []),
    [guidedGameType, revealSlots]
  );
  const feedback = use3DFeedbackPrompt(telemetryGame, is3DMode && isExpanded && !isAnimating);

  const startRound = useGuidedStore((s) => s.startRound);
  const receiveOutcome = useGuidedStore((s) => s.receiveOutcome);
  const requestSkip = useGuidedStore((s) => s.requestSkip);
  const setAnimationBlocking = useGuidedStore((s) => s.setAnimationBlocking);

  useEffect(() => {
    trackAbBucket(telemetryGame);
  }, [telemetryGame]);

  useEffect(() => {
    skipRequestedRef.current = skipRequested;
  }, [skipRequested]);

  const emitOutcome = useCallback((slotId: string) => {
    if (!guidedGameType) return;
    const card = cardsById[slotId];
    if (!card || card.isHidden) return;
    const [prefix, indexRaw] = slotId.split('-');
    const index = Number.isFinite(Number(indexRaw)) ? Number(indexRaw) : 0;
    if (guidedGameType === 'blackjack') {
      if (prefix !== 'player' && prefix !== 'dealer') return;
      receiveOutcome('blackjack', {
        card: { rank: card.rank, suit: card.suit },
        handType: prefix === 'player' ? 'player' : 'dealer',
        handIndex: index,
      });
      return;
    }
    if (guidedGameType === 'baccarat') {
      if (prefix !== 'player' && prefix !== 'banker') return;
      receiveOutcome('baccarat', {
        card: { rank: card.rank, suit: card.suit },
        handType: prefix === 'player' ? 'player' : 'banker',
        cardIndex: index,
      });
      return;
    }
    if (guidedGameType === 'casinoWar' || guidedGameType === 'threeCard' || guidedGameType === 'ultimateHoldem' || guidedGameType === 'hilo' || guidedGameType === 'videoPoker') {
      receiveOutcome(guidedGameType, {
        card: { rank: card.rank, suit: card.suit },
        slotId,
      });
    }
  }, [cardsById, guidedGameType, receiveOutcome]);

  const toggle3DMode = useCallback(() => {
    setIs3DMode((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
      track('casino.3d.toggle', { game: telemetryGame, enabled: next });
      if (!next) {
        setIsAnimating(false);
        setIsExpanded(false);
        onAnimationBlockingChange?.(false);
        if (guidedGameType) {
          setAnimationBlocking(guidedGameType, false);
        }
      }
      return next;
    });
  }, [guidedGameType, onAnimationBlockingChange, setAnimationBlocking, storageKey, telemetryGame, track]);

  useEffect(() => {
    if (isActionActive && is3DMode) {
      setIsAnimating(true);
      setIsExpanded(true);
      animationStartMsRef.current = performance.now();
      onAnimationBlockingChange?.(true);
      if (guidedGameType) {
        const nextRoundId = typeof roundId === 'number' ? roundId : dealId + 1;
        if (activeRoundRef.current !== nextRoundId) {
          activeRoundRef.current = nextRoundId;
          startRound(guidedGameType, nextRoundId);
        }
        setAnimationBlocking(guidedGameType, true);
      }
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
        collapseTimeoutRef.current = null;
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
    }
  }, [dealId, guidedGameType, isActionActive, is3DMode, onAnimationBlockingChange, roundId, setAnimationBlocking, startRound]);

  useEffect(() => {
    const nextKeys: Record<string, string> = {};
    const newDeals: string[] = [];
    const newReveals: string[] = [];

    slots.forEach((slot) => {
      const nextKey = buildCardKey(cardsById[slot.id] ?? null);
      const prevKey = prevKeysRef.current[slot.id] ?? '';
      nextKeys[slot.id] = nextKey;

      if (prevKey === nextKey) return;
      if (!prevKey && nextKey) {
        newDeals.push(slot.id);
        return;
      }
      if (!nextKey) return;

      const prevBase = prevKey.replace('H', '');
      const nextBase = nextKey.replace('H', '');
      const prevHidden = prevKey.endsWith('H');
      const nextHidden = nextKey.endsWith('H');

      if (prevBase === nextBase && prevHidden && !nextHidden) {
        newReveals.push(slot.id);
        return;
      }
      newDeals.push(slot.id);
    });

    prevKeysRef.current = nextKeys;
    if (!didInitRef.current) {
      didInitRef.current = true;
      return;
    }

    if ((newDeals.length || newReveals.length) && is3DMode) {
      setDealSlots(newDeals);
      setRevealSlots(newReveals);
      setDealId((prev) => prev + 1);
      setIsAnimating(true);
      setIsExpanded(true);
      animationStartMsRef.current = performance.now();
      onAnimationBlockingChange?.(true);
      if (guidedGameType) {
        const nextRoundId = typeof roundId === 'number' ? roundId : dealId + 1;
        if (activeRoundRef.current !== nextRoundId) {
          activeRoundRef.current = nextRoundId;
          startRound(guidedGameType, nextRoundId);
        }
        setAnimationBlocking(guidedGameType, true);
        [...newDeals, ...newReveals].forEach(emitOutcome);
      }
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
        collapseTimeoutRef.current = null;
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
    }
  }, [cardsById, dealId, emitOutcome, guidedGameType, is3DMode, onAnimationBlockingChange, roundId, setAnimationBlocking, slots, startRound]);

  const finishAnimation = useCallback(() => {
    setIsAnimating(false);
    collapseTimeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
      onAnimationBlockingChange?.(false);
      if (guidedGameType) {
        setAnimationBlocking(guidedGameType, false);
      }
      collapseTimeoutRef.current = null;
    }, COLLAPSE_DELAY_MS);
  }, [guidedGameType, onAnimationBlockingChange, setAnimationBlocking]);

  const handleAnimationComplete = useCallback(() => {
    feedback.markAnimationComplete(dealId);
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
  }, [dealId, feedback, finishAnimation]);

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
      if (guidedGameType) {
        setAnimationBlocking(guidedGameType, false);
      }
    }
  }, [guidedGameType, is3DMode, onAnimationBlockingChange, setAnimationBlocking]);

  useEffect(() => {
    if (!isAnimating) return;
    setSkipRequested(false);
  }, [isAnimating]);

  useEffect(() => {
    if (!skipRequested) return;
    track('casino.3d.skip', { game: telemetryGame, dealId });
    if (!guidedGameType) return;
    requestSkip(guidedGameType);
  }, [dealId, guidedGameType, requestSkip, skipRequested, telemetryGame, track]);

  useEffect(() => {
    if (isAnimating && !wasAnimatingRef.current) {
      track('casino.3d.animation_start', { game: telemetryGame, dealId });
    }
    wasAnimatingRef.current = isAnimating;
  }, [dealId, isAnimating, telemetryGame, track]);

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
    <>
      {!isExpanded && (
        <button
          type="button"
          onClick={toggle3DMode}
          className="absolute top-2 right-2 z-30 px-2 py-1 text-[10px] font-mono
                     bg-black/80 border border-terminal-green/50 rounded
                     text-terminal-green hover:text-white hover:bg-terminal-green/20 transition-colors"
        >
          {is3DMode ? '2D' : '3D'}
        </button>
      )}

      {is3DMode && (
        <div className={`pointer-events-auto ${expandedClasses}`}>
          {isExpanded && (
            <div className="h-full w-full">
              <Suspense fallback={<Scene3DLoader />}>
                <CardTableScene3D
                  slots={slots}
                  dealOrder={dealOrder}
                  cardsById={cardsById}
                  dealId={dealId}
                  dealSlots={dealSlots}
                  revealSlots={revealSlots}
                  isAnimating={isAnimating}
                  onAnimationComplete={handleAnimationComplete}
                  isMobile={isMobile}
                  fullscreen={isExpanded}
                  skipRequested={skipRequested}
                  tableSize={tableSize}
                  cardSize={cardSize}
                  selectedHand={selectedHand}
                  revealStaggerMs={revealStaggerMs}
                  squeezeSlots={squeezeSlots}
                  chipStacks={chipStacks}
                  accentColor={accentColor}
                  performanceKey={telemetryGame}
                />
              </Suspense>

              {!isAnimating && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2">
                  <span className="text-xs font-mono text-gray-500 tracking-wider">READY</span>
                </div>
              )}
              {isAnimating && dealSlots.length === 0 && revealSlots.length === 0 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2">
                  <span className="text-xs font-mono text-terminal-green animate-pulse font-bold tracking-wider">
                    WAITING FOR CHAIN...
                  </span>
                </div>
              )}
              {feedback.show && (
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-center">
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
          )}
        </div>
      )}
    </>
  );
};

export default CardAnimationOverlay;
