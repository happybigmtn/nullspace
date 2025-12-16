
import React, { useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { getBaccaratValue } from '../../../utils/gameUtils';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';

export const BaccaratView = React.memo<{ gameState: GameState; actions: any; lastWin?: number }>(({ gameState, actions, lastWin }) => {
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
        let won = false;

        if (type === 'PLAYER') won = p > b;
        else if (type === 'BANKER') won = b > p;
        else if (type === 'TIE') won = p === b;
        else if (type === 'P_PAIR') won = gameState.playerCards.length >= 2 && gameState.playerCards[0].rank === gameState.playerCards[1].rank;
        else if (type === 'B_PAIR') won = gameState.dealerCards.length >= 2 && gameState.dealerCards[0].rank === gameState.dealerCards[1].rank;
        else if (type === 'LUCKY6') won = b === 6 && b > p;

        if (won) return 'border-terminal-green text-terminal-green shadow-[0_0_10px_rgba(74,222,128,0.5)] animate-pulse bg-terminal-green/10';
        return 'border-gray-800 bg-black/40 text-gray-500';
    };

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20">
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
                            <div className={`w-16 h-24 border border-dashed rounded flex items-center justify-center ${bankerColor.replace('text-', 'border-')}`}>?</div>
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-2 relative z-20 py-2 sm:py-4">
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                        {gameState.message}{lastWin && lastWin > 0 ? ` (+$${lastWin})` : ''}
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
                            <div className={`w-16 h-24 border border-dashed rounded flex items-center justify-center ${playerColor.replace('text-', 'border-')}`}>?</div>
                        </div>
                    )}
                </div>
            </div>

            {/* BETS SIDEBAR */}
            <div className="hidden md:flex absolute top-0 right-0 bottom-24 w-40 bg-terminal-black/80 border-l-2 border-gray-700 p-2 backdrop-blur-sm z-30 flex-col">
                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 flex-none text-center">Bets</div>
                <div className="flex-1 overflow-y-auto flex flex-col justify-center space-y-1">
                    {allBets.map((b, i) => (
                        <div key={i} className={`flex justify-between items-center text-xs border p-1 rounded bg-black/50 ${i === 0 ? 'border-terminal-green/30' : 'border-gray-800'}`}>
                            <span className={`font-bold text-[10px] ${b.type === 'PLAYER' || b.type === 'BANKER' ? 'text-terminal-green' : 'text-gray-400'}`}>{b.type}</span>
                            <div className="text-white text-[10px]">${b.amount}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* CONTROLS */}
            <GameControlBar
                primaryAction={{
                    label: 'DEAL',
                    onClick: actions?.deal,
                    className: 'w-full sm:w-auto',
                }}
                secondaryActions={[
                    {
                        label: `PLAYER${gameState.bet > 0 ? ` $${gameState.bet}` : ''}`,
                        onClick: () => actions?.baccaratActions?.toggleSelection?.('PLAYER'),
                        active: isPlayerSelected,
                    },
                    {
                        label: `BANKER${gameState.bet > 0 ? ` $${gameState.bet}` : ''}`,
                        onClick: () => actions?.baccaratActions?.toggleSelection?.('BANKER'),
                        active: isBankerSelected,
                    },
                    {
                        label: `TIE${sideBetAmounts.TIE > 0 ? ` $${sideBetAmounts.TIE}` : ''}`,
                        onClick: () => actions?.baccaratActions?.placeBet?.('TIE'),
                        active: sideBetAmounts.TIE > 0,
                    },
                    {
                        label: `P.PAIR${sideBetAmounts.P_PAIR > 0 ? ` $${sideBetAmounts.P_PAIR}` : ''}`,
                        onClick: () => actions?.baccaratActions?.placeBet?.('P_PAIR'),
                        active: sideBetAmounts.P_PAIR > 0,
                    },
                    {
                        label: `B.PAIR${sideBetAmounts.B_PAIR > 0 ? ` $${sideBetAmounts.B_PAIR}` : ''}`,
                        onClick: () => actions?.baccaratActions?.placeBet?.('B_PAIR'),
                        active: sideBetAmounts.B_PAIR > 0,
                    },
                    {
                        label: `LUCKY6${sideBetAmounts.LUCKY6 > 0 ? ` $${sideBetAmounts.LUCKY6}` : ''}`,
                        onClick: () => actions?.baccaratActions?.placeBet?.('LUCKY6'),
                        active: sideBetAmounts.LUCKY6 > 0,
                    },
                    {
                        label: 'REBET',
                        onClick: actions?.baccaratActions?.rebet,
                    },
                    {
                        label: 'UNDO',
                        onClick: actions?.baccaratActions?.undo,
                    },
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
                    {
                        label: 'SUPER',
                        onClick: actions?.toggleSuper,
                        active: gameState.activeModifiers.super,
                    },
                ]}
            />
        </>
    );
});
