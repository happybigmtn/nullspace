
import React, { useState, useEffect, useCallback } from 'react';
import { GameState, GameType, RouletteBet, SicBoBet, CrapsBet } from '../../types';
import { calculateCrapsExposure, calculateRouletteExposure, calculateSicBoOutcomeExposure, ROULETTE_DOUBLE_ZERO } from '../../utils/gameUtils';
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
import { BetSlip } from './shared';
import { Label } from './ui/Label';

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

const ODDS_SUMMARY: Record<GameType, string> = {
  [GameType.BLACKJACK]: '1:1–3:2',
  [GameType.CRAPS]: '1:1–175:1',
  [GameType.ROULETTE]: '1:1–35:1',
  [GameType.SIC_BO]: '1:1–180:1',
  [GameType.BACCARAT]: '0.95:1–25:1',
  [GameType.HILO]: '1:1+',
  [GameType.VIDEO_POKER]: '1:1–800:1',
  [GameType.THREE_CARD]: '1:1–40:1+',
  [GameType.ULTIMATE_HOLDEM]: '1:1–500:1',
  [GameType.CASINO_WAR]: '1:1–10:1',
  [GameType.NONE]: '—',
};

const SICBO_COMBOS: number[][] = (() => {
  const combos: number[][] = [];
  for (let d1 = 1; d1 <= 6; d1 += 1) {
    for (let d2 = 1; d2 <= 6; d2 += 1) {
      for (let d3 = 1; d3 <= 6; d3 += 1) {
        combos.push([d1, d2, d3]);
      }
    }
  }
  return combos;
})();

const getRouletteMaxWin = (bets: RouletteBet[], maxOutcome: number) => {
  if (!bets.length) return 0;
  let max = -Infinity;
  for (let outcome = 0; outcome <= maxOutcome; outcome += 1) {
    max = Math.max(max, calculateRouletteExposure(outcome, bets));
  }
  return Math.max(0, max);
};

const getSicBoMaxWin = (bets: SicBoBet[]) => {
  if (!bets.length) return 0;
  let max = -Infinity;
  for (const combo of SICBO_COMBOS) {
    max = Math.max(max, calculateSicBoOutcomeExposure(combo, bets));
  }
  return Math.max(0, max);
};

const getCrapsMaxWin = (bets: CrapsBet[], point: number | null) => {
  if (!bets.length) return 0;
  let max = -Infinity;
  for (let total = 2; total <= 12; total += 1) {
    if ([4, 6, 8, 10].includes(total)) {
      max = Math.max(max, calculateCrapsExposure(total, point, bets, true));
      max = Math.max(max, calculateCrapsExposure(total, point, bets, false));
    } else {
      max = Math.max(max, calculateCrapsExposure(total, point, bets));
    }
  }
  return Math.max(0, max);
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
    <div className="absolute top-4 left-4 max-w-sm bg-white/80 backdrop-blur-xl border border-titanium-200 p-4 rounded-3xl shadow-float z-40">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-action-primary tracking-[0.2em] uppercase">Super Mode</div>
        {isRevealing && <div className="text-[9px] font-medium text-titanium-400 uppercase">Space to skip</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {visibleMultipliers.map((m, idx) => (
          <span
            key={`${m.id}-${m.superType}-${idx}`}
            className="px-3 py-1.5 rounded-full bg-titanium-50 border border-titanium-100 text-titanium-900 text-[11px] font-bold shadow-sm"
          >
            {formatMultiplier(m)}
          </span>
        ))}
        {multipliers.length === 0 && <span className="text-[11px] font-medium text-titanium-400 italic">Active</span>}
      </div>
    </div>
  );
};

interface ActiveGameProps {
  gameState: GameState;
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

export const ActiveGame: React.FC<ActiveGameProps> = ({ gameState, numberInput, onToggleHold, aiAdvice, actions, onOpenCommandPalette, reducedMotion = false, chips, playMode, currentBet, onBetChange }) => {
  if (gameState.type === GameType.NONE) {
     const handleOpen = () => onOpenCommandPalette?.();
     return (
         <div className="flex-1 flex flex-col items-center justify-center gap-8 py-12">
             <button
                 type="button"
                 onClick={handleOpen}
                 className="group relative flex flex-col items-center gap-6 focus:outline-none"
             >
                 <div className="w-48 h-48 rounded-full bg-white border border-titanium-200 shadow-float flex items-center justify-center group-hover:scale-105 group-active:scale-95 transition-all duration-300">
                    <span className="text-7xl font-light text-titanium-200 group-hover:text-action-primary transition-colors">/</span>
                 </div>
                 <div className="flex flex-col items-center gap-1">
                    <span className="text-[11px] font-bold text-titanium-400 tracking-[0.3em] uppercase">Select Experience</span>
                    <span className="text-[10px] text-titanium-300 font-medium uppercase">Press / to start</span>
                 </div>
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

    if (gameState.stage === 'BETTING') return `Place bets then ${primary}`;
    if (gameState.stage === 'RESULT') return `Next hand: ${primary}`;

    if (gameState.type === GameType.BLACKJACK) {
      if (msg.includes('INSURANCE')) return 'Insurance offered';
      return 'Standard actions available';
    }
    if (gameState.type === GameType.HILO) return 'Higher, lower, or cashout';
    if (gameState.type === GameType.VIDEO_POKER) return 'Select cards to hold';
    
    return 'Choose your move';
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
        return (gameState.bet || 0) + (gameState.blackjack21Plus3Bet || 0) + (gameState.insuranceBet || 0);
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
    gameState.insuranceBet,
    gameState.threeCardPairPlusBet,
    gameState.threeCardSixCardBonusBet,
    gameState.threeCardProgressiveBet,
    gameState.uthTripsBet,
    gameState.uthSixCardBonusBet,
    gameState.uthProgressiveBet,
    gameState.casinoWarTieBet,
  ]);
  const oddsLabel = ODDS_SUMMARY[gameState.type] ?? '—';
  const maxWin = React.useMemo(() => {
    switch (gameState.type) {
      case GameType.ROULETTE:
        return getRouletteMaxWin(
          gameState.rouletteBets,
          gameState.rouletteZeroRule === 'AMERICAN' ? ROULETTE_DOUBLE_ZERO : 36,
        );
      case GameType.SIC_BO:
        return getSicBoMaxWin(gameState.sicBoBets);
      case GameType.CRAPS:
        return getCrapsMaxWin(gameState.crapsBets, gameState.crapsPoint);
      default:
        return null;
    }
  }, [
    gameState.type,
    gameState.rouletteBets,
    gameState.rouletteZeroRule,
    gameState.sicBoBets,
    gameState.crapsBets,
    gameState.crapsPoint,
  ]);

  const firstHandKey = React.useMemo(() => {
    if (gameState.type === GameType.NONE) return null;
    return `ns_first_hand_${gameState.type.toLowerCase()}`;
  }, [gameState.type]);

  const [showFirstHand, setShowFirstHand] = useState(false);

  useEffect(() => {
    if (!firstHandKey || typeof window === 'undefined') return;
    const seen = window.localStorage.getItem(firstHandKey);
    if (!seen && gameState.stage === 'BETTING') setShowFirstHand(true);
    else setShowFirstHand(false);
  }, [firstHandKey, gameState.stage]);

  useEffect(() => {
    if (!showFirstHand || !firstHandKey || typeof window === 'undefined') return;
    if (totalBet > 0 || gameState.stage !== 'BETTING') {
      window.localStorage.setItem(firstHandKey, 'true');
      setShowFirstHand(false);
    }
  }, [showFirstHand, firstHandKey, totalBet, gameState.stage]);

  return (
    <>
         <div className="flex flex-col items-center gap-3 z-30 pointer-events-none select-none mb-6">
             <div className="px-4 py-1.5 rounded-full border border-titanium-200 bg-white/60 backdrop-blur-md shadow-soft text-[10px] font-bold tracking-widest uppercase text-titanium-400">
                 Status: <span className="text-titanium-900">{nextActionLabel()}</span>
             </div>
             {gameState.type !== GameType.NONE ? (
               <BetSlip totalBet={totalBet} oddsLabel={oddsLabel} maxWin={maxWin ?? undefined} />
             ) : null}
         </div>

         {showFirstHand && (
            <div className="flex justify-center mb-4">
              <div className="max-w-md rounded-3xl border border-titanium-200 bg-white/80 px-5 py-4 text-center shadow-soft backdrop-blur-md motion-state dark:border-titanium-800 dark:bg-titanium-900/70">
                <Label size="micro" variant="primary" className="mb-2 block">First hand</Label>
                <div className="text-sm font-semibold text-titanium-900 dark:text-titanium-100">
                  Pick a chip, place your bet, then confirm the play.
                </div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-titanium-400">
                  Provably fair • On-chain settlement
                </div>
              </div>
            </div>
         )}

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
         
         {aiAdvice && (
             <div className="absolute top-4 right-4 max-w-xs bg-white/90 backdrop-blur-xl border border-action-primary/30 p-5 rounded-[2rem] shadow-float z-40">
                 <div className="text-[10px] font-bold text-action-primary mb-2 uppercase tracking-[0.2em]">AI Insights</div>
                 <div className="text-sm text-titanium-800 font-medium leading-relaxed">{aiAdvice}</div>
             </div>
         )}
    </>
  );
};
