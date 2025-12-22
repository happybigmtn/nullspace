/**
 * Baccarat 3D Cards Wrapper
 *
 * Uses CardTableScene3D for consistent floating card animations.
 * 6 card slots: 3 player (bottom) + 3 banker (top), dealt alternately.
 */
import React, { useMemo } from 'react';
import { Card } from '../../../types';
import { cardIdToString } from '../../../utils/gameStateParser';
import { Hand } from '../GameComponents';
import { CardAnimationOverlay } from './CardAnimationOverlay';
import { BACCARAT_SLOTS, BACCARAT_DEAL_ORDER, buildBaccaratCardsById } from './cardLayouts';
import type { CardHand } from './Card3D';

// 1 second delay between each card flip for Baccarat
const BACCARAT_REVEAL_STAGGER_MS = 1000;

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
  roundId?: number;
  superMode?: {
    isActive: boolean;
    multipliers: Array<{ id: number; multiplier: number; superType: string }>;
  } | null;
  isMobile?: boolean;
  onAnimationBlockingChange?: (blocking: boolean) => void;
  children?: React.ReactNode;
}

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
  roundId,
  superMode,
  isMobile = false,
  onAnimationBlockingChange,
  children,
}) => {
  // Build cards mapping for CardTableScene3D
  const cardsById = useMemo(
    () => buildBaccaratCardsById(playerCards, bankerCards),
    [playerCards, bankerCards]
  );

  // Determine which hand is selected for card coloring
  const selectedHand: CardHand = useMemo(() => {
    if (isPlayerSelected) return 'player';
    if (isBankerSelected) return 'banker';
    return null;
  }, [isPlayerSelected, isBankerSelected]);

  return (
    <div className="relative w-full h-full min-h-[400px]">
      {/* 3D Card Animation Overlay */}
      <CardAnimationOverlay
        slots={BACCARAT_SLOTS}
        dealOrder={BACCARAT_DEAL_ORDER}
        cardsById={cardsById}
        isActionActive={isDealing}
        storageKey="baccarat-3d-mode"
        guidedGameType="baccarat"
        roundId={roundId}
        onAnimationBlockingChange={onAnimationBlockingChange}
        isMobile={isMobile}
        selectedHand={selectedHand}
        revealStaggerMs={BACCARAT_REVEAL_STAGGER_MS}
      />

      {/* Super Mode overlay when active */}
      {superMode?.isActive && (
        <div className="pointer-events-none absolute top-4 left-4 right-4 z-[70]">
          <div className="mx-auto w-full max-w-md bg-terminal-black/90 border border-terminal-gold/60 rounded px-3 py-2 text-center shadow-[0_0_14px_rgba(255,215,0,0.35)]">
            <div className="text-[10px] font-mono tracking-[0.3em] text-terminal-gold mb-2">
              SUPER MODE ACTIVE
            </div>
            {Array.isArray(superMode.multipliers) && superMode.multipliers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 justify-center">
                {superMode.multipliers.slice(0, 10).map((m, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded border border-terminal-gold/60 text-terminal-gold text-[10px] font-mono"
                  >
                    {cardIdToString(m.id)} <span className="text-amber-300">x{m.multiplier}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-gray-400 font-mono">Loading multipliers...</div>
            )}
          </div>
        </div>
      )}

      {/* 2D fallback content rendered when 3D is not expanded */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
        {/* Banker section */}
        <div className={`flex flex-col items-center gap-1 transition-all duration-300 ${isBankerSelected ? 'scale-105' : 'scale-95 opacity-80'}`}>
          <span className={`px-2 py-0.5 rounded border text-[10px] tracking-widest ${bankerColor.replace('text-', 'border-')} ${bankerColor} bg-black/60`}>
            {bankerLabel}
          </span>
          {bankerCards.length > 0 ? (
            <Hand cards={bankerCards} forcedColor={bankerColor} />
          ) : (
            <div className={`w-12 h-16 border border-dashed rounded ${bankerColor.replace('text-', 'border-')} flex items-center justify-center text-gray-600`}>?</div>
          )}
        </div>

        {/* Result text */}
        <div className="w-full flex justify-center pointer-events-auto">{children}</div>

        {/* Player section */}
        <div className={`flex flex-col items-center gap-1 transition-all duration-300 ${isPlayerSelected ? 'scale-105' : 'scale-95 opacity-80'}`}>
          <span className={`px-2 py-0.5 rounded border text-[10px] tracking-widest ${playerColor.replace('text-', 'border-')} ${playerColor} bg-black/60`}>
            {playerLabel}
          </span>
          {playerCards.length > 0 ? (
            <Hand cards={playerCards} forcedColor={playerColor} />
          ) : (
            <div className={`w-12 h-16 border border-dashed rounded ${playerColor.replace('text-', 'border-')} flex items-center justify-center text-gray-600`}>?</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BaccaratCards3DWrapper;
