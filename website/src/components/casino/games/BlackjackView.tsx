
import React, { useEffect, useMemo, useState } from 'react';
import { Card, GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { BetsDrawer } from '../BetsDrawer';
import { SideBetsDrawer } from '../SideBetsDrawer';
import { InlineBetSelector } from '../InlineBetSelector';
import { Label } from '../ui/Label';
import { cardIdToString } from '../../../services/games';
import { analyzeBlackjackHand, BlackjackAnalysis } from '../../../utils/blackjackAnalysis';

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
    /** LUX-010: Balance for inline bet selector calculations */
    balance?: number;
}>(({ gameState, actions, lastWin, playMode, currentBet, onBetChange, balance = 1000 }) => {
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
    const isResultStage = gameState.stage === 'RESULT';
    const canRebet = isResultStage && gameState.lastBet && gameState.lastBet > 0 && balance >= gameState.lastBet;
    const canAnalyze = gameState.stage === 'PLAYING' && gameState.playerCards.length > 0 && !!dealerUpcard;

    const activeHandNumber = gameState.completedHands.length + 1;

    const formatCompletedTitle = (idx: number, h: any) => {
        const bet = typeof h?.bet === 'number' ? h.bet : 0;
        const res = typeof h?.result === 'number' ? h.result : null;

        let tag: string;
        if (h?.surrendered) {
            tag = 'SURRENDER';
        } else if (h?.message) {
            tag = String(h.message).toUpperCase();
        } else if (res === null) {
            tag = 'DONE';
        } else if (res > 0) {
            tag = `+${res}`;
        } else if (res < 0) {
            tag = `-${Math.abs(res)}`;
        } else {
            tag = 'PUSH';
        }

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
        : (gameState.stage !== 'BETTING' ? lastSideBets : []);
    const sideBetCount = activeSideBets.length > 0
        ? activeSideBets.length
        : (gameState.stage !== 'BETTING' ? lastSideBets.length : 0);
    const sideBetsLocked = gameState.stage !== 'BETTING';

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-8 relative pt-12 pb-24 animate-scale-in">
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                    <Label size="micro">Blackjack</Label>
                    <div className="h-1 w-8 bg-ns-border rounded-full opacity-60" />
                </div>
                
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="BLACKJACK">
                        <div className="space-y-4 p-2">
                            <p className="text-body text-ns leading-relaxed">
                                Get as close to 21 as possible without going over. Dealer stands on 17.
                            </p>
                            <div className="pt-4">
                                <p className="text-caption uppercase tracking-wider">
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
                            <div className="flex items-center gap-3">
                                <Label variant="destructive">Dealer</Label>
                            <span className="text-display-mono text-headline text-ns">{dealerValue}</span>
                            </div>
                            <Hand
                                cards={gameState.dealerCards}
                                forcedColor="text-mono-400 dark:text-mono-500"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-3">
                             <Label variant="secondary">Dealer</Label>
                             <div className="w-14 h-20 rounded-xl liquid-panel" />
                        </div>
                    )}
                </div>

                {/* Connection Warning */}
                {gameState.message?.includes('OFFLINE') && (
                    <div className="text-center bg-mono-400/20 border border-mono-400/50 rounded-lg px-4 py-2 mx-4">
                        <p className="text-mono-400 dark:text-mono-500 font-bold text-sm">⚠️ Chain Offline - Check Vault Status</p>
                        <p className="text-mono-400 dark:text-mono-500/80 text-xs">Navigate to Security → Unlock or create your vault to connect</p>
                    </div>
                )}

                {/* Center Info */}
                <div className="text-center relative z-20 px-6">
                    <h2 className="text-2xl sm:text-3xl font-bold text-ns tracking-tight font-display animate-scale-in">
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
                        <div className="flex items-center gap-3">
                            <Label variant="gold">You</Label>
                            <span className="text-display-mono text-headline text-ns">{playerValue}</span>
                            {(gameState.completedHands.length > 0 || gameState.blackjackStack.length > 0) ? (
                                <span className="text-caption uppercase tracking-widest ml-2">Hand {activeHandNumber}</span>
                            ) : null}
                        </div>
                        {gameState.playerCards.length > 0 ? (
                             <Hand
                                cards={gameState.playerCards}
                                forcedColor="text-mono-0 dark:text-mono-1000 font-bold"
                            />
                        ) : (
                            <div className="w-14 h-20 rounded-xl bg-mono-0/10" />
                        )}
                    </div>

                    {/* Pending Split Hands */}
                    {gameState.blackjackStack.length > 0 && (
                            <div className="flex gap-2 opacity-30 scale-90 origin-left">
                            {gameState.blackjackStack.map((h, i) => (
                                <div key={i} className="w-14 h-20 rounded-xl liquid-panel flex items-center justify-center">
                                    <Label size="micro">Wait</Label>
                                </div>
                            ))}
                            </div>
                    )}
                </div>

                {/* Super Mode - minimal gold accent indicator */}
                {gameState.superMode?.isActive && (
                    <div className="text-center text-caption text-mono-0 dark:text-mono-1000 animate-in fade-in">
                        <span className="uppercase tracking-widest">Super Mode</span>
                        {Array.isArray(gameState.superMode.multipliers) && gameState.superMode.multipliers.length > 0 && (
                            <span className="text-display-mono ml-2">
                                ×{Math.max(...gameState.superMode.multipliers.map(m => m.multiplier))}
                            </span>
                        )}
                    </div>
                )}

                {/* Analysis panel removed for cleaner UI - analysis still available via 'A' key */}
                {analysis && (
                    <div className="text-center text-caption text-ns-muted animate-in fade-in">
                        Best: <span className="text-mono-0 dark:text-mono-1000 font-medium">{analysis.bestPlay}</span>
                        <button
                            type="button"
                            onClick={() => setAnalysis(null)}
                            className="ml-2 text-ns-muted hover:text-ns"
                        >
                            ×
                        </button>
                    </div>
                )}
            </div>

            {/* CONTROLS */}
            {/* Keyboard shortcuts removed for cleaner UI - shortcuts still work, press ? for help */}
            <div className="ns-controlbar zen-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 liquid-card rounded-none md:rounded-t-3xl backdrop-blur border-t border-ns z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-14 sm:h-16 md:h-20 flex items-center justify-center gap-2 sm:gap-3 p-2 md:px-4">
                    {/* Side Bets - Desktop only drawer, mobile uses simplified button */}
                    <div className="hidden sm:flex items-center gap-2">
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
                                                        ? 'border-mono-0/60 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                                        : sideBetsLocked
                                                            ? 'border-ns text-ns-muted'
                                                            : 'border-ns text-ns hover:border-ns'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span>{bet.id}</span>
                                                    <span className="text-[10px] font-mono text-ns-muted">[{bet.shortcut}]</span>
                                                </div>
                                                {bet.amount > 0 ? (
                                                    <div className="mt-1 text-[10px] tracking-[0.2em] text-ns-muted">
                                                        ${bet.amount.toLocaleString()}
                                                    </div>
                                                ) : null}
                                            </button>
                                        );
                                    })}
                                </div>
                                {sideBetsLocked ? (
                                    <div className="text-[10px] uppercase tracking-[0.24em] text-ns-muted">
                                        Locked until next hand
                                    </div>
                                ) : null}
                            </div>
                        </SideBetsDrawer>
                    </div>
                    {/* Secondary Actions - Main Actions */}
                    {isBettingStage ? (
                        <>
                            {/* Mobile: Simple modifier toggles inline */}
                            <div className="flex sm:hidden items-center gap-1">
                                <button
                                    type="button"
                                    onClick={actions?.toggleSuper}
                                    className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase ${
                                        gameState.activeModifiers.super
                                            ? 'bg-mono-0/20 text-mono-0 dark:text-mono-1000 border border-mono-0/50'
                                            : 'bg-white/55 dark:bg-black/40 text-ns-muted border border-ns-border/70'
                                    }`}
                                >
                                    Super
                                </button>
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
                                                        ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000 font-bold'
                                                        : 'border-ns-border/70 bg-black/60 text-ns hover:bg-black/40 hover:border-ns-border'
                                                }`}
                                            >
                                                SHIELD <span className="text-ns-muted ml-1 text-xs">[Z]</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={actions?.toggleDouble}
                                                className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                                    gameState.activeModifiers.double
                                                        ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000 font-bold'
                                                        : 'border-ns-border/70 bg-black/60 text-ns hover:bg-black/40 hover:border-ns-border'
                                                }`}
                                            >
                                                DOUBLE <span className="text-ns-muted ml-1 text-xs">[X]</span>
                                            </button>
                                        </>
                                    )}
                                    <button
                                        type="button"
                                        onClick={actions?.toggleSuper}
                                        className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                            gameState.activeModifiers.super
                                                ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000'
                                                : 'border-ns-border/70 bg-black/60 text-ns hover:bg-black/40 hover:border-ns-border'
                                        }`}
                                    >
                                        SUPER <span className="text-ns-muted ml-1 text-xs">[G]</span>
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : showInsurancePrompt ? (
                        <>
                            {/* Mobile: Simple No button inline */}
                            <div className="flex sm:hidden items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => actions?.bjInsurance?.(false)}
                                    className="px-3 py-2 rounded-lg text-[10px] font-bold uppercase bg-white/55 dark:bg-black/40 text-ns-muted border border-ns-border/70"
                                >
                                    No
                                </button>
                            </div>
                            <div className="hidden md:flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => actions?.bjInsurance?.(false)}
                                    className="h-14 px-8 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all border-ns-border/70 bg-black/60 text-ns hover:bg-black/40 hover:border-ns-border"
                                >
                                    NO <span className="text-ns-muted ml-1 text-xs">[N]</span>
                                </button>
                                {canAnalyze && (
                                    <button
                                        type="button"
                                        onClick={runAnalysis}
                                        disabled={analysisPending}
                                        className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                            analysisPending
                                                ? 'opacity-60 cursor-not-allowed border-ns-border/60 bg-white/30 dark:bg-black/50 text-ns-muted'
                                                : 'border-mono-0 bg-mono-0/15 text-mono-0 dark:text-mono-1000 hover:bg-mono-0/25'
                                        }`}
                                    >
                                        {analysisPending ? 'ANALYZING' : 'ANALYZE'}
                                    </button>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Mobile: Inline action buttons */}
                            <div className="flex sm:hidden items-center gap-1">
                                <button
                                    type="button"
                                    onClick={actions?.bjStand}
                                    disabled={!canStand}
                                    className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase ${
                                        canStand
                                            ? 'bg-white/55 dark:bg-black/40 text-ns border border-ns-border/70'
                                            : 'opacity-40 bg-white/40 dark:bg-black/50 text-ns-muted border border-ns-border/60'
                                    }`}
                                >
                                    Stand
                                </button>
                                {canDouble && (
                                    <button
                                        type="button"
                                        onClick={actions?.bjDouble}
                                        className="px-3 py-2 rounded-lg text-[10px] font-bold uppercase bg-white/55 dark:bg-black/40 text-ns border border-ns-border/70"
                                    >
                                        x2
                                    </button>
                                )}
                                {canSplit && (
                                    <button
                                        type="button"
                                        onClick={actions?.bjSplit}
                                        className="px-3 py-2 rounded-lg text-[10px] font-bold uppercase bg-white/55 dark:bg-black/40 text-ns border border-ns-border/70"
                                    >
                                        Split
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
                                            ? 'border-ns-border/70 bg-black/60 text-ns hover:bg-black/40 hover:border-ns-border'
                                            : 'opacity-50 cursor-not-allowed border-ns-border/60 bg-white/30 dark:bg-black/50 text-ns-muted'
                                    }`}
                                >
                                    STAND <span className="text-ns-muted ml-1 text-xs">[S]</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={actions?.bjDouble}
                                    disabled={!canDouble}
                                    className={`h-14 px-8 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                        canDouble
                                            ? 'border-ns-border/70 bg-black/60 text-ns hover:bg-black/40 hover:border-ns-border'
                                            : 'opacity-50 cursor-not-allowed border-ns-border/60 bg-white/30 dark:bg-black/50 text-ns-muted'
                                    }`}
                                >
                                    DOUBLE <span className="text-ns-muted ml-1 text-xs">[D]</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={actions?.bjSplit}
                                    disabled={!canSplit}
                                    className={`h-14 px-8 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                        canSplit
                                            ? 'border-ns-border/70 bg-black/60 text-ns hover:bg-black/40 hover:border-ns-border'
                                            : 'opacity-50 cursor-not-allowed border-ns-border/60 bg-white/30 dark:bg-black/50 text-ns-muted'
                                    }`}
                                >
                                    SPLIT <span className="text-ns-muted ml-1 text-xs">[P]</span>
                                </button>
                                {canAnalyze && (
                                    <button
                                        type="button"
                                        onClick={runAnalysis}
                                        disabled={analysisPending}
                                        className={`h-14 px-6 rounded-lg border-2 font-bold text-base tracking-widest uppercase font-mono transition-all ${
                                            analysisPending
                                                ? 'opacity-60 cursor-not-allowed border-ns-border/60 bg-white/30 dark:bg-black/50 text-ns-muted'
                                                : 'border-mono-0 bg-mono-0/15 text-mono-0 dark:text-mono-1000 hover:bg-mono-0/25'
                                        }`}
                                    >
                                        {analysisPending ? 'ANALYZING' : 'ANALYZE'}
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    {/* Primary Action with Bet Selector - LUX-010: Inline stepper */}
                    <div className="flex items-center gap-2 sm:gap-3">
                        {/* Inline Bet Selector - Hidden on mobile (bet in header), visible on sm+ */}
                        {(gameState.stage === 'BETTING' || gameState.stage === 'RESULT') && onBetChange && (
                            <div className="hidden sm:block">
                                <InlineBetSelector
                                    currentBet={currentBet || 25}
                                    balance={balance}
                                    onBetChange={onBetChange}
                                />
                            </div>
                        )}

                        {/* LUX-013: REBET button - shows in RESULT stage with lastBet amount */}
                        {canRebet && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (actions?.setToLastBet?.()) {
                                        actions?.deal?.();
                                    }
                                }}
                                className="h-10 sm:h-14 md:h-16 px-4 sm:px-6 md:px-8 rounded-lg border-2 font-bold text-xs sm:text-sm md:text-base tracking-widest uppercase font-mono transition-all border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000 hover:bg-mono-0/30"
                            >
                                REBET ${gameState.lastBet} <span className="hidden sm:inline text-mono-0 dark:text-mono-1000/60 ml-1 text-xs">[R]</span>
                            </button>
                        )}

                        {/* Primary Action Button - Smaller on mobile */}
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
                            className={`ns-control-primary h-10 sm:h-14 md:h-16 px-6 sm:px-8 md:px-10 rounded-lg border-2 font-bold text-sm sm:text-base md:text-lg tracking-widest uppercase font-mono transition-all shadow-lg ${
                                showInsurancePrompt
                                    ? 'border-mono-0 bg-mono-0 text-black'
                                    : (gameState.stage === 'PLAYING' && !canHit)
                                        ? 'opacity-50 cursor-not-allowed border-ns-border/60 bg-white/30 dark:bg-black/50 text-ns-muted'
                                        : 'border-mono-0 bg-mono-0 text-black'
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
