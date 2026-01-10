import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GameState } from '../../../types';
import { CRAPS_MAX_BETS } from '../../../utils/gameUtils';

interface CrapsBetMenuProps {
    gameState: GameState;
    actions: any;
    canPlaceBonus: boolean;
    playMode?: 'CASH' | 'FREEROLL' | null;
}

type BetGroup = 'NONE' | 'NORMAL' | 'MODERN' | 'BONUS';

// Bet definitions with shortcuts
const NORMAL_BETS = [
    { key: 'p', action: 'PASS', label: 'PASS', altLabel: 'COME' },
    { key: 'd', action: 'DONT_PASS', label: "D.PASS", altLabel: "DON'T" },
    { key: 'f', action: 'FIELD', label: 'FIELD' },
    { key: 'h', action: 'HARDWAY', label: 'HARD' },
    { key: 'o', action: 'ODDS', label: 'ODDS' },
];

const MODERN_BETS = [
    { key: 'y', action: 'YES', label: 'YES' },
    { key: 'n', action: 'NO', label: 'NO' },
    { key: 'x', action: 'NEXT', label: 'NEXT' },
];

const BONUS_BETS = [
    { key: '0', action: 'ALL_BONUS', label: '$$$$$' },
    { key: '1', action: 'FIRE', label: 'FIRE' },
    { key: '2', action: 'ATS_SMALL', label: 'SMALL' },
    { key: '3', action: 'ATS_TALL', label: 'TALL' },
    { key: '4', action: 'ATS_ALL', label: 'ALL' },
    { key: '5', action: 'MUGGSY', label: 'MUGGSY' },
    { key: '6', action: 'DIFF_DOUBLES', label: 'DOUBLES' },
    { key: '7', action: 'RIDE_LINE', label: 'RIDE' },
    { key: '8', action: 'REPLAY', label: 'REPLAY' },
    { key: '9', action: 'HOT_ROLLER', label: 'HOT' },
];

export const CrapsBetMenu: React.FC<CrapsBetMenuProps> = ({
    gameState,
    actions,
    canPlaceBonus,
    playMode,
}) => {
    const [activeGroup, setActiveGroup] = useState<BetGroup>('NONE');
    const [showShortcutHint, setShowShortcutHint] = useState(false);

    const betTypes = useMemo(() => new Set(gameState.crapsBets.map(b => b.type)), [gameState.crapsBets]);

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

    const anyBonusPlaced = useMemo(() =>
        Object.values(bonusBetsPlaced).some(v => v),
        [bonusBetsPlaced]
    );

    // Check if a bonus bet is placed by action name
    const isBonusPlaced = useCallback((action: string) => {
        if (action === 'ALL_BONUS') {
            // ALL_BONUS is "placed" if all individual bonuses are placed
            return Object.values(bonusBetsPlaced).every(v => v);
        }
        const map: Record<string, keyof typeof bonusBetsPlaced> = {
            'FIRE': 'fire',
            'ATS_SMALL': 'atsSmall',
            'ATS_TALL': 'atsTall',
            'ATS_ALL': 'atsAll',
            'MUGGSY': 'muggsy',
            'DIFF_DOUBLES': 'diffDoubles',
            'RIDE_LINE': 'rideLine',
            'REPLAY': 'replay',
            'HOT_ROLLER': 'hotRoller',
        };
        return bonusBetsPlaced[map[action]] || false;
    }, [bonusBetsPlaced]);

    // Execute bet action
    const executeBetAction = useCallback((action: string) => {
        switch (action) {
            case 'PASS':
                actions?.placeCrapsBet?.(gameState.crapsPoint ? 'COME' : 'PASS');
                break;
            case 'DONT_PASS':
                actions?.placeCrapsBet?.(gameState.crapsPoint ? 'DONT_COME' : 'DONT_PASS');
                break;
            case 'FIELD':
                actions?.placeCrapsBet?.('FIELD');
                break;
            case 'HARDWAY':
                actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'HARDWAY' }));
                break;
            case 'ODDS':
                actions?.addCrapsOdds?.();
                break;
            case 'YES':
                actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'YES' }));
                break;
            case 'NO':
                actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'NO' }));
                break;
            case 'NEXT':
                actions?.setGameState?.((prev: any) => ({ ...prev, crapsInputMode: 'NEXT' }));
                break;
            case 'ALL_BONUS':
                // Place all bonus bets at once using a single state update to avoid race conditions
                if (canPlaceBonus) {
                    const bonusTypes = ['FIRE', 'ATS_SMALL', 'ATS_TALL', 'ATS_ALL', 'MUGGSY', 'DIFF_DOUBLES', 'RIDE_LINE', 'REPLAY', 'HOT_ROLLER'] as const;
                    actions?.setGameState?.((prev: any) => {
                        const existingTypes = new Set(prev.crapsBets.map((b: any) => b.type));
                        const newBets = bonusTypes
                            .filter(t => !existingTypes.has(t))
                            .map(type => ({
                                type,
                                target: undefined,
                                amount: prev.bet,
                                oddsAmount: 0,
                                status: 'PENDING' as const,
                                local: true,
                            }));
                        if (prev.crapsBets.length + newBets.length > CRAPS_MAX_BETS) {
                            return { ...prev, message: `BET LIMIT ${CRAPS_MAX_BETS}` };
                        }
                        const totalCost = newBets.reduce((sum, b) => sum + b.amount, 0);
                        return {
                            ...prev,
                            crapsBets: [...prev.crapsBets, ...newBets],
                            crapsUndoStack: [...prev.crapsUndoStack, prev.crapsBets],
                            sessionWager: prev.sessionWager + totalCost,
                            message: `PLACED ${newBets.length} BONUS BETS`,
                        };
                    });
                }
                break;
            case 'FIRE':
            case 'ATS_SMALL':
            case 'ATS_TALL':
            case 'ATS_ALL':
            case 'MUGGSY':
            case 'DIFF_DOUBLES':
            case 'RIDE_LINE':
            case 'REPLAY':
            case 'HOT_ROLLER':
                if (canPlaceBonus || isBonusPlaced(action)) {
                    actions?.placeCrapsBet?.(action);
                }
                break;
            case 'UNDO':
                actions?.undoCrapsBet?.();
                break;
            case 'SUPER':
                actions?.toggleSuper?.();
                break;
        }
        setActiveGroup('NONE');
    }, [actions, gameState.crapsPoint, canPlaceBonus, isBonusPlaced]);

    // Keyboard handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            // Ignore modifier keys alone
            if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

            const key = e.key.toLowerCase();

            // ESC closes menu
            if (key === 'escape') {
                setActiveGroup('NONE');
                return;
            }

            // Group toggles with Shift+number keys (avoids conflict with bet amounts)
            if (e.shiftKey) {
                if (key === '1' || key === '!') {
                    setActiveGroup(activeGroup === 'NORMAL' ? 'NONE' : 'NORMAL');
                    e.preventDefault();
                    return;
                }
                if (key === '2' || key === '@') {
                    setActiveGroup(activeGroup === 'MODERN' ? 'NONE' : 'MODERN');
                    e.preventDefault();
                    return;
                }
                if ((key === '3' || key === '#') && (canPlaceBonus || anyBonusPlaced)) {
                    setActiveGroup(activeGroup === 'BONUS' ? 'NONE' : 'BONUS');
                    e.preventDefault();
                    return;
                }
            }

            // Quick actions available anytime (no group needed)
            if (activeGroup === 'NONE') {
                if (key === 'u') {
                    actions?.undoCrapsBet?.();
                    e.preventDefault();
                    return;
                }
                if (key === 's') {
                    actions?.toggleSuper?.();
                    e.preventDefault();
                    return;
                }
                return;
            }

            // When a group is open, single keys trigger bets
            if (activeGroup === 'NORMAL') {
                const bet = NORMAL_BETS.find(b => b.key === key);
                if (bet) {
                    executeBetAction(bet.action);
                    e.preventDefault();
                    return;
                }
            }

            if (activeGroup === 'MODERN') {
                const bet = MODERN_BETS.find(b => b.key === key);
                if (bet) {
                    executeBetAction(bet.action);
                    e.preventDefault();
                    return;
                }
            }

            if (activeGroup === 'BONUS') {
                const bet = BONUS_BETS.find(b => b.key === key);
                if (bet) {
                    if (canPlaceBonus || isBonusPlaced(bet.action)) {
                        executeBetAction(bet.action);
                    }
                    e.preventDefault();
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeGroup, canPlaceBonus, anyBonusPlaced, executeBetAction, isBonusPlaced, actions]);

    // Get bet state
    const getBetState = useCallback((action: string) => {
        if (action === 'PASS') return betTypes.has('PASS') || betTypes.has('COME');
        if (action === 'DONT_PASS') return betTypes.has('DONT_PASS') || betTypes.has('DONT_COME');
        if (action === 'HARDWAY') return gameState.crapsInputMode === 'HARDWAY' || betTypes.has('HARDWAY');
        if (action === 'YES') return gameState.crapsInputMode === 'YES' || betTypes.has('YES');
        if (action === 'NO') return gameState.crapsInputMode === 'NO' || betTypes.has('NO');
        if (action === 'NEXT') return gameState.crapsInputMode === 'NEXT' || betTypes.has('NEXT');
        return betTypes.has(action as any);
    }, [betTypes, gameState.crapsInputMode]);

    // Render bet button
    const BetButton: React.FC<{
        bet: { key: string; action: string; label: string; altLabel?: string };
        disabled?: boolean;
        color?: 'green' | 'cyan' | 'amber';
    }> = ({ bet, disabled, color = 'green' }) => {
        const isActive = getBetState(bet.action);
        const displayLabel = bet.altLabel && gameState.crapsPoint ? bet.altLabel : bet.label;

        const colors = {
            green: {
                active: 'border-green-400 bg-green-500/20 text-green-300 shadow-[0_0_12px_rgba(74,222,128,0.3)]',
                inactive: 'border-ns-border/70 bg-white/35 dark:bg-black/50 text-ns hover:border-green-600 hover:text-green-400 hover:bg-green-900/20',
                key: 'text-green-500',
            },
            cyan: {
                active: 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]',
                inactive: 'border-ns-border/70 bg-white/35 dark:bg-black/50 text-ns hover:border-cyan-600 hover:text-cyan-400 hover:bg-cyan-900/20',
                key: 'text-cyan-500',
            },
            amber: {
                active: 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.3)]',
                inactive: 'border-ns-border/70 bg-white/35 dark:bg-black/50 text-ns hover:border-amber-600 hover:text-amber-400 hover:bg-amber-900/20',
                key: 'text-amber-500',
            },
        };

        return (
            <button
                type="button"
                onClick={() => !disabled && executeBetAction(bet.action)}
                disabled={disabled}
                className={`
                    relative flex flex-col items-center justify-center
                    h-14 px-3 min-w-[60px]
                    border rounded transition-all duration-150
                    font-mono text-xs tracking-wider
                    ${isActive
                        ? colors[color].active
                        : disabled
                            ? 'border-ns-border/60 bg-black/50 text-ns-muted cursor-not-allowed'
                            : colors[color].inactive
                    }
                `}
            >
                <span className="font-bold">{displayLabel}</span>
                <span className={`text-[9px] mt-0.5 ${isActive ? colors[color].key : 'text-ns-muted'}`}>
                    [{bet.key.toUpperCase()}]
                </span>
            </button>
        );
    };

    return (
        <div className="flex items-center gap-2">
            {/* NORMAL Group [1] */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setActiveGroup(activeGroup === 'NORMAL' ? 'NONE' : 'NORMAL')}
                    className={`
                        h-12 px-4 border rounded font-mono text-sm font-bold tracking-wider transition-all
                        ${activeGroup === 'NORMAL'
                            ? 'border-green-400 bg-green-500/20 text-green-300 shadow-[0_0_15px_rgba(74,222,128,0.3)]'
                            : 'border-ns-border/70 bg-white/40 dark:bg-black/50 text-ns-muted hover:border-green-600 hover:text-green-400'
                        }
                    `}
                >
                    NORMAL
                    <span className="ml-1 text-[10px] text-ns-muted">[⇧1]</span>
                </button>

                {activeGroup === 'NORMAL' && (
                    <div className="absolute bottom-full left-0 mb-2 flex gap-1 p-2 bg-black/95 border border-green-900/50 rounded-lg backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-150 z-50">
                        {NORMAL_BETS.map(bet => (
                            <BetButton key={bet.key} bet={bet} color="green" />
                        ))}
                    </div>
                )}
            </div>

            {/* MODERN Group [2] */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setActiveGroup(activeGroup === 'MODERN' ? 'NONE' : 'MODERN')}
                    className={`
                        h-12 px-4 border rounded font-mono text-sm font-bold tracking-wider transition-all
                        ${activeGroup === 'MODERN'
                            ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                            : 'border-ns-border/70 bg-white/40 dark:bg-black/50 text-ns-muted hover:border-cyan-600 hover:text-cyan-400'
                        }
                    `}
                >
                    MODERN
                    <span className="ml-1 text-[10px] text-ns-muted">[⇧2]</span>
                </button>

                {activeGroup === 'MODERN' && (
                    <div className="absolute bottom-full left-0 mb-2 flex gap-1 p-2 bg-black/95 border border-cyan-900/50 rounded-lg backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-150 z-50">
                        {MODERN_BETS.map(bet => (
                            <BetButton key={bet.key} bet={bet} color="cyan" />
                        ))}
                    </div>
                )}
            </div>

            {/* BONUS Group [3] - Hidden when can't place and none placed */}
            {(canPlaceBonus || anyBonusPlaced) && (
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setActiveGroup(activeGroup === 'BONUS' ? 'NONE' : 'BONUS')}
                        className={`
                            h-12 px-4 border rounded font-mono text-sm font-bold tracking-wider transition-all
                            ${activeGroup === 'BONUS'
                                ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                                : anyBonusPlaced
                                    ? 'border-amber-600/50 bg-amber-900/20 text-amber-400 hover:border-amber-500 animate-pulse'
                                    : 'border-ns-border/70 bg-white/40 dark:bg-black/50 text-ns-muted hover:border-amber-600 hover:text-amber-400'
                            }
                        `}
                    >
                        BONUS
                        <span className="ml-1 text-[10px] text-ns-muted">[⇧3]</span>
                        {anyBonusPlaced && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                        )}
                    </button>

                    {activeGroup === 'BONUS' && (
                        <div className="absolute bottom-full left-0 mb-2 flex gap-1 p-2 bg-black/95 border border-amber-900/50 rounded-lg backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-150 z-50">
                            {BONUS_BETS.map(bet => (
                                <BetButton
                                    key={bet.action}
                                    bet={bet}
                                    color="amber"
                                    disabled={!canPlaceBonus && !isBonusPlaced(bet.action)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Divider */}
            <div className="h-8 w-px bg-ns-border/60 mx-1" />

            {/* Quick Actions */}
            <button
                type="button"
                onClick={() => actions?.undoCrapsBet?.()}
                className="h-12 px-3 border border-ns-border/70 bg-white/40 dark:bg-black/50 text-ns-muted rounded font-mono text-sm hover:border-red-600 hover:text-red-400 transition-all"
            >
                UNDO
                <span className="ml-1 text-[10px] text-ns-muted">[U]</span>
            </button>

            <button
                type="button"
                onClick={() => actions?.toggleSuper?.()}
                className={`
                    h-12 px-3 border rounded font-mono text-sm transition-all
                    ${gameState.activeModifiers.super
                        ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300 shadow-[0_0_15px_rgba(250,204,21,0.4)] animate-pulse'
                        : 'border-ns-border/70 bg-white/40 dark:bg-black/50 text-ns-muted hover:border-yellow-600 hover:text-yellow-400'
                    }
                `}
            >
                SUPER
                <span className="ml-1 text-[10px] text-ns-muted">[S]</span>
            </button>

            {/* Keyboard hint toggle */}
            <button
                type="button"
                onClick={() => setShowShortcutHint(!showShortcutHint)}
                className="h-12 w-12 border border-ns-border/60 bg-white/30 dark:bg-black/50 text-ns-muted rounded font-mono text-lg hover:text-green-500 hover:border-green-800 transition-all"
                title="Keyboard shortcuts"
            >
                ?
            </button>

            {/* Shortcut hint modal */}
            {showShortcutHint && (
                <div
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                    onClick={() => setShowShortcutHint(false)}
                >
                    <div
                        className="bg-white/40 dark:bg-black/50 border border-green-900/50 rounded-lg p-6 max-w-lg w-full font-mono text-sm"
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 className="text-green-400 font-bold tracking-widest mb-4 text-center">KEYBOARD SHORTCUTS</h3>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <div className="text-green-500 font-bold mb-2 border-b border-green-900/50 pb-1">NORMAL [⇧1]</div>
                                <div className="space-y-1 text-ns-muted">
                                    {NORMAL_BETS.map(bet => (
                                        <div key={bet.key}>
                                            <span className="text-green-400">{bet.key.toUpperCase()}</span> {bet.label}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="text-cyan-500 font-bold mb-2 border-b border-cyan-900/50 pb-1">MODERN [⇧2]</div>
                                <div className="space-y-1 text-ns-muted">
                                    {MODERN_BETS.map(bet => (
                                        <div key={bet.key}>
                                            <span className="text-cyan-400">{bet.key.toUpperCase()}</span> {bet.label}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="text-amber-500 font-bold mb-2 border-b border-amber-900/50 pb-1">BONUS [⇧3]</div>
                                <div className="space-y-1 text-ns-muted text-xs">
                                    {BONUS_BETS.map(bet => (
                                        <div key={bet.action}>
                                            <span className="text-amber-400">{bet.key.toUpperCase()}</span> {bet.label}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-ns-border/60">
                            <div className="text-center text-ns-muted">
                                <span className="text-ns-muted">U</span> Undo •
                                <span className="text-ns-muted ml-2">S</span> Super •
                                <span className="text-ns-muted ml-2">C</span> Chips •
                                <span className="text-ns-muted ml-2">ESC</span> Close
                            </div>
                            <div className="text-center text-ns-muted text-xs mt-2">
                                <span className="text-ns-muted">1-8</span> Select chip value
                            </div>
                        </div>

                        <button
                            onClick={() => setShowShortcutHint(false)}
                            className="mt-4 w-full py-2 border border-green-900/50 rounded text-green-500 hover:bg-green-900/20 transition-all"
                        >
                            CLOSE [ESC]
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CrapsBetMenu;
