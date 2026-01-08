
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { GameState } from '../../../types';
import { DiceThrow2D } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { BetsDrawer } from '../BetsDrawer';
import { PanelDrawer } from '../PanelDrawer';
import { InlineBetSelector } from '../InlineBetSelector';
import { Label } from '../ui/Label';
import { calculateCrapsExposure, canPlaceCrapsBonusBets } from '../../../utils/gameUtils';
import { CrapsBonusDashboard } from './CrapsBonusDashboard';
import { CrapsBetMenu } from './CrapsBetMenu';

export const CrapsView = React.memo<{
    gameState: GameState;
    actions: any;
    lastWin?: number;
    playMode?: 'CASH' | 'FREEROLL' | null;
    currentBet?: number;
    onBetChange?: (bet: number) => void;
    /** LUX-010: Balance for inline bet selector calculations */
    balance?: number;
}>(({ gameState, actions, lastWin, playMode, currentBet, onBetChange, balance = 1000 }) => {
    const [leftSidebarView, setLeftSidebarView] = useState<'EXPOSURE' | 'SIDE_BETS'>('EXPOSURE');
    const [diceSettled, setDiceSettled] = useState(true);
    const [showOutcome, setShowOutcome] = useState(true);

    // Reset settled state when a new roll starts
    const rollKey = gameState.crapsRollHistory.length;
    useEffect(() => {
        setDiceSettled(false);
        setShowOutcome(false);
    }, [rollKey]);

    const handleDiceSettled = useCallback(() => {
        setDiceSettled(true);
        // Delay showing outcome text until AFTER dots have faded in (200ms dot delay + 150ms buffer)
        setTimeout(() => setShowOutcome(true), 350);
    }, []);

    // Get current roll (last dice sum)
    const currentRoll = useMemo(() =>
        gameState.dice.length === 2 ? gameState.dice[0] + gameState.dice[1] : null,
        [gameState.dice]
    );

    // Get established come/don't come bets (status 'ON' with a target)
    const establishedComeBets = useMemo(() =>
        gameState.crapsBets
            .map((b, i) => ({ ...b, originalIndex: i }))
            .filter(b =>
                (b.type === 'COME' || b.type === 'DONT_COME') && b.status === 'ON' && b.target
            ),
        [gameState.crapsBets]
    );

    // Determine point circle color based on pass/don't pass bet
    const pointColor = useMemo(() => {
        const hasPassBet = gameState.crapsBets.some(b => b.type === 'PASS');
        const hasDontPassBet = gameState.crapsBets.some(b => b.type === 'DONT_PASS');
        if (hasPassBet) return 'border-action-success text-action-success';
        if (hasDontPassBet) return 'border-action-destructive text-action-destructive';
        return 'border-gray-700 text-gray-700';
    }, [gameState.crapsBets]);

    // Bonus bets can only be placed before epoch point is established
    const canPlaceBonus = useMemo(
        () => canPlaceCrapsBonusBets(gameState.crapsEpochPointEstablished, gameState.dice),
        [gameState.crapsEpochPointEstablished, gameState.dice]
    );

    const bonusBetsPlaced = useMemo(() => ({
        fire: gameState.crapsBets.some(b => b.type === 'FIRE'),
        atsSmall: gameState.crapsBets.some(b => b.type === 'ATS_SMALL'),
        atsTall: gameState.crapsBets.some(b => b.type === 'ATS_TALL'),
        atsAll: gameState.crapsBets.some(b => b.type === 'ATS_ALL'),
        muggsy: gameState.crapsBets.some(b => b.type === 'MUGGSY'),
        diffDoubles: gameState.crapsBets.some(b => b.type === 'DIFF_DOUBLES'),
        rideLine: gameState.crapsBets.some(b => b.type === 'RIDE_LINE'),
        replay: gameState.crapsBets.some(b => b.type === 'REPLAY'),
        hotRoller: gameState.crapsBets.some(b => b.type === 'HOT_ROLLER'),
    }), [gameState.crapsBets]);

    const betTypes = useMemo(() => new Set(gameState.crapsBets.map((b) => b.type)), [gameState.crapsBets]);
    const closeInput = () => actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'NONE' }));

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 relative pt-8 sm:pt-10 pb-24 sm:pb-20">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">CRAPS</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="CRAPS">
                        <div className="space-y-3">
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Exposure
                                </div>
                                <div className="flex flex-col space-y-1">
                                    {(() => {
                                        const hardwayTargets = [4, 6, 8, 10];
                                        const activeHardways = gameState.crapsBets
                                            .filter(b => b.type === 'HARDWAY')
                                            .map(b => b.target!);

                                        const rows: { num: number; label: string; isHard?: boolean }[] = [];

                                        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach(num => {
                                            if (hardwayTargets.includes(num) && activeHardways.includes(num)) {
                                                rows.push({ num, label: `${num}H`, isHard: true });
                                                rows.push({ num, label: `${num}E`, isHard: false });
                                            } else {
                                                rows.push({ num, label: num.toString() });
                                            }
                                        });

                                        // Format number with K/M abbreviations for large values
                                        const formatPnl = (n: number) => {
                                            const abs = Math.abs(n);
                                            if (abs >= 1000000) return `${(abs / 1000000).toFixed(1)}M`;
                                            if (abs >= 10000) return `${Math.round(abs / 1000)}K`;
                                            if (abs >= 1000) return `${(abs / 1000).toFixed(1)}K`;
                                            return abs.toString();
                                        };

                                        return rows.map((row, idx) => {
                                            const pnl = row.isHard !== undefined
                                                ? calculateCrapsExposure(row.num, gameState.crapsPoint, gameState.crapsBets, row.isHard)
                                                : calculateCrapsExposure(row.num, gameState.crapsPoint, gameState.crapsBets);

                                            const pnlRounded = Math.round(pnl);
                                            const isHighlight = row.num === currentRoll;

                                            return (
                                                <div key={idx} className="flex items-center h-6 text-sm">
                                                    <div className="w-14 flex justify-end items-center pr-2 overflow-hidden">
                                                        {pnlRounded < 0 && (
                                                            <span className="text-action-destructive font-mono text-[10px] whitespace-nowrap">
                                                                -{formatPnl(pnlRounded)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className={`w-9 text-center font-bold flex-shrink-0 ${
                                                        isHighlight ? 'text-yellow-400 bg-yellow-400/20 rounded' :
                                                        row.num === 7 ? 'text-action-destructive' :
                                                        row.isHard === true ? 'text-action-primary' :
                                                        row.isHard === false ? 'text-gray-400' : 'text-white'
                                                    }`}>
                                                        {row.label}
                                                    </div>
                                                    <div className="w-14 flex justify-start items-center pl-2 overflow-hidden">
                                                        {pnlRounded > 0 && (
                                                            <span className="text-action-success font-mono text-[10px] whitespace-nowrap">
                                                                +{formatPnl(pnlRounded)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>

                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Table Bets
                                </div>
                                <div className="flex flex-col space-y-1">
                                    {gameState.crapsBets.length > 0 ? (
                                        gameState.crapsBets.map((b, i) => {
                                            const candidateIdx = gameState.crapsOddsCandidates?.indexOf(i);
                                            const isCandidate = candidateIdx !== undefined && candidateIdx !== -1;
                                            return (
                                                <div key={i} onClick={() => isCandidate ? actions?.addCrapsOdds?.(candidateIdx) : actions?.placeCrapsBet?.(b.type, b.target)} className={`flex justify-between items-center text-xs border p-1 rounded cursor-pointer transition-colors ${isCandidate ? 'border-action-primary bg-action-primary/10' : 'border-gray-800 bg-black/50 hover:bg-gray-800'}`}>
                                                <div className="flex flex-col">
                                                    <span className={`font-bold text-[10px] ${isCandidate ? 'text-action-primary' : 'text-action-success'}`}>
                                                        {isCandidate ? `[${candidateIdx! + 1}] ` : ''}{b.type}{b.target !== undefined ? ` ${b.target}` : ''}
                                                    </span>
                                                    <span className="text-[9px] text-gray-500">{b.status === 'PENDING' ? 'WAIT' : 'ON'}</span>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-white text-[10px]">${b.amount}</div>
                                                    {b.oddsAmount && <div className="text-[9px] text-action-primary">+${b.oddsAmount}</div>}
                                                </div>
                                            </div>
                                            );
                                        })
                                    ) : (
                                        <div className="text-center text-[10px] text-gray-700 italic">NO BETS</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </MobileDrawer>
                </div>

                {/* Mobile Bonus Dashboard */}
                <div className="absolute top-2 right-2 z-40 md:hidden">
                    <MobileDrawer label="BONUS" title="SIDE BETS">
                        <CrapsBonusDashboard
                            bets={gameState.crapsBets}
                            madePointsMask={gameState.crapsMadePointsMask}
                        />
                    </MobileDrawer>
                </div>

                {/* Established Come/Don't Come Bets - Above Point, Horizontally Centered */}
                {establishedComeBets.length > 0 && (
                    <div className="flex items-center justify-center gap-4">
                        {establishedComeBets.map((bet, i) => {
                            const candidateIdx = gameState.crapsOddsCandidates?.indexOf(bet.originalIndex);
                            const isCandidate = candidateIdx !== undefined && candidateIdx !== -1;
                            
                            return (
                            <div key={i} onClick={() => isCandidate ? actions?.addCrapsOdds?.(candidateIdx) : actions?.placeCrapsBet?.(bet.type, bet.target)} className="flex flex-col items-center gap-1 cursor-pointer hover:scale-105 transition-transform">
                                <span className={`text-[10px] uppercase tracking-widest ${isCandidate ? 'text-action-primary font-bold' : (bet.type === 'COME' ? 'text-action-success' : 'text-action-destructive')}`}>
                                    {isCandidate ? `[${candidateIdx! + 1}] ` : ''}{bet.type === 'COME' ? 'COME' : "DON'T"}
                                </span>
                                <div className={`w-12 h-12 border-2 flex items-center justify-center text-lg font-bold rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)] ${
                                    isCandidate ? 'border-action-primary text-action-primary bg-action-primary/10' :
                                    (bet.type === 'COME' ? 'border-action-success text-action-success' : 'border-action-destructive text-action-destructive')
                                }`}>
                                    {bet.target}
                                </div>
                                <span className="text-[9px] text-gray-500">${bet.amount + (bet.oddsAmount || 0)}</span>
                            </div>
                            );
                        })}
                    </div>
                )}

                {/* Point Indicator - Centered */}
                <div className="flex flex-col items-center gap-2">
                    <span className="text-xs uppercase tracking-widest text-gray-500">POINT</span>
                    <div className={`w-16 h-16 md:w-20 md:h-20 border-2 flex items-center justify-center text-xl sm:text-2xl font-bold rounded-full shadow-[0_0_15px_rgba(0,0,0,0.5)] ${gameState.crapsPoint ? pointColor : 'border-gray-700 text-gray-700'}`}>
                        {gameState.crapsPoint || "OFF"}
                    </div>
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className={`text-lg sm:text-2xl font-bold text-action-primary tracking-widest leading-tight transition-opacity duration-200 ${showOutcome ? 'opacity-100' : 'opacity-0'}`}>
                        {/* On mobile, replace "SPACE TO ROLL" with "PLACE BETS" */}
                        <span className="hidden sm:inline">{gameState.message}</span>
                        <span className="sm:hidden">{gameState.message?.replace(/SPACE TO ROLL/gi, 'PLACE BETS')}</span>
                    </div>
                    {gameState.crapsRollHistory.length > 0 && (
                        <div className={`text-[11px] sm:text-[10px] tracking-widest mt-1 flex items-center justify-center gap-1 transition-opacity duration-200 ${showOutcome ? 'opacity-100' : 'opacity-0'}`}>
                            <span className="text-gray-400">LAST:</span>
                            {gameState.crapsRollHistory.slice(-10).map((roll, i, arr) => (
                                <span key={i} className={`${i === arr.length - 1 ? 'text-yellow-400 font-bold' : roll === 7 ? 'text-action-destructive' : 'text-gray-400'}`}>
                                    {roll}{i < arr.length - 1 ? ' -' : ''}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Dice Area */}
                <div className="w-full flex items-center justify-center">
                    <DiceThrow2D
                        values={gameState.dice}
                        rollKey={rollKey}
                        label=""
                        className="w-full"
                        maxWidthClassName="max-w-[760px] sm:max-w-[900px] lg:max-w-[1100px]"
                        heightClassName="h-[120px] sm:h-[140px] md:h-[150px]"
                        launchDirection="right"
                        horizontalBoost={22}
                        verticalBoost={9}
                        preventOverlap
                        settleToRow
                        rightWallInset={32}
                        flatOnSettle
                        onSettled={handleDiceSettled}
                    />
                </div>

                {/* Super Mode Info - Animated */}
                {gameState.superMode?.isActive && (
                    <div className="w-full max-w-md mx-auto px-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="relative bg-titanium-900/95 border-2 border-action-primary rounded text-center overflow-hidden
                                        shadow-[0_0_20px_rgba(255,215,0,0.3),inset_0_0_30px_rgba(255,215,0,0.05)]
                                        animate-pulse-glow">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-action-primary/10 to-transparent
                                            animate-shimmer pointer-events-none" />
                            <div className="relative p-3">
                                <div className="text-xs font-bold text-action-primary tracking-[0.3em] mb-2 font-mono flex items-center justify-center gap-2">
                                    <span className="animate-pulse">⚡</span>
                                    <span className="bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-300 bg-clip-text text-transparent">
                                        SUPER MODE ACTIVE
                                    </span>
                                    <span className="animate-pulse">⚡</span>
                                </div>
                                {Array.isArray(gameState.superMode.multipliers) && gameState.superMode.multipliers.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5 justify-center">
                                        {gameState.superMode.multipliers.slice(0, 10).map((m, idx) => (
                                            <span
                                                key={idx}
                                                className="px-2.5 py-1 rounded-lg bg-gradient-to-br from-amber-900/50 to-amber-950/50
                                                           border border-action-primary/60 text-action-primary text-xs font-mono font-bold
                                                           shadow-[0_0_8px_rgba(255,215,0,0.2)] hover:shadow-[0_0_12px_rgba(255,215,0,0.4)]
                                                           transition-all duration-200 hover:scale-105"
                                            >
                                                {m.superType}:{m.id} <span className="text-amber-300">×{m.multiplier}</span>
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-[10px] text-gray-400 font-mono animate-pulse">Loading multipliers...</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Mobile: Core Bets & Active Bets */}
                <div className="w-full mt-4 p-2 border-t border-gray-800 bg-gray-900/20 md:hidden">
                    {/* Core Betting Buttons - Always visible on mobile */}
                    <div className="flex gap-2 mb-3">
                        <button
                            onClick={() => actions?.placeCrapsBet?.(gameState.crapsPoint ? 'COME' : 'PASS')}
                            className={`flex-1 py-3 rounded border text-xs font-bold tracking-wider transition-colors ${
                                betTypes.has('PASS') || betTypes.has('COME')
                                    ? 'border-action-success bg-action-success/20 text-action-success'
                                    : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                            }`}
                        >
                            {gameState.crapsPoint ? 'COME' : 'PASS'}
                        </button>
                        <button
                            onClick={() => actions?.placeCrapsBet?.(gameState.crapsPoint ? 'DONT_COME' : 'DONT_PASS')}
                            className={`flex-1 py-3 rounded border text-xs font-bold tracking-wider transition-colors ${
                                betTypes.has('DONT_PASS') || betTypes.has('DONT_COME')
                                    ? 'border-action-destructive bg-action-destructive/20 text-action-destructive'
                                    : 'border-gray-700 bg-black/50 text-gray-300 hover:bg-gray-800'
                            }`}
                        >
                            {gameState.crapsPoint ? "DON'T" : "DON'T PASS"}
                        </button>
                    </div>

                    {/* Active Bets */}
                    {gameState.crapsBets.length > 0 && (
                        <div className="mb-2">
                            <span className="text-[10px] text-gray-500 tracking-widest uppercase mb-1 block">ACTIVE BETS</span>
                            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                                {gameState.crapsBets.map((b, i) => (
                                    <div key={i} onClick={() => actions?.placeCrapsBet?.(b.type, b.target)} className="flex-none flex flex-col items-center border border-gray-800 bg-black/50 p-1 rounded min-w-[60px] cursor-pointer hover:bg-gray-800 transition-colors">
                                        <span className="text-[9px] text-action-success font-bold">{b.type}</span>
                                        <span className="text-[9px] text-white">${b.amount + (b.oddsAmount || 0)}</span>
                                        {b.target !== undefined && <span className="text-[8px] text-gray-500">{b.target}</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* CONTROLS */}
            <div className="ns-controlbar zen-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 bg-titanium-900/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-16 md:h-20 flex items-center justify-between md:justify-center gap-2 p-2 md:px-4">
                    {/* Bet Menu */}
                    <div className="hidden md:flex items-center gap-2 flex-1">
                        <CrapsBetMenu
                            gameState={gameState}
                            actions={actions}
                            canPlaceBonus={canPlaceBonus}
                            playMode={playMode}
                        />
                        <PanelDrawer label="Table" title="CRAPS TABLE" count={gameState.crapsBets.length} className="hidden md:inline-flex">
                            <div className="space-y-6">
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <button
                                            onClick={() => setLeftSidebarView('EXPOSURE')}
                                            className={`flex-1 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                                leftSidebarView === 'EXPOSURE'
                                                    ? 'text-action-success border border-action-success bg-action-success/10'
                                                    : 'text-titanium-500 border border-titanium-200 hover:text-titanium-800'
                                            }`}
                                        >
                                            Exposure
                                        </button>
                                        <button
                                            onClick={() => setLeftSidebarView('SIDE_BETS')}
                                            className={`flex-1 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                                leftSidebarView === 'SIDE_BETS'
                                                    ? 'text-amber-500 border border-amber-400 bg-amber-400/10'
                                                    : 'text-titanium-500 border border-titanium-200 hover:text-titanium-800'
                                            }`}
                                        >
                                            Bonus
                                        </button>
                                    </div>

                                    {leftSidebarView === 'EXPOSURE' ? (
                                        <div className="max-h-52 overflow-y-auto scrollbar-hide rounded-2xl border border-titanium-200 bg-titanium-50/60 p-2">
                                            {(() => {
                                                const hardwayTargets = [4, 6, 8, 10];
                                                const activeHardways = gameState.crapsBets
                                                    .filter(b => b.type === 'HARDWAY')
                                                    .map(b => b.target!);

                                                const rows: { num: number; label: string; isHard?: boolean }[] = [];

                                                [2,3,4,5,6,7,8,9,10,11,12].forEach(num => {
                                                    if (hardwayTargets.includes(num) && activeHardways.includes(num)) {
                                                        rows.push({ num, label: `${num}H`, isHard: true });
                                                        rows.push({ num, label: `${num}E`, isHard: false });
                                                    } else {
                                                        rows.push({ num, label: num.toString() });
                                                    }
                                                });

                                                const formatPnl = (n: number) => {
                                                    const abs = Math.abs(n);
                                                    if (abs >= 1000000) return `${(abs / 1000000).toFixed(1)}M`;
                                                    if (abs >= 10000) return `${Math.round(abs / 1000)}K`;
                                                    if (abs >= 1000) return `${(abs / 1000).toFixed(1)}K`;
                                                    return abs.toString();
                                                };

                                                return rows.map((row, idx) => {
                                                    const pnl = row.isHard !== undefined
                                                        ? calculateCrapsExposure(row.num, gameState.crapsPoint, gameState.crapsBets, row.isHard)
                                                        : calculateCrapsExposure(row.num, gameState.crapsPoint, gameState.crapsBets);

                                                    const pnlRounded = Math.round(pnl);
                                                    const isHighlight = row.num === currentRoll;

                                                    return (
                                                        <div key={idx} className="flex items-center h-7 text-base">
                                                            <div className="w-20 flex justify-end items-center pr-2 overflow-hidden">
                                                                {pnlRounded < 0 && (
                                                                    <span className="text-action-destructive font-mono text-sm whitespace-nowrap">
                                                                        -{formatPnl(pnlRounded)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className={`w-10 text-center font-bold relative flex-shrink-0 ${
                                                                isHighlight ? 'text-yellow-400 bg-yellow-400/20 rounded' :
                                                                row.num === 7 ? 'text-action-destructive' :
                                                                row.isHard === true ? 'text-action-primary' :
                                                                row.isHard === false ? 'text-titanium-500' : 'text-titanium-900'
                                                            }`}>
                                                                {row.label}
                                                            </div>
                                                            <div className="w-20 flex justify-start items-center pl-2 overflow-hidden">
                                                                {pnlRounded > 0 && (
                                                                    <span className="text-action-success font-mono text-sm whitespace-nowrap">
                                                                        +{formatPnl(pnlRounded)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                    ) : (
                                        <CrapsBonusDashboard
                                            bets={gameState.crapsBets}
                                            madePointsMask={gameState.crapsMadePointsMask}
                                            compact={true}
                                        />
                                    )}
                                </div>

                                <div>
                                    <Label size="micro" className="mb-2 block">Table Bets</Label>
                                    <div className="space-y-2">
                                        {(() => {
                                            const confirmedBets = gameState.crapsBets.filter(b => b.local !== true);
                                            const pendingBets = gameState.crapsBets.filter(b => b.local === true);

                                            const renderBet = (b: typeof gameState.crapsBets[0], i: number, isPending: boolean) => {
                                                const globalIdx = gameState.crapsBets.indexOf(b);
                                                const candidateIdx = gameState.crapsOddsCandidates?.indexOf(globalIdx);
                                                const isCandidate = candidateIdx !== undefined && candidateIdx !== -1;

                                                return (
                                                    <div
                                                        key={i}
                                                        onClick={() => isCandidate ? actions?.addCrapsOdds?.(candidateIdx) : actions?.placeCrapsBet?.(b.type, b.target)}
                                                        className={`flex justify-between items-center text-xs border p-2 rounded cursor-pointer transition-colors ${
                                                            isCandidate
                                                                ? 'border-action-primary bg-action-primary/10'
                                                                : isPending
                                                                    ? 'border-amber-400/50 bg-amber-500/10'
                                                                    : 'border-titanium-200 bg-white hover:bg-titanium-50'
                                                        }`}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className={`font-bold text-[10px] ${
                                                                isCandidate ? 'text-action-primary' : isPending ? 'text-amber-500' : 'text-action-success'
                                                            }`}>
                                                                {isCandidate ? `[${candidateIdx! + 1}] ` : ''}{b.type}{b.target !== undefined ? ` ${b.target}` : ''}
                                                            </span>
                                                            <span className="text-[9px] text-titanium-500">{b.status === 'PENDING' ? 'WAIT' : 'ON'}</span>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-titanium-900 text-[10px]">${b.amount + (b.oddsAmount || 0)}</div>
                                                            {b.localOddsAmount && b.localOddsAmount > 0 && (
                                                                <div className="text-[9px] text-amber-500">+${b.localOddsAmount} odds pending</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            };

                                            if (confirmedBets.length === 0 && pendingBets.length === 0) {
                                                return <div className="text-center text-[10px] text-titanium-500 uppercase tracking-widest">No bets</div>;
                                            }

                                            return (
                                                <>
                                                    {confirmedBets.length > 0 && (
                                                        <div className="space-y-1">
                                                            <div className="text-[8px] text-action-success uppercase tracking-widest font-bold">
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
                        </PanelDrawer>
                    </div>

                    {/* Desktop: Bet Selector + ROLL Button - LUX-010 */}
                    <div className="hidden md:flex items-center gap-3">
                        {/* Inline Bet Selector */}
                        {onBetChange && (
                            <InlineBetSelector
                                currentBet={currentBet || 25}
                                balance={balance}
                                onBetChange={onBetChange}
                            />
                        )}

                        {/* ROLL Button */}
                        <button
                            type="button"
                            onClick={actions?.deal}
                            className="ns-control-primary h-14 px-8 rounded border-2 font-bold text-base tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-action-success bg-action-success text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                        >
                            ROLL
                        </button>
                    </div>

                    {/* Mobile: Simplified buttons */}
                    <div className="flex md:hidden items-center gap-2 flex-1">
                        <BetsDrawer title="PLACE BETS">
                            <div className="space-y-4">
                                {/* Normal Bets */}
                                <div className="rounded border border-gray-800 bg-black/40 p-2 space-y-2">
                                    <div className="text-[10px] text-green-500 font-bold tracking-widest border-b border-gray-800 pb-1">NORMAL BETS</div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        <button onClick={() => actions?.placeCrapsBet?.(gameState.crapsPoint ? 'COME' : 'PASS')} className={`py-3 rounded border text-xs font-bold ${betTypes.has('PASS') || betTypes.has('COME') ? 'border-green-400 bg-green-500/20 text-green-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            {gameState.crapsPoint ? 'COME' : 'PASS'}
                                        </button>
                                        <button onClick={() => actions?.placeCrapsBet?.(gameState.crapsPoint ? 'DONT_COME' : 'DONT_PASS')} className={`py-3 rounded border text-xs font-bold ${betTypes.has('DONT_PASS') || betTypes.has('DONT_COME') ? 'border-green-400 bg-green-500/20 text-green-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
                                            {gameState.crapsPoint ? "DON'T" : "D.PASS"}
                                        </button>
                                        <button onClick={() => actions?.placeCrapsBet?.('FIELD')} className={`py-3 rounded border text-xs font-bold ${betTypes.has('FIELD') ? 'border-green-400 bg-green-500/20 text-green-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>FIELD</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'HARDWAY' }))} className={`py-3 rounded border text-xs font-bold ${betTypes.has('HARDWAY') ? 'border-green-400 bg-green-500/20 text-green-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>HARD</button>
                                        <button onClick={() => actions?.addCrapsOdds?.()} className="py-3 rounded border text-xs font-bold border-gray-700 bg-gray-900 text-gray-400">ODDS</button>
                                    </div>
                                </div>

                                {/* Modern Bets */}
                                <div className="rounded border border-gray-800 bg-black/40 p-2 space-y-2">
                                    <div className="text-[10px] text-cyan-500 font-bold tracking-widest border-b border-gray-800 pb-1">MODERN BETS</div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'YES' }))} className={`py-3 rounded border text-xs font-bold ${betTypes.has('YES') ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>YES</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'NO' }))} className={`py-3 rounded border text-xs font-bold ${betTypes.has('NO') ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>NO</button>
                                        <button onClick={() => actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'NEXT' }))} className={`py-3 rounded border text-xs font-bold ${betTypes.has('NEXT') ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>NEXT</button>
                                    </div>
                                </div>

                                {/* Bonus Bets */}
                                {(canPlaceBonus || Object.values(bonusBetsPlaced).some(v => v)) && (
                                    <div className="rounded border border-gray-800 bg-black/40 p-2 space-y-2">
                                        <div className="text-[10px] text-amber-500 font-bold tracking-widest border-b border-gray-800 pb-1">BONUS BETS</div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                            {[
                                                { key: 'FIRE', label: 'FIRE', placed: bonusBetsPlaced.fire },
                                                { key: 'ATS_SMALL', label: 'ATS-S', placed: bonusBetsPlaced.atsSmall },
                                                { key: 'ATS_TALL', label: 'ATS-T', placed: bonusBetsPlaced.atsTall },
                                                { key: 'ATS_ALL', label: 'ATS-A', placed: bonusBetsPlaced.atsAll },
                                                { key: 'MUGGSY', label: 'MUGGSY', placed: bonusBetsPlaced.muggsy },
                                                { key: 'DIFF_DOUBLES', label: 'DBLS', placed: bonusBetsPlaced.diffDoubles },
                                                { key: 'RIDE_LINE', label: 'RIDE', placed: bonusBetsPlaced.rideLine },
                                                { key: 'REPLAY', label: 'REPLAY', placed: bonusBetsPlaced.replay },
                                                { key: 'HOT_ROLLER', label: 'HOT', placed: bonusBetsPlaced.hotRoller },
                                            ].map(bet => (
                                                <button
                                                    key={bet.key}
                                                    onClick={() => actions?.placeCrapsBet?.(bet.key)}
                                                    disabled={!canPlaceBonus && !bet.placed}
                                                    className={`py-3 rounded border text-xs font-bold transition-all ${
                                                        bet.placed
                                                            ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                                            : !canPlaceBonus
                                                                ? 'border-gray-800 bg-gray-900/50 text-gray-700 cursor-not-allowed'
                                                                : 'border-gray-700 bg-gray-900 text-gray-400'
                                                    }`}
                                                >
                                                    {bet.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="rounded border border-gray-800 bg-black/40 p-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={actions?.undoCrapsBet} className="flex-1 py-3 rounded border border-gray-700 bg-gray-900 text-gray-400 text-xs font-bold">UNDO</button>
                                        <button onClick={actions?.toggleSuper} className={`flex-1 py-3 rounded border text-xs font-bold ${gameState.activeModifiers.super ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>SUPER</button>
                                    </div>
                                </div>
                            </div>
                        </BetsDrawer>
                    </div>

                    {/* Mobile ROLL Button */}
                    <button
                        type="button"
                        onClick={actions?.deal}
                        className="ns-control-primary md:hidden h-12 px-6 rounded border-2 font-bold text-sm tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-action-success bg-action-success text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                    >
                        ROLL
                    </button>
                </div>
            </div>

            {/* MODAL */}
            {gameState.crapsInputMode !== 'NONE' && (
                     <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeInput}>
                         <div className="bg-titanium-900 border border-action-success p-4 sm:p-6 rounded-lg shadow-xl flex flex-col items-center gap-4 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                             <div className="text-sm tracking-widest text-gray-400 uppercase">SELECT {gameState.crapsInputMode} NUMBER</div>
                             <div className="grid grid-cols-4 gap-3">
                                 {(() => {
                                     let numbersToRender: { num: number, label: string, payout?: string }[] = [];
                                     
                                     // Helper for payout text
                                     const getProfit = (type: string, n: number) => {
                                         if (type === 'NEXT') {
                                             if (n === 2 || n === 12) return "35x";
                                             if (n === 3 || n === 11) return "17x";
                                             if (n === 4 || n === 10) return "11x";
                                             if (n === 5 || n === 9) return "8x";
                                             if (n === 6 || n === 8) return "6.2x";
                                             if (n === 7) return "5x";
                                         } else if (type === 'YES') {
                                             if (n === 2 || n === 12) return "6x";
                                             if (n === 3 || n === 11) return "3x";
                                             if (n === 4 || n === 10) return "2x";
                                             if (n === 5 || n === 9) return "1.5x";
                                             if (n === 6 || n === 8) return "1.2x";
                                         } else if (type === 'NO') {
                                             if (n === 2 || n === 12) return "1/6";
                                             if (n === 3 || n === 11) return "1/3";
                                             if (n === 4 || n === 10) return "0.5x";
                                             if (n === 5 || n === 9) return "0.7x";
                                             if (n === 6 || n === 8) return "0.8x";
                                         }
                                         return "";
                                     };
                                    
                                     if (gameState.crapsInputMode === 'YES' || gameState.crapsInputMode === 'NO') {
                                         // All totals 2-12 except 7
                                         [2,3,4,5,6,8,9,10,11,12].forEach(n => {
                                            numbersToRender.push({ num: n, label: n === 10 ? '0' : n === 11 ? '-' : n === 12 ? '=' : n.toString(), payout: getProfit(gameState.crapsInputMode, n) });
                                         });
                                     } else if (gameState.crapsInputMode === 'NEXT') {
                                         [2,3,4,5,6,7,8,9,10,11,12].forEach(n => {
                                             numbersToRender.push({ num: n, label: n === 10 ? '0' : n === 11 ? '-' : n === 12 ? '=' : n.toString(), payout: getProfit('NEXT', n) });
                                         });
                                     } else if (gameState.crapsInputMode === 'HARDWAY') {
                                         numbersToRender = [4,6,8,10].map(n => ({ num: n, label: n === 10 ? '0' : n.toString(), payout: (n===4||n===10) ? '7x' : '9x' }));
                                     }
                                     
                                     return numbersToRender.map(item => {
                                         if (item.num === 7) {
                                             return (
                                                <button
                                                    key={item.num}
                                                    type="button"
                                                    onClick={() => actions?.placeCrapsNumberBet?.(gameState.crapsInputMode, item.num)}
                                                    className="flex flex-col items-center gap-1"
                                                >
                                                    <div className="w-12 h-12 flex items-center justify-center border border-action-destructive rounded bg-gray-900 text-action-destructive font-bold text-lg relative">
                                                        7
                                                        <span className="absolute bottom-0.5 text-[8px] text-action-primary">{item.payout}</span>
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 bg-gray-800 px-1 rounded uppercase">
                                                        KEY 7
                                                    </div>
                                                </button>
                                             );
                                         }

                                         return (
                                            <button
                                                key={item.num}
                                                type="button"
                                                onClick={() => actions?.placeCrapsNumberBet?.(gameState.crapsInputMode, item.num)}
                                                className="flex flex-col items-center gap-1"
                                            >
                                                <div className="w-12 h-12 flex items-center justify-center border border-gray-700 rounded bg-gray-900 text-white font-bold text-lg relative">
                                                    {item.num}
                                                    {item.payout && <span className="absolute bottom-0.5 text-[8px] text-action-primary">({item.payout})</span>}
                                                </div>
                                                <div className="text-[10px] text-gray-500 bg-gray-800 px-1 rounded uppercase">
                                                    KEY {item.label}
                                                </div>
                                            </button>
                                         );
                                     });
                                 })()}
                             </div>
                             <div className="text-xs text-gray-500 mt-2 text-center">Tap outside to cancel. Keyboard: [ESC] CANCEL</div>
                         </div>
                     </div>
                )}
        </>
    );
});
