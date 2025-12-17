
import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { GameState, SicBoBet } from '../../../types';
import { DiceRender } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { getSicBoTotalItems, getSicBoCombinationItems, calculateSicBoTotalExposure, calculateSicBoCombinationExposure } from '../../../utils/gameUtils';

export const SicBoView = React.memo<{ gameState: GameState; numberInput?: string; actions: any; lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, numberInput = "", actions, lastWin, playMode }) => {

    const totalItems = useMemo(() => getSicBoTotalItems(), []);
    const combinationItems = useMemo(() => getSicBoCombinationItems(), []);
    const betTypes = useMemo(() => new Set(gameState.sicBoBets.map((b) => b.type)), [gameState.sicBoBets]);
    const [tapPicks, setTapPicks] = useState<number[]>([]);

    useEffect(() => {
        setTapPicks([]);
    }, [gameState.sicBoInputMode]);

    const renderBetItem = useCallback((bet: SicBoBet, i: number) => {
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
            <div key={i} onClick={() => actions?.placeSicBoBet?.(bet.type, bet.target)} className="flex justify-between items-center text-xs border border-gray-800 p-1 rounded bg-black/50 cursor-pointer hover:bg-gray-800 transition-colors">
                <div className="flex flex-col">
                    <span className="text-terminal-green font-bold text-[10px]">{bet.type} {targetLabel}</span>
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
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20 md:pl-64 md:pr-60">
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
                                    {gameState.sicBoBets.length > 0 ? (
                                        gameState.sicBoBets.map((b, i) => renderBetItem(b, i))
                                    ) : (
                                        <div className="text-center text-[10px] text-gray-700 italic">NO BETS</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Dice Display */}
                <div className="min-h-[96px] sm:min-h-[120px] flex items-center justify-center">
                    {gameState.dice.length === 3 ? (
                        <div className="flex flex-col gap-2 items-center">
                             <span className="text-xs uppercase tracking-widest text-gray-500">ROLL</span>
                             <div className="flex gap-4">
                                {gameState.dice.map((d, i) => <DiceRender key={i} value={d} delayMs={i * 60} />)}
                             </div>
                             <div className="text-terminal-gold font-bold mt-2 text-xl">
                                 TOTAL: {gameState.dice.reduce((a,b)=>a+b,0)}
                             </div>
                        </div>
                    ) : (
                        <div className="flex gap-4">
                            {[1,2,3].map(i => (
                                <div key={i} className="w-14 h-14 sm:w-16 sm:h-16 border border-dashed border-gray-700 rounded flex items-center justify-center text-gray-700 text-xl sm:text-2xl">?</div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                        {gameState.message}{lastWin && lastWin > 0 ? ` (+$${lastWin})` : ''}
                    </div>
                </div>

                {/* History */}
                 {gameState.sicBoHistory.length > 0 && (
                     <div className="flex flex-col items-center gap-1">
                         <span className="text-[10px] text-gray-600 tracking-widest">HISTORY</span>
                         <div className="flex gap-2 opacity-50">
                             {gameState.sicBoHistory.slice(-5).reverse().map((roll, i) => (
                                 <div key={i} className="flex gap-0.5 border border-gray-800 p-1 rounded">
                                     {roll.map((d, j) => <span key={j} className="text-[10px] text-gray-400">{d}</span>)}
                                 </div>
                             ))}
                         </div>
                     </div>
                 )}
            </div>

             {/* EXPOSURE SIDEBAR - Two Columns: Totals | Combinations */}
             <div className="hidden md:flex absolute top-0 left-0 bottom-24 w-64 bg-terminal-black/80 border-r-2 border-gray-700 p-2 overflow-hidden backdrop-blur-sm z-30 flex-col">
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
            <div className="hidden md:flex absolute top-0 right-0 bottom-24 w-60 bg-terminal-black/80 border-l-2 border-gray-700 p-2 backdrop-blur-sm z-30 flex-col">
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 flex-none text-center">Table Bets</div>
                    <div className="flex-1 overflow-y-auto flex flex-col justify-center space-y-1">
                        {gameState.sicBoBets.length > 0 ? (
                            gameState.sicBoBets.map((b, i) => renderBetItem(b, i))
                        ) : (
                            <div className="text-center text-[10px] text-gray-700 italic">NO BETS</div>
                        )}
                    </div>
            </div>

            {/* CONTROLS */}
            <GameControlBar
                primaryAction={{
                    label: 'ROLL',
                    onClick: actions?.deal,
                    className: 'w-full sm:w-auto',
                }}
                secondaryActions={[
                    // Basic Bets
                    { label: 'SMALL', onClick: () => actions?.placeSicBoBet?.('SMALL'), active: betTypes.has('SMALL') },
                    { label: 'BIG', onClick: () => actions?.placeSicBoBet?.('BIG'), active: betTypes.has('BIG') },
                    { label: 'ODD', onClick: () => actions?.placeSicBoBet?.('ODD'), active: betTypes.has('ODD') },
                    { label: 'EVEN', onClick: () => actions?.placeSicBoBet?.('EVEN'), active: betTypes.has('EVEN') },
                    // Specifics (Input Modes)
                    { label: 'DIE', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'SINGLE' })), active: gameState.sicBoInputMode === 'SINGLE' || betTypes.has('SINGLE_DIE') },
                    { label: 'DOUBLE', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'DOUBLE' })), active: gameState.sicBoInputMode === 'DOUBLE' || betTypes.has('DOUBLE_SPECIFIC') },
                    { label: 'TRIPLE', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'TRIPLE' })), active: gameState.sicBoInputMode === 'TRIPLE' || betTypes.has('TRIPLE_SPECIFIC') },
                    { label: 'DOMINO', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'DOMINO' })), active: gameState.sicBoInputMode === 'DOMINO' || betTypes.has('DOMINO') },
                    // Hops & Sums
                    { label: '3-HOP', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP3_EASY' })), active: gameState.sicBoInputMode === 'HOP3_EASY' || betTypes.has('HOP3_EASY') },
                    { label: 'HARD', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP3_HARD' })), active: gameState.sicBoInputMode === 'HOP3_HARD' || betTypes.has('HOP3_HARD') },
                    { label: '4-HOP', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'HOP4_EASY' })), active: gameState.sicBoInputMode === 'HOP4_EASY' || betTypes.has('HOP4_EASY') },
                    { label: 'SUM', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, sicBoInputMode: 'SUM' })), active: gameState.sicBoInputMode === 'SUM' || betTypes.has('SUM') },
                    // Any Triple
                    { label: 'ANY 3', onClick: () => actions?.placeSicBoBet?.('TRIPLE_ANY'), active: betTypes.has('TRIPLE_ANY') },
                    // Actions
                    { label: 'REBET', onClick: actions?.rebetSicBo },
                    { label: 'UNDO', onClick: actions?.undoSicBoBet },
                    // Modifiers
                    ...(playMode !== 'CASH' ? [
                    { label: 'SHIELD', onClick: actions?.toggleShield, active: gameState.activeModifiers.shield },
                    { label: 'DOUBLE', onClick: actions?.toggleDouble, active: gameState.activeModifiers.double },
                    ] : []),
                    { label: 'SUPER', onClick: actions?.toggleSuper, active: gameState.activeModifiers.super },
                ]}
            />

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
