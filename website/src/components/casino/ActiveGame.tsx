
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GameState, GameType } from '../../types';
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
import { Label } from './ui/Label';
import { USE_CLASSIC_CASINO_UI } from '../../config/casinoUI';

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

const sumBetAmounts = (bets: Array<{ amount?: number; oddsAmount?: number; localOddsAmount?: number }>) =>
  bets.reduce((sum, bet) => sum + (bet.amount || 0) + (bet.oddsAmount || 0) + (bet.localOddsAmount || 0), 0);


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
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [revealedCount, multipliers.length, reducedMotion, skipped]);

  const visibleMultipliers = multipliers.slice(0, revealedCount);
  const isRevealing = revealedCount < multipliers.length && !skipped;

  return (
    <div className="absolute top-4 left-4 max-w-sm liquid-card liquid-sheen border border-ns p-4 rounded-3xl shadow-float z-40">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-mono-0 dark:text-mono-1000 tracking-[0.2em] uppercase">Super Mode</div>
        {isRevealing && <div className="text-[9px] font-medium text-ns-muted uppercase">Space to skip</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {visibleMultipliers.map((m, idx) => (
          <span
            key={`${m.id}-${m.superType}-${idx}`}
            className="px-3 py-1.5 rounded-full liquid-chip border border-ns text-ns text-[11px] font-bold shadow-sm"
          >
            {formatMultiplier(m)}
          </span>
        ))}
        {multipliers.length === 0 && <span className="text-[11px] font-medium text-ns-muted italic">Active</span>}
      </div>
    </div>
  );
};

interface ActiveGameProps {
  gameState: GameState;
  numberInput: string;
  onToggleHold: (index: number) => void;
  actions: any;
  onOpenCommandPalette?: () => void;
  reducedMotion?: boolean;
  chips?: number;
  playMode: 'CASH' | 'FREEROLL' | null;
  currentBet?: number;
  onBetChange?: (bet: number) => void;
}

const formatAmount = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  return Math.floor(amount).toLocaleString();
};

export const ActiveGame: React.FC<ActiveGameProps> = ({ gameState, numberInput, onToggleHold, actions, onOpenCommandPalette, reducedMotion = false, chips, playMode, currentBet, onBetChange }) => {
  const handleOpen = useCallback(() => onOpenCommandPalette?.(), [onOpenCommandPalette]);

  const primaryActionLabel = () => {
    if (gameState.type === GameType.ROULETTE) return 'SPIN';
    if (gameState.type === GameType.SIC_BO || gameState.type === GameType.CRAPS) return 'ROLL';
    if (gameState.type === GameType.VIDEO_POKER) return gameState.stage === 'PLAYING' ? 'DRAW' : 'DEAL';
    return 'DEAL';
  };

  const nextActionLabel = () => {
    const primary = primaryActionLabel();
    const msg = (gameState.message ?? '').toString().toUpperCase();

    // Show actual game message if it's meaningful (not generic)
    const genericMessages = ['PLACE YOUR BETS', 'CHOOSE YOUR MOVE', 'PLACE BET', ''];
    if (msg && !genericMessages.includes(msg)) {
      return msg;
    }

    // Handle different game stages
    if (gameState.stage === 'RESULT') return `Next hand: ${primary}`;

    // Game-specific guidance based on type
    switch (gameState.type) {
      case GameType.BACCARAT:
        return 'Select PLAYER or BANKER then DEAL';
      case GameType.BLACKJACK:
        if (msg.includes('INSURANCE')) return 'Insurance offered';
        if (gameState.stage === 'PLAYING') return 'Hit, Stand, or Double';
        return `Place bet then ${primary}`;
      case GameType.CASINO_WAR:
        return `Place bet then ${primary}`;
      case GameType.CRAPS:
        return 'Place bets then ROLL';
      case GameType.HILO:
        if (gameState.stage === 'PLAYING') return 'Higher, Lower, or Cashout';
        return `Place bet then ${primary}`;
      case GameType.ROULETTE:
        return 'Place bets then SPIN';
      case GameType.SIC_BO:
        return 'Place bets then ROLL';
      case GameType.THREE_CARD:
        return `Ante up then ${primary}`;
      case GameType.ULTIMATE_HOLDEM:
        return `Ante + Blind then ${primary}`;
      case GameType.VIDEO_POKER:
        if (gameState.stage === 'PLAYING') return 'Select cards to HOLD';
        return `Place bet then ${primary}`;
      default:
        if (gameState.stage === 'BETTING') return `Place bets then ${primary}`;
        return 'Choose your move';
    }
  };

  const displayWin = gameState.stage === 'RESULT' ? gameState.lastResult : 0;
  const totalBet = React.useMemo(() => {
    switch (gameState.type) {
      case GameType.ROULETTE:
        return sumBetAmounts(gameState.rouletteBets);
      case GameType.SIC_BO:
        return sumBetAmounts(gameState.sicBoBets);
      case GameType.CRAPS:
        return sumBetAmounts(gameState.crapsBets);
      case GameType.BACCARAT:
        return (gameState.bet || 0) + sumBetAmounts(gameState.baccaratBets);
      case GameType.BLACKJACK:
        return (
          (gameState.bet || 0)
          + (gameState.blackjack21Plus3Bet || 0)
          + (gameState.blackjackLuckyLadiesBet || 0)
          + (gameState.blackjackPerfectPairsBet || 0)
          + (gameState.blackjackBustItBet || 0)
          + (gameState.blackjackRoyalMatchBet || 0)
          + (gameState.insuranceBet || 0)
        );
      case GameType.THREE_CARD:
        return (gameState.bet || 0)
          + (gameState.threeCardPairPlusBet || 0)
          + (gameState.threeCardSixCardBonusBet || 0)
          + (gameState.threeCardProgressiveBet || 0);
      case GameType.ULTIMATE_HOLDEM:
        return (gameState.bet || 0) * 2
          + (gameState.uthTripsBet || 0)
          + (gameState.uthSixCardBonusBet || 0)
          + (gameState.uthProgressiveBet || 0);
      case GameType.CASINO_WAR:
        return (gameState.bet || 0) + (gameState.casinoWarTieBet || 0);
      case GameType.HILO:
      case GameType.VIDEO_POKER:
      case GameType.NONE:
      default:
        return gameState.bet || 0;
    }
  }, [
    gameState.type,
    gameState.bet,
    gameState.rouletteBets,
    gameState.sicBoBets,
    gameState.crapsBets,
    gameState.baccaratBets,
    gameState.blackjack21Plus3Bet,
    gameState.blackjackLuckyLadiesBet,
    gameState.blackjackPerfectPairsBet,
    gameState.blackjackBustItBet,
    gameState.blackjackRoyalMatchBet,
    gameState.insuranceBet,
    gameState.threeCardPairPlusBet,
    gameState.threeCardSixCardBonusBet,
    gameState.threeCardProgressiveBet,
    gameState.uthTripsBet,
    gameState.uthSixCardBonusBet,
    gameState.uthProgressiveBet,
    gameState.casinoWarTieBet,
  ]);

  /**
   * Classic UI branch: minimal overlays and the straightforward control surface
   * we used right after removing React Three Fiber. Keeps all logic intact but
   * drops the recent glass/monochrome layers, bet slip, and shortcut chrome.
   */
  if (USE_CLASSIC_CASINO_UI) {
    if (gameState.type === GameType.NONE) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <button
            type="button"
            onClick={handleOpen}
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

    return (
      <>
        <div className="flex justify-center z-30 pointer-events-none select-none mb-2">
          <div className="px-3 py-1 rounded border border-ns-border bg-ns-surface/90 text-[10px] tracking-widest uppercase text-ns-muted">
            NEXT: <span className="text-ns font-semibold">{nextActionLabel()}</span>
          </div>
        </div>

        {gameState.superMode?.isActive && (
          <SuperModeDisplay
            multipliers={gameState.superMode.multipliers || []}
            reducedMotion={reducedMotion}
          />
        )}

        {/* Centered Bet Display - shows prominently during play */}
        {totalBet > 0 && gameState.stage === 'PLAYING' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="flex flex-col items-center gap-1 bg-ns-surface/80 backdrop-blur-sm rounded-2xl px-6 py-3 border border-ns shadow-float animate-scale-in">
              <span className="text-[10px] uppercase tracking-widest text-ns-muted font-bold">Your Bet</span>
              <span className="text-2xl font-bold text-ns font-mono">${totalBet.toLocaleString()}</span>
            </div>
          </div>
        )}

        <BigWinEffect
          amount={displayWin}
          show={gameState.stage === 'RESULT' && displayWin > 0}
          durationMs={gameState.type === GameType.BLACKJACK ? 1000 : undefined}
          reducedMotion={reducedMotion}
          betAmount={totalBet}
        />

        <div className="flex-1 flex flex-col items-center justify-center min-h-0 w-full">
          {gameState.type === GameType.BLACKJACK && <BlackjackView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
          {gameState.type === GameType.CRAPS && <CrapsView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} currentBet={currentBet} onBetChange={onBetChange} />}
          {gameState.type === GameType.BACCARAT && <BaccaratView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
          {gameState.type === GameType.ROULETTE && <RouletteView gameState={gameState} numberInput={numberInput} actions={actions} lastWin={displayWin} playMode={playMode} />}
          {gameState.type === GameType.SIC_BO && <SicBoView gameState={gameState} numberInput={numberInput} actions={actions} lastWin={displayWin} playMode={playMode} />}
          {gameState.type === GameType.HILO && <HiLoView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
          {gameState.type === GameType.VIDEO_POKER && (
            <VideoPokerView gameState={gameState} onToggleHold={onToggleHold} actions={actions} lastWin={displayWin} playMode={playMode} />
          )}
          {gameState.type === GameType.THREE_CARD && <ThreeCardPokerView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
          {gameState.type === GameType.ULTIMATE_HOLDEM && <UltimateHoldemView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
          {gameState.type === GameType.CASINO_WAR && (
            <GenericGameView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />
          )}
        </div>

      </>
    );
  }

  if (gameState.type === GameType.NONE) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 py-12">
        <button
          type="button"
          onClick={handleOpen}
          className="group relative flex flex-col items-center gap-6 focus:outline-none"
        >
          <div className="w-48 h-48 rounded-full liquid-card liquid-sheen border border-ns shadow-float flex items-center justify-center group-hover:scale-105 group-active:scale-95 transition-all duration-300">
            <span className="text-7xl font-light text-ns-muted group-hover:text-mono-0 dark:text-mono-1000 transition-colors">/</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[11px] font-bold text-ns-muted tracking-[0.3em] uppercase">Select Experience</span>
            <span className="text-[10px] text-ns-muted font-medium uppercase">Press / to start</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <>
         <div className="flex flex-col items-center gap-2 z-30 pointer-events-none select-none mb-2">
             <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-medium text-ns-muted">
                 <span className="uppercase tracking-[0.24em] text-[9px] font-semibold text-ns-muted">Status</span>
                 <span className="text-ns">{nextActionLabel()}</span>
                 <span className="h-3 w-px bg-ns-border opacity-60" />
                 <span className="uppercase tracking-[0.24em] text-[9px] font-semibold text-ns-muted">Bet</span>
                 <span className="text-ns">${formatAmount(totalBet)}</span>
             </div>
         </div>

         {gameState.superMode?.isActive && (
             <SuperModeDisplay
               multipliers={gameState.superMode.multipliers || []}
               reducedMotion={reducedMotion}
             />
         )}

         {/* Centered Bet Display - shows prominently during play */}
         {totalBet > 0 && gameState.stage === 'PLAYING' && (
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
             <div className="flex flex-col items-center gap-1 bg-ns-surface/80 backdrop-blur-sm rounded-2xl px-6 py-3 border border-ns shadow-float animate-scale-in">
               <span className="text-[10px] uppercase tracking-widest text-ns-muted font-bold">Your Bet</span>
               <span className="text-2xl font-bold text-ns font-mono">${totalBet.toLocaleString()}</span>
             </div>
           </div>
         )}

         <BigWinEffect
            amount={displayWin}
            show={gameState.stage === 'RESULT' && displayWin > 0}
            durationMs={gameState.type === GameType.BLACKJACK ? 1000 : undefined}
            reducedMotion={reducedMotion}
            betAmount={totalBet}
         />

         <div className="flex-1 flex flex-col items-center justify-center min-h-0 w-full game-perspective">
            {gameState.type === GameType.BLACKJACK && <BlackjackView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
            {gameState.type === GameType.CRAPS && <CrapsView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} currentBet={currentBet} onBetChange={onBetChange} />}
            {gameState.type === GameType.BACCARAT && <BaccaratView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
            {gameState.type === GameType.ROULETTE && <RouletteView gameState={gameState} numberInput={numberInput} actions={actions} lastWin={displayWin} playMode={playMode} />}
            {gameState.type === GameType.SIC_BO && <SicBoView gameState={gameState} numberInput={numberInput} actions={actions} lastWin={displayWin} playMode={playMode} />}
            {gameState.type === GameType.HILO && <HiLoView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
            {gameState.type === GameType.VIDEO_POKER && (
                <VideoPokerView gameState={gameState} onToggleHold={onToggleHold} actions={actions} lastWin={displayWin} playMode={playMode} />
            )}
            {gameState.type === GameType.THREE_CARD && <ThreeCardPokerView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
            {gameState.type === GameType.ULTIMATE_HOLDEM && <UltimateHoldemView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}

            {gameState.type === GameType.CASINO_WAR && (
                <GenericGameView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />
            )}
         </div>
         
    </>
  );
};
