
import React, { useMemo, useState } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { getVisibleHandValue } from '../../../utils/gameUtils';
import { cardIdToString } from '../../../utils/gameStateParser';

const CHIP_VALUES = [1, 5, 25, 100, 500, 1000, 5000, 10000];

// Casino chip colors by denomination
const CHIP_COLORS: Record<number, { bg: string; border: string; text: string }> = {
    1: { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-800' },
    5: { bg: 'bg-red-600', border: 'border-red-400', text: 'text-white' },
    25: { bg: 'bg-green-600', border: 'border-green-400', text: 'text-white' },
    100: { bg: 'bg-gray-900', border: 'border-gray-600', text: 'text-white' },
    500: { bg: 'bg-purple-600', border: 'border-purple-400', text: 'text-white' },
    1000: { bg: 'bg-yellow-500', border: 'border-yellow-300', text: 'text-black' },
    5000: { bg: 'bg-pink-500', border: 'border-pink-300', text: 'text-white' },
    10000: { bg: 'bg-blue-600', border: 'border-blue-400', text: 'text-white' },
};

// Chip component for bet size display
const ChipButton: React.FC<{
    value: number;
    selected?: boolean;
    onClick?: () => void;
    size?: 'sm' | 'md' | 'lg';
}> = ({ value, selected, onClick, size = 'lg' }) => {
    const colors = CHIP_COLORS[value] || CHIP_COLORS[25];
    const label = value >= 1000 ? `${value / 1000}K` : value.toString();
    const sizes = { sm: 'w-10 h-10 text-xs', md: 'w-12 h-12 text-sm', lg: 'w-14 h-14 text-base' };

    return (
        <button
            type="button"
            onClick={onClick}
            className={`
                ${sizes[size]} relative rounded-full font-bold font-mono
                ${colors.bg} ${colors.text} border-4 ${colors.border}
                flex items-center justify-center transition-all duration-150
                ${onClick ? 'cursor-pointer hover:scale-110 active:scale-95' : ''}
                ${selected ? 'ring-2 ring-white ring-offset-2 ring-offset-black shadow-lg' : ''}
            `}
            style={{ boxShadow: `inset 0 2px 4px rgba(255,255,255,0.3), inset 0 -2px 4px rgba(0,0,0,0.3)` }}
        >
            <div className="absolute inset-0.5 rounded-full border-2 border-dashed border-white/30" />
            <span className="relative z-10 drop-shadow-md">{label}</span>
        </button>
    );
};

export const BlackjackView = React.memo<{
    gameState: GameState;
    actions: any;
    lastWin?: number;
    playMode?: 'CASH' | 'FREEROLL' | null;
    currentBet?: number;
    onBetChange?: (bet: number) => void;
}>(({ gameState, actions, lastWin, playMode, currentBet, onBetChange }) => {
    const [showChipSelector, setShowChipSelector] = useState(false);
    const dealerValue = useMemo(() => getVisibleHandValue(gameState.dealerCards), [gameState.dealerCards]);
    const playerValue = useMemo(() => getVisibleHandValue(gameState.playerCards), [gameState.playerCards]);
    const showInsurancePrompt = useMemo(() => {
        if (gameState.stage !== 'PLAYING') return false;
        const msg = (gameState.message ?? '').toString().toUpperCase();
        return msg.includes('INSURANCE');
    }, [gameState.message, gameState.stage]);

    const canHit = gameState.stage === 'PLAYING' && !showInsurancePrompt && playerValue < 21;
    const canStand = gameState.stage === 'PLAYING' && !showInsurancePrompt && gameState.playerCards.length > 0;
    const canDouble = gameState.stage === 'PLAYING' && !showInsurancePrompt && gameState.playerCards.length === 2;
    const canSplit =
        gameState.stage === 'PLAYING' &&
        !showInsurancePrompt &&
        gameState.playerCards.length === 2 &&
        gameState.playerCards[0]?.rank === gameState.playerCards[1]?.rank;

    const activeHandNumber = gameState.completedHands.length + 1;

    const formatCompletedTitle = (idx: number, h: any) => {
        const bet = typeof h?.bet === 'number' ? h.bet : 0;
        const res = typeof h?.result === 'number' ? h.result : null;
        const tag =
            h?.surrendered
                ? 'SURRENDER'
                : h?.message
                    ? String(h.message).toUpperCase()
                    : res === null
                        ? 'DONE'
                        : res > 0
                            ? `+${res}`
                            : res < 0
                                ? `-${Math.abs(res)}`
                                : 'PUSH';
        return `HAND ${idx + 1} · $${bet} · ${tag}`;
    };
    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">BLACKJACK</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="BLACKJACK">
                        <div className="space-y-3">
                            <div className="text-[11px] text-gray-300 leading-relaxed font-mono">
                                Get as close to 21 as possible without going over. Dealer stands on 17.
                            </div>
                            <div className="text-[10px] text-gray-600 leading-relaxed font-mono">
                                Controls: HIT (H), STAND (S), DOUBLE (D), SPLIT (P). Insurance is local-mode only.
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Dealer Area */}
                <div className="min-h-[96px] sm:min-h-[120px] flex items-center justify-center opacity-75">
                    {gameState.dealerCards.length > 0 ? (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-sm font-bold tracking-widest text-white font-mono">DEALER <span className="text-white">({dealerValue})</span></span>
                            <Hand
                                cards={gameState.dealerCards}
                                forcedColor="text-terminal-accent"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                             <span className="text-sm font-bold tracking-widest text-white font-mono">DEALER</span>
                             <div className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border-2 border-dashed border-terminal-accent rounded" />
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                        <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse font-mono">
                            {gameState.message}
                        </div>
                </div>

                {/* Player Area - Highlighted */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
                    {/* Finished Split Hands */}
                    {gameState.completedHands.length > 0 && (
                            <div className="flex gap-2 opacity-50 scale-75 origin-right">
                            {gameState.completedHands.map((h, i) => (
                                <Hand
                                    key={i}
                                    cards={h.cards}
                                    title={formatCompletedTitle(i, h)}
                                    forcedColor={h?.result < 0 ? 'text-terminal-accent' : 'text-terminal-green'}
                                />
                            ))}
                            </div>
                    )}

                    <div className="flex flex-col items-center gap-2 scale-110 transition-transform">
                        <span className="text-sm font-bold tracking-widest text-white font-mono">
                            YOU <span className="text-white">({playerValue})</span>
                            {(gameState.completedHands.length > 0 || gameState.blackjackStack.length > 0) ? (
                                <span className="text-gray-500 text-xs"> · HAND {activeHandNumber}</span>
                            ) : null}
                        </span>
                        {gameState.playerCards.length > 0 ? (
                             <Hand
                                cards={gameState.playerCards}
                                forcedColor="text-terminal-green"
                            />
                        ) : (
                            <div className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border-2 border-dashed border-terminal-green/50 rounded" />
                        )}
                    </div>

                    {/* Pending Split Hands */}
                    {gameState.blackjackStack.length > 0 && (
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2 opacity-50 scale-75 origin-left">
                            {gameState.blackjackStack.map((h, i) => (
                                <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 bg-terminal-dim border-2 border-gray-700 rounded flex items-center justify-center">
                                    <span className="text-xs text-gray-500 font-mono">WAIT</span>
                                </div>
                            ))}
                            </div>
                    )}
                </div>

                {/* Super Mode Info - Animated */}
                {gameState.superMode?.isActive && (
                    <div className="w-full max-w-md mx-auto px-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="relative bg-terminal-black/95 border-2 border-terminal-gold rounded text-center overflow-hidden
                                        shadow-[0_0_20px_rgba(255,215,0,0.3),inset_0_0_30px_rgba(255,215,0,0.05)]
                                        animate-pulse-glow">
                            {/* Animated shimmer overlay */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-terminal-gold/10 to-transparent
                                            animate-shimmer pointer-events-none" />

                            <div className="relative p-3">
                                <div className="text-xs font-bold text-terminal-gold tracking-[0.3em] mb-2 font-mono flex items-center justify-center gap-2">
                                    <span className="animate-pulse">⚡</span>
                                    <span className="bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-300 bg-clip-text text-transparent">
                                        SUPER MODE ACTIVE
                                    </span>
                                    <span className="animate-pulse">⚡</span>
                                </div>
                                {Array.isArray(gameState.superMode.multipliers) && gameState.superMode.multipliers.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5 justify-center">
                                        {gameState.superMode.multipliers.slice(0, 10).map((m, idx) => (
                                            <span
                                                key={idx}
                                                className="px-2.5 py-1 rounded-lg bg-gradient-to-br from-amber-900/50 to-amber-950/50
                                                           border border-terminal-gold/60 text-terminal-gold text-xs font-mono font-bold
                                                           shadow-[0_0_8px_rgba(255,215,0,0.2)] hover:shadow-[0_0_12px_rgba(255,215,0,0.4)]
                                                           transition-all duration-200 hover:scale-105"
                                                style={{ animationDelay: `${idx * 50}ms` }}
                                            >
                                                {cardIdToString(m.id)} <span className="text-amber-300">×{m.multiplier}</span>
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-[10px] text-gray-400 font-mono animate-pulse">Loading multipliers...</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* CONTROLS */}
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 sm:sticky sm:bottom-0 bg-terminal-black/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] sm:pb-0">
                <div className="h-16 sm:h-20 flex items-center justify-between sm:justify-center gap-2 p-2 sm:px-4">
                    {/* Secondary Actions - Main Actions */}
                    {(gameState.stage === 'BETTING' || gameState.stage === 'RESULT') ? (
                        <div className="flex items-center gap-2">
                            {/* Side Bets Group */}
                            {gameState.stage === 'BETTING' && (
                                <div className="hidden sm:flex items-center gap-2 border-r-2 border-gray-700 pr-3">
                                    <button
                                        type="button"
                                        onClick={actions?.bjToggle21Plus3}
                                        className={`h-12 px-4 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                            (gameState.blackjack21Plus3Bet || 0) > 0
                                                ? 'border-amber-400 bg-amber-400/20 text-amber-400'
                                                : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                        }`}
                                    >
                                        21+3{(gameState.blackjack21Plus3Bet || 0) > 0 ? ` $${gameState.blackjack21Plus3Bet}` : ''}
                                    </button>
                                </div>
                            )}

                            {/* Modifiers Group */}
                            <div className="hidden sm:flex items-center gap-2">
                                {playMode !== 'CASH' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={actions?.toggleShield}
                                            className={`h-12 px-4 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                                gameState.activeModifiers.shield
                                                    ? 'border-terminal-green bg-terminal-green/20 text-terminal-green'
                                                    : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                            }`}
                                        >
                                            SHIELD
                                        </button>
                                        <button
                                            type="button"
                                            onClick={actions?.toggleDouble}
                                            className={`h-12 px-4 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                                gameState.activeModifiers.double
                                                    ? 'border-terminal-green bg-terminal-green/20 text-terminal-green'
                                                    : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                            }`}
                                        >
                                            DOUBLE
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={actions?.toggleSuper}
                                    className={`h-12 px-4 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                        gameState.activeModifiers.super
                                            ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold'
                                            : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                    }`}
                                >
                                    SUPER
                                </button>
                            </div>
                        </div>
                    ) : showInsurancePrompt ? (
                        <div className="hidden sm:flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => actions?.bjInsurance?.(false)}
                                className="h-12 px-6 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800"
                            >
                                NO
                            </button>
                        </div>
                    ) : (
                        <div className="hidden sm:flex items-center gap-2">
                            <button
                                type="button"
                                onClick={actions?.bjStand}
                                disabled={!canStand}
                                className={`h-12 px-6 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                    canStand
                                        ? 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                        : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                }`}
                            >
                                STAND
                            </button>
                            <button
                                type="button"
                                onClick={actions?.bjDouble}
                                disabled={!canDouble}
                                className={`h-12 px-6 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                    canDouble
                                        ? 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                        : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                }`}
                            >
                                DOUBLE
                            </button>
                            <button
                                type="button"
                                onClick={actions?.bjSplit}
                                disabled={!canSplit}
                                className={`h-12 px-6 rounded border-2 font-bold text-sm tracking-widest uppercase font-mono transition-all ${
                                    canSplit
                                        ? 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                        : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                }`}
                            >
                                SPLIT
                            </button>
                        </div>
                    )}

                    {/* Primary Action with Chip Selector (Desktop & Mobile) */}
                    <div className="flex items-center gap-3">
                        {/* Chip Selector - Only show during BETTING or RESULT stage */}
                        {(gameState.stage === 'BETTING' || gameState.stage === 'RESULT') && (
                            <div className="relative">
                                <ChipButton
                                    value={currentBet || 25}
                                    selected={showChipSelector}
                                    onClick={() => setShowChipSelector(!showChipSelector)}
                                />
                                {showChipSelector && (
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 p-3 bg-black/95 border border-gray-700 rounded-xl backdrop-blur-sm z-50">
                                        <div className="flex gap-2 pb-2">
                                            {CHIP_VALUES.slice(0, 4).map((value) => (
                                                <ChipButton
                                                    key={value}
                                                    value={value}
                                                    size="md"
                                                    selected={currentBet === value}
                                                    onClick={() => {
                                                        onBetChange?.(value);
                                                        setShowChipSelector(false);
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex gap-2 pt-2 border-t border-gray-800">
                                            {CHIP_VALUES.slice(4).map((value) => (
                                                <ChipButton
                                                    key={value}
                                                    value={value}
                                                    size="md"
                                                    selected={currentBet === value}
                                                    onClick={() => {
                                                        onBetChange?.(value);
                                                        setShowChipSelector(false);
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Primary Action Button */}
                        <button
                            type="button"
                            onClick={
                                (gameState.stage === 'BETTING' || gameState.stage === 'RESULT')
                                    ? actions?.deal
                                    : showInsurancePrompt
                                        ? () => actions?.bjInsurance?.(true)
                                        : actions?.bjHit
                            }
                            disabled={gameState.stage === 'PLAYING' && !showInsurancePrompt && !canHit}
                            className={`h-12 sm:h-14 px-6 sm:px-8 rounded border-2 font-bold text-sm sm:text-base tracking-widest uppercase font-mono transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                showInsurancePrompt
                                    ? 'border-terminal-gold bg-terminal-gold text-black hover:bg-white hover:border-white'
                                    : (gameState.stage === 'PLAYING' && !canHit)
                                        ? 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                        : 'border-terminal-green bg-terminal-green text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95'
                            }`}
                        >
                            {(gameState.stage === 'BETTING' || gameState.stage === 'RESULT')
                                ? 'DEAL'
                                : showInsurancePrompt
                                    ? 'INSURE'
                                    : 'HIT'
                            }
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
});
