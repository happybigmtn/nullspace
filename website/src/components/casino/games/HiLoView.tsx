
import React, { useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';

interface HiLoViewProps {
    gameState: GameState;
    actions?: {
        deal?: () => void;
        toggleShield?: () => void;
        toggleDouble?: () => void;
        hiloPlay?: (guess: 'HIGHER' | 'LOWER' | 'SAME') => void;
        hiloCashout?: () => void;
    };
}

export const HiLoView = React.memo<HiLoViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, actions, lastWin, playMode }) => {
    const currentCard = gameState.playerCards[gameState.playerCards.length - 1];
    const nextMultipliers = gameState.hiloNextMultipliers;
    const lowerMultiplier = nextMultipliers?.lower ?? 0;
    const higherMultiplier = nextMultipliers?.higher ?? 0;
    const sameMultiplier = nextMultipliers?.same ?? 0;
    const showLower = lowerMultiplier > 0;
    const showHigher = higherMultiplier > 0;
    const showSame = sameMultiplier > 0;

    const formatMultiplier = (bps: number) => (
        bps > 0 ? `${(bps / 10_000).toFixed(2)}x` : '—'
    );

    const options = useMemo(() => {
        const list: Array<{ id: 'LOWER' | 'SAME' | 'HIGHER'; label: string; key: string; multiplier: number; tone: 'destructive' | 'primary' | 'success' }> = [];
        if (showLower) list.push({ id: 'LOWER', label: 'LOWER', key: 'L', multiplier: lowerMultiplier, tone: 'destructive' });
        if (showSame) list.push({ id: 'SAME', label: 'SAME', key: 'S', multiplier: sameMultiplier, tone: 'primary' });
        if (showHigher) list.push({ id: 'HIGHER', label: 'HIGHER', key: 'H', multiplier: higherMultiplier, tone: 'success' });
        return list;
    }, [showLower, showSame, showHigher, lowerMultiplier, sameMultiplier, higherMultiplier]);

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-8 relative z-10 pt-8 sm:pt-10 pb-32">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase zen-hide">HILO</h1>
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
                
                {/* TOP: POT with accumulator graph */}
                <div className="min-h-[60px] sm:min-h-[80px] flex flex-col items-center justify-center w-full max-w-md">
                     <div className="text-2xl sm:text-3xl text-mono-0 dark:text-mono-1000 font-mono font-bold mb-1 sm:mb-2 tracking-widest">
                         POT: ${gameState.hiloAccumulator.toLocaleString()}
                     </div>
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20 zen-hide">
                        <div className="text-lg sm:text-2xl font-bold text-mono-0 dark:text-mono-1000 tracking-widest leading-tight animate-pulse">
                            {gameState.message}
                        </div>
                </div>

                {/* Current Card & Projections */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
                    {gameState.playerCards.length > 0 && (
                        <div className="flex flex-col gap-2 items-center">
                            <span className="text-xs uppercase tracking-widest text-gray-500">CURRENT CARD</span>
                            <div className="flex items-center gap-4">
                                {/* LEFT PROJECTION */}
                                <div className="text-right opacity-80 min-w-[56px]">
                                    <div className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">
                                        {showLower ? 'LOWER' : showSame && !showHigher ? 'SAME' : '—'}
                                    </div>
                                    <div className="text-mono-0 dark:text-mono-1000 font-bold font-mono font-bold text-sm">
                                        {showLower ? formatMultiplier(lowerMultiplier) : showSame && !showHigher ? formatMultiplier(sameMultiplier) : '—'}
                                    </div>
                                </div>

                                <Hand cards={[gameState.playerCards[gameState.playerCards.length - 1]]} />

                                {/* RIGHT PROJECTION */}
                                <div className="text-left opacity-80 min-w-[56px]">
                                    <div className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">
                                        {showHigher ? 'HIGHER' : showSame && !showLower ? 'SAME' : '—'}
                                    </div>
                                    <div className="text-mono-0 dark:text-mono-1000 font-bold font-mono font-bold text-sm">
                                        {showHigher ? formatMultiplier(higherMultiplier) : showSame && !showLower ? formatMultiplier(sameMultiplier) : '—'}
                                    </div>
                                </div>
                            </div>
                            {showSame && showLower && showHigher && (
                                <div className="text-center opacity-80">
                                    <div className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">SAME</div>
                                    <div className="text-mono-0 dark:text-mono-1000 font-mono font-bold text-sm">
                                        {formatMultiplier(sameMultiplier)}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* BOTTOM: History */}
                <div className="min-h-[48px] sm:min-h-[60px] flex items-center justify-center zen-hide">
                     {gameState.playerCards.length > 1 && (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-[11px] uppercase tracking-widest text-gray-400">CARD HISTORY</span>
                            <div className="flex gap-2 opacity-80 scale-90 origin-top">
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
                        className: 'w-full md:w-auto',
                    }}
                    /* LUX-012: Modifiers in collapsible accordion */
                    modifiers={playMode !== 'CASH' ? {
                        shield: {
                            active: gameState.activeModifiers.shield,
                            available: true,
                            onToggle: actions?.toggleShield,
                        },
                        double: {
                            active: gameState.activeModifiers.double,
                            available: true,
                            onToggle: actions?.toggleDouble,
                        },
                    } : undefined}
                />
            ) : (
                <GameControlBar variant="stack">
                    <button
                        type="button"
                        onClick={actions?.hiloCashout}
                        className="w-full h-12 rounded border-2 border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000 font-mono font-bold tracking-widest uppercase hover:bg-mono-0/20 transition-all"
                    >
                        <span className="ns-keycap">C</span> CASHOUT · LOCK POT
                    </button>
                    <div className={`mt-2 grid ${options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                        {options.map((option) => {
                            const toneClass = option.tone === 'destructive'
                                ? 'border-mono-400 text-mono-400 dark:text-mono-500 hover:bg-mono-400/10'
                                : option.tone === 'success'
                                    ? 'border-mono-0 text-mono-0 dark:text-mono-1000 font-bold hover:bg-mono-0/10'
                                    : 'border-mono-0 text-mono-0 dark:text-mono-1000 hover:bg-mono-0/10';
                            const keycapClass = option.tone === 'destructive'
                                ? 'text-mono-400 dark:text-mono-500'
                                : option.tone === 'success'
                                    ? 'text-mono-0 dark:text-mono-1000 font-bold'
                                    : 'text-mono-0 dark:text-mono-1000';

                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => actions?.hiloPlay?.(option.id)}
                                    className={`h-16 rounded border-2 bg-black/50 transition-all flex flex-col items-center justify-center ${toneClass}`}
                                >
                                    <div className="text-[10px] text-gray-400 tracking-widest uppercase font-mono">
                                        <span className={`ns-keycap font-bold ${keycapClass}`}>{option.key}</span> {option.label}
                                    </div>
                                    <div className={`font-mono font-bold text-sm ${keycapClass}`}>
                                        {formatMultiplier(option.multiplier)}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </GameControlBar>
            )}
        </>
    );
});
