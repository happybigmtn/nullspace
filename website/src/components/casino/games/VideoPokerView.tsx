
import React, { useCallback, useMemo, useEffect, useState } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { evaluateVideoPokerHand } from '../../../utils/gameUtils';
import { CardAnimationOverlay } from '../3d/CardAnimationOverlay';
import { buildCardsById, buildRowSlots } from '../3d/cardLayouts';
import { deriveSessionRoundId } from '../3d/engine/GuidedRound';

// Simple mobile detection hook
const useIsMobile = () => {
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 640);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);
    return isMobile;
};

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

export const VideoPokerView = React.memo<VideoPokerViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null; onAnimationBlockingChange?: (blocking: boolean) => void }>(({ gameState, onToggleHold, actions, lastWin, playMode, onAnimationBlockingChange }) => {
    const handleToggleHold = useCallback((index: number) => {
        onToggleHold(index);
    }, [onToggleHold]);
    const isMobile = useIsMobile();
    const roundId = useMemo(() => {
        if (gameState.sessionId === null || !Number.isFinite(gameState.moveNumber)) return undefined;
        return deriveSessionRoundId(gameState.sessionId, gameState.moveNumber);
    }, [gameState.moveNumber, gameState.sessionId]);

    const handEval = useMemo(() => {
        if (gameState.playerCards.length !== 5) return null;
        try {
            return evaluateVideoPokerHand(gameState.playerCards);
        } catch {
            return null;
        }
    }, [gameState.playerCards]);

    const highlightRank = gameState.stage === 'RESULT' ? handEval?.rank ?? null : null;
    const animationActive = useMemo(
        () => /DEALING|DRAWING|WAITING FOR CHAIN/.test(gameState.message),
        [gameState.message]
    );
    const playerSlots = useMemo(() => buildRowSlots('player', 5, 0.9, { spacing: 1.35, fan: 0.05 }), []);
    const dealOrder = useMemo(() => ['player-0', 'player-1', 'player-2', 'player-3', 'player-4'], []);
    const cardsById = useMemo(() => buildCardsById('player', gameState.playerCards, 5), [gameState.playerCards]);
    return (
        <>
            <CardAnimationOverlay
                slots={playerSlots}
                dealOrder={dealOrder}
                cardsById={cardsById}
                isActionActive={animationActive}
                storageKey="video-poker-3d-mode"
                guidedGameType="videoPoker"
                roundId={roundId}
                onAnimationBlockingChange={onAnimationBlockingChange}
                isMobile={isMobile}
            />
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
                                                    ? 'border-terminal-green bg-terminal-green/10 text-terminal-green'
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
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse font-mono">
                        {gameState.message}
                    </div>
                    {handEval && gameState.stage !== 'BETTING' ? (
                        <div className={`text-[10px] tracking-widest uppercase font-mono ${
                            handEval.multiplier > 0 ? 'text-terminal-green' : 'text-gray-600'
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
                                    ? 'border-terminal-green text-terminal-green bg-terminal-green/10'
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
            <div className="hidden md:flex absolute top-0 left-0 bottom-24 w-56 bg-terminal-black/80 border-r-2 border-gray-700 backdrop-blur-sm z-30 flex-col">
                <div className="flex-none border-b border-gray-800 py-2">
                    <div className="text-[10px] font-bold tracking-widest uppercase text-center text-terminal-green">
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
                                            ? 'border-terminal-green bg-terminal-green/10 text-terminal-green'
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
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 sm:sticky sm:bottom-0 bg-terminal-black/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] sm:pb-0">
                <div className="h-16 sm:h-20 flex items-center justify-center gap-2 sm:gap-3 p-2 sm:px-4">
                    {gameState.stage === 'PLAYING' && (
                        <div className="hidden sm:flex items-center gap-2">
                            {[1, 2, 3, 4, 5].map((n) => {
                                const isHeld = gameState.playerCards[n - 1]?.isHeld;
                                return (
                                    <button
                                        key={n}
                                        type="button"
                                        onClick={() => handleToggleHold(n - 1)}
                                        className={`h-12 px-4 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                            isHeld
                                                ? 'border-terminal-green bg-terminal-green/20 text-terminal-green'
                                                : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                        }`}
                                    >
                                        HOLD {n}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={
                            (gameState.stage === 'BETTING' || gameState.stage === 'RESULT')
                                ? actions?.deal
                                : actions?.drawVideoPoker
                        }
                        className="h-12 sm:h-14 px-6 sm:px-8 rounded border-2 font-bold text-sm sm:text-base tracking-widest uppercase font-mono transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-terminal-green bg-terminal-green text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                    >
                        {(gameState.stage === 'BETTING' || gameState.stage === 'RESULT') ? 'DEAL' : 'DRAW'}
                    </button>
                </div>
            </div>
        </>
    );
});
