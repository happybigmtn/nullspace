
import React, { useState, useEffect, useCallback } from 'react';
import { GameState, GameType, Card } from '../../types';
import { BlackjackView } from './games/BlackjackView';
import { CrapsView } from './games/CrapsView';
import { BaccaratView } from './games/BaccaratView';
import { RouletteView } from './games/RouletteView';
import { SicBoView } from './games/SicBoView';
import { HiLoView } from './games/HiLoView';
import { VideoPokerView } from './games/VideoPokerView';
import { ThreeCardPokerView } from './games/ThreeCardPokerView';
import { UltimateHoldemView } from './games/UltimateHoldemView';
import { GenericGameView } from './games/GenericGameView';
import { BigWinEffect } from './BigWinEffect';

// Helper functions for formatting multipliers
const cardRankName = (id: number): string => {
  const rank = id % 13;
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return ranks[rank];
};

const cardSuitSymbol = (id: number): string => {
  const suit = Math.floor(id / 13);
  const suits = ['♠', '♥', '♦', '♣'];
  return suits[suit];
};

const formatMultiplier = (m: { id: number; multiplier: number; superType: string }): string => {
  switch (m.superType) {
    case 'Card':
      return `${cardRankName(m.id)}${cardSuitSymbol(m.id)} x${m.multiplier}`;
    case 'Number':
      return `#${m.id} x${m.multiplier}`;
    case 'Total':
      return `Σ${m.id} x${m.multiplier}`;
    case 'Rank':
      return `${cardRankName(m.id)} x${m.multiplier}`;
    case 'Suit':
      return `${cardSuitSymbol(m.id * 13)} x${m.multiplier}`;
    default:
      return `${m.id} x${m.multiplier}`;
  }
};

// Staged reveal display component
interface SuperModeDisplayProps {
  multipliers: Array<{ id: number; multiplier: number; superType: string }>;
  reducedMotion: boolean;
}

const SuperModeDisplay: React.FC<SuperModeDisplayProps> = ({ multipliers, reducedMotion }) => {
  const [revealedCount, setRevealedCount] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const [multipliersKey, setMultipliersKey] = useState('');

  // Reset state when multipliers change
  useEffect(() => {
    const newKey = multipliers.map(m => `${m.id}-${m.multiplier}-${m.superType}`).join(',');
    if (newKey !== multipliersKey) {
      setMultipliersKey(newKey);
      setRevealedCount(0);
      setSkipped(false);
    }
  }, [multipliers, multipliersKey]);

  // Skip handler (SPACE or ESC)
  const handleSkip = useCallback((e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Escape') {
      // Only skip if we're still revealing
      if (revealedCount < multipliers.length && !skipped) {
        e.preventDefault();
        setSkipped(true);
        setRevealedCount(multipliers.length);
      }
    }
  }, [multipliers.length, revealedCount, skipped]);

  useEffect(() => {
    window.addEventListener('keydown', handleSkip);
    return () => window.removeEventListener('keydown', handleSkip);
  }, [handleSkip]);

  // Staged reveal effect
  useEffect(() => {
    if (reducedMotion || skipped) {
      setRevealedCount(multipliers.length);
      return;
    }

    if (revealedCount < multipliers.length) {
      const timer = setTimeout(() => {
        setRevealedCount(prev => prev + 1);
      }, 400); // 400ms per element
      return () => clearTimeout(timer);
    }
  }, [revealedCount, multipliers.length, reducedMotion, skipped]);

  const visibleMultipliers = multipliers.slice(0, revealedCount);
  const isRevealing = revealedCount < multipliers.length && !skipped;

  if (multipliers.length === 0) {
    return (
      <div className="absolute top-4 left-4 max-w-sm bg-terminal-black/90 border border-terminal-gold/50 p-3 rounded shadow-lg z-40 text-xs">
        <div className="font-bold text-terminal-gold mb-1">SUPER MODE</div>
        <div className="text-[10px] text-gray-400">Active</div>
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-4 max-w-sm bg-terminal-black/90 border border-terminal-gold/50 p-3 rounded shadow-lg z-40 text-xs">
      <div className="font-bold text-terminal-gold mb-1">
        SUPER MODE {isRevealing && <span className="text-gray-400 font-normal">(SPACE to skip)</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {visibleMultipliers.map((m, idx) => (
          <span
            key={`${m.id}-${m.superType}-${idx}`}
            className={`px-2 py-0.5 rounded border border-terminal-gold/30 text-terminal-gold/90 ${
              !reducedMotion && idx === revealedCount - 1 && !skipped ? 'animate-pulse' : ''
            }`}
            style={{
              animation: !reducedMotion && idx === revealedCount - 1 && !skipped
                ? 'fadeIn 200ms ease-out'
                : undefined
            }}
          >
            {formatMultiplier(m)}
          </span>
        ))}
      </div>
    </div>
  );
};

interface ActiveGameProps {
  gameState: GameState;
  deck: Card[];
  numberInput: string;
  onToggleHold: (index: number) => void;
  aiAdvice: string | null;
  actions: any;
  onOpenCommandPalette?: () => void;
  reducedMotion?: boolean;
  chips?: number;
  playMode: 'CASH' | 'FREEROLL' | null;
  currentBet?: number;
  onBetChange?: (bet: number) => void;
}

export const ActiveGame: React.FC<ActiveGameProps> = ({ gameState, deck, numberInput, onToggleHold, aiAdvice, actions, onOpenCommandPalette, reducedMotion = false, chips, playMode, currentBet, onBetChange }) => {
  if (gameState.type === GameType.NONE) {
     const handleOpen = () => onOpenCommandPalette?.();
     return (
         <div className="flex-1 flex flex-col items-center justify-center gap-4">
             <button
                 type="button"
                 onClick={handleOpen}
                 onKeyDown={(e) => {
                     if (e.key === 'Enter' || e.key === ' ') {
                         e.preventDefault();
                         handleOpen();
                     }
                 }}
                 className="flex flex-col items-center justify-center gap-4 focus:outline-none focus:ring-2 focus:ring-terminal-green/40 rounded"
             >
                 <div
                     className="text-[12rem] font-bold text-terminal-green leading-none animate-pulse cursor-pointer select-none"
                     style={{ textShadow: '0 0 40px rgba(0, 255, 136, 0.5), 0 0 80px rgba(0, 255, 136, 0.3)' }}
                 >
                     /
                 </div>
                 <div className="text-sm text-gray-600 tracking-[0.3em] uppercase">press to play</div>
             </button>
         </div>
     );
  }

  const primaryActionLabel = () => {
    if (gameState.type === GameType.ROULETTE) return 'SPIN';
    if (gameState.type === GameType.SIC_BO || gameState.type === GameType.CRAPS) return 'ROLL';
    if (gameState.type === GameType.VIDEO_POKER) return gameState.stage === 'PLAYING' ? 'DRAW' : 'DEAL';
    return 'DEAL';
  };

  const nextActionLabel = () => {
    const primary = primaryActionLabel();
    const msg = (gameState.message ?? '').toString().toUpperCase();

    if (gameState.stage === 'BETTING') return `PLACE BETS → ${primary}`;
    if (gameState.stage === 'RESULT') return `NEXT ROUND → ${primary}`;

    // PLAYING
    if (gameState.type === GameType.BLACKJACK) {
      if (msg.includes('INSURANCE')) return 'INSURANCE: YES / NO';
      return 'HIT / STAND / DOUBLE / SPLIT';
    }
    if (gameState.type === GameType.HILO) return 'HIGHER / LOWER / CASHOUT';
    if (gameState.type === GameType.VIDEO_POKER) return 'HOLD CARDS → DRAW';
    if (gameState.type === GameType.THREE_CARD) return msg.includes('REVEAL') ? 'REVEAL' : 'PLAY OR FOLD';
    if (gameState.type === GameType.ULTIMATE_HOLDEM) {
      if (msg.includes('REVEAL')) return 'REVEAL';
      if (gameState.communityCards.length === 0) return 'CHECK or BET 3X/4X';
      if (gameState.communityCards.length === 3) return 'CHECK or BET 2X';
      if (gameState.communityCards.length === 5) return 'FOLD or BET 1X';
      return 'CHOOSE ACTION';
    }
    if (gameState.type === GameType.CASINO_WAR && msg.includes('WAR')) return 'WAR OR SURRENDER';
    if (gameState.type === GameType.ROULETTE || gameState.type === GameType.SIC_BO || gameState.type === GameType.CRAPS)
      return `TAP ${primary}`;

    return 'CHOOSE ACTION';
  };

  // Only show wins from authoritative game completion (CasinoGameCompleted event)
  // Removed transientWin based on chip changes - this caused false positives
  // from polling/chain state updates that don't correspond to actual game wins
  const displayWin = gameState.stage === 'RESULT' ? gameState.lastResult : 0;

  return (
    <>
         <div className="flex justify-center z-30 pointer-events-none select-none mb-2">
             <div className="px-3 py-1 rounded border border-gray-800 bg-black/60 text-[10px] tracking-widest uppercase text-gray-300">
                 NEXT: <span className="text-white">{nextActionLabel()}</span>
             </div>
         </div>

         {gameState.superMode?.isActive && (
             <SuperModeDisplay
               multipliers={gameState.superMode.multipliers || []}
               reducedMotion={reducedMotion}
             />
         )}

         <BigWinEffect
            amount={displayWin}
            show={gameState.stage === 'RESULT' && displayWin > 0}
            durationMs={gameState.type === GameType.BLACKJACK ? 1000 : undefined}
            reducedMotion={reducedMotion}
         />

         {gameState.type === GameType.BLACKJACK && <BlackjackView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
         {gameState.type === GameType.CRAPS && <CrapsView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} currentBet={currentBet} onBetChange={onBetChange} />}
         {gameState.type === GameType.BACCARAT && <BaccaratView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
         {gameState.type === GameType.ROULETTE && <RouletteView gameState={gameState} numberInput={numberInput} actions={actions} lastWin={displayWin} playMode={playMode} />}
         {gameState.type === GameType.SIC_BO && <SicBoView gameState={gameState} numberInput={numberInput} actions={actions} lastWin={displayWin} playMode={playMode} />}
         {gameState.type === GameType.HILO && <HiLoView gameState={gameState} deck={deck} actions={actions} lastWin={displayWin} playMode={playMode} />}
         {gameState.type === GameType.VIDEO_POKER && (
             <VideoPokerView gameState={gameState} onToggleHold={onToggleHold} actions={actions} lastWin={displayWin} playMode={playMode} />
         )}
         {gameState.type === GameType.THREE_CARD && <ThreeCardPokerView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
         {gameState.type === GameType.ULTIMATE_HOLDEM && <UltimateHoldemView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}

         {gameState.type === GameType.CASINO_WAR && (
             <GenericGameView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />
         )}
         
         {aiAdvice && (
             <div className="absolute top-4 right-4 max-w-xs bg-terminal-black border border-terminal-accent p-4 rounded shadow-lg z-40 text-xs">
                 <div className="font-bold text-terminal-accent mb-1">AI ADVICE</div>
                 {aiAdvice}
             </div>
         )}
    </>
  );
};
