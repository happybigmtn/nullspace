/**
 * Card animation overlay for table games.
 *
 * Shows a fullscreen 3D deal/reveal scene during action windows.
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../../../types';
import { CardSlotConfig } from './cardLayouts';
import { COLLAPSE_DELAY_MS, getMinRemainingMs, MIN_ANIMATION_MS } from './sceneTiming';
import type { CardHand } from './Card3D';
import { useGuidedStore } from './engine/GuidedStore';

const CardTableScene3D = lazy(() =>
  import('./CardTableScene3D').then((mod) => ({ default: mod.CardTableScene3D }))
);

interface CardAnimationOverlayProps {
  slots: CardSlotConfig[];
  dealOrder: string[];
  cardsById: Record<string, Card | null>;
  isActionActive: boolean;
  storageKey: string;
  guidedGameType?: 'blackjack' | 'baccarat';
  onAnimationBlockingChange?: (blocking: boolean) => void;
  isMobile?: boolean;
  tableSize?: { width: number; depth: number; y: number };
  cardSize?: [number, number, number];
  selectedHand?: CardHand; // Which hand the player bet on - for card coloring
  revealStaggerMs?: number; // Delay between each card flip (default 130ms)
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
  onAnimationBlockingChange,
  isMobile = false,
  tableSize,
  cardSize,
  selectedHand,
  revealStaggerMs,
}) => {
  const [is3DMode, setIs3DMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(storageKey);
    return stored ? stored === 'true' : true;
  });

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

  const startRound = useGuidedStore((s) => s.startRound);
  const receiveOutcome = useGuidedStore((s) => s.receiveOutcome);
  const requestSkip = useGuidedStore((s) => s.requestSkip);
  const setAnimationBlocking = useGuidedStore((s) => s.setAnimationBlocking);

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
    }
  }, [cardsById, guidedGameType, receiveOutcome]);

  const toggle3DMode = useCallback(() => {
    setIs3DMode((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
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
  }, [guidedGameType, onAnimationBlockingChange, setAnimationBlocking, storageKey]);

  useEffect(() => {
    if (isActionActive && is3DMode) {
      setIsAnimating(true);
      setIsExpanded(true);
      animationStartMsRef.current = performance.now();
      onAnimationBlockingChange?.(true);
      if (guidedGameType) {
        const roundId = dealId + 1;
        if (activeRoundRef.current !== roundId) {
          activeRoundRef.current = roundId;
          startRound(guidedGameType, roundId);
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
  }, [dealId, guidedGameType, isActionActive, is3DMode, onAnimationBlockingChange, setAnimationBlocking, startRound]);

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
        const roundId = dealId + 1;
        if (activeRoundRef.current !== roundId) {
          activeRoundRef.current = roundId;
          startRound(guidedGameType, roundId);
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
  }, [cardsById, dealId, emitOutcome, guidedGameType, is3DMode, onAnimationBlockingChange, setAnimationBlocking, slots, startRound]);

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
    if (!skipRequested || !guidedGameType) return;
    requestSkip(guidedGameType);
  }, [guidedGameType, requestSkip, skipRequested]);

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
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default CardAnimationOverlay;
