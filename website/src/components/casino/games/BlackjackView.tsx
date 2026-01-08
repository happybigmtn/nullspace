
import React, { useEffect, useMemo, useState } from 'react';
import { Card, GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { BetsDrawer } from '../BetsDrawer';
import { SideBetsDrawer } from '../SideBetsDrawer';
import { Label } from '../ui/Label';
import { cardIdToString } from '../../../services/games';
import { analyzeBlackjackHand, BlackjackAnalysis } from '../../../utils/blackjackAnalysis';

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

const ChipButton: React.FC<{
    value: number;
    selected?: boolean;
    onClick?: () => void;
    size?: 'sm' | 'md' | 'lg';
}> = ({ value, selected, onClick, size = 'lg' }) => {
    const label = value >= 1000 ? `${value / 1000}K` : value.toString();
    const sizes = { sm: 'w-10 h-10 text-xs', md: 'w-12 h-12 text-sm', lg: 'w-14 h-14 text-base' };

    return (
        <button
            type="button"
            onClick={onClick}
            className={`
                ns-control-no-unify
                ${sizes[size]} relative rounded-full font-bold
                flex items-center justify-center transition-all duration-300
                ${onClick ? 'cursor-pointer hover:scale-110 active:scale-95' : ''}
                ${selected ? 'bg-titanium-900 text-white shadow-float ring-2 ring-offset-2 ring-titanium-900' : 'bg-white text-titanium-800 border border-titanium-200 shadow-soft'}
            `}
            style={{ fontFamily: 'Space Grotesk' }}
        >
            <span className="relative z-10">{label}</span>
        </button>
    );
};

const calculateBlackjackTotal = (cards: Card[]): number => {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
        if (!card) continue;
        if (card.rank === 'A') {
            total += 11;
            aces += 1;
            continue;
        }
        const asNumber = Number(card.rank);
        if (Number.isFinite(asNumber)) {
            total += Math.min(asNumber, 10);
        } else {
            total += 10;
        }
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces -= 1;
    }
    return total;
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
    const [analysis, setAnalysis] = useState<BlackjackAnalysis | null>(null);
    const [analysisPending, setAnalysisPending] = useState(false);
    const dealerValue = useMemo(() => {
        if (typeof gameState.blackjackDealerValue === 'number' && gameState.blackjackDealerValue > 0) {
            return gameState.blackjackDealerValue;
        }
        const visibleDealerCards = gameState.dealerCards.filter((card) => card && !card.isHidden);
        if (visibleDealerCards.length === 0) return '?';
        return calculateBlackjackTotal(visibleDealerCards);
    }, [gameState.blackjackDealerValue, gameState.dealerCards]);
    const playerValue = useMemo(() => {
        if (typeof gameState.blackjackPlayerValue === 'number' && gameState.blackjackPlayerValue > 0) {
            return gameState.blackjackPlayerValue;
        }
        if (gameState.playerCards.length === 0) return '?';
        return calculateBlackjackTotal(gameState.playerCards);
    }, [gameState.blackjackPlayerValue, gameState.playerCards]);
    const showInsurancePrompt = useMemo(() => {
        if (gameState.stage !== 'PLAYING') return false;
        const msg = (gameState.message ?? '').toString().toUpperCase();
        return msg.includes('INSURANCE');
    }, [gameState.message, gameState.stage]);

    const dealerUpcard = useMemo(
        () => gameState.dealerCards.find((card) => card && !card.isHidden) ?? null,
        [gameState.dealerCards]
    );
    const knownCards = useMemo(() => {
        const cards: Card[] = [];
        cards.push(...gameState.playerCards);
        for (const hand of gameState.completedHands) {
            if (hand?.cards?.length) cards.push(...hand.cards);
        }
        for (const pending of gameState.blackjackStack) {
            if (pending?.cards?.length) cards.push(...pending.cards);
        }
        for (const card of gameState.dealerCards) {
            if (card && !card.isHidden) cards.push(card);
        }
        return cards;
    }, [gameState.playerCards, gameState.completedHands, gameState.blackjackStack, gameState.dealerCards]);

    const canHit = gameState.blackjackActions?.canHit && !showInsurancePrompt;
    const canStand = gameState.blackjackActions?.canStand && !showInsurancePrompt;
    const canDouble = gameState.blackjackActions?.canDouble && !showInsurancePrompt;
    const canSplit = gameState.blackjackActions?.canSplit && !showInsurancePrompt;
    const isBettingStage = gameState.stage === 'BETTING' || gameState.stage === 'RESULT';
    const canAnalyze = gameState.stage === 'PLAYING' && gameState.playerCards.length > 0 && !!dealerUpcard;

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

    useEffect(() => {
        setAnalysis(null);
        setAnalysisPending(false);
    }, [gameState.moveNumber, gameState.stage]);

    const runAnalysis = () => {
        if (!canAnalyze || analysisPending || !dealerUpcard) return;
        setAnalysisPending(true);
        requestAnimationFrame(() => {
            const result = analyzeBlackjackHand({
                playerCards: gameState.playerCards,
                dealerCard: dealerUpcard,
                knownCards,
                canSplit: !!canSplit,
                canDouble: !!canDouble,
                canSurrender: false,
                canHit: !!canHit,
                canStand: !!canStand,
                iterations: 3000,
            });
            setAnalysis(result);
            setAnalysisPending(false);
        });
    };

    const formatEv = (value?: number): string => {
        if (value === undefined || Number.isNaN(value)) return '--';
        const fixed = value.toFixed(3);
        return value > 0 ? `+${fixed}` : fixed;
    };
    const analysisRows = analysis
        ? [
              { key: 'stand', label: 'Stand', code: 'S', value: analysis.values.stand },
              { key: 'hit', label: 'Hit', code: 'H', value: analysis.values.hit },
              { key: 'double', label: 'Double', code: 'D', value: analysis.values.double },
              { key: 'split', label: 'Split', code: 'P', value: analysis.values.split },
              { key: 'surrender', label: 'Surrender', code: 'R', value: analysis.values.surrender },
              { key: 'insurance', label: 'Insurance', code: 'I', value: analysis.values.insurance },
          ].filter((row) => row.value !== undefined)
        : [];
    const sideBetDefs = useMemo(
        () => [
            { id: '21+3', amount: gameState.blackjack21Plus3Bet || 0, onToggle: actions?.bjToggle21Plus3, shortcut: '1' },
            { id: 'Lucky Ladies', amount: gameState.blackjackLuckyLadiesBet || 0, onToggle: actions?.bjToggleLuckyLadies, shortcut: '2' },
            { id: 'Perfect Pairs', amount: gameState.blackjackPerfectPairsBet || 0, onToggle: actions?.bjTogglePerfectPairs, shortcut: '3' },
            { id: 'Bust It', amount: gameState.blackjackBustItBet || 0, onToggle: actions?.bjToggleBustIt, shortcut: '4' },
            { id: 'Royal Match', amount: gameState.blackjackRoyalMatchBet || 0, onToggle: actions?.bjToggleRoyalMatch, shortcut: '5' },
        ],
        [
            actions?.bjToggle21Plus3,
            actions?.bjToggleLuckyLadies,
            actions?.bjTogglePerfectPairs,
            actions?.bjToggleBustIt,
            actions?.bjToggleRoyalMatch,
            gameState.blackjack21Plus3Bet,
            gameState.blackjackLuckyLadiesBet,
            gameState.blackjackPerfectPairsBet,
            gameState.blackjackBustItBet,
            gameState.blackjackRoyalMatchBet,
        ]
    );
    const activeSideBets = useMemo(
        () => sideBetDefs.filter((bet) => bet.amount > 0).map((bet) => ({ id: bet.id, amount: bet.amount })),
        [sideBetDefs]
    );
    const [lastSideBets, setLastSideBets] = useState(activeSideBets);
    useEffect(() => {
        if (activeSideBets.length > 0) setLastSideBets(activeSideBets);
    }, [activeSideBets]);
    const displaySideBets = activeSideBets.length > 0
        ? activeSideBets
        : gameState.stage !== 'BETTING'
            ? lastSideBets
            : [];
    const sideBetCount = activeSideBets.length > 0
        ? activeSideBets.length
        : gameState.stage !== 'BETTING'
            ? lastSideBets.length
            : 0;
    const sideBetsLocked = gameState.stage !== 'BETTING';

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-8 relative pt-12 pb-24 animate-scale-in">
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                    <Label size="micro">Blackjack</Label>
                    <div className="h-1 w-8 bg-titanium-200 rounded-full" />
                </div>
                
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="BLACKJACK">
                        <div className="space-y-4 p-2">
                            <p className="text-body-sm text-titanium-800 font-semibold leading-relaxed">
                                Get as close to 21 as possible without going over. Dealer stands on 17.
                            </p>
                            <div className="bg-titanium-50 p-4 rounded-2xl border border-titanium-100">
                                <Label size="micro" className="mb-2 block">Controls</Label>
                                <p className="text-[11px] text-titanium-500 font-bold uppercase tracking-wider">
                                    Hit (H) • Stand (S) • Double (D) • Split (P)
                                </p>
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Dealer Area */}
                <div className="min-h-[120px] flex items-center justify-center opacity-80">
                    {gameState.dealerCards.length > 0 ? (
                        <div className="flex flex-col items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Label variant="destructive">Dealer</Label>
                                <span className="px-2.5 py-1 rounded-lg bg-titanium-100 text-titanium-900 font-black text-sm tabular-nums">{dealerValue}</span>
                            </div>
                            <Hand
                                cards={gameState.dealerCards}
                                forcedColor="text-action-destructive"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-3">
                             <Label variant="secondary">Dealer</Label>
                             <div className="w-14 h-20 border-2 border-dashed border-titanium-200 rounded-xl" />
                        </div>
                    )}
                </div>

                {/* Connection Warning */}
                {gameState.message?.includes('OFFLINE') && (
                    <div className="text-center bg-action-destructive/20 border border-action-destructive/50 rounded-lg px-4 py-2 mx-4">
                        <p className="text-action-destructive font-bold text-sm">⚠️ Chain Offline - Check Vault Status</p>
                        <p className="text-action-destructive/80 text-xs">Navigate to Security → Unlock Vault to connect</p>
                    </div>
                )}

                {/* Center Info */}
                <div className="text-center relative z-20 px-6">
                    <h2 className="text-2xl sm:text-3xl font-bold text-titanium-900 tracking-tight font-display animate-scale-in">
                        {gameState.message || 'Place Your Bet'}
                    </h2>
                </div>

                {/* Player Area - Highlighted */}
                <div className="min-h-[120px] flex gap-12 items-center justify-center">
                    {/* Finished Split Hands */}
                    {gameState.completedHands.length > 0 && (
                            <div className="flex gap-3 opacity-40 scale-90 origin-right grayscale">
                            {gameState.completedHands.map((h, i) => (
                                <Hand
                                    key={i}
                                    cards={h.cards}
                                    title={formatCompletedTitle(i, h)}
                                />
                            ))}
                            </div>
                    )}

                    <div className="flex flex-col items-center gap-4 scale-110">
                        <div className="flex items-center gap-2">
                            <Label variant="gold">You</Label>
                            <span className="px-2.5 py-1 rounded-lg bg-titanium-100 text-titanium-900 font-black text-sm tabular-nums">{playerValue}</span>
                            {(gameState.completedHands.length > 0 || gameState.blackjackStack.length > 0) ? (
                                <span className="text-titanium-400 text-xs font-bold uppercase tracking-widest ml-1">Hand {activeHandNumber}</span>
                            ) : null}
                        </div>
                        {gameState.playerCards.length > 0 ? (
                             <Hand
                                cards={gameState.playerCards}
                                forcedColor="text-action-success"
                            />
                        ) : (
                            <div className="w-14 h-20 border-2 border-dashed border-action-success/30 rounded-xl bg-action-success/5 shadow-inner" />
                        )}
                    </div>

                    {/* Pending Split Hands */}
                    {gameState.blackjackStack.length > 0 && (
                            <div className="flex gap-2 opacity-30 scale-90 origin-left">
                            {gameState.blackjackStack.map((h, i) => (
                                <div key={i} className="w-14 h-20 bg-titanium-100 border border-titanium-200 rounded-xl flex items-center justify-center">
                                    <Label size="micro">Wait</Label>
                                </div>
                            ))}
                            </div>
                    )}
                </div>

                {displaySideBets.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs uppercase tracking-[0.15em] text-titanium-500">
                        <span className="text-titanium-400 font-semibold">Side Bets:</span>
                        {displaySideBets.map((bet) => (
                            <span
                                key={bet.id}
                                className="rounded-full border border-titanium-200 px-3 py-1.5 text-titanium-700 dark:border-titanium-800 dark:text-titanium-200 font-medium"
                            >
                                {bet.id} ${bet.amount.toLocaleString()}
                            </span>
                        ))}
                    </div>
                )}

                {/* Super Mode Info - Animated */}
                {gameState.superMode?.isActive && (
                    <div className="w-full max-w-md mx-auto px-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="relative bg-titanium-900/95 border-2 border-action-primary rounded text-center overflow-hidden
                                        shadow-[0_0_20px_rgba(255,215,0,0.3),inset_0_0_30px_rgba(255,215,0,0.05)]
                                        animate-pulse-glow">
                            {/* Animated shimmer overlay */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-action-primary/10 to-transparent
                                            animate-shimmer pointer-events-none" />

                            <div className="relative p-3">
                                <div className="text-xs font-bold text-action-primary tracking-[0.3em] mb-2 font-mono flex items-center justify-center gap-2">
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
                                                           border border-action-primary/60 text-action-primary text-xs font-mono font-bold
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

                {(analysis || analysisPending) && (
                    <div className="w-full max-w-md mx-auto px-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="bg-titanium-900/95 border-2 border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-titanium-900/90">
                                <Label size="micro">Hand Analysis</Label>
                                <button
                                    type="button"
                                    onClick={() => setAnalysis(null)}
                                    className="text-[10px] px-2 py-1 rounded border border-gray-700 bg-black/40 text-gray-400 hover:border-gray-500"
                                >
                                    CLEAR
                                </button>
                            </div>
                            <div className="p-3 space-y-3">
                                {analysisPending && !analysis ? (
                                    <div className="text-[11px] text-gray-400 font-mono">Analyzing...</div>
                                ) : null}
                                {analysis ? (
                                    <div className="space-y-2">
                                        {analysisRows.map((row) => {
                                            const isBest = analysis.bestPlay === row.code;
                                            return (
                                                <div
                                                    key={row.key}
                                                    className={`flex items-center justify-between px-3 py-2 rounded border text-[11px] font-mono ${
                                                        isBest
                                                            ? 'border-action-primary bg-action-primary/15 text-action-primary'
                                                            : 'border-gray-800 bg-black/40 text-gray-300'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold tracking-widest uppercase">{row.label}</span>
                                                        {isBest && (
                                                            <span className="text-[9px] font-bold uppercase tracking-widest text-action-primary">
                                                                BEST
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="tabular-nums">{formatEv(row.value)}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : null}
                                {analysis ? (
                                    <div className="text-[10px] text-gray-500 leading-relaxed">
                                        EV per 1x bet • {analysis.iterations.toLocaleString()} sims • {analysis.note}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* CONTROLS */}
            <div className="ns-controlbar zen-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 bg-titanium-900/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                {/* Keyboard Shortcuts Hint Bar - All Screens */}
                <div className="flex items-center justify-center gap-3 sm:gap-6 py-2 border-b border-gray-800 text-[10px] sm:text-xs font-mono text-gray-400 bg-black/30 flex-wrap px-2">
                    {isBettingStage ? (
                        <>
                            <span><kbd className="px-1 sm:px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">SPACE</kbd> Deal</span>
                            <span><kbd className="px-1 sm:px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">↑↓</kbd> Bet</span>
                            <span className="hidden sm:inline"><kbd className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">1-5</kbd> Side Bets</span>
                            <span className="hidden sm:inline"><kbd className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">G</kbd> Super</span>
                        </>
                    ) : showInsurancePrompt ? (
                        <>
                            <span><kbd className="px-1 sm:px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">I</kbd> Insure</span>
                            <span><kbd className="px-1 sm:px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">N</kbd> No</span>
                        </>
                    ) : (
                        <>
                            <span><kbd className="px-1 sm:px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">H</kbd> Hit</span>
                            <span><kbd className="px-1 sm:px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">S</kbd> Stand</span>
                            <span><kbd className="px-1 sm:px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">D</kbd> Double</span>
                            <span><kbd className="px-1 sm:px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">P</kbd> Split</span>
                        </>
                    )}
                    <span className="text-gray-600 hidden sm:inline">|</span>
                    <span className="hidden sm:inline"><kbd className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-bold">?</kbd> Help</span>
                </div>
                <div className="h-16 md:h-20 flex items-center justify-between md:justify-center gap-2 p-2 md:px-4">
                    <div className="flex items-center gap-2">
                        <SideBetsDrawer
                            title="BLACKJACK SIDE BETS"
                            label="Side Bets"
                            count={sideBetCount}
                            shortcutHint="1–5"
                            disabled={sideBetDefs.length === 0}
                        >
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    {sideBetDefs.map((bet) => {
                                        const active = bet.amount > 0;
                                        return (
                                            <button
                                                key={bet.id}
                                                type="button"
                                                onClick={() => !sideBetsLocked && bet.onToggle?.()}
                                                disabled={sideBetsLocked}
                                                className={`rounded-xl border px-3 py-3 text-xs font-semibold uppercase tracking-widest transition-all ${
                                                    active
                                                        ? 'border-action-primary/60 bg-action-primary/10 text-action-primary'
                                                        : sideBetsLocked
                                                            ? 'border-titanium-200 text-titanium-400 dark:border-titanium-800 dark:text-titanium-500'
                                                            : 'border-titanium-200 text-titanium-700 hover:border-titanium-500 dark:border-titanium-800 dark:text-titanium-200'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span>{bet.id}</span>
                                                    <span className="text-[10px] font-mono text-titanium-400">[{bet.shortcut}]</span>
                                                </div>
                                                {bet.amount > 0 ? (
                                                    <div className="mt-1 text-[10px] tracking-[0.2em] text-titanium-500">
                                                        ${bet.amount.toLocaleString()}
                                                    </div>
                                                ) : null}
                                            </button>
                                        );
                                    })}
                                </div>
                                {sideBetsLocked ? (
                                    <div className="text-[10px] uppercase tracking-[0.24em] text-titanium-400">
                                        Locked until next hand
                                    </div>
                                ) : null}
                            </div>
                        </SideBetsDrawer>
                    </div>
                    {/* Secondary Actions - Main Actions */}
                    {isBettingStage ? (
                        <>
                            <div className="flex md:hidden items-center gap-2">
                                <BetsDrawer title="MODIFIERS">
                                    <div className="rounded border border-gray-800 bg-black/40 p-2 space-y-2">
                                        <div className="text-[10px] text-cyan-500 font-bold tracking-widest border-b border-gray-800 pb-1">MODIFIERS</div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                            {playMode !== 'CASH' && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={actions?.toggleShield}
                                                        className={`py-3 rounded border text-xs font-bold ${
                                                            gameState.activeModifiers.shield
                                                                ? 'border-action-success bg-action-success/20 text-action-success'
                                                                : 'border-gray-700 bg-gray-900 text-gray-400'
                                                        }`}
                                                    >
                                                        SHIELD
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={actions?.toggleDouble}
                                                        className={`py-3 rounded border text-xs font-bold ${
                                                            gameState.activeModifiers.double
                                                                ? 'border-action-success bg-action-success/20 text-action-success'
                                                                : 'border-gray-700 bg-gray-900 text-gray-400'
                                                        }`}
                                                    >
                                                        DOUBLE
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                type="button"
                                                onClick={actions?.toggleSuper}
                                                className={`py-3 rounded border text-xs font-bold ${
                                                    gameState.activeModifiers.super
                                                        ? 'border-action-primary bg-action-primary/20 text-action-primary'
                                                        : 'border-gray-700 bg-gray-900 text-gray-400'
                                                }`}
                                            >
                                                SUPER
                                            </button>
                                        </div>
                                    </div>
                                </BetsDrawer>
                            </div>

                            <div className="hidden md:flex items-center gap-3">
                                {/* Modifiers Group */}
                                <div className="flex items-center gap-3">
                                    {playMode !== 'CASH' && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={actions?.toggleShield}
                                                className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                                    gameState.activeModifiers.shield
                                                        ? 'border-action-success bg-action-success/20 text-action-success'
                                                        : 'border-gray-600 bg-black/60 text-gray-200 hover:bg-gray-700 hover:border-gray-500'
                                                }`}
                                            >
                                                SHIELD <span className="text-gray-500 ml-1 text-xs">[Z]</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={actions?.toggleDouble}
                                                className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                                    gameState.activeModifiers.double
                                                        ? 'border-action-success bg-action-success/20 text-action-success'
                                                        : 'border-gray-600 bg-black/60 text-gray-200 hover:bg-gray-700 hover:border-gray-500'
                                                }`}
                                            >
                                                DOUBLE <span className="text-gray-500 ml-1 text-xs">[X]</span>
                                            </button>
                                        </>
                                    )}
                                    <button
                                        type="button"
                                        onClick={actions?.toggleSuper}
                                        className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                            gameState.activeModifiers.super
                                                ? 'border-action-primary bg-action-primary/20 text-action-primary'
                                                : 'border-gray-600 bg-black/60 text-gray-200 hover:bg-gray-700 hover:border-gray-500'
                                        }`}
                                    >
                                        SUPER <span className="text-gray-500 ml-1 text-xs">[G]</span>
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : showInsurancePrompt ? (
                        <>
                            <div className="flex md:hidden items-center gap-2">
                                <MobileDrawer label="INSURE" title="INSURANCE">
                                    <div className="rounded border border-gray-800 bg-black/40 p-2">
                                        <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => actions?.bjInsurance?.(true)}
                                            className="py-3 rounded border border-action-primary bg-action-primary/20 text-action-primary text-xs font-bold"
                                        >
                                            YES
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => actions?.bjInsurance?.(false)}
                                            className="py-3 rounded border border-gray-700 bg-gray-900 text-gray-400 text-xs font-bold"
                                        >
                                            NO
                                        </button>
                                        </div>
                                    </div>
                                </MobileDrawer>
                                {canAnalyze && (
                                    <button
                                        type="button"
                                        onClick={runAnalysis}
                                        disabled={analysisPending}
                                        className={`text-[11px] font-mono px-3 py-2 rounded-full border ${
                                            analysisPending
                                                ? 'opacity-60 cursor-not-allowed border-gray-800 bg-black/30 text-gray-500'
                                                : 'border-action-primary bg-action-primary/15 text-action-primary hover:bg-action-primary/25'
                                        }`}
                                    >
                                        {analysisPending ? '...' : 'ANALYZE'}
                                    </button>
                                )}
                            </div>
                            <div className="hidden md:flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => actions?.bjInsurance?.(false)}
                                    className="h-14 px-8 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all border-gray-600 bg-black/60 text-gray-200 hover:bg-gray-700 hover:border-gray-500"
                                >
                                    NO <span className="text-gray-500 ml-1 text-xs">[N]</span>
                                </button>
                                {canAnalyze && (
                                    <button
                                        type="button"
                                        onClick={runAnalysis}
                                        disabled={analysisPending}
                                        className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                            analysisPending
                                                ? 'opacity-60 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-500'
                                                : 'border-action-primary bg-action-primary/15 text-action-primary hover:bg-action-primary/25'
                                        }`}
                                    >
                                        {analysisPending ? 'ANALYZING' : 'ANALYZE'}
                                    </button>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex md:hidden items-center gap-2">
                                <MobileDrawer label="ACTIONS" title="BLACKJACK ACTIONS">
                                    <div className="rounded border border-gray-800 bg-black/40 p-2">
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        <button
                                            type="button"
                                            onClick={actions?.bjStand}
                                            disabled={!canStand}
                                            className={`py-3 rounded border text-xs font-bold ${
                                                canStand
                                                    ? 'border-gray-700 bg-gray-900 text-gray-300'
                                                    : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                            }`}
                                        >
                                            STAND
                                        </button>
                                        <button
                                            type="button"
                                            onClick={actions?.bjDouble}
                                            disabled={!canDouble}
                                            className={`py-3 rounded border text-xs font-bold ${
                                                canDouble
                                                    ? 'border-gray-700 bg-gray-900 text-gray-300'
                                                    : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                            }`}
                                        >
                                            DOUBLE
                                        </button>
                                        <button
                                            type="button"
                                            onClick={actions?.bjSplit}
                                            disabled={!canSplit}
                                            className={`py-3 rounded border text-xs font-bold ${
                                                canSplit
                                                    ? 'border-gray-700 bg-gray-900 text-gray-300'
                                                    : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                            }`}
                                        >
                                            SPLIT
                                        </button>
                                        </div>
                                    </div>
                                </MobileDrawer>
                                {canAnalyze && (
                                    <button
                                        type="button"
                                        onClick={runAnalysis}
                                        disabled={analysisPending}
                                        className={`text-[11px] font-mono px-3 py-2 rounded-full border ${
                                            analysisPending
                                                ? 'opacity-60 cursor-not-allowed border-gray-800 bg-black/30 text-gray-500'
                                                : 'border-action-primary bg-action-primary/15 text-action-primary hover:bg-action-primary/25'
                                        }`}
                                    >
                                        {analysisPending ? '...' : 'ANALYZE'}
                                    </button>
                                )}
                            </div>
                            <div className="hidden md:flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={actions?.bjStand}
                                    disabled={!canStand}
                                    className={`h-14 px-8 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                        canStand
                                            ? 'border-gray-600 bg-black/60 text-gray-200 hover:bg-gray-700 hover:border-gray-500'
                                            : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                    }`}
                                >
                                    STAND <span className="text-gray-500 ml-1 text-xs">[S]</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={actions?.bjDouble}
                                    disabled={!canDouble}
                                    className={`h-14 px-8 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                        canDouble
                                            ? 'border-gray-600 bg-black/60 text-gray-200 hover:bg-gray-700 hover:border-gray-500'
                                            : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                    }`}
                                >
                                    DOUBLE <span className="text-gray-500 ml-1 text-xs">[D]</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={actions?.bjSplit}
                                    disabled={!canSplit}
                                    className={`h-14 px-8 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                        canSplit
                                            ? 'border-gray-600 bg-black/60 text-gray-200 hover:bg-gray-700 hover:border-gray-500'
                                            : 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                    }`}
                                >
                                    SPLIT <span className="text-gray-500 ml-1 text-xs">[P]</span>
                                </button>
                                {canAnalyze && (
                                    <button
                                        type="button"
                                        onClick={runAnalysis}
                                        disabled={analysisPending}
                                        className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                            analysisPending
                                                ? 'opacity-60 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-500'
                                                : 'border-action-primary bg-action-primary/15 text-action-primary hover:bg-action-primary/25'
                                        }`}
                                    >
                                        {analysisPending ? 'ANALYZING' : 'ANALYZE'}
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    {/* Primary Action with Chip Selector (Desktop & Mobile) */}
                    <div className="flex items-center gap-3">
                        {/* Chip Selector - Only show during BETTING or RESULT stage */}
                        {(gameState.stage === 'BETTING' || gameState.stage === 'RESULT') && (
                            <div className="relative flex flex-col items-center">
                                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Bet</span>
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
                            className={`ns-control-primary h-14 md:h-16 px-8 md:px-10 rounded-lg border-2 font-bold text-base md:text-lg tracking-widest uppercase font-mono transition-all shadow-[0_0_20px_rgba(0,0,0,0.5)] ${
                                showInsurancePrompt
                                    ? 'border-action-primary bg-action-primary text-black hover:bg-white hover:border-white'
                                    : (gameState.stage === 'PLAYING' && !canHit)
                                        ? 'opacity-50 cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-700'
                                        : 'border-action-success bg-action-success text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95'
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
