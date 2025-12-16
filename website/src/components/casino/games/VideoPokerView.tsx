
import React, { useCallback, useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { evaluateVideoPokerHand } from '../../../utils/gameUtils';

interface VideoPokerViewProps {
    gameState: GameState;
    onToggleHold: (index: number) => void;
    actions?: {
        deal?: () => void;
        drawVideoPoker?: () => void;
    };
}

const VIDEO_POKER_PAYTABLE: Array<{ rank: string; multiplier: number }> = [
    { rank: 'ROYAL FLUSH', multiplier: 800 },
    { rank: 'STRAIGHT FLUSH', multiplier: 50 },
    { rank: 'FOUR OF A KIND', multiplier: 25 },
    { rank: 'FULL HOUSE', multiplier: 9 },
    { rank: 'FLUSH', multiplier: 6 },
    { rank: 'STRAIGHT', multiplier: 4 },
    { rank: 'THREE OF A KIND', multiplier: 3 },
    { rank: 'TWO PAIR', multiplier: 2 },
    { rank: 'JACKS OR BETTER', multiplier: 1 },
];

export const VideoPokerView = React.memo<VideoPokerViewProps & { lastWin?: number }>(({ gameState, onToggleHold, actions, lastWin }) => {
    const handleToggleHold = useCallback((index: number) => {
        onToggleHold(index);
    }, [onToggleHold]);

    const handEval = useMemo(() => {
        if (gameState.playerCards.length !== 5) return null;
        try {
            return evaluateVideoPokerHand(gameState.playerCards);
        } catch {
            return null;
        }
    }, [gameState.playerCards]);

    const highlightRank = gameState.stage === 'RESULT' ? handEval?.rank ?? null : null;
    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">VIDEO POKER</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="VIDEO POKER">
                        <div className="space-y-3">
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-gray-800 pb-1">
                                Paytable
                            </div>
                            <div className="space-y-1">
                                {VIDEO_POKER_PAYTABLE.map((row) => {
                                    const active = highlightRank === row.rank;
                                    return (
                                        <div
                                            key={row.rank}
                                            className={[
                                                'flex items-center justify-between rounded border px-2 py-1 text-[11px]',
                                                active
                                                    ? 'border-terminal-green bg-terminal-green/10 text-terminal-green'
                                                    : 'border-gray-800 bg-black/40 text-gray-300',
                                            ].join(' ')}
                                        >
                                            <span className="truncate pr-2">{row.rank}</span>
                                            <span className="text-white">{row.multiplier}x</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="text-[10px] text-gray-600 leading-relaxed">
                                Tap cards (or press 1–5) to toggle HOLD. DRAW replaces unheld cards.
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                        {gameState.message}{lastWin && lastWin > 0 ? ` (+$${lastWin})` : ''}
                    </div>
                    {handEval && gameState.stage !== 'BETTING' ? (
                        <div
                            className={[
                                'text-[10px] tracking-widest uppercase',
                                handEval.multiplier > 0 ? 'text-terminal-green' : 'text-gray-600',
                            ].join(' ')}
                        >
                            {handEval.rank}
                            {handEval.multiplier > 0 ? ` · x${handEval.multiplier}` : ''}
                        </div>
                    ) : null}
                </div>

                {/* Hand Area */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-4 items-center justify-center">
                    {gameState.playerCards.length > 0 && gameState.playerCards.map((card, i) => (
                        <button
                            key={i}
                            type="button"
                            onClick={() => handleToggleHold(i)}
                            aria-pressed={!!card.isHeld}
                            className="flex flex-col gap-2 cursor-pointer transition-transform hover:-translate-y-2"
                        >
                             <Hand cards={[card]} />
                             <div className={`text-center text-[10px] font-bold py-1 border rounded ${card.isHeld ? 'border-terminal-green text-terminal-green bg-terminal-green/10' : 'border-transparent text-transparent'}`}>
                                 HOLD
                             </div>
                             <div className="text-center text-[10px] text-gray-600">[{i+1}]</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* CONTROLS */}
            <GameControlBar
                primaryAction={
                    (gameState.stage === 'BETTING' || gameState.stage === 'RESULT')
                        ? { label: 'DEAL', onClick: actions?.deal, className: 'w-full sm:w-auto' }
                        : { label: 'DRAW', onClick: actions?.drawVideoPoker, className: 'w-full sm:w-auto' }
                }
                secondaryActions={
                    gameState.stage === 'PLAYING'
                        ? [1, 2, 3, 4, 5].map((n) => ({
                            label: `HOLD ${n}`,
                            onClick: () => handleToggleHold(n - 1),
                            active: gameState.playerCards[n - 1]?.isHeld,
                        }))
                        : []
                }
            />
        </>
    );
});
