
import React, { useMemo, useState } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { getBaccaratValue } from '../../../utils/gameUtils';
import { cardIdToString } from '../../../utils/gameStateParser';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';

export const BaccaratView = React.memo<{ gameState: GameState; actions: any; lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, actions, lastWin, playMode }) => {
    const [leftSidebarView, setLeftSidebarView] = useState<'EXPOSURE' | 'SIDE_BETS'>('EXPOSURE');
    // Consolidate main bet and side bets for display
    const allBets = useMemo(() => [
        { type: gameState.baccaratSelection, amount: gameState.bet },
        ...gameState.baccaratBets
    ], [gameState.baccaratSelection, gameState.bet, gameState.baccaratBets]);

    const isPlayerSelected = useMemo(() => gameState.baccaratSelection === 'PLAYER', [gameState.baccaratSelection]);
    const isBankerSelected = useMemo(() => gameState.baccaratSelection === 'BANKER', [gameState.baccaratSelection]);

    const playerValue = useMemo(() => getBaccaratValue(gameState.playerCards), [gameState.playerCards]);
    const bankerValue = useMemo(() => getBaccaratValue(gameState.dealerCards), [gameState.dealerCards]);

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
            P_PERFECT_PAIR: amt('P_PERFECT_PAIR'),
            B_PERFECT_PAIR: amt('B_PERFECT_PAIR'),
        };
    }, [gameState.baccaratBets]);

    const totalBet = useMemo(
        () => allBets.reduce((sum, b) => sum + (Number.isFinite(b.amount) ? b.amount : 0), 0),
        [allBets]
    );

    const playerColor = isPlayerSelected ? 'text-terminal-green' : 'text-terminal-accent';
    const bankerColor = isBankerSelected ? 'text-terminal-green' : 'text-terminal-accent';

    const getWinnerClass = (type: string) => {
        if (gameState.stage !== 'RESULT') return 'border-gray-800 bg-black/40';
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
        else if (type === 'P_PERFECT_PAIR') won = gameState.playerCards.length >= 2 && gameState.playerCards[0].rank === gameState.playerCards[1].rank && gameState.playerCards[0].suit === gameState.playerCards[1].suit;
        else if (type === 'B_PERFECT_PAIR') won = gameState.dealerCards.length >= 2 && gameState.dealerCards[0].rank === gameState.dealerCards[1].rank && gameState.dealerCards[0].suit === gameState.dealerCards[1].suit;

        if (won) return 'border-terminal-green text-terminal-green shadow-[0_0_10px_rgba(74,222,128,0.5)] animate-pulse bg-terminal-green/10';
        return 'border-gray-800 bg-black/40 text-gray-500';
    };

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20 md:pl-64">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">BACCARAT</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="BETS" title="BACCARAT BETS">
                        <div className="space-y-2">
                            {allBets.map((b, i) => (
                                <div
                                    key={i}
                                    className={`flex justify-between items-center text-xs border p-2 rounded bg-black/40 ${
                                        i === 0 ? 'border-terminal-green/30' : 'border-gray-800'
                                    }`}
                                >
                                    <span className={`font-bold text-[10px] ${b.type === 'PLAYER' || b.type === 'BANKER' ? 'text-terminal-green' : 'text-gray-400'}`}>{b.type}</span>
                                    <div className="text-white text-[10px]">${b.amount}</div>
                                </div>
                            ))}
                        </div>
                    </MobileDrawer>
                </div>
                {/* Banker Area */}
                <div className={`min-h-[96px] sm:min-h-[120px] flex items-center justify-center transition-all duration-300 ${isBankerSelected ? 'scale-110 opacity-100' : 'scale-90 opacity-75'}`}>
                    {gameState.dealerCards.length > 0 ? (
                        <Hand
                            cards={gameState.dealerCards}
                            title={`BANKER (${bankerValue})`}
                            forcedColor={bankerColor}
                        />
                    ) : (
                        <div className="flex flex-col gap-2 items-center">
                            <span className={`text-xl sm:text-2xl font-bold tracking-widest ${bankerColor}`}>BANKER</span>
                            <div className={`w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed rounded flex items-center justify-center ${bankerColor.replace('text-', 'border-')}`}>?</div>
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-2 relative z-20 py-2 sm:py-4">
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                        {gameState.message}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
                        <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass(gameState.baccaratSelection)}`}>
                            <span className={gameState.stage === 'RESULT' && getWinnerClass(gameState.baccaratSelection).includes('text-terminal-green') ? 'text-terminal-green' : 'text-white'}>
                                {gameState.baccaratSelection}
                            </span> ${gameState.bet.toLocaleString()}
                        </span>
                        {sideBetAmounts.TIE > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('TIE')}`}>
                                TIE ${sideBetAmounts.TIE.toLocaleString()}
                            </span>
                        )}
                        {sideBetAmounts.P_PAIR > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('P_PAIR')}`}>
                                P.PAIR ${sideBetAmounts.P_PAIR.toLocaleString()}
                            </span>
                        )}
                        {sideBetAmounts.B_PAIR > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('B_PAIR')}`}>
                                B.PAIR ${sideBetAmounts.B_PAIR.toLocaleString()}
                            </span>
                        )}
                        {sideBetAmounts.LUCKY6 > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('LUCKY6')}`}>
                                LUCKY6 ${sideBetAmounts.LUCKY6.toLocaleString()}
                            </span>
                        )}
                        {sideBetAmounts.P_DRAGON > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('P_DRAGON')}`}>
                                P.DRAGON ${sideBetAmounts.P_DRAGON.toLocaleString()}
                            </span>
                        )}
                        {sideBetAmounts.B_DRAGON > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('B_DRAGON')}`}>
                                B.DRAGON ${sideBetAmounts.B_DRAGON.toLocaleString()}
                            </span>
                        )}
                        {sideBetAmounts.PANDA8 > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('PANDA8')}`}>
                                PANDA8 ${sideBetAmounts.PANDA8.toLocaleString()}
                            </span>
                        )}
                        {sideBetAmounts.P_PERFECT_PAIR > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('P_PERFECT_PAIR')}`}>
                                P.PP ${sideBetAmounts.P_PERFECT_PAIR.toLocaleString()}
                            </span>
                        )}
                        {sideBetAmounts.B_PERFECT_PAIR > 0 && (
                            <span className={`px-2 py-0.5 rounded border transition-all ${getWinnerClass('B_PERFECT_PAIR')}`}>
                                B.PP ${sideBetAmounts.B_PERFECT_PAIR.toLocaleString()}
                            </span>
                        )}
                    </div>
                </div>

                {/* Player Area */}
                <div className={`min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center transition-all duration-300 ${isPlayerSelected ? 'scale-110 opacity-100' : 'scale-90 opacity-75'}`}>
                    {gameState.playerCards.length > 0 ? (
                        <Hand
                            cards={gameState.playerCards}
                            title={`PLAYER (${playerValue})`}
                            forcedColor={playerColor}
                        />
                    ) : (
                        <div className="flex flex-col gap-2 items-center">
                            <span className={`text-xl sm:text-2xl font-bold tracking-widest ${playerColor}`}>PLAYER</span>
                            <div className={`w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed rounded flex items-center justify-center ${playerColor.replace('text-', 'border-')}`}>?</div>
                        </div>
                    )}
                </div>

                {/* Super Mode Info */}
                {gameState.superMode?.isActive && (
                    <div className="w-full max-w-md mx-auto px-4">
                        <div className="bg-terminal-black/90 border border-terminal-gold/50 p-2 rounded text-center">
                            <div className="text-[10px] font-bold text-terminal-gold tracking-widest mb-1">⚡ SUPER MODE</div>
                            {Array.isArray(gameState.superMode.multipliers) && gameState.superMode.multipliers.length > 0 ? (
                                <div className="flex flex-wrap gap-1 justify-center">
                                    {gameState.superMode.multipliers.slice(0, 10).map((m, idx) => (
                                        <span
                                            key={idx}
                                            className="px-2 py-0.5 rounded border border-terminal-gold/30 text-terminal-gold/90 text-[10px]"
                                        >
                                            {cardIdToString(m.id)} x{m.multiplier}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-[9px] text-gray-400">Awaiting multipliers...</div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* LEFT SIDEBAR - EXPOSURE / SIDE BETS TOGGLE */}
            <div className="hidden md:flex absolute top-0 left-0 bottom-24 w-56 bg-terminal-black/80 border-r-2 border-gray-700 backdrop-blur-sm z-30 flex-col">
                {/* Toggle Tabs */}
                <div className="flex-none flex border-b border-gray-800">
                    <button
                        onClick={() => setLeftSidebarView('EXPOSURE')}
                        className={`flex-1 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors ${
                            leftSidebarView === 'EXPOSURE'
                                ? 'text-terminal-green border-b-2 border-terminal-green bg-terminal-green/10'
                                : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        EXPOSURE
                    </button>
                    <button
                        onClick={() => setLeftSidebarView('SIDE_BETS')}
                        className={`flex-1 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors ${
                            leftSidebarView === 'SIDE_BETS'
                                ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-400/10'
                                : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        SIDE BETS
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-2">
                    {leftSidebarView === 'EXPOSURE' ? (
                        <div className="flex flex-col justify-center space-y-2 h-full font-mono">
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 text-center border-b border-gray-800 pb-1">
                                POTENTIAL OUTCOMES
                            </div>
                            {/* Player Win */}
                            <div className="flex items-center justify-between p-2 border border-gray-800 rounded bg-black/40">
                                <span className="text-sm text-terminal-green font-bold">PLAYER WIN</span>
                                <span className="text-xs text-gray-400">1:1</span>
                            </div>
                            {/* Banker Win */}
                            <div className="flex items-center justify-between p-2 border border-gray-800 rounded bg-black/40">
                                <span className="text-sm text-terminal-green font-bold">BANKER WIN</span>
                                <span className="text-xs text-gray-400">0.95:1</span>
                            </div>
                            {/* Tie */}
                            <div className="flex items-center justify-between p-2 border border-gray-800 rounded bg-black/40">
                                <span className="text-sm text-gray-400 font-bold">TIE</span>
                                <span className="text-xs text-terminal-gold">8:1</span>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 text-center border-b border-gray-800 pb-1">
                                SIDE BET PAYOUTS
                            </div>
                            {/* Side bet payout info */}
                            {[
                                { type: 'TIE', payout: '8:1', desc: 'Player & Banker tie' },
                                { type: 'P_PAIR', payout: '11:1', desc: 'Player first 2 same rank' },
                                { type: 'B_PAIR', payout: '11:1', desc: 'Banker first 2 same rank' },
                                { type: 'LUCKY6', payout: 'Varies', desc: 'Banker wins with 6' },
                                { type: 'P_DRAGON', payout: 'Varies', desc: 'Player natural or +4' },
                                { type: 'B_DRAGON', payout: 'Varies', desc: 'Banker natural or +4' },
                                { type: 'PANDA8', payout: '25:1', desc: 'Player 3-card 8' },
                                { type: 'P.PP', payout: '25:1', desc: 'Player perfect pair' },
                                { type: 'B.PP', payout: '25:1', desc: 'Banker perfect pair' },
                            ].map((bet) => (
                                <div key={bet.type} className="border border-gray-800 rounded bg-black/40 p-2">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs text-amber-400 font-bold">{bet.type}</span>
                                        <span className="text-xs text-terminal-gold">{bet.payout}</span>
                                    </div>
                                    <div className="text-[9px] text-gray-500">{bet.desc}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* BETS SIDEBAR - Split Confirmed/Pending */}
            <div className="hidden md:flex absolute top-0 right-0 bottom-24 w-40 bg-terminal-black/80 border-l-2 border-gray-700 p-2 backdrop-blur-sm z-30 flex-col">
                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 flex-none text-center">Bets</div>
                <div className="flex-1 overflow-y-auto flex flex-col space-y-2">
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
                                    className={`flex justify-between items-center text-xs border p-1 rounded transition-colors ${
                                        isPending
                                            ? 'border-dashed border-amber-600/50 bg-amber-900/20 opacity-60 cursor-pointer hover:bg-amber-800/30'
                                            : isMainBet
                                                ? 'border-terminal-green/30 bg-black/50'
                                                : 'border-gray-800 bg-black/50 cursor-pointer hover:bg-gray-800'
                                    }`}
                                >
                                    <span className={`font-bold text-[10px] ${
                                        isMainBet ? 'text-terminal-green' : isPending ? 'text-amber-400' : 'text-gray-400'
                                    }`}>
                                        {b.type}
                                    </span>
                                    <div className={`text-[10px] ${isPending ? 'text-amber-300' : 'text-white'}`}>${b.amount}</div>
                                </div>
                            );
                        };

                        if (confirmedBets.length === 0 && pendingBets.length === 0) {
                            return <div className="text-center text-[10px] text-gray-700 italic">NO BETS</div>;
                        }

                        return (
                            <>
                                {confirmedBets.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="text-[8px] text-terminal-green uppercase tracking-widest font-bold">
                                            Confirmed ({confirmedBets.length})
                                        </div>
                                        {confirmedBets.map((b, i) => renderBet(b, i, false))}
                                    </div>
                                )}

                                {pendingBets.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="text-[8px] text-amber-400 uppercase tracking-widest font-bold">
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

            {/* CONTROLS - Grouped by Normal/Bonus */}
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 sm:sticky sm:bottom-0 bg-terminal-black/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] sm:pb-0">
                <div className="h-auto sm:h-20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between sm:justify-center gap-2 p-2 sm:px-4">
                    {/* Desktop: Bet Groups */}
                    <div className="hidden sm:flex items-center gap-3 flex-1">
                        {/* Normal Bets */}
                        <div className="flex items-center gap-2 px-3 py-1 border border-gray-700 rounded bg-black/40">
                            <span className="text-[9px] text-gray-500 uppercase tracking-widest">NORMAL</span>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.toggleSelection?.('PLAYER')}
                                className={`px-3 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    isPlayerSelected
                                        ? 'border-terminal-green bg-terminal-green/20 text-terminal-green'
                                        : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                }`}
                            >
                                PLAYER{gameState.bet > 0 && isPlayerSelected ? ` $${gameState.bet}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.toggleSelection?.('BANKER')}
                                className={`px-3 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    isBankerSelected
                                        ? 'border-terminal-green bg-terminal-green/20 text-terminal-green'
                                        : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                                }`}
                            >
                                BANKER{gameState.bet > 0 && isBankerSelected ? ` $${gameState.bet}` : ''}
                            </button>
                        </div>

                        {/* Bonus Bets */}
                        <div className="flex items-center gap-2 px-3 py-1 border border-gray-700 rounded bg-black/40">
                            <span className="text-[9px] text-amber-500 uppercase tracking-widest">BONUS</span>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('TIE')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.TIE > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                TIE{sideBetAmounts.TIE > 0 ? ` $${sideBetAmounts.TIE}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('P_PAIR')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.P_PAIR > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                P.PAIR{sideBetAmounts.P_PAIR > 0 ? ` $${sideBetAmounts.P_PAIR}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('B_PAIR')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.B_PAIR > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                B.PAIR{sideBetAmounts.B_PAIR > 0 ? ` $${sideBetAmounts.B_PAIR}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('LUCKY6')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.LUCKY6 > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                LUCKY6{sideBetAmounts.LUCKY6 > 0 ? ` $${sideBetAmounts.LUCKY6}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('P_DRAGON')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.P_DRAGON > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                P.DRAG{sideBetAmounts.P_DRAGON > 0 ? ` $${sideBetAmounts.P_DRAGON}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('B_DRAGON')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.B_DRAGON > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                B.DRAG{sideBetAmounts.B_DRAGON > 0 ? ` $${sideBetAmounts.B_DRAGON}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('PANDA8')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.PANDA8 > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                PANDA8{sideBetAmounts.PANDA8 > 0 ? ` $${sideBetAmounts.PANDA8}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('P_PERFECT_PAIR')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.P_PERFECT_PAIR > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                P.PP{sideBetAmounts.P_PERFECT_PAIR > 0 ? ` $${sideBetAmounts.P_PERFECT_PAIR}` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions?.baccaratActions?.placeBet?.('B_PERFECT_PAIR')}
                                className={`px-2 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    sideBetAmounts.B_PERFECT_PAIR > 0
                                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                B.PP{sideBetAmounts.B_PERFECT_PAIR > 0 ? ` $${sideBetAmounts.B_PERFECT_PAIR}` : ''}
                            </button>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={actions?.baccaratActions?.rebet}
                                className="px-3 py-1.5 rounded border border-gray-700 bg-black/50 text-gray-300 text-xs font-bold tracking-wider hover:bg-gray-800 transition-all"
                            >
                                REBET
                            </button>
                            <button
                                type="button"
                                onClick={actions?.baccaratActions?.undo}
                                className="px-3 py-1.5 rounded border border-gray-700 bg-black/50 text-gray-300 text-xs font-bold tracking-wider hover:bg-gray-800 transition-all"
                            >
                                UNDO
                            </button>
                            {playMode !== 'CASH' && (
                                <>
                                    <button
                                        type="button"
                                        onClick={actions?.toggleShield}
                                        className={`px-3 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                            gameState.activeModifiers.shield
                                                ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold'
                                                : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                        }`}
                                    >
                                        SHIELD
                                    </button>
                                    <button
                                        type="button"
                                        onClick={actions?.toggleDouble}
                                        className={`px-3 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                            gameState.activeModifiers.double
                                                ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold'
                                                : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                        }`}
                                    >
                                        DOUBLE
                                    </button>
                                </>
                            )}
                            <button
                                type="button"
                                onClick={actions?.toggleSuper}
                                className={`px-3 py-1.5 rounded border text-xs font-bold tracking-wider transition-all ${
                                    gameState.activeModifiers.super
                                        ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold'
                                        : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                }`}
                            >
                                SUPER
                            </button>
                        </div>
                    </div>

                    {/* DEAL Button */}
                    <button
                        type="button"
                        onClick={actions?.deal}
                        className="h-14 px-8 rounded border-2 font-bold text-base tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-terminal-green bg-terminal-green text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                    >
                        DEAL
                    </button>

                    {/* Mobile: Simplified controls */}
                    <div className="flex sm:hidden gap-2">
                        <MobileDrawer label="BETS" title="PLACE BETS">
                            <div className="space-y-4">
                                {/* Normal Bets */}
                                <div>
                                    <div className="text-[10px] text-green-500 font-bold tracking-widest mb-2 border-b border-gray-800 pb-1">NORMAL BETS</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => actions?.baccaratActions?.toggleSelection?.('PLAYER')}
                                            className={`py-3 rounded border text-xs font-bold ${
                                                isPlayerSelected
                                                    ? 'border-green-400 bg-green-500/20 text-green-300'
                                                    : 'border-gray-700 bg-gray-900 text-gray-400'
                                            }`}
                                        >
                                            PLAYER
                                        </button>
                                        <button
                                            onClick={() => actions?.baccaratActions?.toggleSelection?.('BANKER')}
                                            className={`py-3 rounded border text-xs font-bold ${
                                                isBankerSelected
                                                    ? 'border-green-400 bg-green-500/20 text-green-300'
                                                    : 'border-gray-700 bg-gray-900 text-gray-400'
                                            }`}
                                        >
                                            BANKER
                                        </button>
                                    </div>
                                </div>

                                {/* Bonus Bets */}
                                <div>
                                    <div className="text-[10px] text-amber-500 font-bold tracking-widest mb-2 border-b border-gray-800 pb-1">BONUS BETS</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('TIE')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.TIE > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            TIE
                                        </button>
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('P_PAIR')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.P_PAIR > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            P.PAIR
                                        </button>
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('B_PAIR')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.B_PAIR > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            B.PAIR
                                        </button>
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('LUCKY6')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.LUCKY6 > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            LUCKY6
                                        </button>
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('P_DRAGON')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.P_DRAGON > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            P.DRAG
                                        </button>
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('B_DRAGON')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.B_DRAGON > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            B.DRAG
                                        </button>
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('PANDA8')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.PANDA8 > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            PANDA8
                                        </button>
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('P_PERFECT_PAIR')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.P_PERFECT_PAIR > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            P.PP
                                        </button>
                                        <button onClick={() => actions?.baccaratActions?.placeBet?.('B_PERFECT_PAIR')} className={`py-3 rounded border text-xs font-bold ${sideBetAmounts.B_PERFECT_PAIR > 0 ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            B.PP
                                        </button>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2">
                                    <button onClick={actions?.baccaratActions?.rebet} className="flex-1 py-3 rounded border border-gray-700 bg-gray-900 text-gray-400 text-xs font-bold">
                                        REBET
                                    </button>
                                    <button onClick={actions?.baccaratActions?.undo} className="flex-1 py-3 rounded border border-gray-700 bg-gray-900 text-gray-400 text-xs font-bold">
                                        UNDO
                                    </button>
                                    <button onClick={actions?.toggleSuper} className={`flex-1 py-3 rounded border text-xs font-bold ${gameState.activeModifiers.super ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                        SUPER
                                    </button>
                                </div>
                            </div>
                        </MobileDrawer>
                    </div>
                </div>
            </div>
        </>
    );
});
