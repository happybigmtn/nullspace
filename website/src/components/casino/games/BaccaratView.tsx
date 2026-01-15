
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { cardIdToString } from '../../../services/games';
import { MobileDrawer } from '../MobileDrawer';
import { BetsDrawer } from '../BetsDrawer';
import { SideBetsDrawer } from '../SideBetsDrawer';
import { Label } from '../ui/Label';

type BetGroup = 'NONE' | 'BONUS';

// Bonus bet definitions with shortcuts - clearer labels for better UX
const BONUS_BETS = [
    { key: '1', action: 'TIE', label: 'TIE', desc: '8:1' },
    { key: '2', action: 'P_PAIR', label: 'Player Pair', desc: '11:1' },
    { key: '3', action: 'B_PAIR', label: 'Banker Pair', desc: '11:1' },
    { key: '4', action: 'LUCKY6', label: 'Lucky 6', desc: '12:1' },
    { key: '5', action: 'P_DRAGON', label: 'P. Dragon', desc: 'Varies' },
    { key: '6', action: 'B_DRAGON', label: 'B. Dragon', desc: 'Varies' },
    { key: '8', action: 'PANDA8', label: 'Panda 8', desc: '25:1' },
    { key: '9', action: 'PERFECT_PAIR', label: 'Perfect Pair', desc: '25:1' },
    { key: '0', action: 'ALL_BONUS', label: 'ALL BETS', desc: 'All at once' },
];

export const BaccaratView = React.memo<{
    gameState: GameState;
    actions: any;
    lastWin?: number;
    playMode?: 'CASH' | 'FREEROLL' | null;
}>(({ gameState, actions, lastWin, playMode }) => {
    const [leftSidebarView, setLeftSidebarView] = useState<'EXPOSURE' | 'SIDE_BETS'>('EXPOSURE');
    const [activeGroup, setActiveGroup] = useState<BetGroup>('NONE');
    const [toolsOpen, setToolsOpen] = useState(false);
    const baccaratBetCount = useMemo(() => {
        const main = gameState.bet > 0 ? 1 : 0;
        return main + gameState.baccaratBets.length;
    }, [gameState.bet, gameState.baccaratBets.length]);

    const isPlayerSelected = useMemo(() => gameState.baccaratSelection === 'PLAYER', [gameState.baccaratSelection]);
    const isBankerSelected = useMemo(() => gameState.baccaratSelection === 'BANKER', [gameState.baccaratSelection]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            const key = e.key.toLowerCase();
            if (key === 't') {
                e.preventDefault();
                setToolsOpen((prev) => !prev);
                return;
            }
            if (e.key === 'Escape') setToolsOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const playerValue = useMemo(() => gameState.baccaratPlayerTotal, [gameState.baccaratPlayerTotal]);
    const bankerValue = useMemo(() => gameState.baccaratBankerTotal, [gameState.baccaratBankerTotal]);
    const playerLabel = useMemo(
        () => (gameState.playerCards.length > 0 ? `PLAYER (${playerValue ?? '?'})` : 'PLAYER'),
        [gameState.playerCards.length, playerValue]
    );
    const bankerLabel = useMemo(
        () => (gameState.dealerCards.length > 0 ? `BANKER (${bankerValue ?? '?'})` : 'BANKER'),
        [gameState.dealerCards.length, bankerValue]
    );

    const hasTie = useMemo(() => gameState.baccaratBets.some(b => b.type === 'TIE'), [gameState.baccaratBets]);
    const hasPlayerPair = useMemo(() => gameState.baccaratBets.some(b => b.type === 'P_PAIR'), [gameState.baccaratBets]);
    const hasBankerPair = useMemo(() => gameState.baccaratBets.some(b => b.type === 'B_PAIR'), [gameState.baccaratBets]);
    const hasLucky6 = useMemo(() => gameState.baccaratBets.some(b => b.type === 'LUCKY6'), [gameState.baccaratBets]);

    const sideBetAmounts = useMemo(() => {
        const amt = (type: string) => gameState.baccaratBets.find(b => b.type === type)?.amount ?? 0;
        return {
            TIE: amt('TIE'),
            P_PAIR: amt('P_PAIR'),
            B_PAIR: amt('B_PAIR'),
            LUCKY6: amt('LUCKY6'),
            P_DRAGON: amt('P_DRAGON'),
            B_DRAGON: amt('B_DRAGON'),
            PANDA8: amt('PANDA8'),
            PERFECT_PAIR: amt('PERFECT_PAIR'),
        };
    }, [gameState.baccaratBets]);

    const playerColor = isPlayerSelected ? 'text-mono-0 dark:text-mono-1000 font-bold' : 'text-mono-400 dark:text-mono-500';
    const bankerColor = isBankerSelected ? 'text-mono-0 dark:text-mono-1000 font-bold' : 'text-mono-400 dark:text-mono-500';

    const allBonusPlaced = useMemo(
        () => Object.values(sideBetAmounts).every(amount => amount > 0),
        [sideBetAmounts]
    );

    // Execute bet action
    const executeBetAction = useCallback((action: string) => {
        if (action === 'ALL_BONUS') {
            // Place all bonus bets at once
            const bonusTypes = ['TIE', 'P_PAIR', 'B_PAIR', 'LUCKY6', 'P_DRAGON', 'B_DRAGON', 'PANDA8', 'PERFECT_PAIR'];
            bonusTypes.forEach(type => {
                const alreadyPlaced = gameState.baccaratBets.some(b => b.type === type);
                if (!alreadyPlaced) {
                    actions?.baccaratActions?.placeBet?.(type);
                }
            });
        } else {
            actions?.baccaratActions?.placeBet?.(action);
        }
        setActiveGroup('NONE');
    }, [actions, gameState.baccaratBets]);

    // Keyboard handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            // Ignore modifier keys alone
            if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

            const key = e.key.toLowerCase();

            // ESC closes menu
            if (key === 'escape') {
                setActiveGroup('NONE');
                return;
            }

            // Shift+2 toggles BONUS menu
            if (e.shiftKey && (key === '2' || key === '@')) {
                setActiveGroup(activeGroup === 'BONUS' ? 'NONE' : 'BONUS');
                e.preventDefault();
                return;
            }

            // When BONUS group is open, number keys trigger bets
            if (activeGroup === 'BONUS') {
                const bet = BONUS_BETS.find(b => b.key === key);
                if (bet) {
                    executeBetAction(bet.action);
                    e.preventDefault();
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeGroup, executeBetAction]);

    const isBonusActive = useCallback((action: string) => {
        if (action === 'ALL_BONUS') return allBonusPlaced;
        const key = action as keyof typeof sideBetAmounts;
        return (sideBetAmounts[key] ?? 0) > 0;
    }, [allBonusPlaced, sideBetAmounts]);

    const getWinnerClass = (type: string) => {
        if (gameState.stage !== 'RESULT') return 'border-ns-border/60 bg-white/40';
        const p = playerValue;
        const b = bankerValue;
        const margin = Math.abs(p - b);
        const pNatural = p >= 8;
        const bNatural = b >= 8;
        let won = false;

        if (type === 'PLAYER') won = p > b;
        else if (type === 'BANKER') won = b > p;
        else if (type === 'TIE') won = p === b;
        else if (type === 'P_PAIR') won = gameState.playerCards.length >= 2 && gameState.playerCards[0].rank === gameState.playerCards[1].rank;
        else if (type === 'B_PAIR') won = gameState.dealerCards.length >= 2 && gameState.dealerCards[0].rank === gameState.dealerCards[1].rank;
        else if (type === 'LUCKY6') won = b === 6 && b > p;
        // Dragon Bonus
        else if (type === 'P_DRAGON') won = p > b && (pNatural || margin >= 4);
        else if (type === 'B_DRAGON') won = b > p && (bNatural || margin >= 4);
        // Panda 8: Player wins with 3-card total of 8
        else if (type === 'PANDA8') won = p > b && p === 8 && gameState.playerCards.length === 3;
        // Perfect Pairs (same rank AND same suit)
        else if (type === 'PERFECT_PAIR') {
            const playerPair = gameState.playerCards.length >= 2
                && gameState.playerCards[0].rank === gameState.playerCards[1].rank
                && gameState.playerCards[0].suit === gameState.playerCards[1].suit;
            const bankerPair = gameState.dealerCards.length >= 2
                && gameState.dealerCards[0].rank === gameState.dealerCards[1].rank
                && gameState.dealerCards[0].suit === gameState.dealerCards[1].suit;
            won = playerPair || bankerPair;
        }

        if (won) return 'border-mono-0 text-mono-0 dark:text-mono-1000 font-bold shadow-[0_0_10px_rgba(74,222,128,0.5)] animate-pulse bg-mono-0/10';
        return 'border-ns-border/60 bg-white/40 text-ns-muted';
    };

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-12 relative pt-12 pb-24 animate-scale-in">
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                    <Label size="micro">Baccarat</Label>
                    <div className="h-1 w-8 bg-ns-border rounded-full opacity-60" />
                </div>

                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="BACCARAT">
                        <div className="space-y-4 p-2">
                            <p className="text-body text-ns leading-relaxed">
                                Closest to 9 wins. Aces are 1, Face cards and 10s are 0.
                            </p>
                            <div className="pt-4">
                                <p className="text-caption uppercase tracking-wider">
                                    PLAYER (P) • BANKER (B) • TIE (E)
                                </p>
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                <div className="min-h-[180px] w-full max-w-2xl flex flex-col items-center justify-center gap-12 px-6">
                    <div className="flex flex-col items-center gap-4 opacity-80 group transition-transform hover:scale-105">
                        <div className="flex items-center gap-3">
                            <Label variant="destructive">Banker</Label>
                            <span className="text-display-mono text-headline text-ns">{bankerValue}</span>
                        </div>
                        <Hand cards={gameState.dealerCards} forcedColor={bankerColor} />
                    </div>

                    <div className="h-px w-32 bg-ns-border" />

                    <div className="flex flex-col items-center gap-4 group transition-transform hover:scale-105">
                        <div className="flex items-center gap-3">
                            <Label variant="gold">Player</Label>
                            <span className="text-display-mono text-headline text-ns">{playerValue}</span>
                        </div>
                        <Hand cards={gameState.playerCards} forcedColor={playerColor} />
                    </div>
                </div>
                {/* Center Info - simplified to just the message */}
                <div className="text-center relative z-20 py-2 sm:py-4 px-6">
                    <h2 className="text-headline text-ns tracking-tight animate-scale-in zen-hide">
                        {gameState.message || 'Place Your Bets'}
                    </h2>
                    {/* Result summary - always visible */}
                    {gameState.stage === 'RESULT' && (
                        <div className="mt-2 flex items-center justify-center gap-4 text-sm font-mono">
                            <span className="text-ns-muted">P: <span className="text-ns font-bold">{playerValue}</span></span>
                            <span className="text-ns-muted">B: <span className="text-ns font-bold">{bankerValue}</span></span>
                            <span className={`font-bold ${
                                playerValue > bankerValue ? 'text-mono-0 dark:text-mono-1000' :
                                bankerValue > playerValue ? 'text-mono-0 dark:text-mono-1000' :
                                'text-ns-muted'
                            }`}>
                                {playerValue > bankerValue ? 'PLAYER WINS' :
                                 bankerValue > playerValue ? 'BANKER WINS' : 'TIE'}
                            </span>
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
            </div>

            {/* Table Drawer */}
            {toolsOpen && (
                <>
                    <button
                        type="button"
                        aria-label="Close table tools"
                        onClick={() => setToolsOpen(false)}
                        className="hidden md:block fixed inset-0 z-30 bg-black/20"
                    />
                    <div className="hidden md:block fixed bottom-24 right-6 z-40 w-80">
                        <div className="liquid-card liquid-sheen border border-ns/40 rounded-3xl p-4 shadow-float">
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-ns-muted">Baccarat Table</div>
                            <div className="flex items-center gap-2">
                                {baccaratBetCount > 0 && (
                                    <span className="text-[10px] font-bold text-ns-muted">{baccaratBetCount} bets</span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setToolsOpen(false)}
                                    className="liquid-chip px-2 py-1 text-[10px] text-ns-muted"
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 mb-3">
                            <button
                                type="button"
                                onClick={() => setLeftSidebarView('EXPOSURE')}
                                className={`flex-1 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                    leftSidebarView === 'EXPOSURE'
                                        ? 'text-mono-0 dark:text-mono-1000 border border-mono-0 bg-mono-0/10'
                                        : 'text-ns-muted border border-ns hover:text-ns'
                                }`}
                            >
                                Exposure
                            </button>
                            <button
                                type="button"
                                onClick={() => setLeftSidebarView('SIDE_BETS')}
                                className={`flex-1 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                    leftSidebarView === 'SIDE_BETS'
                                        ? 'text-mono-0 dark:text-mono-1000 border border-mono-0 bg-mono-0/10'
                                        : 'text-ns-muted border border-ns hover:text-ns'
                                }`}
                            >
                                Side Bets
                            </button>
                        </div>

                        {leftSidebarView === 'EXPOSURE' ? (
                            <div className="space-y-2 font-mono">
                                <div className="text-[10px] text-ns-muted uppercase tracking-widest mb-2 text-center border-b border-ns pb-1">
                                    Potential Outcomes
                                </div>
                                <div className="flex items-center justify-between p-2 border border-ns rounded bg-ns-surface">
                                    <span className="text-sm text-mono-0 dark:text-mono-1000 font-bold">PLAYER WIN</span>
                                    <span className="text-xs text-ns-muted">1:1</span>
                                </div>
                                <div className="flex items-center justify-between p-2 border border-ns rounded bg-ns-surface">
                                    <span className="text-sm text-mono-0 dark:text-mono-1000 font-bold">BANKER WIN</span>
                                    <span className="text-xs text-ns-muted">1:1 (6 pays 1:2)</span>
                                </div>
                                <div className="flex items-center justify-between p-2 border border-ns rounded bg-ns-surface">
                                    <span className="text-sm text-ns font-bold">TIE</span>
                                    <span className="text-xs text-mono-0 dark:text-mono-1000">8:1</span>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="text-[10px] text-ns-muted uppercase tracking-widest mb-2 text-center border-b border-ns pb-1">
                                    Side Bet Payouts
                                </div>
                                {[
                                    { type: 'TIE', payout: '8:1', desc: 'Player & Banker tie' },
                                    { type: 'P_PAIR', payout: '11:1', desc: 'Player first 2 same rank' },
                                    { type: 'B_PAIR', payout: '11:1', desc: 'Banker first 2 same rank' },
                                    { type: 'LUCKY6', payout: 'Varies', desc: 'Banker wins with 6' },
                                    { type: 'P_DRAGON', payout: 'Varies', desc: 'Player natural or +4' },
                                    { type: 'B_DRAGON', payout: 'Varies', desc: 'Banker natural or +4' },
                                    { type: 'PANDA8', payout: '25:1', desc: 'Player 3-card 8' },
                                    { type: 'PERF.PAIR', payout: '25:1 / 250:1', desc: 'Either suited pair / both suited pairs' },
                                ].map((bet) => (
                                    <div key={bet.type} className="border border-ns rounded bg-ns-surface p-2">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-amber-500 font-bold">{bet.type}</span>
                                            <span className="text-xs text-mono-0 dark:text-mono-1000">{bet.payout}</span>
                                        </div>
                                        <div className="text-[9px] text-ns-muted">{bet.desc}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="mt-4">
                            <Label size="micro" className="mb-2 block">Bets</Label>
                            <div className="space-y-2">
                                {(() => {
                                    const confirmedMainBet = gameState.bet > 0 ? [{ type: gameState.baccaratSelection, amount: gameState.bet, local: false }] : [];
                                    const confirmedSideBets = gameState.baccaratBets.filter(b => b.local !== true);
                                    const pendingSideBets = gameState.baccaratBets.filter(b => b.local === true);

                                    const confirmedBets = [...confirmedMainBet, ...confirmedSideBets];
                                    const pendingBets = pendingSideBets;

                                    const renderBet = (b: any, i: number, isPending: boolean) => {
                                        const isMainBet = b.type === 'PLAYER' || b.type === 'BANKER';
                                        return (
                                            <div
                                                key={i}
                                                onClick={() => !isMainBet ? actions?.baccaratActions?.placeBet?.(b.type) : undefined}
                                                className={`flex justify-between items-center text-xs border p-2 rounded transition-colors ${
                                                    isPending
                                                        ? 'border-dashed border-amber-400/50 bg-amber-500/10 cursor-pointer hover:bg-amber-500/20'
                                                        : isMainBet
                                                            ? 'border-mono-0/30 bg-ns-surface'
                                                            : 'border-ns bg-ns-surface cursor-pointer hover:border-mono-0/40'
                                                }`}
                                            >
                                                <span className={`font-bold text-[10px] ${
                                                    isMainBet ? 'text-mono-0 dark:text-mono-1000 font-bold' : isPending ? 'text-amber-500' : 'text-ns'
                                                }`}>
                                                    {b.type}
                                                </span>
                                                <div className="text-[10px] text-ns">${b.amount}</div>
                                            </div>
                                        );
                                    };

                                    if (confirmedBets.length === 0 && pendingBets.length === 0) {
                                        return <div className="text-center text-[10px] text-ns-muted uppercase tracking-widest">No bets</div>;
                                    }

                                    return (
                                        <>
                                            {confirmedBets.length > 0 && (
                                                <div className="space-y-1">
                                                    <div className="text-[8px] text-mono-0 dark:text-mono-1000 font-bold uppercase tracking-widest">
                                                        Confirmed ({confirmedBets.length})
                                                    </div>
                                                    {confirmedBets.map((b, i) => renderBet(b, i, false))}
                                                </div>
                                            )}

                                            {pendingBets.length > 0 && (
                                                <div className="space-y-1">
                                                    <div className="text-[8px] text-amber-500 uppercase tracking-widest font-bold">
                                                        Pending ({pendingBets.length})
                                                    </div>
                                                    {pendingBets.map((b, i) => renderBet(b, i, true))}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                        </div>
                    </div>
                </>
            )}

            {/* CONTROLS - Grouped by Normal/Bonus */}
            <div className="ns-controlbar zen-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 liquid-card rounded-none md:rounded-t-3xl z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-auto md:h-20 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 p-2 md:px-4">
                    {/* Desktop: Bet Groups */}
                    <div className="hidden md:flex items-center gap-3">
                        {/* Normal Bets */}
                        <div className="flex items-center gap-2 px-3 py-1 liquid-panel">
                            <span className="text-[9px] text-ns-muted uppercase tracking-widest">NORMAL</span>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.toggleSelection?.('PLAYER')}
                                className={`liquid-chip px-3 py-2 text-xs font-semibold tracking-wider transition-all ${
                                    isPlayerSelected
                                        ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000 font-bold'
                                        : 'border-ns-border/70 text-ns hover:border-ns-border'
                                }`}
                            >
                                PLAYER{gameState.bet > 0 && isPlayerSelected ? ` $${gameState.bet}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.toggleSelection?.('BANKER')}
                                className={`liquid-chip px-3 py-2 text-xs font-semibold tracking-wider transition-all ${
                                    isBankerSelected
                                        ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000 font-bold'
                                        : 'border-ns-border/70 text-ns hover:border-ns-border'
                                }`}
                            >
                                BANKER{gameState.bet > 0 && isBankerSelected ? ` $${gameState.bet}` : ''}
                            </button>
                        </div>

                        <SideBetsDrawer
                            title="BACCARAT SIDE BETS"
                            label="Side Bets"
                            count={Object.values(sideBetAmounts).filter((amount) => amount > 0).length}
                            shortcutHint="Shift+2"
                            open={activeGroup === 'BONUS'}
                            onOpenChange={(open) => setActiveGroup(open ? 'BONUS' : 'NONE')}
                        >
                            <div className="grid grid-cols-2 gap-2">
                                {BONUS_BETS.map((bet) => {
                                    const active = isBonusActive(bet.action);
                                    return (
                                        <button
                                            key={bet.action}
                                            type="button"
                                            onClick={() => executeBetAction(bet.action)}
                                            className={`rounded-xl border px-3 py-3 text-xs font-semibold transition-all ${
                                                active
                                                    ? 'border-mono-0/60 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                                    : 'border-ns bg-ns-surface text-ns hover:border-mono-0/40'
                                            }`}
                                        >
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="uppercase tracking-wider">{bet.label}</span>
                                                    <span className="text-[10px] font-mono text-ns-muted">[{bet.key}]</span>
                                                </div>
                                                <span className="text-[9px] font-mono text-mono-0/60 dark:text-mono-1000/60">{bet.desc}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </SideBetsDrawer>

                        <button
                            type="button"
                            onClick={() => setToolsOpen((prev) => !prev)}
                            className={`hidden md:inline-flex px-3 py-2 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-all ${
                                toolsOpen
                                    ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                    : 'border-ns-border/70 text-ns-muted hover:border-ns'
                            }`}
                        >
                            Table
                        </button>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={actions?.baccaratActions?.rebet}
                                className="liquid-chip px-3 py-2 border-ns-border/70 text-ns text-xs font-semibold tracking-wider hover:border-ns-border transition-all"
                            >
                                REBET
                            </button>
                            <button
                                type="button"
                                onClick={actions?.baccaratActions?.undo}
                                className="liquid-chip px-3 py-2 border-ns-border/70 text-ns text-xs font-semibold tracking-wider hover:border-ns-border transition-all"
                            >
                                UNDO
                            </button>
                            {playMode !== 'CASH' && (
                                <>
                                    <button
                                        type="button"
                                        onClick={actions?.toggleShield}
                                        className={`liquid-chip px-3 py-2 text-xs font-semibold tracking-wider transition-all ${
                                            gameState.activeModifiers.shield
                                                ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000'
                                                : 'border-ns-border/70 text-ns-muted hover:border-ns-border'
                                        }`}
                                    >
                                        SHIELD
                                    </button>
                                    <button
                                        type="button"
                                        onClick={actions?.toggleDouble}
                                        className={`liquid-chip px-3 py-2 text-xs font-semibold tracking-wider transition-all ${
                                            gameState.activeModifiers.double
                                                ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000'
                                                : 'border-ns-border/70 text-ns-muted hover:border-ns-border'
                                        }`}
                                    >
                                        DOUBLE
                                    </button>
                                </>
                            )}
                            <button
                                type="button"
                                onClick={actions?.toggleSuper}
                                className={`liquid-chip px-3 py-2 text-xs font-semibold tracking-wider transition-all ${
                                    gameState.activeModifiers.super
                                        ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000'
                                        : 'border-ns-border/70 text-ns-muted hover:border-ns-border'
                                }`}
                            >
                                SUPER
                            </button>
                        </div>
                    </div>

                    {/* Mobile: Inline bet controls (no drawers) */}
                    <div className="flex md:hidden items-center justify-between gap-2 w-full">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => actions?.baccaratActions?.toggleSelection?.('PLAYER')}
                                className={`liquid-chip px-3 py-2 text-[10px] font-semibold ${
                                    isPlayerSelected
                                        ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000 font-bold'
                                        : 'border-ns-border/70 text-ns-muted'
                                }`}
                            >
                                P
                            </button>
                            <button
                                onClick={() => actions?.baccaratActions?.toggleSelection?.('BANKER')}
                                className={`liquid-chip px-3 py-2 text-[10px] font-semibold ${
                                    isBankerSelected
                                        ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000 font-bold'
                                        : 'border-ns-border/70 text-ns-muted'
                                }`}
                            >
                                B
                            </button>
                            <button
                                onClick={actions?.toggleSuper}
                                className={`liquid-chip px-2 py-2 text-[10px] font-semibold ${
                                    gameState.activeModifiers.super
                                        ? 'border-mono-0 bg-mono-0/20 text-mono-0 dark:text-mono-1000'
                                        : 'border-ns-border/70 text-ns-muted'
                                }`}
                            >
                                ⚡
                            </button>
                        </div>

                        {/* DEAL Button - Mobile */}
                        <button
                            type="button"
                            onClick={actions?.deal}
                            className="ns-control-primary h-10 px-6 rounded border-2 font-bold text-sm tracking-widest uppercase transition-all border-mono-0 bg-mono-0 text-black"
                        >
                            DEAL
                        </button>
                    </div>

                    {/* DEAL Button - Desktop */}
                    <button
                        type="button"
                        onClick={actions?.deal}
                        className="hidden md:block ns-control-primary h-14 px-8 rounded border-2 font-bold text-base tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-mono-0 bg-mono-0 text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                    >
                        DEAL
                    </button>
                </div>
            </div>
        </>
    );
});
