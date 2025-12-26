
import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { GameState, SicBoBet } from '../../../types';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { getSicBoTotalItems, getSicBoCombinationItems, calculateSicBoTotalExposure, calculateSicBoCombinationExposure } from '../../../utils/gameUtils';
import { DiceThrow2D } from '../GameComponents';

export const SicBoView = React.memo<{
    gameState: GameState;
    numberInput?: string;
    actions: any;
    lastWin?: number;
    playMode?: 'CASH' | 'FREEROLL' | null;
}>(({ gameState, numberInput = "", actions, lastWin, playMode }) => {

    const totalItems = useMemo(() => getSicBoTotalItems(), []);
    const combinationItems = useMemo(() => getSicBoCombinationItems(), []);
    const betTypes = useMemo(() => new Set(gameState.sicBoBets.map((b) => b.type)), [gameState.sicBoBets]);
    const [tapPicks, setTapPicks] = useState<number[]>([]);
    useEffect(() => {
        setTapPicks([]);
    }, [gameState.sicBoInputMode]);

    const renderBetItem = useCallback((bet: SicBoBet, i: number, isPending: boolean) => {
        const targetLabel = (() => {
            if (bet.type === 'DOMINO' && bet.target !== undefined) {
                const min = (bet.target >> 4) & 0x0f;
                const max = bet.target & 0x0f;
                return `${min}-${max}`;
            }
            if ((bet.type === 'HOP3_EASY' || bet.type === 'HOP4_EASY') && bet.target !== undefined) {
                const parts = [1, 2, 3, 4, 5, 6].filter((n) => (bet.target! & (1 << (n - 1))) !== 0);
                return parts.join('-');
            }
            if (bet.type === 'HOP3_HARD' && bet.target !== undefined) {
                const doubled = (bet.target >> 4) & 0x0f;
                const single = bet.target & 0x0f;
                return `${doubled}-${doubled}-${single}`;
            }
            return bet.target !== undefined ? String(bet.target) : '';
        })();

        return (
            <div key={i} onClick={() => actions?.placeSicBoBet?.(bet.type, bet.target)} className={`flex justify-between items-center text-xs border p-1 rounded cursor-pointer hover:bg-gray-800 transition-colors ${
                isPending ? 'border-dashed border-amber-600/50 bg-amber-900/20 opacity-70' : 'border-gray-800 bg-black/50'
            }`}>
                <div className="flex flex-col">
                    <span className={`font-bold text-[10px] ${isPending ? 'text-amber-400' : 'text-terminal-green'}`}>{bet.type} {targetLabel}</span>
                </div>
                <div className="text-white text-[10px]">${bet.amount}</div>
            </div>
        );
    }, []);

    const closeInput = useCallback(() => {
        setTapPicks([]);
        actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'NONE' }));
    }, [actions]);

    const handleTapPick = useCallback((n: number) => {
        const mode = gameState.sicBoInputMode;
        if (mode === 'NONE') return;

        const place = (type: SicBoBet['type'], target?: number) => {
            actions?.placeSicBoBet?.(type, target);
            setTapPicks([]);
        };

        if (mode === 'SINGLE') return place('SINGLE_DIE', n);
        if (mode === 'DOUBLE') return place('DOUBLE_SPECIFIC', n);
        if (mode === 'TRIPLE') return place('TRIPLE_SPECIFIC', n);
        if (mode === 'SUM') return place('SUM', n);

        if (mode === 'HOP3_HARD') {
            if (tapPicks.length === 0) return setTapPicks([n]);
            const doubled = tapPicks[0];
            if (n === doubled) return setTapPicks([]);
            return place('HOP3_HARD', (doubled << 4) | n);
        }

        if (mode === 'DOMINO') {
            const next = tapPicks.includes(n) ? tapPicks.filter((x) => x !== n) : [...tapPicks, n].slice(0, 2);
            if (next.length < 2) {
                setTapPicks(next);
                return;
            }
            const [a, b] = next;
            if (a === b) {
                setTapPicks([a]);
                return;
            }
            const min = Math.min(a, b);
            const max = Math.max(a, b);
            return place('DOMINO', (min << 4) | max);
        }

        if (mode === 'HOP3_EASY' || mode === 'HOP4_EASY') {
            const maxCount = mode === 'HOP3_EASY' ? 3 : 4;
            const next = tapPicks.includes(n) ? tapPicks.filter((x) => x !== n) : [...tapPicks, n];
            if (next.length > maxCount) return;
            if (next.length < maxCount) {
                setTapPicks(next);
                return;
            }
            const mask = next.reduce((m, v) => m | (1 << (v - 1)), 0);
            return place(mode, mask);
        }
    }, [actions, gameState.sicBoInputMode, tapPicks]);

    // Render a single exposure row for TOTALS column
    const renderTotalRow = useCallback((entry: { total: number; isTriple: boolean; label: string }, idx: number) => {
        const pnl = calculateSicBoTotalExposure(entry.total, entry.isTriple, gameState.sicBoBets);
        const pnlRounded = Math.round(pnl);

        return (
            <div key={idx} className="flex items-center h-5 text-xs w-full">
                <div className="flex-1 flex justify-end items-center text-right pr-1 overflow-hidden">
                    {pnlRounded < 0 && <span className="text-terminal-accent font-mono text-[10px]">-{Math.abs(pnlRounded).toLocaleString()}</span>}
                </div>
                <div className="flex-none w-6 flex justify-center items-center relative">
                    <span className={`font-mono z-10 text-[10px] ${entry.isTriple ? 'text-terminal-gold font-bold' : 'text-gray-500'}`}>
                        {entry.label}
                    </span>
                    {pnlRounded < 0 && <div className="absolute right-0 top-0.5 bottom-0.5 w-0.5 bg-terminal-accent" />}
                    {pnlRounded > 0 && <div className="absolute left-0 top-0.5 bottom-0.5 w-0.5 bg-terminal-green" />}
                </div>
                <div className="flex-1 flex justify-start items-center pl-1 overflow-hidden">
                    {pnlRounded > 0 && <span className="text-terminal-green font-mono text-[10px]">+{pnlRounded.toLocaleString()}</span>}
                </div>
            </div>
        );
    }, [gameState.sicBoBets]);

    // Render a single exposure row for COMBINATIONS column
    const renderComboRow = useCallback((entry: { type: 'SINGLE' | 'SINGLE_2X' | 'SINGLE_3X' | 'DOUBLE' | 'TRIPLE' | 'ANY_TRIPLE'; target?: number; label: string }, idx: number) => {
        const pnl = calculateSicBoCombinationExposure(entry.type, entry.target, gameState.sicBoBets);
        const pnlRounded = Math.round(pnl);

        // Color code by type
        const typeColor = entry.type === 'SINGLE' ? 'text-cyan-400'
            : entry.type === 'SINGLE_2X' ? 'text-cyan-300'
            : entry.type === 'SINGLE_3X' ? 'text-cyan-200'
            : entry.type === 'DOUBLE' ? 'text-purple-400'
            : entry.type === 'TRIPLE' ? 'text-terminal-gold'
            : 'text-terminal-gold';

        return (
            <div key={idx} className="flex items-center h-5 text-xs w-full">
                <div className="flex-1 flex justify-end items-center text-right pr-1 overflow-hidden">
                    {pnlRounded < 0 && <span className="text-terminal-accent font-mono text-[10px]">-{Math.abs(pnlRounded).toLocaleString()}</span>}
                </div>
                <div className="flex-none w-10 flex justify-center items-center relative">
                    <span className={`font-mono z-10 text-[10px] ${typeColor}`}>
                        {entry.label}
                    </span>
                    {pnlRounded < 0 && <div className="absolute right-0 top-0.5 bottom-0.5 w-0.5 bg-terminal-accent" />}
                    {pnlRounded > 0 && <div className="absolute left-0 top-0.5 bottom-0.5 w-0.5 bg-terminal-green" />}
                </div>
                <div className="flex-1 flex justify-start items-center pl-1 overflow-hidden">
                    {pnlRounded > 0 && <span className="text-terminal-green font-mono text-[10px]">+{pnlRounded.toLocaleString()}</span>}
                </div>
            </div>
        );
    }, [gameState.sicBoBets]);

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-8 relative pt-8 sm:pt-10 pb-24 sm:pb-20 lg:pl-64 lg:pr-60">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">SIC BO</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="SIC BO">
                        <div className="space-y-3">
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Exposure
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-0.5">
                                        <div className="text-[9px] text-gray-500 tracking-widest text-center mb-1">TOTALS</div>
                                        {totalItems.map((entry, idx) => renderTotalRow(entry, idx))}
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="text-[9px] text-gray-500 tracking-widest text-center mb-1">COMBOS</div>
                                        {combinationItems.map((entry, idx) => renderComboRow(entry, idx))}
                                    </div>
                                </div>
                            </div>
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Table Bets
                                </div>
                                <div className="flex flex-col space-y-1">
                                    {(() => {
                                        const confirmedBets = gameState.sicBoBets.filter(b => b.local !== true);
                                        const pendingBets = gameState.sicBoBets.filter(b => b.local === true);

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
                                                        {confirmedBets.map((b, i) => renderBetItem(b, i, false))}
                                                    </div>
                                                )}

                                                {pendingBets.length > 0 && (
                                                    <div className="space-y-1">
                                                        <div className="text-[8px] text-amber-400 uppercase tracking-widest font-bold">
                                                            Pending ({pendingBets.length})
                                                        </div>
                                                        {pendingBets.map((b, i) => renderBetItem(b, i, true))}
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Dice Display */}
                <div className="min-h-[110px] flex items-center justify-center">
                    <DiceThrow2D
                        values={gameState.dice}
                        rollKey={gameState.sicBoHistory.length}
                    />
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                        {gameState.message}
                    </div>
                    {/* Current Bets Summary - visible on main screen */}
                    {gameState.sicBoBets.length > 0 && (
                        <div className="mt-2 flex flex-wrap justify-center gap-2 max-w-md mx-auto">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-terminal-green/40 bg-black/40 text-[10px] tracking-widest">
                                <span className="text-gray-500">TOTAL:</span>
                                <span className="text-terminal-gold">${gameState.sicBoBets.reduce((a, b) => a + b.amount, 0).toLocaleString()}</span>
                                <span className="text-gray-600">({gameState.sicBoBets.length} bets)</span>
                            </div>
                            <div className="flex flex-wrap justify-center gap-1">
                                {gameState.sicBoBets.slice(0, 5).map((bet, i) => (
                                    <span key={i} className="px-2 py-0.5 text-[9px] rounded border border-gray-700 bg-black/60 text-gray-300">
                                        {bet.type}{bet.target !== undefined ? `:${bet.target}` : ''}
                                    </span>
                                ))}
                                {gameState.sicBoBets.length > 5 && (
                                    <span className="px-2 py-0.5 text-[9px] rounded border border-gray-700 bg-black/60 text-gray-500">
                                        +{gameState.sicBoBets.length - 5} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* History */}
                 {gameState.sicBoHistory.length > 0 && (
                     <div className="flex flex-col items-center gap-1">
                         <span className="text-[11px] text-gray-400 tracking-widest">HISTORY</span>
                         <div className="flex gap-2 opacity-80">
                             {gameState.sicBoHistory.slice(-5).reverse().map((roll, i) => (
                                 <div key={i} className="flex gap-0.5 border border-gray-800 p-1 rounded">
                                     {roll.map((d, j) => <span key={j} className="text-[11px] text-gray-300">{d}</span>)}
                                 </div>
                             ))}
                         </div>
                     </div>
                 )}
            </div>

             {/* EXPOSURE SIDEBAR - Two Columns: Totals | Combinations */}
             <div className="hidden lg:flex absolute top-0 left-0 bottom-24 w-64 bg-terminal-black/80 border-r-2 border-gray-700 p-2 overflow-hidden backdrop-blur-sm z-30 flex-col">
                {/* Two-column header */}
                <div className="flex-none flex border-b border-gray-800 pb-1 mb-1">
                    <div className="flex-1 text-center">
                        <span className="text-[9px] font-bold text-gray-500 tracking-widest">TOTALS</span>
                    </div>
                    <div className="flex-1 text-center">
                        <span className="text-[9px] font-bold text-gray-500 tracking-widest">COMBOS</span>
                    </div>
                </div>

                <div className="flex-1 flex flex-row relative overflow-hidden">
                    {/* Vertical Divider */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-800 -translate-x-1/2"></div>

                    {/* Left Column - Totals 3-18 */}
                    <div className="flex-1 flex flex-col gap-0 pr-1 border-r border-gray-800/50 overflow-y-auto">
                        {totalItems.map((entry, idx) => renderTotalRow(entry, idx))}
                    </div>

                    {/* Right Column - Singles (1x/2x/3x), Doubles, Triples */}
                    <div className="flex-1 flex flex-col gap-0 pl-1 overflow-y-auto">
                        <div className="text-[8px] text-cyan-400 text-center mb-0.5">1×</div>
                        {combinationItems.filter(c => c.type === 'SINGLE').map((entry, idx) => renderComboRow(entry, idx))}

                        <div className="text-[8px] text-cyan-300 text-center mt-0.5 mb-0.5">2×</div>
                        {combinationItems.filter(c => c.type === 'SINGLE_2X').map((entry, idx) => renderComboRow(entry, idx + 6))}

                        <div className="text-[8px] text-cyan-200 text-center mt-0.5 mb-0.5">3×</div>
                        {combinationItems.filter(c => c.type === 'SINGLE_3X').map((entry, idx) => renderComboRow(entry, idx + 12))}

                        <div className="text-[8px] text-purple-400 text-center mt-0.5 mb-0.5">DBL</div>
                        {combinationItems.filter(c => c.type === 'DOUBLE').map((entry, idx) => renderComboRow(entry, idx + 18))}

                        <div className="text-[8px] text-terminal-gold text-center mt-0.5 mb-0.5">TRP</div>
                        {combinationItems.filter(c => c.type === 'TRIPLE' || c.type === 'ANY_TRIPLE').map((entry, idx) => renderComboRow(entry, idx + 24))}
                    </div>
                </div>
            </div>

            {/* ACTIVE BETS SIDEBAR - Reduced to w-60 */}
            <div className="hidden lg:flex absolute top-0 right-0 bottom-24 w-60 bg-terminal-black/80 border-l-2 border-gray-700 p-2 backdrop-blur-sm z-30 flex-col">
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 flex-none text-center">Table Bets</div>
                    <div className="flex-1 overflow-y-auto flex flex-col space-y-2">
                        {(() => {
                            const confirmedBets = gameState.sicBoBets.filter(b => b.local !== true);
                            const pendingBets = gameState.sicBoBets.filter(b => b.local === true);

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
                                            {confirmedBets.map((b, i) => renderBetItem(b, i, false))}
                                        </div>
                                    )}

                                    {pendingBets.length > 0 && (
                                        <div className="space-y-1">
                                            <div className="text-[8px] text-amber-400 uppercase tracking-widest font-bold">
                                                Pending ({pendingBets.length})
                                            </div>
                                            {pendingBets.map((b, i) => renderBetItem(b, i, true))}
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
            </div>

            {/* CONTROLS */}
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 bg-terminal-black/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-auto md:h-20 flex flex-col md:flex-row items-stretch md:items-center justify-between md:justify-center gap-2 p-2 md:px-4">
                    {/* Desktop: Bet controls */}
                    <div className="hidden md:flex items-center gap-2 flex-1 flex-wrap">
                        {/* Basic Bets Group */}
                        <div className="flex items-center gap-1 px-2 border-l-2 border-terminal-green/30">
                            <span className="text-[9px] text-terminal-green font-bold tracking-widest mr-1">BASIC</span>
                            <button type="button" onClick={() => actions?.placeSicBoBet?.('SMALL')} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${betTypes.has('SMALL') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>SMALL</button>
                            <button type="button" onClick={() => actions?.placeSicBoBet?.('BIG')} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${betTypes.has('BIG') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>BIG</button>
                            <button type="button" onClick={() => actions?.placeSicBoBet?.('ODD')} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${betTypes.has('ODD') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>ODD</button>
                            <button type="button" onClick={() => actions?.placeSicBoBet?.('EVEN')} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${betTypes.has('EVEN') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>EVEN</button>
                        </div>

                        {/* Specific Bets Group */}
                        <div className="flex items-center gap-1 px-2 border-l-2 border-cyan-400/30">
                            <span className="text-[9px] text-cyan-400 font-bold tracking-widest mr-1">SPECIFIC</span>
                            <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'SINGLE' }))} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.sicBoInputMode === 'SINGLE' || betTypes.has('SINGLE_DIE') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>DIE</button>
                            <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'DOUBLE' }))} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.sicBoInputMode === 'DOUBLE' || betTypes.has('DOUBLE_SPECIFIC') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>DOUBLE</button>
                            <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'TRIPLE' }))} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.sicBoInputMode === 'TRIPLE' || betTypes.has('TRIPLE_SPECIFIC') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>TRIPLE</button>
                            <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'DOMINO' }))} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.sicBoInputMode === 'DOMINO' || betTypes.has('DOMINO') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>DOMINO</button>
                            <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP3_EASY' }))} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.sicBoInputMode === 'HOP3_EASY' || betTypes.has('HOP3_EASY') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>3-HOP</button>
                            <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP3_HARD' }))} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.sicBoInputMode === 'HOP3_HARD' || betTypes.has('HOP3_HARD') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>HARD</button>
                            <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP4_EASY' }))} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.sicBoInputMode === 'HOP4_EASY' || betTypes.has('HOP4_EASY') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>4-HOP</button>
                            <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'SUM' }))} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.sicBoInputMode === 'SUM' || betTypes.has('SUM') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>SUM</button>
                            <button type="button" onClick={() => actions?.placeSicBoBet?.('TRIPLE_ANY')} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${betTypes.has('TRIPLE_ANY') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>ANY 3</button>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 px-2 border-l-2 border-gray-700/30">
                            <button type="button" onClick={actions?.rebetSicBo} className="h-8 px-3 rounded border border-gray-700 bg-black/50 text-gray-300 text-xs font-bold tracking-wider hover:bg-gray-800 transition-all">REBET</button>
                            <button type="button" onClick={actions?.undoSicBoBet} className="h-8 px-3 rounded border border-gray-700 bg-black/50 text-gray-300 text-xs font-bold tracking-wider hover:bg-gray-800 transition-all">UNDO</button>
                        </div>

                        {/* Modifiers */}
                        <div className="flex items-center gap-1 px-2 border-l-2 border-gray-700/30">
                            {playMode !== 'CASH' && (
                                <>
                                    <button type="button" onClick={actions?.toggleShield} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.activeModifiers.shield ? 'border-purple-400 bg-purple-400/20 text-purple-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>SHIELD</button>
                                    <button type="button" onClick={actions?.toggleDouble} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.activeModifiers.double ? 'border-blue-400 bg-blue-400/20 text-blue-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>DOUBLE</button>
                                </>
                            )}
                            <button type="button" onClick={actions?.toggleSuper} className={`h-8 px-3 rounded border text-xs font-bold tracking-wider transition-all ${gameState.activeModifiers.super ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>SUPER</button>
                        </div>
                    </div>

                    {/* Mobile: Simplified button */}
                    <div className="flex md:hidden items-center gap-2">
                        <MobileDrawer label="BETS" title="PLACE BETS">
                            <div className="space-y-4">
                                {/* Basic Bets */}
                                <div className="rounded border border-gray-800 bg-black/40 p-2 space-y-2">
                                    <div className="text-[10px] text-terminal-green font-bold tracking-widest border-b border-gray-800 pb-1">BASIC BETS</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={() => actions?.placeSicBoBet?.('SMALL')} className={`py-3 rounded border text-xs font-bold ${betTypes.has('SMALL') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>SMALL</button>
                                        <button onClick={() => actions?.placeSicBoBet?.('BIG')} className={`py-3 rounded border text-xs font-bold ${betTypes.has('BIG') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>BIG</button>
                                        <button onClick={() => actions?.placeSicBoBet?.('ODD')} className={`py-3 rounded border text-xs font-bold ${betTypes.has('ODD') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>ODD</button>
                                        <button onClick={() => actions?.placeSicBoBet?.('EVEN')} className={`py-3 rounded border text-xs font-bold ${betTypes.has('EVEN') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>EVEN</button>
                                    </div>
                                </div>

                                {/* Specific Bets */}
                                <div className="rounded border border-gray-800 bg-black/40 p-2 space-y-2">
                                    <div className="text-[10px] text-cyan-400 font-bold tracking-widest border-b border-gray-800 pb-1">SPECIFIC BETS</div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'SINGLE' }))} className={`py-3 rounded border text-xs font-bold ${gameState.sicBoInputMode === 'SINGLE' || betTypes.has('SINGLE_DIE') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>DIE</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'DOUBLE' }))} className={`py-3 rounded border text-xs font-bold ${gameState.sicBoInputMode === 'DOUBLE' || betTypes.has('DOUBLE_SPECIFIC') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>DOUBLE</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'TRIPLE' }))} className={`py-3 rounded border text-xs font-bold ${gameState.sicBoInputMode === 'TRIPLE' || betTypes.has('TRIPLE_SPECIFIC') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>TRIPLE</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'DOMINO' }))} className={`py-3 rounded border text-xs font-bold ${gameState.sicBoInputMode === 'DOMINO' || betTypes.has('DOMINO') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>DOMINO</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP3_EASY' }))} className={`py-3 rounded border text-xs font-bold ${gameState.sicBoInputMode === 'HOP3_EASY' || betTypes.has('HOP3_EASY') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>3-HOP</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP3_HARD' }))} className={`py-3 rounded border text-xs font-bold ${gameState.sicBoInputMode === 'HOP3_HARD' || betTypes.has('HOP3_HARD') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>HARD</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP4_EASY' }))} className={`py-3 rounded border text-xs font-bold ${gameState.sicBoInputMode === 'HOP4_EASY' || betTypes.has('HOP4_EASY') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>4-HOP</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'SUM' }))} className={`py-3 rounded border text-xs font-bold ${gameState.sicBoInputMode === 'SUM' || betTypes.has('SUM') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>SUM</button>
                                        <button onClick={() => actions?.placeSicBoBet?.('TRIPLE_ANY')} className={`py-3 rounded border text-xs font-bold ${betTypes.has('TRIPLE_ANY') ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>ANY 3</button>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="rounded border border-gray-800 bg-black/40 p-2">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        <button onClick={actions?.rebetSicBo} className="flex-1 py-3 rounded border border-gray-700 bg-gray-900 text-gray-400 text-xs font-bold">REBET</button>
                                        <button onClick={actions?.undoSicBoBet} className="flex-1 py-3 rounded border border-gray-700 bg-gray-900 text-gray-400 text-xs font-bold">UNDO</button>
                                        {playMode !== 'CASH' && (
                                            <>
                                                <button onClick={actions?.toggleShield} className={`flex-1 py-3 rounded border text-xs font-bold ${gameState.activeModifiers.shield ? 'border-purple-400 bg-purple-400/20 text-purple-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>SHIELD</button>
                                                <button onClick={actions?.toggleDouble} className={`flex-1 py-3 rounded border text-xs font-bold ${gameState.activeModifiers.double ? 'border-blue-400 bg-blue-400/20 text-blue-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>DOUBLE</button>
                                            </>
                                        )}
                                        <button onClick={actions?.toggleSuper} className={`flex-1 py-3 rounded border text-xs font-bold ${gameState.activeModifiers.super ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>SUPER</button>
                                    </div>
                                </div>
                            </div>
                        </MobileDrawer>
                    </div>

                    {/* ROLL Button */}
                    <button
                        type="button"
                        onClick={actions?.deal}
                        className="h-12 md:h-14 px-6 md:px-8 rounded border-2 font-bold text-sm md:text-base tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-terminal-green bg-terminal-green text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                    >
                        ROLL
                    </button>
                </div>
            </div>

            {/* SIC BO MODAL */}
            {gameState.sicBoInputMode !== 'NONE' && (
                 <div
                     className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                     onClick={closeInput}
                 >
                     <div
                         className="bg-terminal-black border border-terminal-green p-4 sm:p-6 rounded-lg shadow-xl flex flex-col items-center gap-4 w-full max-w-lg"
                         onClick={(e) => e.stopPropagation()}
                     >
                         <div className="text-sm tracking-widest text-gray-400 uppercase text-center">
                             {gameState.sicBoInputMode === 'SINGLE' && "TAP NUMBER (1-6)"}
                             {gameState.sicBoInputMode === 'DOUBLE' && "TAP DOUBLE (1-6)"}
                             {gameState.sicBoInputMode === 'TRIPLE' && "TAP TRIPLE (1-6)"}
                             {gameState.sicBoInputMode === 'DOMINO' && "TAP 2 NUMBERS (1-6)"}
                             {gameState.sicBoInputMode === 'HOP3_EASY' && "TAP 3 NUMBERS (1-6)"}
                             {gameState.sicBoInputMode === 'HOP3_HARD' && "TAP DOUBLE THEN SINGLE (1-6)"}
                             {gameState.sicBoInputMode === 'HOP4_EASY' && "TAP 4 NUMBERS (1-6)"}
                             {gameState.sicBoInputMode === 'SUM' && "TAP TOTAL (3-18) OR TYPE (ENTER)"}
                         </div>

                         {gameState.sicBoInputMode === 'SUM' ? (
                              <>
                                  <div className="text-3xl text-white font-bold font-mono h-12 flex items-center justify-center border-b border-gray-700 w-32">
                                     {numberInput}
                                     <span className="animate-pulse">_</span>
                                  </div>
                                  <div className="grid grid-cols-8 gap-2 w-full">
                                      {Array.from({ length: 16 }, (_, i) => i + 3).map((t) => (
                                          <button
                                              key={t}
                                              type="button"
                                              onClick={() => handleTapPick(t)}
                                              className="h-11 rounded border border-gray-800 bg-gray-900/50 text-white text-sm font-bold hover:border-gray-600"
                                          >
                                              {t}
                                          </button>
                                      ))}
                                  </div>
                              </>
                         ) : (
                             <div className="flex gap-2">
                                 {[1,2,3,4,5,6].map(n => {
                                     const selected = tapPicks.includes(n);
                                     return (
                                         <button
                                             key={n}
                                             type="button"
                                             onClick={() => handleTapPick(n)}
                                             className={`flex flex-col items-center gap-1 rounded border px-2 py-2 ${
                                                 selected ? 'border-terminal-green bg-terminal-green/10' : 'border-gray-700 bg-gray-900'
                                             }`}
                                         >
                                             <div className="w-10 h-10 flex items-center justify-center rounded text-white font-bold">
                                                 {n}
                                             </div>
                                             <div className="text-[9px] text-gray-500">[{n}]</div>
                                         </button>
                                     );
                                 })}
                             </div>
                         )}

                         {gameState.sicBoInputMode === 'DOMINO' && tapPicks.length > 0 && (
                             <div className="text-xs text-gray-500">SELECTED: {tapPicks.join('-')}</div>
                         )}

                         {gameState.sicBoInputMode === 'HOP3_HARD' && tapPicks.length === 1 && (
                             <div className="text-xs text-gray-500">DOUBLE: {tapPicks[0]}</div>
                         )}

                         {(gameState.sicBoInputMode === 'HOP3_EASY' || gameState.sicBoInputMode === 'HOP4_EASY') && tapPicks.length > 0 && (
                             <div className="text-xs text-gray-500">SELECTED: {tapPicks.join('-')}</div>
                         )}

                         <div className="text-xs text-gray-500 mt-2 text-center">
                             Tap outside to cancel. Keyboard: [ESC] CANCEL {gameState.sicBoInputMode === 'SUM' && "[ENTER] CONFIRM"}
                         </div>
                     </div>
                 </div>
            )}
        </>
    );
});
