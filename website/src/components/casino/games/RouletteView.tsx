
import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { GameState, RouletteBet } from '../../../types';
import { getRouletteColor, calculateRouletteExposure } from '../../../utils/gameUtils';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';

export const RouletteView = React.memo<{ gameState: GameState; numberInput?: string; actions: any; lastWin?: number }>(({ gameState, numberInput = "", actions, lastWin }) => {
    const lastNum = useMemo(() =>
        gameState.rouletteHistory.length > 0 ? gameState.rouletteHistory[gameState.rouletteHistory.length - 1] : null,
        [gameState.rouletteHistory]
    );
    const [spinKey, setSpinKey] = useState(0);
    const betTypes = useMemo(() => new Set(gameState.rouletteBets.map((b) => b.type)), [gameState.rouletteBets]);

    const totalBet = useMemo(() => gameState.rouletteBets.reduce((acc, b) => acc + b.amount, 0), [gameState.rouletteBets]);

    const insideBet = useMemo(() => {
        const mode = gameState.rouletteInputMode;
        if (mode === 'NONE') return null;

        let betType: Parameters<typeof actions.placeRouletteBet>[0] | null = null;
        let label = '';
        const targets: number[] = [];

        if (mode === 'STRAIGHT') {
            betType = 'STRAIGHT'; label = 'STRAIGHT (0–36)';
            for (let n = 0; n <= 36; n++) targets.push(n);
        } else if (mode === 'SPLIT_H') {
            betType = 'SPLIT_H'; label = 'SPLIT H (left #)';
            for (let n = 1; n <= 35; n++) if (n % 3 !== 0) targets.push(n);
        } else if (mode === 'SPLIT_V') {
            betType = 'SPLIT_V'; label = 'SPLIT V (top #)';
            for (let n = 1; n <= 33; n++) targets.push(n);
        } else if (mode === 'STREET') {
            betType = 'STREET'; label = 'STREET (row start)';
            for (let n = 1; n <= 34; n += 3) targets.push(n);
        } else if (mode === 'CORNER') {
            betType = 'CORNER'; label = 'CORNER (top-left)';
            for (let n = 1; n <= 32; n++) if (n % 3 !== 0) targets.push(n);
        } else if (mode === 'SIX_LINE') {
            betType = 'SIX_LINE'; label = 'SIX LINE (row start)';
            for (let n = 1; n <= 31; n += 3) targets.push(n);
        }

        if (!betType) return null;
        return { betType, targets, label };
    }, [actions.placeRouletteBet, gameState.rouletteInputMode]);

    const closeInsideBet = useCallback(() => {
        actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'NONE' }));
    }, [actions]);

    const placeInsideBet = useCallback((target: number) => {
        if (!insideBet?.betType) return;
        actions?.placeRouletteBet?.(insideBet.betType, target);
    }, [actions, insideBet?.betType]);

    useEffect(() => {
        if (lastNum !== null) setSpinKey((k) => k + 1);
    }, [lastNum]);

    const renderBetItem = useCallback((bet: RouletteBet, i: number) => (
        <div key={i} className="flex justify-between items-center text-xs border border-gray-800 p-1 rounded bg-black/50">
            <div className="flex flex-col">
                <span className="text-terminal-green font-bold text-[10px]">{bet.type} {bet.target !== undefined ? bet.target : ''}</span>
            </div>
            <div className="text-white text-[10px]">${bet.amount}</div>
        </div>
    ), []);

    const renderExposureRow = useCallback((num: number) => {
        const pnl = calculateRouletteExposure(num, gameState.rouletteBets);
        const maxScale = Math.max(100, totalBet * 36); 
        const barPercent = Math.min(Math.abs(pnl) / maxScale * 50, 50);
        const color = getRouletteColor(num);
        const colorClass = color === 'RED' ? 'text-terminal-accent' : color === 'BLACK' ? 'text-white' : 'text-terminal-green';

        return (
            <div key={num} className="flex items-center h-7 text-base">
                <div className="flex-1 flex justify-end items-center pr-1 gap-1 min-w-0">
                    {pnl < 0 && <span className="text-sm text-gray-400 truncate">{Math.abs(pnl)}</span>}
                    {pnl < 0 && (
                        <div className="bg-terminal-accent/80 h-3 rounded-l" style={{ width: `${barPercent}%` }} />
                    )}
                </div>
                <div className={`w-7 text-center font-bold ${colorClass} flex-shrink-0`}>{num}</div>
                <div className="flex-1 flex justify-start items-center pl-1 gap-1 min-w-0">
                    {pnl > 0 && (
                        <div className="bg-terminal-green/80 h-3 rounded-r" style={{ width: `${barPercent}%` }} />
                    )}
                    {pnl > 0 && <span className="text-sm text-gray-400 truncate">{pnl}</span>}
                </div>
            </div>
        );
    }, [gameState.rouletteBets, totalBet]);

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">ROULETTE</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="ROULETTE">
                        <div className="space-y-3">
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Exposure
                                </div>
                                <div className="space-y-1">
                                    <div>{renderExposureRow(0)}</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-0.5">
                                            {Array.from({ length: 18 }, (_, i) => i + 1).map(num => renderExposureRow(num))}
                                        </div>
                                        <div className="space-y-0.5">
                                            {Array.from({ length: 18 }, (_, i) => i + 19).map(num => renderExposureRow(num))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Table Bets
                                </div>
                                <div className="flex flex-col space-y-1">
                                    {gameState.rouletteBets.length === 0 ? (
                                        <div className="text-center text-[10px] text-gray-700 italic">NO BETS</div>
                                    ) : (
                                        gameState.rouletteBets.map((b, i) => renderBetItem(b, i))
                                    )}
                                </div>
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Last Number Display */}
                <div className="min-h-[120px] flex flex-col items-center justify-center gap-4">
                     {lastNum !== null ? (
                        <div
                            key={spinKey}
                            className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 flex items-center justify-center text-4xl sm:text-5xl font-bold shadow-[0_0_30px_rgba(0,0,0,0.5)] animate-roulette-spin ${getRouletteColor(lastNum) === 'RED' ? 'border-terminal-accent text-terminal-accent' : getRouletteColor(lastNum) === 'BLACK' ? 'border-gray-500 text-white' : 'border-terminal-green text-terminal-green'}`}
                        >
                            {lastNum}
                        </div>
                     ) : (
                        <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-gray-800 flex items-center justify-center text-sm text-gray-600 animate-pulse">
                            SPIN
                        </div>
                     )}
                     
                     {/* History */}
                     {gameState.rouletteHistory.length > 0 && (
                         <div className="flex gap-2 opacity-75">
                             {gameState.rouletteHistory.slice(-8).reverse().map((num, i) => (
                                 <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border ${getRouletteColor(num) === 'RED' ? 'border-terminal-accent text-terminal-accent' : getRouletteColor(num) === 'BLACK' ? 'border-gray-500 text-white' : 'border-terminal-green text-terminal-green'}`}>
                                     {num}
                                 </div>
                             ))}
                         </div>
                     )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                        {gameState.message}{lastWin && lastWin > 0 ? ` (+$${lastWin})` : ''}
                    </div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                        ZERO RULE: {gameState.rouletteZeroRule.split('_').join(' ')}
                    </div>
                </div>
            </div>

            {/* EXPOSURE SIDEBAR */}
            <div className="hidden md:flex absolute top-0 left-0 bottom-24 w-60 bg-terminal-black/80 border-r-2 border-gray-700 p-2 overflow-hidden backdrop-blur-sm z-30 flex-col">
                <h3 className="text-[10px] font-bold text-gray-500 mb-2 tracking-widest text-center border-b border-gray-800 pb-1 flex-none">EXPOSURE</h3>
                
                {/* 0 Row */}
                <div className="flex-none mb-1">
                    {renderExposureRow(0)}
                </div>

                <div className="flex-1 flex flex-row relative overflow-hidden">
                    {/* Vertical Divider */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-800 -translate-x-1/2"></div>

                    {/* 1-18 */}
                    <div className="flex-1 flex flex-col gap-0.5 pr-1">
                        {Array.from({ length: 18 }, (_, i) => i + 1).map(num => renderExposureRow(num))}
                    </div>

                    {/* 19-36 */}
                    <div className="flex-1 flex flex-col gap-0.5 pl-1">
                        {Array.from({ length: 18 }, (_, i) => i + 19).map(num => renderExposureRow(num))}
                    </div>
                </div>
            </div>

            {/* ACTIVE BETS SIDEBAR */}
            <div className="hidden md:flex absolute top-0 right-0 bottom-24 w-60 bg-terminal-black/80 border-l-2 border-gray-700 p-2 backdrop-blur-sm z-30 flex-col">
                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 flex-none text-center">Table Bets</div>
                <div className="flex-1 overflow-y-auto flex flex-col justify-center space-y-1">
                    {gameState.rouletteBets.length === 0 ? (
                        <div className="text-center text-[10px] text-gray-700 italic">NO BETS</div>
                    ) : (
                        gameState.rouletteBets.map((b, i) => renderBetItem(b, i))
                    )}
                </div>
            </div>

            {/* CONTROLS */}
            <GameControlBar
                primaryAction={{
                    label: 'SPIN',
                    onClick: actions?.deal,
                    className: 'w-full sm:w-auto',
                }}
                secondaryActions={[
                    // Outside Bets
                    { label: 'RED', onClick: () => actions?.placeRouletteBet?.('RED'), active: betTypes.has('RED'), className: 'text-terminal-accent border-terminal-accent' },
                    { label: 'BLACK', onClick: () => actions?.placeRouletteBet?.('BLACK'), active: betTypes.has('BLACK') },
                    { label: 'EVEN', onClick: () => actions?.placeRouletteBet?.('EVEN'), active: betTypes.has('EVEN') },
                    { label: 'ODD', onClick: () => actions?.placeRouletteBet?.('ODD'), active: betTypes.has('ODD') },
                    { label: '1-18', onClick: () => actions?.placeRouletteBet?.('LOW'), active: betTypes.has('LOW') },
                    { label: '19-36', onClick: () => actions?.placeRouletteBet?.('HIGH'), active: betTypes.has('HIGH') },
                    // Dozens
                    { label: '1st 12', onClick: () => actions?.placeRouletteBet?.('DOZEN_1'), active: betTypes.has('DOZEN_1') },
                    { label: '2nd 12', onClick: () => actions?.placeRouletteBet?.('DOZEN_2'), active: betTypes.has('DOZEN_2') },
                    { label: '3rd 12', onClick: () => actions?.placeRouletteBet?.('DOZEN_3'), active: betTypes.has('DOZEN_3') },
                    // Columns
                    { label: 'COL 1', onClick: () => actions?.placeRouletteBet?.('COL_1'), active: betTypes.has('COL_1') },
                    { label: 'COL 2', onClick: () => actions?.placeRouletteBet?.('COL_2'), active: betTypes.has('COL_2') },
                    { label: 'COL 3', onClick: () => actions?.placeRouletteBet?.('COL_3'), active: betTypes.has('COL_3') },
                    // Zero
                    { label: 'ZERO', onClick: () => actions?.placeRouletteBet?.('ZERO'), active: betTypes.has('ZERO'), className: 'text-terminal-green border-terminal-green' },
                    // Inside Bets (Modes)
                    { label: 'STRAIGHT', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'STRAIGHT' })), active: gameState.rouletteInputMode === 'STRAIGHT' },
                    { label: 'SPLIT', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'SPLIT_H' })), active: gameState.rouletteInputMode === 'SPLIT_H' },
                    { label: 'VSPLIT', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'SPLIT_V' })), active: gameState.rouletteInputMode === 'SPLIT_V' },
                    { label: 'STREET', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'STREET' })), active: gameState.rouletteInputMode === 'STREET' },
                    { label: 'CORNER', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'CORNER' })), active: gameState.rouletteInputMode === 'CORNER' },
                    { label: 'SIX LINE', onClick: () => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'SIX_LINE' })), active: gameState.rouletteInputMode === 'SIX_LINE' },
                    // Actions
                    { label: 'REBET', onClick: actions?.rebetRoulette },
                    { label: 'UNDO', onClick: actions?.undoRouletteBet },
                    { label: 'RULE', onClick: actions?.cycleRouletteZeroRule },
                    // Modifiers
                    { label: 'SHIELD', onClick: actions?.toggleShield, active: gameState.activeModifiers.shield },
                    { label: 'DOUBLE', onClick: actions?.toggleDouble, active: gameState.activeModifiers.double },
                    { label: 'SUPER', onClick: actions?.toggleSuper, active: gameState.activeModifiers.super },
                ]}
            />

            {/* NUM INPUT MODAL */}
            {gameState.rouletteInputMode !== 'NONE' && (
                 <div
                     className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                     onClick={closeInsideBet}
                 >
                     <div
                         className="bg-terminal-black border border-terminal-green p-4 sm:p-6 rounded-lg shadow-xl flex flex-col items-center gap-4 w-full max-w-lg"
                         onClick={(e) => e.stopPropagation()}
                     >
                         <div className="text-sm tracking-widest text-gray-400 uppercase text-center">
                             {insideBet?.label ? `TAP A NUMBER — ${insideBet.label}` : 'TAP A NUMBER'}
                         </div>

                         <div className="text-xs text-gray-500 text-center">
                             Keyboard fallback: type digits → [ENTER] confirm, [ESC] cancel
                         </div>

                         <div className="text-3xl text-white font-bold font-mono h-12 flex items-center justify-center border-b border-gray-700 w-32">
                             {numberInput}
                             <span className="animate-pulse">_</span>
                         </div>

                         <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 w-full">
                             {(insideBet?.targets ?? []).map((n) => (
                                 <button
                                     key={n}
                                     type="button"
                                     onClick={() => placeInsideBet(n)}
                                     className="h-11 rounded border border-gray-800 bg-gray-900/50 text-white text-sm font-bold hover:border-gray-600"
                                 >
                                     {n}
                                 </button>
                             ))}
                         </div>

                         <button
                             type="button"
                             onClick={closeInsideBet}
                             className="h-10 px-4 rounded border border-gray-700 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-500"
                         >
                             Close
                         </button>
                     </div>
                 </div>
            )}
        </>
    );
});
