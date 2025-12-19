
import React from 'react';
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
}

export const ActiveGame: React.FC<ActiveGameProps> = ({ gameState, deck, numberInput, onToggleHold, aiAdvice, actions, onOpenCommandPalette, reducedMotion = false, chips, playMode }) => {
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

  const prevChipsRef = React.useRef(chips);
  const [transientWin, setTransientWin] = React.useState(0);

  React.useEffect(() => {
    if (chips !== undefined && prevChipsRef.current !== undefined) {
      const diff = chips - prevChipsRef.current;
      if (diff > 0) {
        setTransientWin(diff);
      } else {
        setTransientWin(0);
      }
    }
    prevChipsRef.current = chips;
  }, [chips]);

  React.useEffect(() => {
    setTransientWin(0);
  }, [gameState.type]);

  const displayWin = gameState.stage === 'RESULT' ? gameState.lastResult : transientWin;

  return (
    <>
         <div className="flex justify-center z-30 pointer-events-none select-none mb-2">
             <div className="px-3 py-1 rounded border border-gray-800 bg-black/60 text-[10px] tracking-widest uppercase text-gray-300">
                 NEXT: <span className="text-white">{nextActionLabel()}</span>
             </div>
         </div>


	         <BigWinEffect 
	            amount={gameState.stage === 'RESULT' ? gameState.lastResult : transientWin} 
	            show={gameState.stage === 'RESULT' ? gameState.lastResult > 0 : transientWin > 0} 
	            durationMs={gameState.type === GameType.BLACKJACK ? 1000 : undefined}
                reducedMotion={reducedMotion}
	         />

         {gameState.type === GameType.BLACKJACK && <BlackjackView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
         {gameState.type === GameType.CRAPS && <CrapsView gameState={gameState} actions={actions} lastWin={displayWin} playMode={playMode} />}
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
