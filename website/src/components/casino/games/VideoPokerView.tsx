
import React, { useCallback, useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
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

export const VideoPokerView = React.memo<VideoPokerViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, onToggleHold, actions, lastWin, playMode }) => {
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
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20">
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
                                            className={`flex items-center justify-between rounded border-2 px-2 py-1 text-[11px] font-mono ${
                                                active
                                                    ? 'border-action-success bg-action-success/10 text-action-success'
                                                    : 'border-gray-800 bg-black/40 text-gray-300'
                                            }`}
                                        >
                                            <span className="truncate pr-2">{row.rank}</span>
                                            <span className="text-white">{row.multiplier}x</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="text-[10px] text-gray-600 leading-relaxed font-mono">
                                Tap cards (or press 1–5) to toggle HOLD. DRAW replaces unheld cards.
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className="text-lg sm:text-2xl font-bold text-action-primary tracking-widest leading-tight animate-pulse font-mono">
                        {gameState.message}
                    </div>
                    {handEval && gameState.stage !== 'BETTING' ? (
                        <div className={`text-[10px] tracking-widest uppercase font-mono ${
                            handEval.multiplier > 0 ? 'text-action-success' : 'text-gray-600'
                        }`}>
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
                             <div className={`text-center text-[10px] font-bold py-1 border-2 rounded font-mono tracking-widest ${
                                card.isHeld
                                    ? 'border-action-success text-action-success bg-action-success/10'
                                    : 'border-transparent text-transparent'
                             }`}>
                                 HOLD
                             </div>
                             <div className="text-center text-[10px] text-gray-600 font-mono">[{i+1}]</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* LEFT SIDEBAR - PAY TABLE */}
            <div className="hidden lg:flex absolute top-0 left-0 bottom-24 w-56 bg-titanium-900/80 border-r-2 border-gray-700 backdrop-blur-sm z-30 flex-col">
                <div className="flex-none border-b border-gray-800 py-2">
                    <div className="text-[10px] font-bold tracking-widest uppercase text-center text-action-success">
                        PAY TABLE
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    <div className="space-y-1">
                        {VIDEO_POKER_PAYTABLE.map((row) => {
                            const active = highlightRank === row.rank;
                            return (
                                <div
                                    key={row.rank}
                                    className={`flex items-center justify-between rounded border-2 px-2 py-1.5 text-[11px] font-mono transition-colors ${
                                        active
                                            ? 'border-action-success bg-action-success/10 text-action-success'
                                            : 'border-gray-800 bg-black/40 text-gray-300'
                                    }`}
                                >
                                    <span className="truncate pr-2">{row.rank}</span>
                                    <span className="text-white font-bold">{row.multiplier}x</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* CONTROLS */}
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 bg-titanium-900/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-16 md:h-20 flex items-center justify-center gap-2 md:gap-3 p-2 md:px-4">
                    {gameState.stage === 'PLAYING' && (
                        <>
                            <div className="flex md:hidden items-center gap-2">
                                <MobileDrawer label="HOLD" title="HOLD CARDS">
                                    <div className="rounded border border-gray-800 bg-black/40 p-2">
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {[1, 2, 3, 4, 5].map((n) => {
                                            const isHeld = gameState.playerCards[n - 1]?.isHeld;
                                            return (
                                                <button
                                                    key={n}
                                                    type="button"
                                                    onClick={() => handleToggleHold(n - 1)}
                                                    className={`py-3 rounded border text-xs font-bold ${
                                                        isHeld
                                                            ? 'border-action-success bg-action-success/20 text-action-success'
                                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                                                        }`}
                                                >
                                                    HOLD {n}
                                                </button>
                                            );
                                        })}
                                        </div>
                                    </div>
                                </MobileDrawer>
                            </div>
                            <div className="hidden md:flex items-center gap-2">
                                {[1, 2, 3, 4, 5].map((n) => {
                                    const isHeld = gameState.playerCards[n - 1]?.isHeld;
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            onClick={() => handleToggleHold(n - 1)}
                                            className={`h-12 px-4 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                                isHeld
                                                    ? 'border-action-success bg-action-success/20 text-action-success'
                                                    : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                            }`}
                                        >
                                            HOLD {n}
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={
                            (gameState.stage === 'BETTING' || gameState.stage === 'RESULT')
                                ? actions?.deal
                                : actions?.drawVideoPoker
                        }
                        className="h-12 md:h-14 px-6 md:px-8 rounded border-2 font-bold text-sm md:text-base tracking-widest uppercase font-mono transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-action-success bg-action-success text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                    >
                        <span className="ns-keycap ns-keycap-dark">⎵</span> {(gameState.stage === 'BETTING' || gameState.stage === 'RESULT') ? 'DEAL' : 'DRAW'}
                    </button>
                </div>
            </div>
        </>
    );
});
