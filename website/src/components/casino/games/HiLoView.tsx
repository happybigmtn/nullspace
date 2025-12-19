
import React, { useCallback } from 'react';
import { GameState, Card } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { getHiLoRank } from '../../../utils/gameUtils';

interface HiLoViewProps {
    gameState: GameState;
    deck: Card[];
    actions?: {
        deal?: () => void;
        toggleShield?: () => void;
        toggleDouble?: () => void;
        hiloPlay?: (guess: 'HIGHER' | 'LOWER' | 'SAME') => void;
        hiloCashout?: () => void;
    };
}

export const HiLoView = React.memo<HiLoViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, deck, actions, lastWin, playMode }) => {
    // Keep the prop for compatibility (other games use the shared deck), but HiLo projections
    // must not depend on the local deck (on-chain play doesn't have a local deck).
    void deck;

    const currentCard = gameState.playerCards[gameState.playerCards.length - 1];
    const currentRank = currentCard ? getHiLoRank(currentCard) : 7; // 1..13, default to middle
    const isAtAce = currentRank === 1;
    const isAtKing = currentRank === 13;

    const nextGuessMultiplier = useCallback(
        (guess: 'HIGHER' | 'LOWER' | 'SAME') => {
            if (!currentCard) return '0.00x';

            // Match on-chain hilo.rs `calculate_multiplier`:
            // - Same (at edges): 1 rank wins = 13x
            // - Higher: strictly higher wins, same = push
            // - Lower: strictly lower wins, same = push
            const rank = currentRank;
            let winningRanks: number;

            if (guess === 'SAME') {
                winningRanks = 1; // 13x
            } else if (guess === 'HIGHER') {
                if (rank === 13) return '—'; // Invalid at King
                winningRanks = 13 - rank; // Strictly higher
            } else {
                // LOWER
                if (rank === 1) return '—'; // Invalid at Ace
                winningRanks = rank - 1; // Strictly lower
            }

            if (winningRanks <= 0) return '—';
            const bps = Math.floor((13 * 10_000) / winningRanks);
            return (bps / 10_000).toFixed(2) + 'x';
        },
        [currentCard, currentRank]
    );

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-8 relative z-10 pt-8 sm:pt-10 pb-32">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">HILO</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="HILO">
                        <div className="space-y-3">
                            <div className="text-[11px] text-gray-300 leading-relaxed">
                                Guess whether the next card is higher or lower than the current card. Cash out anytime to
                                lock in the pot.
                            </div>
                            <div className="text-[10px] text-gray-600 leading-relaxed">
                                Multipliers shown are based on remaining winning ranks (A is low, K is high).
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                
                {/* TOP: POT */}
                <div className="min-h-[60px] sm:min-h-[80px] flex flex-col items-center justify-center w-full max-w-md">
                     <div className="text-2xl sm:text-3xl text-terminal-gold font-bold mb-1 sm:mb-2 tracking-widest">
                         POT: ${gameState.hiloAccumulator.toLocaleString()}
                     </div>
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                        <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                            {gameState.message}
                        </div>
                </div>

                {/* Current Card & Projections */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
                    {gameState.playerCards.length > 0 && (
                        <div className="flex flex-col gap-2 items-center">
                            <span className="text-xs uppercase tracking-widest text-gray-500">CURRENT CARD</span>
                            <div className="flex items-center gap-4">
                                {/* LEFT PROJECTION: Lower (normal/King) or Same (Ace) */}
                                <div className="text-right opacity-80">
                                    <div className="text-[10px] text-gray-500 uppercase">
                                        {isAtAce ? 'SAME' : 'LOWER'}
                                    </div>
                                    <div className="text-terminal-green font-bold text-sm">
                                        {isAtAce ? nextGuessMultiplier('SAME') : nextGuessMultiplier('LOWER')}
                                    </div>
                                </div>

                                <Hand cards={[gameState.playerCards[gameState.playerCards.length - 1]]} />

                                {/* RIGHT PROJECTION: Higher (normal/Ace) or Same (King) */}
                                <div className="text-left opacity-80">
                                    <div className="text-[10px] text-gray-500 uppercase">
                                        {isAtKing ? 'SAME' : 'HIGHER'}
                                    </div>
                                    <div className="text-terminal-green font-bold text-sm">
                                        {isAtKing ? nextGuessMultiplier('SAME') : nextGuessMultiplier('HIGHER')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* BOTTOM: History */}
                <div className="min-h-[48px] sm:min-h-[60px] flex items-center justify-center">
                     {gameState.playerCards.length > 1 && (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-[10px] uppercase tracking-widest text-gray-600">CARD HISTORY</span>
                            <div className="flex gap-2 opacity-50 scale-75 origin-top">
                                {gameState.playerCards.slice(0, -1).slice(-8).map((c, i) => (
                                    <Hand key={i} cards={[c]} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* CONTROLS */}
            {(gameState.stage === 'BETTING' || gameState.stage === 'RESULT') ? (
                <GameControlBar
                    primaryAction={{
                        label: 'DEAL',
                        onClick: actions?.deal,
                        className: 'w-full sm:w-auto',
                    }}
                    secondaryActions={playMode !== 'CASH' ? [
                        {
                            label: 'SHIELD',
                            onClick: actions?.toggleShield,
                            active: gameState.activeModifiers.shield,
                        },
                        {
                            label: 'DOUBLE',
                            onClick: actions?.toggleDouble,
                            active: gameState.activeModifiers.double,
                        },
                    ] : []}
                />
            ) : (
                <GameControlBar variant="stack">
                    <button
                        type="button"
                        onClick={actions?.hiloCashout}
                        className="w-full h-12 rounded border border-terminal-gold/60 bg-terminal-gold/10 text-terminal-gold font-bold tracking-widest uppercase hover:bg-terminal-gold/20"
                    >
                        <span className="ns-keycap">C</span> CASHOUT · LOCK POT
                    </button>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                        {/* LEFT BUTTON: Lower (normal/King) or Same (Ace) */}
                        <button
                            type="button"
                            onClick={() => actions?.hiloPlay?.(isAtAce ? 'SAME' : 'LOWER')}
                            className="h-16 rounded border border-terminal-accent/60 bg-black/50 hover:bg-terminal-accent/10 flex flex-col items-center justify-center"
                        >
                            <div className="text-[10px] text-gray-500 tracking-widest uppercase">
                                <span className="ns-keycap text-terminal-accent font-bold">{isAtAce ? 'S' : 'L'}</span> {isAtAce ? 'SAME' : 'LOWER'}
                            </div>
                            <div className="text-terminal-accent font-bold text-sm">
                                {isAtAce ? nextGuessMultiplier('SAME') : nextGuessMultiplier('LOWER')}
                            </div>
                        </button>
                        {/* RIGHT BUTTON: Higher (normal/Ace) or Same (King) */}
                        <button
                            type="button"
                            onClick={() => actions?.hiloPlay?.(isAtKing ? 'SAME' : 'HIGHER')}
                            className="h-16 rounded border border-terminal-green/60 bg-black/50 hover:bg-terminal-green/10 flex flex-col items-center justify-center"
                        >
                            <div className="text-[10px] text-gray-500 tracking-widest uppercase">
                                <span className="ns-keycap text-terminal-green font-bold">{isAtKing ? 'S' : 'H'}</span> {isAtKing ? 'SAME' : 'HIGHER'}
                            </div>
                            <div className="text-terminal-green font-bold text-sm">
                                {isAtKing ? nextGuessMultiplier('SAME') : nextGuessMultiplier('HIGHER')}
                            </div>
                        </button>
                    </div>
                </GameControlBar>
            )}
        </>
    );
});
