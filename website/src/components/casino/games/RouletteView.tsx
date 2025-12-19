
import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { GameState, RouletteBet } from '../../../types';
import { getRouletteColor, calculateRouletteExposure } from '../../../utils/gameUtils';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';

export const RouletteView = React.memo<{ gameState: GameState; numberInput?: string; actions: any; lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, numberInput = "", actions, lastWin, playMode }) => {
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
                                <div className="flex flex-col space-y-2">
                                    {(() => {
                                        const confirmedBets = gameState.rouletteBets.filter(b => b.local !== true);
                                        const pendingBets = gameState.rouletteBets.filter(b => b.local === true);

                                        const renderMobileBet = (b: RouletteBet, i: number, isPending: boolean) => (
                                            <div
                                                key={i}
                                                onClick={() => actions?.placeRouletteBet?.(b.type, b.target)}
                                                className={`flex justify-between items-center text-xs border p-1 rounded cursor-pointer hover:bg-gray-800 transition-colors ${
                                                    isPending
                                                        ? 'border-dashed border-amber-600/50 bg-amber-900/20 opacity-70'
                                                        : 'border-gray-800 bg-black/50'
                                                }`}
                                            >
                                                <div className="flex flex-col">
                                                    <span className={`font-bold text-[10px] ${isPending ? 'text-amber-400' : 'text-terminal-green'}`}>
                                                        {b.type} {b.target !== undefined ? b.target : ''}
                                                    </span>
                                                </div>
                                                <div className="text-white text-[10px]">${b.amount}</div>
                                            </div>
                                        );

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
                                                        {confirmedBets.map((b, i) => renderMobileBet(b, i, false))}
                                                    </div>
                                                )}
                                                {pendingBets.length > 0 && (
                                                    <div className="space-y-1">
                                                        <div className="text-[8px] text-amber-400 uppercase tracking-widest font-bold">
                                                            Pending ({pendingBets.length})
                                                        </div>
                                                        {pendingBets.map((b, i) => renderMobileBet(b, i, true))}
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
                        {gameState.message}
                    </div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                        ZERO RULE: {gameState.rouletteZeroRule.split('_').join(' ')}
                    </div>
                    {/* Current Bets Summary - visible on main screen */}
                    {gameState.rouletteBets.length > 0 && (
                        <div className="mt-2 flex flex-wrap justify-center gap-2 max-w-md mx-auto">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-terminal-green/40 bg-black/40 text-[10px] tracking-widest">
                                <span className="text-gray-500">TOTAL:</span>
                                <span className="text-terminal-gold">${totalBet.toLocaleString()}</span>
                                <span className="text-gray-600">({gameState.rouletteBets.length} bets)</span>
                            </div>
                            <div className="flex flex-wrap justify-center gap-1">
                                {gameState.rouletteBets.slice(0, 6).map((bet, i) => (
                                    <span key={i} className="px-2 py-0.5 text-[9px] rounded border border-gray-700 bg-black/60 text-gray-300">
                                        {bet.type}{bet.target !== undefined ? `:${bet.target}` : ''}
                                    </span>
                                ))}
                                {gameState.rouletteBets.length > 6 && (
                                    <span className="px-2 py-0.5 text-[9px] rounded border border-gray-700 bg-black/60 text-gray-500">
                                        +{gameState.rouletteBets.length - 6} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
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
                <div className="flex-1 overflow-y-auto flex flex-col space-y-2">
                    {(() => {
                        const confirmedBets = gameState.rouletteBets.filter(b => b.local !== true);
                        const pendingBets = gameState.rouletteBets.filter(b => b.local === true);

                        const renderBet = (b: RouletteBet, i: number, isPending: boolean) => (
                            <div
                                key={i}
                                onClick={() => actions?.placeRouletteBet?.(b.type, b.target)}
                                className={`flex justify-between items-center text-xs border p-1 rounded cursor-pointer hover:bg-gray-800 transition-colors ${
                                    isPending
                                        ? 'border-dashed border-amber-600/50 bg-amber-900/20 opacity-70'
                                        : 'border-gray-800 bg-black/50'
                                }`}
                            >
                                <div className="flex flex-col">
                                    <span className={`font-bold text-[10px] ${isPending ? 'text-amber-400' : 'text-terminal-green'}`}>
                                        {b.type} {b.target !== undefined ? b.target : ''}
                                    </span>
                                </div>
                                <div className="text-white text-[10px]">${b.amount}</div>
                            </div>
                        );

                        if (confirmedBets.length === 0 && pendingBets.length === 0) {
                            return <div className="text-center text-[10px] text-gray-700 italic">NO BETS</div>;
                        }

                        return (
                            <>
                                {/* Confirmed (on-chain) bets */}
                                {confirmedBets.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="text-[8px] text-terminal-green uppercase tracking-widest font-bold">
                                            Confirmed ({confirmedBets.length})
                                        </div>
                                        {confirmedBets.map((b, i) => renderBet(b, i, false))}
                                    </div>
                                )}

                                {/* Pending (local staged) bets */}
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

            {/* CONTROLS */}
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 sm:sticky sm:bottom-0 bg-terminal-black/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] sm:pb-0">
                <div className="h-auto sm:h-20 flex flex-col sm:flex-row items-center justify-center gap-2 p-2 sm:px-4">
                    {/* Outside Bets Group */}
                    <div className="hidden sm:flex items-center gap-1 px-3 py-2 rounded border border-terminal-green/30 bg-terminal-green/5">
                        <span className="text-[8px] text-terminal-green font-bold tracking-widest uppercase mr-2">OUTSIDE</span>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('RED')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('RED') ? 'border-terminal-accent bg-terminal-accent/20 text-terminal-accent' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>RED</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('BLACK')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('BLACK') ? 'border-white bg-white/20 text-white' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>BLACK</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('ODD')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('ODD') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>ODD</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('EVEN')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('EVEN') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>EVEN</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('LOW')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('LOW') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>1-18</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('HIGH')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('HIGH') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>19-36</button>
                        <div className="w-px h-6 bg-gray-700 mx-1"></div>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('DOZEN_1')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('DOZEN_1') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>1ST 12</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('DOZEN_2')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('DOZEN_2') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>2ND 12</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('DOZEN_3')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('DOZEN_3') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>3RD 12</button>
                        <div className="w-px h-6 bg-gray-700 mx-1"></div>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('COL_1')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('COL_1') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>COL 1</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('COL_2')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('COL_2') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>COL 2</button>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('COL_3')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('COL_3') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>COL 3</button>
                        <div className="w-px h-6 bg-gray-700 mx-1"></div>
                        <button type="button" onClick={() => actions?.placeRouletteBet?.('ZERO')} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${betTypes.has('ZERO') ? 'border-terminal-green bg-terminal-green/20 text-terminal-green' : 'border-terminal-green/30 bg-black/50 text-terminal-green hover:bg-gray-800'}`}>ZERO</button>
                    </div>

                    {/* Inside Bets Group */}
                    <div className="hidden sm:flex items-center gap-1 px-3 py-2 rounded border border-terminal-gold/30 bg-terminal-gold/5">
                        <span className="text-[8px] text-terminal-gold font-bold tracking-widest uppercase mr-2">INSIDE</span>
                        <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'STRAIGHT' }))} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.rouletteInputMode === 'STRAIGHT' ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>STRAIGHT</button>
                        <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'SPLIT_H' }))} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.rouletteInputMode === 'SPLIT_H' ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>SPLIT</button>
                        <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'SPLIT_V' }))} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.rouletteInputMode === 'SPLIT_V' ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>VSPLIT</button>
                        <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'STREET' }))} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.rouletteInputMode === 'STREET' ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>STREET</button>
                        <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'CORNER' }))} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.rouletteInputMode === 'CORNER' ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>CORNER</button>
                        <button type="button" onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, rouletteInputMode: 'SIX_LINE' }))} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.rouletteInputMode === 'SIX_LINE' ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>SIX LINE</button>
                    </div>

                    {/* SPIN Button */}
                    <button
                        type="button"
                        onClick={actions?.deal}
                        className="h-14 px-8 rounded border-2 font-bold text-base tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-terminal-green bg-terminal-green text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                    >
                        SPIN
                    </button>

                    {/* Actions Group */}
                    <div className="hidden sm:flex items-center gap-1">
                        <button type="button" onClick={actions?.rebetRoulette} className="h-8 px-2 rounded border border-gray-700 bg-black/50 text-gray-300 text-[10px] font-bold tracking-widest uppercase hover:bg-gray-800 transition-all">REBET</button>
                        <button type="button" onClick={actions?.undoRouletteBet} className="h-8 px-2 rounded border border-gray-700 bg-black/50 text-gray-300 text-[10px] font-bold tracking-widest uppercase hover:bg-gray-800 transition-all">UNDO</button>
                        <button type="button" onClick={actions?.cycleRouletteZeroRule} className="h-8 px-2 rounded border border-gray-700 bg-black/50 text-gray-300 text-[10px] font-bold tracking-widest uppercase hover:bg-gray-800 transition-all">RULE</button>
                        {playMode !== 'CASH' && (
                            <>
                                <button type="button" onClick={actions?.toggleShield} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.activeModifiers.shield ? 'border-blue-400 bg-blue-500/20 text-blue-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>SHIELD</button>
                                <button type="button" onClick={actions?.toggleDouble} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.activeModifiers.double ? 'border-purple-400 bg-purple-500/20 text-purple-300' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>DOUBLE</button>
                            </>
                        )}
                        <button type="button" onClick={actions?.toggleSuper} className={`h-8 px-2 rounded border text-[10px] font-bold tracking-widest uppercase transition-all ${gameState.activeModifiers.super ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold' : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'}`}>SUPER</button>
                    </div>
                </div>
            </div>

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
