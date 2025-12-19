import React, { useMemo } from 'react';
import { CrapsBet } from '../../../types';

interface CrapsBonusDashboardProps {
    bets: CrapsBet[];
    madePointsMask: number;
    className?: string;
    compact?: boolean;
}

// Payout tables
const FIRE_PAYOUTS: Record<number, number> = { 4: 24, 5: 249, 6: 999 };
const DIFF_DOUBLES_PAYOUTS: Record<number, number> = { 3: 4, 4: 8, 5: 15, 6: 100 };
const RIDE_LINE_PAYOUTS: Record<number, number> = { 3: 2, 4: 3, 5: 5, 6: 8, 7: 12, 8: 18, 9: 25, 10: 40, 11: 100 };
const HOT_ROLLER_PAYOUTS: Record<number, number> = { 2: 5, 3: 10, 4: 20, 5: 50, 6: 200 };

// VU Meter component - vertical LED bar
const VUMeter: React.FC<{
    value: number;
    max: number;
    label?: string;
    showValue?: boolean;
    size?: 'sm' | 'md' | 'lg';
    orientation?: 'horizontal' | 'vertical';
}> = ({ value, max, label, showValue = true, size = 'md', orientation = 'horizontal' }) => {
    const percentage = Math.min(100, (value / max) * 100);
    const isHot = percentage >= 66;
    const isWarm = percentage >= 33;

    const segments = orientation === 'vertical' ? 8 : 12;
    const filledSegments = Math.ceil((value / max) * segments);

    const heights = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };
    const widths = { sm: 'w-1', md: 'w-1.5', lg: 'w-2' };

    if (orientation === 'vertical') {
        return (
            <div className="flex flex-col items-center gap-1">
                {label && <span className="text-[8px] text-gray-400 uppercase tracking-wider">{label}</span>}
                <div className="flex flex-col-reverse gap-0.5">
                    {Array.from({ length: segments }).map((_, i) => {
                        const isActive = i < filledSegments;
                        const segmentPercentage = (i / segments) * 100;
                        return (
                            <div
                                key={i}
                                className={`
                                    ${widths[size]} h-2 rounded-sm transition-all duration-150
                                    ${isActive
                                        ? segmentPercentage >= 75
                                            ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                                            : segmentPercentage >= 50
                                                ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24]'
                                                : 'bg-green-400 shadow-[0_0_4px_#4ade80]'
                                        : 'bg-gray-800'
                                    }
                                `}
                            />
                        );
                    })}
                </div>
                {showValue && <span className="text-[10px] font-mono text-gray-400">{value}</span>}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1 w-full">
            {label && (
                <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</span>
                    {showValue && (
                        <span className={`text-[10px] font-mono font-bold ${isHot ? 'text-amber-400' : 'text-gray-400'}`}>
                            {value}/{max}
                        </span>
                    )}
                </div>
            )}
            <div className="flex gap-0.5">
                {Array.from({ length: segments }).map((_, i) => {
                    const isActive = i < filledSegments;
                    const segmentPercentage = (i / segments) * 100;
                    return (
                        <div
                            key={i}
                            className={`
                                flex-1 ${heights[size]} rounded-sm transition-all duration-150
                                ${isActive
                                    ? segmentPercentage >= 75
                                        ? 'bg-red-500 shadow-[0_0_6px_#ef4444]'
                                        : segmentPercentage >= 50
                                            ? 'bg-amber-400 shadow-[0_0_4px_#fbbf24]'
                                            : 'bg-green-400 shadow-[0_0_3px_#4ade80]'
                                    : 'bg-gray-800/50'
                                }
                            `}
                        />
                    );
                })}
            </div>
        </div>
    );
};

// LED Segment display for numbers
const LEDSegment: React.FC<{
    value: number | string;
    active: boolean;
    hot?: boolean;
    size?: 'sm' | 'md' | 'lg';
}> = ({ value, active, hot = false, size = 'md' }) => {
    const sizes = {
        sm: 'w-5 h-5 text-[10px]',
        md: 'w-7 h-7 text-xs',
        lg: 'w-9 h-9 text-sm',
    };

    return (
        <div
            className={`
                ${sizes[size]} flex items-center justify-center
                font-mono font-bold rounded
                border transition-all duration-300
                ${active
                    ? hot
                        ? 'bg-amber-500/30 border-amber-400 text-amber-300 shadow-[0_0_12px_#fbbf24,inset_0_0_8px_#fbbf24] animate-pulse'
                        : 'bg-green-500/20 border-green-400 text-green-300 shadow-[0_0_8px_#4ade80,inset_0_0_4px_#4ade80]'
                    : 'bg-gray-900/80 border-gray-800 text-gray-500'
                }
            `}
        >
            {value}
        </div>
    );
};

// Compact bet card header
const BetHeader: React.FC<{
    title: string;
    amount: number;
    progress?: string;
    isHot?: boolean;
    payout?: number;
}> = ({ title, amount, progress, isHot, payout }) => (
    <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
            <span className={`
                font-mono text-[10px] font-bold tracking-wider uppercase
                ${isHot ? 'text-amber-400' : 'text-green-500'}
            `}>
                {isHot && '>>> '}{title}{isHot && ' <<<'}
            </span>
            {progress && (
                <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-gray-900 text-gray-300 border border-gray-700">
                    {progress}
                </span>
            )}
        </div>
        <div className="flex items-center gap-2">
            {payout !== undefined && payout > 0 && (
                <span className="font-mono text-[10px] text-amber-400 animate-pulse">
                    WIN ${(amount * (payout + 1)).toLocaleString()}
                </span>
            )}
            <span className="font-mono text-[10px] text-gray-300">${amount}</span>
        </div>
    </div>
);

// Fire Bet Section
const FireBetSection: React.FC<{ bet: CrapsBet; madePointsMask: number }> = ({ bet, madePointsMask }) => {
    const points = [4, 5, 6, 8, 9, 10];
    const madeCount = points.filter((_, i) => (madePointsMask >> i) & 1).length;
    const isHot = madeCount >= 4;
    const currentPayout = FIRE_PAYOUTS[madeCount] || 0;

    return (
        <div className={`p-3 rounded-lg border ${isHot ? 'border-amber-500/50 bg-amber-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
            <BetHeader
                title="FIRE"
                amount={bet.amount}
                progress={`${madeCount}/6`}
                isHot={isHot}
                payout={currentPayout}
            />

            <div className="flex items-center justify-center gap-1 mb-2">
                {points.map((point, i) => (
                    <LEDSegment
                        key={point}
                        value={point}
                        active={(madePointsMask >> i) & 1 ? true : false}
                        hot={isHot}
                        size="md"
                    />
                ))}
            </div>

            <VUMeter value={madeCount} max={6} size="md" showValue={false} />

            <div className="flex items-center justify-center gap-2 mt-2">
                {[4, 5, 6].map(tier => (
                    <div
                        key={tier}
                        className={`
                            font-mono text-[9px] px-2 py-0.5 rounded border
                            ${madeCount === tier
                                ? 'bg-amber-500/30 border-amber-400 text-amber-300 animate-pulse'
                                : madeCount === tier - 1
                                    ? 'bg-green-900/30 border-green-600/50 text-green-400'
                                    : 'bg-gray-900 border-gray-800 text-gray-500'
                            }
                        `}
                    >
                        {tier}PT={FIRE_PAYOUTS[tier]}x
                    </div>
                ))}
            </div>
        </div>
    );
};

// ATS Section
const ATSSection: React.FC<{ bets: CrapsBet[] }> = ({ bets }) => {
    const smallBet = bets.find(b => b.type === 'ATS_SMALL');
    const tallBet = bets.find(b => b.type === 'ATS_TALL');
    const allBet = bets.find(b => b.type === 'ATS_ALL');

    const getHits = (mask: number, isSmall: boolean) => {
        let count = 0;
        const bits = isSmall ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
        bits.forEach(bit => { if ((mask >> bit) & 1) count++; });
        return count;
    };

    const ATSRow: React.FC<{
        label: string;
        bet: CrapsBet | undefined;
        nums: number[];
        isSmall: boolean;
    }> = ({ label, bet, nums, isSmall }) => {
        if (!bet) return null;
        const mask = bet.progressMask || 0;
        const hits = getHits(mask, isSmall);
        const isHot = hits >= 4;

        return (
            <div className={`p-2 rounded border ${isHot ? 'border-amber-500/40 bg-amber-950/10' : 'border-gray-800 bg-gray-900/30'}`}>
                <div className="flex items-center justify-between mb-1">
                    <span className={`font-mono text-[9px] font-bold ${isHot ? 'text-amber-400' : 'text-green-500'}`}>{label}</span>
                    <span className="font-mono text-[9px] text-gray-400">${bet.amount}</span>
                </div>
                <div className="flex items-center gap-0.5 mb-1">
                    {nums.map((num, i) => {
                        const bitIndex = isSmall ? i : i + 5;
                        return (
                            <LEDSegment
                                key={num}
                                value={num}
                                active={(mask >> bitIndex) & 1 ? true : false}
                                hot={isHot}
                                size="sm"
                            />
                        );
                    })}
                </div>
                <VUMeter value={hits} max={5} size="sm" showValue={false} />
            </div>
        );
    };

    return (
        <div className="space-y-2">
            <div className="font-mono text-[9px] text-gray-400 uppercase tracking-wider">ALL TALL SMALL</div>
            <div className="grid grid-cols-2 gap-2">
                <ATSRow label="SMALL" bet={smallBet} nums={[2, 3, 4, 5, 6]} isSmall={true} />
                <ATSRow label="TALL" bet={tallBet} nums={[8, 9, 10, 11, 12]} isSmall={false} />
            </div>
            {allBet && (
                <div className={`p-2 rounded border ${allBet ? 'border-gray-800 bg-gray-900/30' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[9px] font-bold text-green-500">ALL</span>
                        <span className="font-mono text-[9px] text-gray-400">${allBet.amount} • 175x</span>
                    </div>
                    <VUMeter
                        value={getHits(allBet.progressMask || 0, true) + getHits(allBet.progressMask || 0, false)}
                        max={10}
                        size="sm"
                    />
                </div>
            )}
        </div>
    );
};

// Different Doubles Section
const DiffDoublesSection: React.FC<{ bet: CrapsBet }> = ({ bet }) => {
    const mask = bet.progressMask || 0;
    const hitCount = [0, 1, 2, 3, 4, 5].filter(i => (mask >> i) & 1).length;
    const isHot = hitCount >= 4;
    const currentPayout = DIFF_DOUBLES_PAYOUTS[hitCount] || 0;

    return (
        <div className={`p-3 rounded-lg border ${isHot ? 'border-amber-500/50 bg-amber-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
            <BetHeader
                title="DOUBLES"
                amount={bet.amount}
                progress={`${hitCount}/6`}
                isHot={isHot}
                payout={currentPayout}
            />

            <div className="flex items-center justify-center gap-1 mb-2">
                {[1, 2, 3, 4, 5, 6].map((d, i) => (
                    <div
                        key={d}
                        className={`
                            flex items-center justify-center px-1.5 py-1 rounded border
                            font-mono text-[10px] transition-all
                            ${(mask >> i) & 1
                                ? isHot
                                    ? 'bg-amber-500/20 border-amber-400/60 text-amber-300 shadow-[0_0_8px_#fbbf24]'
                                    : 'bg-green-500/20 border-green-400/60 text-green-300 shadow-[0_0_6px_#4ade80]'
                                : 'bg-gray-900 border-gray-800 text-gray-700'
                            }
                        `}
                    >
                        {d}-{d}
                    </div>
                ))}
            </div>

            <VUMeter value={hitCount} max={6} size="sm" showValue={false} />
        </div>
    );
};

// Ride the Line Section
const RideLineSection: React.FC<{ bet: CrapsBet }> = ({ bet }) => {
    const wins = bet.progressMask || 0;
    const isHot = wins >= 5;
    const currentPayout = RIDE_LINE_PAYOUTS[wins] || 0;

    return (
        <div className={`p-3 rounded-lg border ${isHot ? 'border-amber-500/50 bg-amber-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
            <BetHeader
                title="RIDE THE LINE"
                amount={bet.amount}
                progress={`${wins} WINS`}
                isHot={isHot}
                payout={currentPayout}
            />

            <VUMeter value={wins} max={11} label="" size="md" />

            <div className="flex items-center justify-center gap-1 mt-2 flex-wrap">
                {[3, 5, 7, 10, 11].map(tier => (
                    <div
                        key={tier}
                        className={`
                            font-mono text-[8px] px-1.5 py-0.5 rounded border
                            ${wins >= tier
                                ? 'bg-green-500/20 border-green-400/50 text-green-300'
                                : wins === tier - 1
                                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse'
                                    : 'bg-gray-900 border-gray-800 text-gray-500'
                            }
                        `}
                    >
                        {tier}W={RIDE_LINE_PAYOUTS[tier]}x
                    </div>
                ))}
            </div>
        </div>
    );
};

// Replay Section
const ReplaySection: React.FC<{ bet: CrapsBet }> = ({ bet }) => {
    const mask = bet.progressMask || 0;
    const points = [4, 5, 6, 8, 9, 10];
    const shifts = [0, 4, 8, 12, 16, 20];
    const counts = points.map((p, i) => ({ point: p, count: (mask >> shifts[i]) & 0xF }));
    const maxCount = Math.max(...counts.map(c => c.count));
    const isHot = maxCount >= 3;

    return (
        <div className={`p-3 rounded-lg border ${isHot ? 'border-amber-500/50 bg-amber-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
            <BetHeader title="REPLAY" amount={bet.amount} progress={`MAX ${maxCount}x`} isHot={isHot} />

            <div className="grid grid-cols-6 gap-1">
                {counts.map(({ point, count }) => (
                    <div key={point} className="flex flex-col items-center gap-1">
                        <VUMeter value={count} max={4} size="sm" showValue={false} orientation="vertical" />
                        <span className={`font-mono text-[9px] ${count >= 3 ? 'text-amber-400' : 'text-gray-400'}`}>{point}</span>
                    </div>
                ))}
            </div>

            <div className="mt-2 text-center font-mono text-[8px] text-gray-400">
                3x = 70-120x • 4x = UP TO 1000x
            </div>
        </div>
    );
};

// Hot Roller Section
const HotRollerSection: React.FC<{ bet: CrapsBet }> = ({ bet }) => {
    const mask = bet.progressMask || 0;
    const pointWays: Record<number, number[]> = {
        4: [0, 1], 5: [2, 3], 6: [4, 5, 6],
        8: [7, 8, 9], 9: [10, 11], 10: [12, 13],
    };

    const pointStatus = Object.entries(pointWays).map(([point, bits]) => {
        const waysHit = bits.filter(b => (mask >> b) & 1).length;
        return { point: Number(point), waysHit, total: bits.length, complete: waysHit === bits.length };
    });

    const completedPoints = pointStatus.filter(p => p.complete).length;
    const isHot = completedPoints >= 2;
    const currentPayout = HOT_ROLLER_PAYOUTS[completedPoints] || 0;

    return (
        <div className={`p-3 rounded-lg border ${isHot ? 'border-amber-500/50 bg-amber-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
            <BetHeader
                title="HOT ROLLER"
                amount={bet.amount}
                progress={`${completedPoints}/6`}
                isHot={isHot}
                payout={currentPayout}
            />

            <div className="grid grid-cols-6 gap-1 mb-2">
                {pointStatus.map(({ point, waysHit, total, complete }) => (
                    <div
                        key={point}
                        className={`
                            flex flex-col items-center p-1 rounded border font-mono text-[9px]
                            ${complete
                                ? 'bg-amber-500/30 border-amber-400 text-amber-300 shadow-[0_0_8px_#fbbf24] animate-pulse'
                                : waysHit > 0
                                    ? 'bg-green-500/10 border-green-600/50 text-green-400'
                                    : 'bg-gray-900 border-gray-800 text-gray-500'
                            }
                        `}
                    >
                        <span className="font-bold">{point}</span>
                        <span className="text-[8px] opacity-70">{waysHit}/{total}</span>
                    </div>
                ))}
            </div>

            <VUMeter value={completedPoints} max={6} size="sm" showValue={false} />
        </div>
    );
};

// Muggsy Section
const MuggsySection: React.FC<{ bet: CrapsBet }> = ({ bet }) => {
    const stage = bet.target || 0;
    const isHot = stage === 1;

    return (
        <div className={`p-3 rounded-lg border ${isHot ? 'border-amber-500/50 bg-amber-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
            <BetHeader title="MUGGSY" amount={bet.amount} isHot={isHot} />

            <div className="flex items-center gap-2">
                <div className={`
                    flex-1 p-2 rounded border text-center font-mono text-[10px]
                    ${stage === 0
                        ? 'bg-green-500/20 border-green-400/50 text-green-300 animate-pulse'
                        : 'bg-gray-900 border-gray-800 text-gray-400'
                    }
                `}>
                    COME-OUT 7<br />
                    <span className="text-[9px] opacity-70">2:1</span>
                </div>
                <div className="text-gray-700">→</div>
                <div className={`
                    flex-1 p-2 rounded border text-center font-mono text-[10px]
                    ${stage === 1
                        ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 animate-pulse shadow-[0_0_10px_#fbbf24]'
                        : 'bg-gray-900 border-gray-800 text-gray-400'
                    }
                `}>
                    POINT-7<br />
                    <span className="text-[9px] opacity-70">3:1</span>
                </div>
            </div>

            {stage === 1 && (
                <div className="mt-2 text-center font-mono text-[10px] text-amber-400 animate-pulse">
                    POINT SET! WAITING FOR 7...
                </div>
            )}
        </div>
    );
};

// Main Dashboard Component
export const CrapsBonusDashboard: React.FC<CrapsBonusDashboardProps> = ({
    bets,
    madePointsMask,
    className = '',
    compact = false,
}) => {
    const sideBets = useMemo(() => ({
        fire: bets.find(b => b.type === 'FIRE'),
        ats: bets.filter(b => ['ATS_SMALL', 'ATS_TALL', 'ATS_ALL'].includes(b.type)),
        muggsy: bets.find(b => b.type === 'MUGGSY'),
        diffDoubles: bets.find(b => b.type === 'DIFF_DOUBLES'),
        rideLine: bets.find(b => b.type === 'RIDE_LINE'),
        replay: bets.find(b => b.type === 'REPLAY'),
        hotRoller: bets.find(b => b.type === 'HOT_ROLLER'),
    }), [bets]);

    const hasSideBets = Object.values(sideBets).some(v =>
        Array.isArray(v) ? v.length > 0 : v !== undefined
    );

    if (!hasSideBets) return null;

    const totalAtRisk = [
        sideBets.fire,
        ...sideBets.ats,
        sideBets.muggsy,
        sideBets.diffDoubles,
        sideBets.rideLine,
        sideBets.replay,
        sideBets.hotRoller,
    ].filter(Boolean).reduce((sum, bet) => sum + (bet?.amount || 0), 0);

    return (
        <div className={`
            relative overflow-hidden rounded-lg border border-gray-800
            bg-gradient-to-b from-gray-950 via-black to-gray-950
            ${className}
        `}>
            {/* Scanline overlay */}
            <div
                className="absolute inset-0 pointer-events-none opacity-[0.02]"
                style={{
                    backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.1) 2px, rgba(0,255,0,0.1) 4px)',
                }}
            />

            {/* Header */}
            <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between">
                <span className="font-mono text-[10px] text-green-500 tracking-widest uppercase">
                    SIDE BETS ACTIVE
                </span>
                <span className="font-mono text-[10px] text-amber-400">
                    ${totalAtRisk.toLocaleString()} AT RISK
                </span>
            </div>

            {/* Content */}
            <div className={`p-3 space-y-3 ${compact ? 'max-h-[50vh] overflow-y-auto' : ''}`}>
                {sideBets.fire && <FireBetSection bet={sideBets.fire} madePointsMask={madePointsMask} />}
                {sideBets.ats.length > 0 && <ATSSection bets={sideBets.ats} />}
                {sideBets.muggsy && <MuggsySection bet={sideBets.muggsy} />}
                {sideBets.diffDoubles && <DiffDoublesSection bet={sideBets.diffDoubles} />}
                {sideBets.rideLine && <RideLineSection bet={sideBets.rideLine} />}
                {sideBets.replay && <ReplaySection bet={sideBets.replay} />}
                {sideBets.hotRoller && <HotRollerSection bet={sideBets.hotRoller} />}
            </div>
        </div>
    );
};

export default CrapsBonusDashboard;
