
import React, { useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { BetsDrawer } from '../BetsDrawer';
import { SideBetsDrawer } from '../SideBetsDrawer';
import { PanelDrawer } from '../PanelDrawer';
import { Label } from '../ui/Label';

interface UltimateHoldemViewProps {
    gameState: GameState;
    actions: any;
}

// Helper to describe the current betting stage
const getStageDescription = (stage: string, communityCards: number): string => {
    if (stage === 'BETTING') return 'ANTE + BLIND';
    if (communityCards === 0) return 'PRE-FLOP';
    if (communityCards === 3) return 'FLOP';
    if (communityCards === 5) return 'RIVER';
    return '';
};

const BONUS_BETS = [
    { key: 'T', action: 'TRIPS', label: 'TRIPS' },
    { key: '6', action: 'SIX_CARD', label: '6-CARD' },
    { key: 'J', action: 'PROGRESSIVE', label: 'PROG' },
];

export const UltimateHoldemView = React.memo<UltimateHoldemViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, actions, lastWin, playMode }) => {
    const stageDesc = useMemo(() =>
        getStageDescription(gameState.stage, gameState.communityCards.length),
        [gameState.stage, gameState.communityCards.length]
    );

    const baseTotalBet = useMemo(
        () =>
            (gameState.bet || 0) * 2 +
            (gameState.uthTripsBet || 0) +
            (gameState.uthSixCardBonusBet || 0) +
            (gameState.uthProgressiveBet || 0),
        [gameState.bet, gameState.uthTripsBet, gameState.uthSixCardBonusBet, gameState.uthProgressiveBet]
    );

    const showDealerCards = useMemo(() =>
        gameState.stage === 'RESULT' || gameState.dealerCards.every(c => c && !c.isHidden),
        [gameState.stage, gameState.dealerCards]
    );

    const isBonusActive = (action: string) => {
        if (action === 'TRIPS') return (gameState.uthTripsBet || 0) > 0;
        if (action === 'SIX_CARD') return (gameState.uthSixCardBonusBet || 0) > 0;
        if (action === 'PROGRESSIVE') return (gameState.uthProgressiveBet || 0) > 0;
        return false;
    };

    const handleBonusSelect = (action: string) => {
        if (action === 'TRIPS') actions?.uthToggleTrips?.();
        if (action === 'SIX_CARD') actions?.uthToggleSixCardBonus?.();
        if (action === 'PROGRESSIVE') actions?.uthToggleProgressive?.();
    };

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-4 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20 md:px-24 lg:px-40">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">ULTIMATE TEXAS HOLD'EM</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="ULTIMATE TEXAS HOLD'EM">
                        <div className="space-y-3">
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Blind Bonus
                                </div>
                                <div className="space-y-2 text-[10px]">
                                    <div className="flex justify-between"><span className="text-gray-400">Royal Flush</span><span className="text-action-primary">500:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Straight Flush</span><span className="text-action-primary">50:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Four of Kind</span><span className="text-action-primary">10:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Full House</span><span className="text-action-primary">3:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Flush</span><span className="text-action-primary">3:2</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Straight</span><span className="text-action-primary">1:1</span></div>
                                    <div className="border-t border-gray-800 pt-2 mt-2 text-[10px] text-gray-500 italic">
                                        Dealer must have pair+ to qualify
                                    </div>
                                </div>
                            </div>
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Betting Guide
                                </div>
                                <div className="space-y-2 text-[10px] text-gray-400">
                                    <div className="border-b border-gray-800 pb-2">
                                        <div className="text-action-success mb-1">PRE-FLOP</div>
                                        <div>• Check OR</div>
                                        <div>• Bet 3x/4x Ante</div>
                                    </div>
                                    <div className="border-b border-gray-800 pb-2">
                                        <div className="text-action-success mb-1">FLOP</div>
                                        <div>• Check OR</div>
                                        <div>• Bet 2x Ante</div>
                                    </div>
                                    <div>
                                        <div className="text-action-success mb-1">RIVER</div>
                                        <div>• Fold OR</div>
                                        <div>• Bet 1x Ante</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </MobileDrawer>
                </div>

                {/* Dealer Area */}
                <div className="min-h-[88px] sm:min-h-[100px] flex items-center justify-center opacity-75">
                    {gameState.dealerCards.length > 0 ? (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-bold tracking-widest text-action-destructive">DEALER</span>
                            <Hand
                                cards={gameState.dealerCards}
                                forcedColor="text-action-destructive"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-bold tracking-widest text-action-destructive">DEALER</span>
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                                {[0, 1].map(i => (
                                    <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-action-destructive/50 rounded" />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Community Cards */}
                <div className="flex flex-col items-center gap-2">
                    <span className="text-xs uppercase tracking-widest text-gray-500">COMMUNITY</span>
                    <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                        {gameState.communityCards.length > 0 ? (
                            <Hand cards={gameState.communityCards} />
                        ) : (
                            [0, 1, 2, 3, 4].map(i => (
                                <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-gray-700 rounded" />
                            ))
                        )}
                    </div>
                </div>

                {/* 6-Card Bonus Cards */}
                {gameState.uthBonusCards.length > 0 && (
                    <div className="flex flex-col items-center gap-2">
                        <span className="text-xs uppercase tracking-widest text-gray-500">6-CARD BONUS</span>
                        <div className="flex gap-2">
                            <Hand cards={gameState.uthBonusCards} />
                        </div>
                    </div>
                )}

                {/* Center Info */}
                <div className="text-center space-y-2 relative z-20">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded border bg-black/40 text-[10px] tracking-widest uppercase border-gray-800 text-gray-400">
                        <span className="text-gray-500">{gameState.stage}</span>
                        {stageDesc ? (
                            <>
                                <span className="text-gray-700">•</span>
                                <span className="text-action-primary">{stageDesc}</span>
                            </>
                        ) : null}
                        <span className="text-gray-700">•</span>
                        <span className="text-gray-500">TOTAL</span>
                        <span className="text-action-primary">${baseTotalBet.toLocaleString()}</span>
                    </div>
                    <div className="text-base sm:text-lg font-semibold text-action-primary tracking-widest leading-tight animate-pulse zen-hide">
                        {gameState.message}
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1 justify-center">
                        <span>ANTE: ${gameState.bet.toLocaleString()}</span>
                        <span>BLIND: ${gameState.bet.toLocaleString()}</span>
                        {gameState.uthTripsBet > 0 && <span>TRIPS: ${gameState.uthTripsBet.toLocaleString()}</span>}
                        {gameState.uthSixCardBonusBet > 0 && <span>6-CARD: ${gameState.uthSixCardBonusBet.toLocaleString()}</span>}
                        {gameState.uthProgressiveBet > 0 && <span>PROG: ${gameState.uthProgressiveBet.toLocaleString()}</span>}
                    </div>
                    <div
                        className={`inline-flex items-center gap-2 px-3 py-1 rounded border bg-black/40 text-[10px] tracking-widest ${
                            gameState.uthProgressiveBet > 0 ? 'border-action-success/40 text-action-primary' : 'border-gray-800 text-gray-600'
                        }`}
                    >
                        <span>PROG JACKPOT</span>
                        <span key={gameState.uthProgressiveJackpot} className="font-bold tabular-nums">
                            ${gameState.uthProgressiveJackpot.toLocaleString()}
                        </span>
                    </div>
                </div>

                {/* Player Area */}
                <div className="min-h-[88px] sm:min-h-[100px] flex gap-8 items-center justify-center">
                    {gameState.playerCards.length > 0 ? (
                        <div className="flex flex-col items-center gap-2 scale-110">
                            <span className="text-lg font-bold tracking-widest text-action-success">YOU</span>
                            <Hand
                                cards={gameState.playerCards}
                                forcedColor="text-action-success"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 scale-110">
                            <span className="text-lg font-bold tracking-widest text-action-success">YOU</span>
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                                {[0, 1].map(i => (
                                    <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-action-success/50 rounded" />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Guide Drawer */}

            {/* Controls */}
            <div className="ns-controlbar zen-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 bg-titanium-900/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-auto md:h-20 flex flex-col md:flex-row items-stretch md:items-center justify-between md:justify-center gap-2 p-2 md:px-4">
                    {/* Desktop: Grouped Controls */}
                    <div className="hidden md:flex items-center gap-4 flex-1">
                        {gameState.stage === 'BETTING' ? (
                            <>
                                {/* NORMAL BETS GROUP */}
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-action-success font-bold tracking-widest uppercase font-mono">NORMAL:</span>
                                    <div className="h-6 w-px bg-gray-700" />
                                    <span className="text-xs text-gray-500 font-mono">Ante + Blind</span>
                                </div>

                                {/* Spacer */}
                                <div className="h-8 w-px bg-gray-700" />

                                <SideBetsDrawer
                                    title="HOLD'EM SIDE BETS"
                                    label="Side Bets"
                                    count={BONUS_BETS.filter((bet) => isBonusActive(bet.action)).length}
                                    shortcutHint="T/6/J"
                                >
                                    <div className="grid grid-cols-2 gap-2">
                                        {BONUS_BETS.map((bet) => {
                                            const active = isBonusActive(bet.action);
                                            return (
                                                <button
                                                    key={bet.action}
                                                    type="button"
                                                    onClick={() => handleBonusSelect(bet.action)}
                                                    className={`rounded-xl border px-3 py-3 text-xs font-semibold uppercase tracking-widest transition-all ${
                                                        active
                                                            ? 'border-action-primary/60 bg-action-primary/10 text-action-primary'
                                                            : 'border-titanium-200 text-titanium-700 hover:border-titanium-500 dark:border-titanium-800 dark:text-titanium-200'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>{bet.label}</span>
                                                        <span className="text-[10px] font-mono text-titanium-400">[{bet.key}]</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </SideBetsDrawer>

                                <PanelDrawer label="Guide" title="HOLD'EM GUIDE" className="hidden md:inline-flex">
                                    <div className="space-y-6">
                                        <div>
                                            <Label size="micro" className="mb-2 block">Blind Bonus</Label>
                                            <div className="space-y-2 text-[10px]">
                                                <div className="flex justify-between"><span className="text-titanium-600">Royal Flush</span><span className="text-action-primary">500:1</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Straight Flush</span><span className="text-action-primary">50:1</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Four of Kind</span><span className="text-action-primary">10:1</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Full House</span><span className="text-action-primary">3:1</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Flush</span><span className="text-action-primary">3:2</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Straight</span><span className="text-action-primary">1:1</span></div>
                                                <div className="border-t border-titanium-200 pt-2 mt-2 text-[9px] text-titanium-500 italic">
                                                    Dealer must have pair or better to qualify
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <Label size="micro" className="mb-2 block">Betting</Label>
                                            <div className="space-y-2 text-[10px] text-titanium-500">
                                                <div className="border-b border-titanium-200 pb-2">
                                                    <div className="text-action-success mb-1">Pre-flop</div>
                                                    <div>• Check OR</div>
                                                    <div>• Bet 3x/4x Ante</div>
                                                </div>
                                                <div className="border-b border-titanium-200 pb-2">
                                                    <div className="text-action-success mb-1">Flop</div>
                                                    <div>• Check OR</div>
                                                    <div>• Bet 2x Ante</div>
                                                </div>
                                                <div>
                                                    <div className="text-action-success mb-1">River</div>
                                                    <div>• Fold OR</div>
                                                    <div>• Bet 1x Ante</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </PanelDrawer>

                                {/* Spacer */}
                                {(playMode !== 'CASH' || gameState.activeModifiers.super) && <div className="h-8 w-px bg-gray-700" />}

                                {/* MODIFIERS GROUP */}
                                {playMode !== 'CASH' && (
                                    <>
                                        <button
                                            onClick={actions?.toggleShield}
                                            className={`px-3 py-1 rounded border-2 text-xs font-bold font-mono tracking-wider transition-colors ${
                                                gameState.activeModifiers.shield
                                                    ? 'border-blue-400 bg-blue-500/20 text-blue-300'
                                                    : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                            }`}
                                        >
                                            SHIELD
                                        </button>
                                        <button
                                            onClick={actions?.toggleDouble}
                                            className={`px-3 py-1 rounded border-2 text-xs font-bold font-mono tracking-wider transition-colors ${
                                                gameState.activeModifiers.double
                                                    ? 'border-purple-400 bg-purple-500/20 text-purple-300'
                                                    : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                            }`}
                                        >
                                            DOUBLE
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={actions?.toggleSuper}
                                    className={`px-3 py-1 rounded border-2 text-xs font-bold font-mono tracking-wider transition-colors ${
                                        gameState.activeModifiers.super
                                            ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300'
                                            : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                    }`}
                                >
                                    SUPER
                                </button>
                            </>
                        ) : gameState.communityCards.length === 0 ? (
                            <>
                                <button
                                    onClick={() => actions?.uhBet?.(4)}
                                    className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-primary text-action-primary hover:bg-action-primary/10"
                                >
                                    <span className="ns-keycap">4</span> BET 4X
                                </button>
                                <button
                                    onClick={() => actions?.uhBet?.(3)}
                                    className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-primary text-action-primary hover:bg-action-primary/10"
                                >
                                    <span className="ns-keycap">3</span> BET 3X
                                </button>
                            </>
                        ) : gameState.communityCards.length === 3 ? (
                            <button
                                onClick={() => actions?.uhBet?.(2)}
                                className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-primary text-action-primary hover:bg-action-primary/10"
                            >
                                <span className="ns-keycap">2</span> BET 2X
                            </button>
                        ) : gameState.communityCards.length === 5 && !gameState.message.includes('REVEAL') ? (
                            <button
                                onClick={actions?.uhFold}
                                className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-destructive text-action-destructive hover:bg-action-destructive/10"
                            >
                                <span className="ns-keycap">F</span> FOLD
                            </button>
                        ) : null}
                    </div>

                    {/* Desktop: Primary Action */}
                    <div className="hidden md:flex items-center gap-3">
                        <button
                            type="button"
                            onClick={
                                gameState.stage === 'BETTING' || gameState.stage === 'RESULT'
                                    ? actions?.deal
                                    : gameState.message.includes('REVEAL')
                                        ? actions?.deal
                                        : gameState.communityCards.length === 5
                                            ? () => actions?.uhBet?.(1)
                                            : actions?.uhCheck
                            }
                            className={`ns-control-primary h-14 px-8 rounded border-2 font-bold text-base font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                gameState.communityCards.length === 5 && gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL')
                                    ? 'border-action-primary bg-action-primary text-black hover:bg-white hover:border-white'
                                    : 'border-action-success bg-action-success text-black hover:bg-white hover:border-white'
                            } hover:scale-105 active:scale-95`}
                        >
                            {gameState.stage === 'BETTING'
                                ? <><span className="ns-keycap ns-keycap-dark">⎵</span> DEAL</>
                                : gameState.stage === 'RESULT'
                                    ? <><span className="ns-keycap ns-keycap-dark">⎵</span> NEW HAND</>
                                    : gameState.message.includes('REVEAL')
                                        ? <><span className="ns-keycap ns-keycap-dark">⎵</span> REVEAL</>
                                        : gameState.communityCards.length === 5
                                            ? <><span className="ns-keycap ns-keycap-dark">1</span> BET 1X</>
                                            : <><span className="ns-keycap ns-keycap-dark">C</span> CHECK</>}
                        </button>
                    </div>

                    {/* Mobile: Simplified controls */}
                    <div className="flex md:hidden flex-col gap-2">
                        <div className="flex items-center gap-2">
                            {gameState.stage === 'BETTING' && (
                                <>
                                    <SideBetsDrawer
                                        title="HOLD'EM SIDE BETS"
                                        label="Side Bets"
                                        count={BONUS_BETS.filter((bet) => isBonusActive(bet.action)).length}
                                        shortcutHint="T/6/J"
                                    >
                                        <div className="grid grid-cols-2 gap-2">
                                            {BONUS_BETS.map((bet) => {
                                                const active = isBonusActive(bet.action);
                                                return (
                                                    <button
                                                        key={bet.action}
                                                        onClick={() => handleBonusSelect(bet.action)}
                                                        className={`py-3 rounded border text-xs font-bold ${
                                                            active
                                                                ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                                                : 'border-gray-700 bg-gray-900 text-gray-400'
                                                        }`}
                                                    >
                                                        {bet.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </SideBetsDrawer>
                                    <BetsDrawer title="MODIFIERS">
                                        <div className="rounded border border-gray-800 bg-black/40 p-2 space-y-2">
                                            <div className="text-[10px] text-cyan-500 font-bold tracking-widest border-b border-gray-800 pb-1">MODIFIERS</div>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                {playMode !== 'CASH' && (
                                                    <>
                                                        <button
                                                            onClick={actions?.toggleShield}
                                                            className={`py-3 rounded border text-xs font-bold ${
                                                                gameState.activeModifiers.shield
                                                                    ? 'border-blue-400 bg-blue-500/20 text-blue-300'
                                                                    : 'border-gray-700 bg-gray-900 text-gray-400'
                                                            }`}
                                                        >
                                                            SHIELD
                                                        </button>
                                                        <button
                                                            onClick={actions?.toggleDouble}
                                                            className={`py-3 rounded border text-xs font-bold ${
                                                                gameState.activeModifiers.double
                                                                    ? 'border-purple-400 bg-purple-500/20 text-purple-300'
                                                                    : 'border-gray-700 bg-gray-900 text-gray-400'
                                                            }`}
                                                        >
                                                            DOUBLE
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    onClick={actions?.toggleSuper}
                                                    className={`py-3 rounded border text-xs font-bold ${
                                                        gameState.activeModifiers.super
                                                            ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300'
                                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                                                    }`}
                                                >
                                                    SUPER
                                                </button>
                                            </div>
                                        </div>
                                    </BetsDrawer>
                                </>
                            )}

                            {/* Primary Button */}
                            <button
                                type="button"
                                onClick={
                                    gameState.stage === 'BETTING' || gameState.stage === 'RESULT'
                                        ? actions?.deal
                                        : gameState.message.includes('REVEAL')
                                            ? actions?.deal
                                            : gameState.communityCards.length === 5
                                                ? () => actions?.uhBet?.(1)
                                                : actions?.uhCheck
                                }
                                className={`ns-control-primary flex-1 h-12 px-6 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                    gameState.communityCards.length === 5 && gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL')
                                        ? 'border-action-primary bg-action-primary text-black hover:bg-white hover:border-white'
                                        : 'border-action-success bg-action-success text-black hover:bg-white hover:border-white'
                                } hover:scale-105 active:scale-95`}
                            >
                                {gameState.stage === 'BETTING'
                                    ? 'DEAL'
                                    : gameState.stage === 'RESULT'
                                        ? 'NEW HAND'
                                        : gameState.message.includes('REVEAL')
                                            ? 'REVEAL'
                                            : gameState.communityCards.length === 5
                                                ? 'BET 1X'
                                                : 'CHECK'}
                            </button>
                        </div>

                        {/* Additional action buttons during play */}
                        {gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL') && (
                            <div className="flex gap-2">
                                {gameState.communityCards.length === 0 && (
                                    <>
                                        <button
                                            onClick={() => actions?.uhBet?.(4)}
                                            className="flex-1 py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-primary text-action-primary hover:bg-action-primary/10"
                                        >
                                            <span className="ns-keycap">4</span> BET 4X
                                        </button>
                                        <button
                                            onClick={() => actions?.uhBet?.(3)}
                                            className="flex-1 py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-primary text-action-primary hover:bg-action-primary/10"
                                        >
                                            <span className="ns-keycap">3</span> BET 3X
                                        </button>
                                    </>
                                )}
                                {gameState.communityCards.length === 3 && (
                                    <button
                                        onClick={() => actions?.uhBet?.(2)}
                                        className="flex-1 py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-primary text-action-primary hover:bg-action-primary/10"
                                    >
                                        <span className="ns-keycap">2</span> BET 2X
                                    </button>
                                )}
                                {gameState.communityCards.length === 5 && (
                                    <button
                                        onClick={actions?.uhFold}
                                        className="flex-1 py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-destructive text-action-destructive hover:bg-action-destructive/10"
                                    >
                                        <span className="ns-keycap">F</span> FOLD
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
});
