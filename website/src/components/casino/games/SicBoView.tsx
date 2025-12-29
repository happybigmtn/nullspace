import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { GameState, SicBoBet } from '../../../types';
import { MobileDrawer } from '../MobileDrawer';
import { getSicBoTotalItems, getSicBoCombinationItems, calculateSicBoTotalExposure, calculateSicBoCombinationExposure } from '../../../utils/gameUtils';
import { DiceThrow2D } from '../GameComponents';
import { Label } from '../ui/Label';

export const SicBoView = React.memo<{
    gameState: GameState;
    numberInput?: string;
    actions: any;
    lastWin?: number;
    playMode?: 'CASH' | 'FREEROLL' | null;
}>(({ gameState, numberInput = "", actions, lastWin, playMode }) => {

    const totalItems = useMemo(() => getSicBoTotalItems(), []);
    const combinationItems = useMemo(() => getSicBoCombinationItems(), []);
    const [tapPicks, setTapPicks] = useState<number[]>([]);
    useEffect(() => {
        setTapPicks([]);
    }, [gameState.sicBoInputMode]);

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

    const renderTotalRow = useCallback((entry: { total: number; isTriple: boolean; label: string }, idx: number) => {
        const pnl = calculateSicBoTotalExposure(entry.total, entry.isTriple, gameState.sicBoBets);
        const pnlRounded = Math.round(pnl);

        return (
            <div key={idx} className="flex items-center h-5 text-xs w-full">
                <div className="flex-1 flex justify-end items-center text-right pr-1 overflow-hidden">
                    {pnlRounded < 0 && <span className="text-action-destructive font-mono text-[10px]">-{Math.abs(pnlRounded).toLocaleString()}</span>}
                </div>
                <div className="flex-none w-6 flex justify-center items-center relative">
                    <span className={`font-mono z-10 text-[10px] ${entry.isTriple ? 'text-action-primary font-bold' : 'text-titanium-400'}`}>
                        {entry.label}
                    </span>
                </div>
                <div className="flex-1 flex justify-start items-center pl-1 overflow-hidden">
                    {pnlRounded > 0 && <span className="text-action-success font-mono text-[10px]">+{pnlRounded.toLocaleString()}</span>}
                </div>
            </div>
        );
    }, [gameState.sicBoBets]);

    const renderComboRow = useCallback((entry: { type: 'SINGLE' | 'SINGLE_2X' | 'SINGLE_3X' | 'DOUBLE' | 'TRIPLE' | 'ANY_TRIPLE'; target?: number; label: string }, idx: number) => {
        const pnl = calculateSicBoCombinationExposure(entry.type, entry.target, gameState.sicBoBets);
        const pnlRounded = Math.round(pnl);

        const typeColor = entry.type === 'SINGLE' ? 'text-cyan-400'
            : entry.type === 'SINGLE_2X' ? 'text-cyan-300'
            : entry.type === 'SINGLE_3X' ? 'text-cyan-200'
            : entry.type === 'DOUBLE' ? 'text-purple-400'
            : 'text-action-primary';

        return (
            <div key={idx} className="flex items-center h-5 text-xs w-full">
                <div className="flex-1 flex justify-end items-center text-right pr-1 overflow-hidden">
                    {pnlRounded < 0 && <span className="text-action-destructive font-mono text-[10px]">-{Math.abs(pnlRounded).toLocaleString()}</span>}
                </div>
                <div className="flex-none w-10 flex justify-center items-center relative">
                    <span className={`font-mono z-10 text-[10px] ${typeColor}`}>
                        {entry.label}
                    </span>
                </div>
                <div className="flex-1 flex justify-start items-center pl-1 overflow-hidden">
                    {pnlRounded > 0 && <span className="text-action-success font-mono text-[10px]">+{pnlRounded.toLocaleString()}</span>}
                </div>
            </div>
        );
    }, [gameState.sicBoBets]);

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-8 relative pt-12 pb-24 animate-scale-in">
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                    <Label size="micro">Sic Bo</Label>
                    <div className="h-1 w-8 bg-titanium-200 rounded-full" />
                </div>

                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="SIC BO">
                        <div className="space-y-4 p-2 text-center">
                            <Label size="micro">Table Exposure</Label>
                            {/* Exposure grids could go here */}
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
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-titanium-900 tracking-tight font-display animate-scale-in">
                        {gameState.message || 'Place Your Bets'}
                    </h2>
                    {/* Current Bets Summary */}
                    {gameState.sicBoBets.length > 0 && (
                        <div className="mt-2 flex flex-wrap justify-center gap-2 max-w-md mx-auto">
                            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-action-success/20 bg-white shadow-soft text-[10px] font-black uppercase tracking-widest">
                                <span className="text-titanium-400">Total:</span>
                                <span className="text-action-success">${gameState.sicBoBets.reduce((a, b) => a + b.amount, 0).toLocaleString()}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* History */}
                 {gameState.sicBoHistory.length > 0 && (
                     <div className="flex flex-col items-center gap-2">
                         <Label size="micro" variant="secondary">Recent Results</Label>
                         <div className="flex gap-2 opacity-80">
                             {gameState.sicBoHistory.slice(-5).reverse().map((roll, i) => (
                                 <div key={i} className="flex gap-1.5 bg-titanium-100 px-3 py-1.5 rounded-xl border border-titanium-200 shadow-soft">
                                     {roll.map((d, j) => <span key={j} className="text-xs font-black text-titanium-900">{d}</span>)}
                                 </div>
                             ))}
                         </div>
                     </div>
                 )}
            </div>

             {/* EXPOSURE SIDEBAR */}
             <div className="hidden lg:flex absolute top-8 left-4 bottom-24 w-64 bg-white/60 backdrop-blur-md rounded-[32px] border border-titanium-200 p-6 flex-col shadow-soft">
                <div className="flex-none flex border-b border-titanium-100 pb-2 mb-4">
                    <div className="flex-1 text-center"><Label size="micro">Totals</Label></div>
                    <div className="flex-1 text-center"><Label size="micro">Combos</Label></div>
                </div>

                <div className="flex-1 flex flex-row relative overflow-hidden">
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-titanium-100 -translate-x-1/2"></div>
                    <div className="flex-1 flex flex-col gap-0.5 pr-2 overflow-y-auto scrollbar-hide">
                        {totalItems.map((entry, idx) => renderTotalRow(entry, idx))}
                    </div>
                    <div className="flex-1 flex flex-col gap-0.5 pl-2 overflow-y-auto scrollbar-hide text-center">
                        {combinationItems.slice(0, 18).map((entry, idx) => renderComboRow(entry, idx))}
                    </div>
                </div>
            </div>

            {/* ACTIVE BETS SIDEBAR */}
            <div className="hidden lg:flex absolute top-8 right-4 bottom-24 w-60 bg-white/60 backdrop-blur-md rounded-[32px] border border-titanium-200 p-6 flex-col shadow-soft">
                    <Label className="mb-4 text-center block">Active Bets</Label>
                    <div className="flex-1 overflow-y-auto space-y-2 scrollbar-hide">
                        {gameState.sicBoBets.length === 0 ? (
                            <div className="text-center py-12 italic text-titanium-300 text-xs">No active bets</div>
                        ) : (
                            gameState.sicBoBets.map((b, i) => (
                                <div key={i} className={`p-3 rounded-2xl border transition-all ${b.local ? 'bg-titanium-50 border-dashed border-titanium-300' : 'bg-white border-titanium-100 shadow-soft'}`}>
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] font-bold text-titanium-900 uppercase tracking-tight">{b.type} {b.target ?? ''}</span>
                                        <span className="text-xs font-black text-action-success">${b.amount}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
            </div>

            {/* SIC BO MODAL */}
            {gameState.sicBoInputMode !== 'NONE' && (
                 <div className="fixed inset-0 bg-titanium-900/60 backdrop-blur-lg z-[100] flex items-center justify-center p-6" onClick={closeInput}>
                     <div className="bg-white rounded-[48px] p-12 shadow-float border border-titanium-200 flex flex-col items-center gap-8 w-full max-w-lg animate-scale-in" onClick={(e) => e.stopPropagation()}>
                         <Label variant="primary" size="micro">Selection Required</Label>
                         <h3 className="text-2xl font-black text-titanium-900 tracking-tight font-display text-center">
                             {gameState.sicBoInputMode === 'SUM' ? "Select Total" : "Select Numbers"}
                         </h3>

                         {gameState.sicBoInputMode === 'SUM' ? (
                              <div className="grid grid-cols-4 gap-3 w-full">
                                  {Array.from({ length: 16 }, (_, i) => i + 3).map((t) => (
                                      <button
                                          key={t}
                                          type="button"
                                          onClick={() => handleTapPick(t)}
                                          className="h-14 rounded-2xl border border-titanium-200 bg-titanium-50 text-titanium-900 font-bold hover:border-action-primary transition-all active:scale-95"
                                      >
                                          {t}
                                      </button>
                                  ))}
                              </div>
                         ) : (
                             <div className="grid grid-cols-3 gap-4 w-full">
                                 {[1,2,3,4,5,6].map(n => {
                                     const selected = tapPicks.includes(n);
                                     return (
                                         <button
                                             key={n}
                                             type="button"
                                             onClick={() => handleTapPick(n)}
                                             className={`h-20 flex flex-col items-center justify-center gap-1 rounded-3xl border-2 transition-all active:scale-95 ${
                                                 selected ? 'border-action-primary bg-action-primary/5 shadow-inner' : 'border-titanium-100 bg-white'
                                             }`}
                                         >
                                             <span className="text-2xl font-black text-titanium-900">{n}</span>
                                         </button>
                                     );
                                 })}
                             </div>
                         )}

                         <button onClick={closeInput} className="px-8 py-3 rounded-full bg-titanium-900 text-white font-bold text-xs uppercase tracking-widest active:scale-95">Cancel</button>
                     </div>
                 </div>
            )}

            {/* Control Bar */}
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 bg-titanium-50/95 backdrop-blur border-t border-titanium-200 z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-auto md:h-20 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 p-2 md:px-4">
                    {/* Quick Bets - Desktop */}
                    <div className="hidden md:flex items-center gap-2 flex-1">
                        {/* Simple Bets */}
                        <div className="flex items-center gap-1">
                            {(['BIG', 'SMALL', 'ODD', 'EVEN'] as const).map(type => {
                                const isActive = gameState.sicBoBets.some(b => b.type === type);
                                return (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => actions?.placeSicBoBet?.(type)}
                                        className={`px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-tight transition-all active:scale-95 ${
                                            isActive
                                                ? 'border-action-primary bg-action-primary/10 text-action-primary'
                                                : 'border-titanium-200 bg-white text-titanium-600 hover:border-titanium-400'
                                        }`}
                                    >
                                        {type}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="h-6 w-px bg-titanium-200" />

                        {/* Number-based Bets */}
                        <div className="flex items-center gap-1">
                            {[
                                { mode: 'SINGLE', label: 'Single' },
                                { mode: 'DOUBLE', label: 'Double' },
                                { mode: 'TRIPLE', label: 'Triple' },
                                { mode: 'SUM', label: 'Sum' },
                            ].map(({ mode, label }) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => actions?.setGameState?.((prev: GameState) => ({ ...prev, sicBoInputMode: mode as GameState['sicBoInputMode'] }))}
                                    className="px-3 py-1.5 rounded-full border border-titanium-200 bg-white text-titanium-600 text-[10px] font-bold uppercase tracking-tight hover:border-titanium-400 transition-all active:scale-95"
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        <div className="h-6 w-px bg-titanium-200" />

                        {/* Utility Buttons */}
                        <button
                            type="button"
                            onClick={actions?.undoSicBoBet}
                            disabled={gameState.sicBoUndoStack.length === 0}
                            className="px-3 py-1.5 rounded-full border border-titanium-200 bg-white text-titanium-400 text-[10px] font-bold uppercase tracking-tight hover:border-titanium-400 transition-all active:scale-95 disabled:opacity-30"
                        >
                            Undo
                        </button>
                        <button
                            type="button"
                            onClick={actions?.rebetSicBo}
                            disabled={gameState.sicBoLastRoundBets.length === 0}
                            className="px-3 py-1.5 rounded-full border border-titanium-200 bg-white text-titanium-400 text-[10px] font-bold uppercase tracking-tight hover:border-titanium-400 transition-all active:scale-95 disabled:opacity-30"
                        >
                            Rebet
                        </button>
                    </div>

                    {/* Mobile: Bet Menu Drawer */}
                    <div className="flex md:hidden items-center gap-2">
                        <MobileDrawer label="BETS" title="PLACE BETS">
                            <div className="space-y-4">
                                {/* Simple Bets */}
                                <div className="rounded-2xl border border-titanium-100 bg-white p-3 space-y-2">
                                    <Label size="micro">Simple Bets</Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {(['BIG', 'SMALL', 'ODD', 'EVEN'] as const).map(type => {
                                            const isActive = gameState.sicBoBets.some(b => b.type === type);
                                            return (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => actions?.placeSicBoBet?.(type)}
                                                    className={`py-3 rounded-xl border text-xs font-bold uppercase transition-all active:scale-95 ${
                                                        isActive
                                                            ? 'border-action-primary bg-action-primary/10 text-action-primary'
                                                            : 'border-titanium-200 bg-titanium-50 text-titanium-700'
                                                    }`}
                                                >
                                                    {type}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Number Bets */}
                                <div className="rounded-2xl border border-titanium-100 bg-white p-3 space-y-2">
                                    <Label size="micro">Number Bets</Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            { mode: 'SINGLE', label: 'Single Die' },
                                            { mode: 'DOUBLE', label: 'Double' },
                                            { mode: 'TRIPLE', label: 'Triple' },
                                            { mode: 'SUM', label: 'Sum Total' },
                                        ].map(({ mode, label }) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() => actions?.setGameState?.((prev: GameState) => ({ ...prev, sicBoInputMode: mode as GameState['sicBoInputMode'] }))}
                                                className="py-3 rounded-xl border border-titanium-200 bg-titanium-50 text-titanium-700 text-xs font-bold uppercase transition-all active:scale-95"
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Utility Buttons */}
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={actions?.undoSicBoBet}
                                        disabled={gameState.sicBoUndoStack.length === 0}
                                        className="flex-1 py-3 rounded-xl border border-titanium-200 bg-white text-titanium-400 text-xs font-bold uppercase transition-all active:scale-95 disabled:opacity-30"
                                    >
                                        Undo
                                    </button>
                                    <button
                                        type="button"
                                        onClick={actions?.rebetSicBo}
                                        disabled={gameState.sicBoLastRoundBets.length === 0}
                                        className="flex-1 py-3 rounded-xl border border-titanium-200 bg-white text-titanium-400 text-xs font-bold uppercase transition-all active:scale-95 disabled:opacity-30"
                                    >
                                        Rebet
                                    </button>
                                </div>
                            </div>
                        </MobileDrawer>
                    </div>

                    {/* ROLL Button */}
                    <button
                        type="button"
                        onClick={actions?.deal}
                        className="h-14 px-12 rounded-full border-2 font-bold text-lg font-display tracking-tight uppercase transition-all shadow-soft border-action-primary bg-action-primary text-white hover:bg-action-primary-hover hover:scale-105 active:scale-95"
                    >
                        ROLL
                    </button>
                </div>
            </div>
        </>
    );
});