import React, { useMemo, useCallback } from 'react';
import { GameState, RouletteBet } from '../../../types';
import { getRouletteColor, calculateRouletteExposure, formatRouletteNumber, ROULETTE_DOUBLE_ZERO } from '../../../utils/gameUtils';
import { MobileDrawer } from '../MobileDrawer';
import { BetsDrawer } from '../BetsDrawer';
import { Pseudo3DWheel } from '../pseudo3d/Pseudo3DWheel';
import { Label } from '../ui/Label';

/** Helper to get roulette number text color class based on the color */
function getRouletteColorClass(num: number): string {
    const color = getRouletteColor(num);
    if (color === 'RED') return 'text-mono-400 dark:text-mono-500';
    if (color === 'BLACK') return 'text-ns';
    return 'text-mono-0 dark:text-mono-1000 font-bold';
}

/** Helper for history chip border/text color */
function getRouletteChipColorClass(num: number): string {
    const color = getRouletteColor(num);
    if (color === 'RED') return 'border-mono-400 text-mono-400 dark:text-mono-500';
    if (color === 'BLACK') return 'border-ns text-ns';
    return 'border-mono-0 text-mono-0 dark:text-mono-1000 font-bold';
}

type RouletteViewProps = {
    gameState: GameState;
    numberInput?: string;
    actions: any;
    lastWin?: number;
    playMode?: 'CASH' | 'FREEROLL' | null;
};

export const RouletteView = React.memo(({ gameState, numberInput = "", actions, lastWin, playMode }: RouletteViewProps) => {
    const lastNum = useMemo(() =>
        gameState.rouletteHistory.length > 0 ? gameState.rouletteHistory[gameState.rouletteHistory.length - 1] : null,
        [gameState.rouletteHistory]
    );
    const isSpinning = gameState.message === 'SPINNING ON CHAIN...';
    const totalBet = useMemo(() => gameState.rouletteBets.reduce((acc, b) => acc + b.amount, 0), [gameState.rouletteBets]);
    const isAmerican = gameState.rouletteZeroRule === 'AMERICAN';
    const zeroRuleLabel = gameState.rouletteZeroRule.split('_').join(' ');
    const exposureByNumber = useMemo(() => {
        const exposureCount = isAmerican ? 38 : 37;
        const exposures = new Array(exposureCount);
        for (let num = 0; num < exposureCount; num += 1) {
            exposures[num] = calculateRouletteExposure(num, gameState.rouletteBets);
        }
        return exposures;
    }, [gameState.rouletteBets, isAmerican]);

    const hasBet = useCallback((type: RouletteBet['type'], target?: number) => {
        if (typeof target === 'number') {
            return gameState.rouletteBets.some((bet) => bet.type === type && bet.target === target);
        }
        return gameState.rouletteBets.some((bet) => bet.type === type);
    }, [gameState.rouletteBets]);

    const openInputMode = useCallback((mode: GameState['rouletteInputMode']) => {
        actions?.setGameState?.((prev: GameState) => ({ ...prev, rouletteInputMode: mode }));
    }, [actions]);

    const closeInput = useCallback(() => {
        actions?.setGameState?.((prev: GameState) => ({ ...prev, rouletteInputMode: 'NONE' }));
    }, [actions]);

    const isValidInputNumber = useCallback((mode: GameState['rouletteInputMode'], value: number) => {
        if (mode === 'NONE') return false;
        if (mode === 'STRAIGHT') {
            if (value === ROULETTE_DOUBLE_ZERO) return isAmerican;
            return value >= 0 && value <= 36;
        }
        if (mode === 'SPLIT_H') return value >= 1 && value <= 35 && value % 3 !== 0;
        if (mode === 'SPLIT_V') return value >= 1 && value <= 33;
        if (mode === 'STREET') return value >= 1 && value <= 34 && (value - 1) % 3 === 0;
        if (mode === 'CORNER') return value >= 1 && value <= 32 && value % 3 !== 0;
        if (mode === 'SIX_LINE') return value >= 1 && value <= 31 && (value - 1) % 3 === 0;
        return false;
    }, [isAmerican]);

    const inputNumbers = useMemo(() => {
        if (gameState.rouletteInputMode === 'STRAIGHT') {
            const nums = [0];
            if (isAmerican) nums.push(ROULETTE_DOUBLE_ZERO);
            for (let n = 1; n <= 36; n += 1) nums.push(n);
            return nums;
        }
        const nums = [];
        for (let n = 1; n <= 36; n += 1) nums.push(n);
        return nums;
    }, [gameState.rouletteInputMode, isAmerican]);

    const handleInputPick = useCallback((value: number) => {
        const mode = gameState.rouletteInputMode;
        if (!isValidInputNumber(mode, value)) return;

        if (mode === 'STRAIGHT') {
            if (value === 0) {
                actions?.placeRouletteBet?.('ZERO');
            } else {
                actions?.placeRouletteBet?.('STRAIGHT', value);
            }
            return;
        }

        actions?.placeRouletteBet?.(mode as RouletteBet['type'], value);
    }, [actions, gameState.rouletteInputMode, isValidInputNumber]);

    const rouletteInputLabel = useMemo(() => {
        switch (gameState.rouletteInputMode) {
            case 'STRAIGHT':
                return 'Straight';
            case 'SPLIT_H':
                return 'Split (Horizontal)';
            case 'SPLIT_V':
                return 'Split (Vertical)';
            case 'STREET':
                return 'Street';
            case 'CORNER':
                return 'Corner';
            case 'SIX_LINE':
                return 'Six Line';
            default:
                return '';
        }
    }, [gameState.rouletteInputMode]);

    const renderExposureRow = useCallback((num: number) => {
        const pnl = exposureByNumber[num] ?? 0;
        const maxScale = Math.max(100, totalBet * 36); 
        const barPercent = Math.min(Math.abs(pnl) / maxScale * 50, 50);
        const colorClass = getRouletteColorClass(num);

        return (
            <div key={num} className="flex items-center h-6 text-xs px-2">
                <div className="flex-1 flex justify-end items-center pr-2 gap-1">
                    {pnl < 0 && <span className="text-[9px] font-bold text-ns-muted tabular-nums">{Math.abs(pnl)}</span>}
                    {pnl < 0 && (
                        <div className="bg-mono-400/40 h-2 rounded-full" style={{ width: `${barPercent}%` }} />
                    )}
                </div>
                <div className={`w-6 text-center font-black ${colorClass} tabular-nums`}>{formatRouletteNumber(num)}</div>
                <div className="flex-1 flex justify-start items-center pl-2 gap-1">
                    {pnl > 0 && (
                        <div className="bg-mono-0/40 h-2 rounded-full" style={{ width: `${barPercent}%` }} />
                    )}
                    {pnl > 0 && <span className="text-[9px] font-bold text-ns-muted tabular-nums">{pnl}</span>}
                </div>
            </div>
        );
    }, [exposureByNumber, totalBet]);

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-8 relative pt-10 pb-24 animate-scale-in">
            <div className="absolute top-2 left-2 z-40">
                <MobileDrawer label="INFO" title="ROULETTE">
                    <div className="space-y-3 text-xs text-ns-muted">
                        <p>Pick outside bets or choose a number for straight and split plays.</p>
                        <p className="text-[10px] uppercase tracking-widest text-ns-muted">Spin with Space or tap Spin.</p>
                    </div>
                </MobileDrawer>
            </div>
            {/* Main Wheel Area */}
            <div className="w-full flex-1 flex flex-col items-center justify-center gap-12">
                 <div className="relative group">
                    <Pseudo3DWheel 
                        lastNumber={lastNum} 
                        isSpinning={isSpinning}
                        isAmerican={isAmerican}
                        style={{ width: 300, height: 320 }}
                    />
                    {/* Floating current number display */}
                    {!isSpinning && lastNum !== null && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 liquid-panel rounded-full w-16 h-16 flex items-center justify-center shadow-float animate-scale-in">
                            <span className={`text-2xl font-black ${getRouletteColorClass(lastNum)}`}>
                                {formatRouletteNumber(lastNum)}
                            </span>
                        </div>
                    )}
                 </div>
                 
                 <div className="flex flex-col items-center gap-4">
                    <div className="text-center">
                        <Label variant={isSpinning ? 'gold' : 'primary'}>{isSpinning ? 'Wheel spinning...' : 'Ready to play'}</Label>
                        <h2 className="text-2xl font-bold text-ns tracking-tight mt-1 zen-hide">{gameState.message || 'Place your bets'}</h2>
                    </div>

                    {/* Compact History */}
                    {gameState.rouletteHistory.length > 0 && (
                        <div className="flex gap-1.5 p-1.5 liquid-chip shadow-soft zen-hide" role="list" aria-label="Recent results">
                            {gameState.rouletteHistory.slice(-6).reverse().map((num, i) => {
                                const color = getRouletteColor(num);
                                const colorLabel = color === 'RED' ? 'red' : color === 'BLACK' ? 'black' : 'green';
                                return (
                                    <div
                                        key={i}
                                        role="listitem"
                                        aria-label={`${formatRouletteNumber(num)} - ${colorLabel}`}
                                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border transition-all liquid-chip ${getRouletteChipColorClass(num)} shadow-soft`}
                                    >
                                        {formatRouletteNumber(num)}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                 </div>
            </div>


            {gameState.rouletteInputMode !== 'NONE' && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Select number"
                    className="absolute inset-0 z-50 flex items-center justify-center p-4"
                >
                    <button
                        type="button"
                        aria-label="Cancel selection"
                        className="absolute inset-0 bg-black/40 backdrop-blur-lg cursor-default"
                        onClick={closeInput}
                    />
                    <div className="w-full max-w-lg liquid-card liquid-sheen rounded-3xl p-5 shadow-float" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                            <Label size="micro">{rouletteInputLabel}</Label>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-ns-muted">{numberInput || 'Pick a number'}</span>
                        </div>
                        <div className="grid grid-cols-6 gap-2">
                            {inputNumbers.map((value) => {
                                const isValid = isValidInputNumber(gameState.rouletteInputMode, value);
                                const isActive = gameState.rouletteInputMode === 'STRAIGHT'
                                    ? (value === 0
                                        ? hasBet('ZERO')
                                        : hasBet('STRAIGHT', value))
                                    : hasBet(gameState.rouletteInputMode as RouletteBet['type'], value);
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => handleInputPick(value)}
                                        disabled={!isValid}
                                        className={`h-10 rounded-xl border text-xs font-bold uppercase transition-all active:scale-95 ${
                                            isActive
                                                ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                                : isValid
                                                    ? 'border-ns bg-ns-surface text-ns'
                                                    : 'border-ns bg-ns-surface text-ns-muted opacity-40 cursor-not-allowed'
                                        }`}
                                    >
                                        {formatRouletteNumber(value)}
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            type="button"
                            onClick={closeInput}
                            className="mt-4 w-full py-3 rounded-full bg-mono-0 text-white text-xs font-bold uppercase tracking-widest active:scale-95 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>

        {/* Control Bar */}
            <div className="ns-controlbar zen-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 liquid-card rounded-none md:rounded-t-3xl backdrop-blur border-t border-ns z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
            <div className="h-auto md:h-20 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 p-2 md:px-4">
                <div className="hidden md:flex items-center gap-2 flex-1 flex-wrap">
                    <div className="flex items-center gap-1 flex-wrap">
                        {([
                            { label: 'Red', type: 'RED' as const },
                            { label: 'Black', type: 'BLACK' as const },
                            { label: 'Even', type: 'EVEN' as const },
                            { label: 'Odd', type: 'ODD' as const },
                            { label: 'Low', type: 'LOW' as const },
                            { label: 'High', type: 'HIGH' as const },
                        ]).map((bet) => {
                            const active = hasBet(bet.type);
                            return (
                                <button
                                    key={bet.type}
                                    type="button"
                                    onClick={() => actions?.placeRouletteBet?.(bet.type)}
                                    className={`px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-tight transition-all active:scale-95 ${
                                        active
                                            ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                            : 'border-ns bg-ns-surface text-ns hover:border-mono-0/40'
                                    }`}
                                >
                                    {bet.label}
                                </button>
                            );
                        })}
                        <button
                            type="button"
                            onClick={() => actions?.placeRouletteBet?.('ZERO')}
                            className={`px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-tight transition-all active:scale-95 ${
                                hasBet('ZERO')
                                    ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                    : 'border-ns bg-ns-surface text-ns hover:border-mono-0/40'
                            }`}
                        >
                            0
                        </button>
                        {isAmerican && (
                            <button
                                type="button"
                                onClick={() => actions?.placeRouletteBet?.('STRAIGHT', ROULETTE_DOUBLE_ZERO)}
                                className={`px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-tight transition-all active:scale-95 ${
                                    hasBet('STRAIGHT', ROULETTE_DOUBLE_ZERO)
                                        ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                        : 'border-ns bg-ns-surface text-ns hover:border-mono-0/40'
                                }`}
                            >
                                00
                            </button>
                        )}
                    </div>

                    <div className="h-6 w-px bg-ns-border opacity-60" />

                    <div className="flex items-center gap-1 flex-wrap">
                        {([
                            { label: 'D1', type: 'DOZEN_1' as const },
                            { label: 'D2', type: 'DOZEN_2' as const },
                            { label: 'D3', type: 'DOZEN_3' as const },
                            { label: 'C1', type: 'COL_1' as const },
                            { label: 'C2', type: 'COL_2' as const },
                            { label: 'C3', type: 'COL_3' as const },
                        ]).map((bet) => {
                            const active = hasBet(bet.type);
                            return (
                                <button
                                    key={bet.type}
                                    type="button"
                                    onClick={() => actions?.placeRouletteBet?.(bet.type)}
                                    className={`px-2.5 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-tight transition-all active:scale-95 ${
                                        active
                                            ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                            : 'border-ns bg-ns-surface text-ns hover:border-mono-0/40'
                                    }`}
                                >
                                    {bet.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="h-6 w-px bg-ns-border opacity-60" />

                    <div className="flex items-center gap-1 flex-wrap">
                        {([
                            { label: 'Straight', mode: 'STRAIGHT' as const },
                            { label: 'Split H', mode: 'SPLIT_H' as const },
                            { label: 'Split V', mode: 'SPLIT_V' as const },
                            { label: 'Street', mode: 'STREET' as const },
                            { label: 'Corner', mode: 'CORNER' as const },
                            { label: 'Six', mode: 'SIX_LINE' as const },
                        ]).map((entry) => (
                            <button
                                key={entry.mode}
                                type="button"
                                onClick={() => openInputMode(entry.mode)}
                                className={`px-2.5 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-tight transition-all active:scale-95 ${
                                    gameState.rouletteInputMode === entry.mode
                                        ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                        : 'border-ns bg-ns-surface text-ns hover:border-mono-0/40'
                                }`}
                            >
                                {entry.label}
                            </button>
                        ))}
                    </div>

                    <div className="h-6 w-px bg-ns-border opacity-60" />

                    <div className="flex items-center gap-1 flex-wrap">
                        <button
                            type="button"
                            onClick={actions?.undoRouletteBet}
                            disabled={gameState.rouletteUndoStack.length === 0}
                            className="px-3 py-1.5 rounded-full border border-ns bg-ns-surface text-ns-muted text-[10px] font-bold uppercase tracking-tight hover:border-ns transition-all active:scale-95 disabled:opacity-30"
                        >
                            Undo
                        </button>
                        <button
                            type="button"
                            onClick={actions?.rebetRoulette}
                            disabled={gameState.rouletteLastRoundBets.length === 0}
                            className="px-3 py-1.5 rounded-full border border-ns bg-ns-surface text-ns-muted text-[10px] font-bold uppercase tracking-tight hover:border-ns transition-all active:scale-95 disabled:opacity-30"
                        >
                            Rebet
                        </button>
                        <button
                            type="button"
                            onClick={actions?.cycleRouletteZeroRule}
                            className="px-3 py-1.5 rounded-full border border-ns bg-ns-surface text-ns text-[10px] font-bold uppercase tracking-tight hover:border-mono-0/40 transition-all active:scale-95"
                        >
                            Rule: {zeroRuleLabel}
                        </button>
                        <button
                            type="button"
                            onClick={actions?.toggleSuper}
                            className={`px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-tight transition-all active:scale-95 ${
                                gameState.activeModifiers.super
                                    ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                : 'border-ns bg-ns-surface text-ns hover:border-mono-0/40'
                            }`}
                        >
                            Super
                        </button>
                        <div className="hidden md:block">
                            <div className="ml-3 rounded-3xl liquid-panel border border-ns/40 px-4 py-3 space-y-4 shadow-soft">
                                <div className="flex items-center justify-between">
                                    <div className="text-[10px] font-bold uppercase tracking-tight text-ns">Roulette Table</div>
                                    {gameState.rouletteBets.length > 0 && (
                                        <span className="text-[10px] font-bold text-ns-muted">
                                            {gameState.rouletteBets.length} bets
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <Label size="micro" className="mb-2 block">Exposure</Label>
                                    <div className="max-h-56 overflow-y-auto scrollbar-hide rounded-2xl bg-ns-surface/60 p-2 border border-ns/30">
                                        {Array.from({ length: exposureByNumber.length }, (_, i) => i).map(num => renderExposureRow(num))}
                                    </div>
                                </div>
                                <div>
                                    <Label size="micro" className="mb-2 block">Active Bets</Label>
                                    <div className="space-y-2">
                                        {gameState.rouletteBets.length === 0 ? (
                                            <div className="text-center py-6 text-[11px] text-ns-muted uppercase tracking-widest">No bets placed</div>
                                        ) : (
                                            gameState.rouletteBets.map((b, i) => (
                                                <div key={i} className={`flex justify-between items-center p-3 rounded-2xl border transition-all ${b.local ? 'bg-ns-surface border-dashed border-ns' : 'bg-ns-surface border-ns shadow-soft'}`}>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-bold text-ns uppercase tracking-tight">
                                                            {b.type} {b.type === 'STRAIGHT' && typeof b.target === 'number' ? formatRouletteNumber(b.target) : b.target ?? ''}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-ns-muted uppercase">{b.local ? 'Pending' : 'Confirmed'}</span>
                                                    </div>
                                                    <span className="text-xs font-bold text-mono-0 dark:text-mono-1000">${b.amount}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex md:hidden items-center gap-2">
                    <BetsDrawer title="PLACE BETS">
                        <div className="space-y-4">
                            <div className="rounded-2xl liquid-panel p-3 space-y-2">
                                <Label size="micro">Quick Bets</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    {([
                                        { label: 'Red', type: 'RED' as const },
                                        { label: 'Black', type: 'BLACK' as const },
                                        { label: 'Even', type: 'EVEN' as const },
                                        { label: 'Odd', type: 'ODD' as const },
                                        { label: 'Low', type: 'LOW' as const },
                                        { label: 'High', type: 'HIGH' as const },
                                    ]).map((bet) => {
                                        const active = hasBet(bet.type);
                                        return (
                                            <button
                                                key={bet.type}
                                                type="button"
                                                onClick={() => actions?.placeRouletteBet?.(bet.type)}
                                                className={`py-3 rounded-xl border text-xs font-bold uppercase transition-all active:scale-95 ${
                                                    active
                                                        ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                                        : 'border-ns bg-ns-surface text-ns'
                                                }`}
                                            >
                                                {bet.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="rounded-2xl liquid-panel p-3 space-y-2">
                                <Label size="micro">Dozens & Columns</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    {([
                                        { label: 'Dozen 1', type: 'DOZEN_1' as const },
                                        { label: 'Dozen 2', type: 'DOZEN_2' as const },
                                        { label: 'Dozen 3', type: 'DOZEN_3' as const },
                                        { label: 'Col 1', type: 'COL_1' as const },
                                        { label: 'Col 2', type: 'COL_2' as const },
                                        { label: 'Col 3', type: 'COL_3' as const },
                                    ]).map((bet) => {
                                        const active = hasBet(bet.type);
                                        return (
                                            <button
                                                key={bet.type}
                                                type="button"
                                                onClick={() => actions?.placeRouletteBet?.(bet.type)}
                                                className={`py-3 rounded-xl border text-[11px] font-bold uppercase transition-all active:scale-95 ${
                                                    active
                                                        ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                                        : 'border-ns bg-ns-surface text-ns'
                                                }`}
                                            >
                                                {bet.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="rounded-2xl liquid-panel p-3 space-y-2">
                                <Label size="micro">Zero</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => actions?.placeRouletteBet?.('ZERO')}
                                        className={`py-3 rounded-xl border text-xs font-bold uppercase transition-all active:scale-95 ${
                                            hasBet('ZERO')
                                                ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                                : 'border-ns bg-ns-surface text-ns'
                                        }`}
                                    >
                                        0
                                    </button>
                                    {isAmerican && (
                                        <button
                                            type="button"
                                            onClick={() => actions?.placeRouletteBet?.('STRAIGHT', ROULETTE_DOUBLE_ZERO)}
                                            className={`py-3 rounded-xl border text-xs font-bold uppercase transition-all active:scale-95 ${
                                                hasBet('STRAIGHT', ROULETTE_DOUBLE_ZERO)
                                                    ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                                    : 'border-ns bg-ns-surface text-ns'
                                            }`}
                                        >
                                            00
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-2xl liquid-panel p-3 space-y-2">
                                <Label size="micro">Number Bets</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    {([
                                        { label: 'Straight', mode: 'STRAIGHT' as const },
                                        { label: 'Split H', mode: 'SPLIT_H' as const },
                                        { label: 'Split V', mode: 'SPLIT_V' as const },
                                        { label: 'Street', mode: 'STREET' as const },
                                        { label: 'Corner', mode: 'CORNER' as const },
                                        { label: 'Six Line', mode: 'SIX_LINE' as const },
                                    ]).map((entry) => (
                                        <button
                                            key={entry.mode}
                                            type="button"
                                            onClick={() => openInputMode(entry.mode)}
                                        className="py-3 rounded-xl border border-ns bg-ns-surface text-ns text-xs font-bold uppercase transition-all active:scale-95"
                                        >
                                            {entry.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-2xl liquid-panel p-3 space-y-2">
                                <Label size="micro">Actions</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={actions?.undoRouletteBet}
                                        disabled={gameState.rouletteUndoStack.length === 0}
                                        className="py-3 rounded-xl border border-ns bg-ns-surface text-ns-muted text-xs font-bold uppercase transition-all active:scale-95 disabled:opacity-30"
                                    >
                                        Undo
                                    </button>
                                    <button
                                        type="button"
                                        onClick={actions?.rebetRoulette}
                                        disabled={gameState.rouletteLastRoundBets.length === 0}
                                        className="py-3 rounded-xl border border-ns bg-ns-surface text-ns-muted text-xs font-bold uppercase transition-all active:scale-95 disabled:opacity-30"
                                    >
                                        Rebet
                                    </button>
                                    <button
                                        type="button"
                                        onClick={actions?.cycleRouletteZeroRule}
                                        className="py-3 rounded-xl border border-ns bg-ns-surface text-ns text-xs font-bold uppercase transition-all active:scale-95"
                                    >
                                        Rule: {zeroRuleLabel}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={actions?.toggleSuper}
                                        className={`py-3 rounded-xl border text-xs font-bold uppercase transition-all active:scale-95 ${
                                            gameState.activeModifiers.super
                                                ? 'border-mono-0 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                                                : 'border-ns bg-ns-surface text-ns'
                                        }`}
                                    >
                                        Super
                                    </button>
                                </div>
                            </div>
                        </div>
                    </BetsDrawer>
                </div>

                <button
                    type="button"
                    onClick={actions?.deal}
                    className="ns-control-primary h-14 px-12 rounded-full border-2 font-bold text-lg font-display tracking-tight uppercase transition-all shadow-soft border-mono-0 bg-mono-0 text-white hover:bg-mono-0-hover hover:scale-105 active:scale-95"
                >
                    Spin
                </button>
            </div>
            </div>
        </>
    );
});
