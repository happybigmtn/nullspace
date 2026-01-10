
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

const ODDS_SUMMARY: Record<GameType, string> = {
  [GameType.BLACKJACK]: '1:1–3:2',
  [GameType.CRAPS]: '1:1–175:1',
  [GameType.ROULETTE]: '1:1–35:1',
  [GameType.SIC_BO]: '1:1–180:1',
  [GameType.BACCARAT]: '0.5:1–250:1',
  [GameType.HILO]: '1:1+',
  [GameType.VIDEO_POKER]: '1:1–800:1',
  [GameType.THREE_CARD]: '1:1–40:1+',
  [GameType.ULTIMATE_HOLDEM]: '1:1–500:1',
  [GameType.CASINO_WAR]: '1:1–10:1',
  [GameType.NONE]: '—',
};

const SHORTCUT_HINTS: Partial<Record<GameType, string[]>> = {
  [GameType.BLACKJACK]: ['Space Deal', 'H Hit', 'S Stand', 'D Double', 'P Split', '1–5 Side Bets'],
  [GameType.BACCARAT]: ['Space Deal', 'P Player', 'B Banker', 'E Tie', 'Shift+2 Side Bets'],
  [GameType.CRAPS]: ['Space Roll', 'Z Shield', 'G Super'],
  [GameType.ROULETTE]: ['Space Spin', 'T Rebet', 'U Undo'],
  [GameType.SIC_BO]: ['Space Roll', 'R Rebet', 'U Undo'],
  [GameType.HILO]: ['H Higher', 'L Lower', 'S Same', 'C Cashout'],
  [GameType.VIDEO_POKER]: ['Space Deal/Draw', '1–5 Hold'],
  [GameType.THREE_CARD]: ['Space Deal', 'P Play', 'F Fold'],
  [GameType.ULTIMATE_HOLDEM]: ['Space Deal', 'C Check', '1/2/3/4 Bet', 'F Fold'],
  [GameType.CASINO_WAR]: ['Space Deal', 'W War', 'S Surrender', 'T Tie'],
};

const GLOBAL_SHORTCUTS = ['Alt+L Feed', '/ Games', '? Help'];

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
  aiAdvice: string | null;
  actions: any;
  onOpenCommandPalette?: () => void;
  reducedMotion?: boolean;
  chips?: number;
  playMode: 'CASH' | 'FREEROLL' | null;
  currentBet?: number;
  onBetChange?: (bet: number) => void;
  focusMode?: boolean;
}

const formatAmount = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  return Math.floor(amount).toLocaleString();
};

export const ActiveGame: React.FC<ActiveGameProps> = ({ gameState, numberInput, onToggleHold, aiAdvice, actions, onOpenCommandPalette, reducedMotion = false, chips, playMode, currentBet, onBetChange, focusMode = false }) => {
  const [showShortcutOverlay, setShowShortcutOverlay] = useState(true);
  const shortcutTimerRef = React.useRef<number | null>(null);
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
  const oddsLabel = ODDS_SUMMARY[gameState.type] ?? '—';
  const shortcutHints = useMemo(() => {
    const base = SHORTCUT_HINTS[gameState.type] ?? ['Space Deal'];
    return [...base, ...GLOBAL_SHORTCUTS];
  }, [gameState.type]);

  useEffect(() => {
    setShowShortcutOverlay(true);
    if (shortcutTimerRef.current) window.clearTimeout(shortcutTimerRef.current);
    shortcutTimerRef.current = window.setTimeout(() => {
      setShowShortcutOverlay(false);
    }, 5000);
    return () => {
      if (shortcutTimerRef.current) window.clearTimeout(shortcutTimerRef.current);
    };
  }, [gameState.type, gameState.stage]);

  useEffect(() => {
    const dismiss = () => setShowShortcutOverlay(false);
    window.addEventListener('keydown', dismiss);
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, []);

  const parsedShortcuts = useMemo(
    () => shortcutHints.map((hint) => {
      const [key, ...rest] = hint.split(' ');
      return { key, label: rest.join(' ') };
    }),
    [shortcutHints]
  );
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

        {aiAdvice && (
          <div className="absolute top-4 right-4 max-w-xs bg-terminal-black border border-terminal-accent p-4 rounded shadow-lg z-40 text-xs">
            <div className="font-bold text-terminal-accent mb-1">AI ADVICE</div>
            {aiAdvice}
          </div>
        )}
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
         <div className={`flex flex-col items-center gap-3 z-30 pointer-events-none select-none ${focusMode ? 'mb-2' : 'mb-6'}`}>
             {focusMode ? (
                 <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-medium text-ns-muted">
                     <span className="uppercase tracking-[0.24em] text-[9px] font-semibold text-ns-muted">Status</span>
                     <span className="text-ns">{nextActionLabel()}</span>
                     <span className="h-3 w-px bg-ns-border opacity-60" />
                     <span className="uppercase tracking-[0.24em] text-[9px] font-semibold text-ns-muted">Bet</span>
                     <span className="text-ns">${formatAmount(totalBet)}</span>
                     <span className="text-ns-muted">Odds {oddsLabel}</span>
                     {typeof maxWin === 'number' && (
                       <span className="text-ns-muted">Max ${formatAmount(maxWin)}</span>
                     )}
                 </div>
             ) : (
               <>
                 <div className="px-4 py-1.5 rounded-full border border-ns bg-ns-surface backdrop-blur-md shadow-soft text-[10px] font-bold tracking-widest uppercase text-ns-muted">
                     Status: <span className="text-ns">{nextActionLabel()}</span>
                 </div>
                 <BetSlip totalBet={totalBet} oddsLabel={oddsLabel} maxWin={maxWin ?? undefined} />
               </>
             )}
             {parsedShortcuts.length > 0 && (
               <div className="flex flex-wrap items-center justify-center gap-2 text-[9px] uppercase tracking-[0.2em] text-ns-muted zen-quiet">
                 {parsedShortcuts.map((shortcut) => (
                   <div key={`${shortcut.key}-${shortcut.label}`} className="flex items-center gap-2">
                     <span className="ns-keycap">{shortcut.key}</span>
                     {shortcut.label ? (
                       <span className="text-ns-muted">
                         {shortcut.label}
                       </span>
                     ) : null}
                   </div>
                 ))}
               </div>
             )}
         </div>

         {showShortcutOverlay && parsedShortcuts.length > 0 && (
           <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-scale-in">
             <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-ns bg-ns-surface px-3 py-2 shadow-soft backdrop-blur-md">
               {parsedShortcuts.map((shortcut) => (
                 <div key={`${shortcut.key}-${shortcut.label}`} className="flex items-center gap-2">
                   <span className="ns-keycap">{shortcut.key}</span>
                   {shortcut.label ? (
                     <span className="text-[9px] uppercase tracking-[0.2em] text-ns-muted">
                       {shortcut.label}
                     </span>
                   ) : null}
                 </div>
               ))}
             </div>
           </div>
         )}

         {showFirstHand && !focusMode && (
            <div className="flex justify-center mb-4">
              <div className="max-w-md rounded-3xl liquid-card liquid-sheen border border-ns px-5 py-4 text-center shadow-soft backdrop-blur-md motion-state">
                <Label size="micro" variant="primary" className="mb-2 block">First hand</Label>
                <div className="text-sm font-semibold text-ns">
                  Pick a chip, place your bet, then confirm the play.
                </div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-ns-muted">
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
         
         {aiAdvice && !focusMode && (
             <div className="absolute top-4 right-4 max-w-xs liquid-card liquid-sheen border border-ns p-5 rounded-[2rem] shadow-float z-40">
                 <div className="text-[10px] font-bold text-mono-0 dark:text-mono-1000 mb-2 uppercase tracking-[0.2em]">AI Insights</div>
                 <div className="text-sm text-ns font-medium leading-relaxed">{aiAdvice}</div>
             </div>
         )}
    </>
  );
};
