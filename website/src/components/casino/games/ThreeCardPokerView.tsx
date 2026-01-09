
import React, { useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { BetsDrawer } from '../BetsDrawer';
import { SideBetsDrawer } from '../SideBetsDrawer';
import { PanelDrawer } from '../PanelDrawer';
import { Label } from '../ui/Label';

interface ThreeCardPokerViewProps {
    gameState: GameState;
    actions: any;
}

const BONUS_BETS = [
    { key: 'P', action: 'PAIR_PLUS', label: 'PAIR+' },
    { key: '6', action: 'SIX_CARD', label: '6-CARD' },
    { key: 'J', action: 'PROGRESSIVE', label: 'PROG' },
];

export const ThreeCardPokerView = React.memo<ThreeCardPokerViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, actions, lastWin, playMode }) => {
    const playerRank = useMemo(() => gameState.threeCardPlayerRank ?? '', [gameState.threeCardPlayerRank]);
    const dealerRank = useMemo(() => gameState.threeCardDealerRank ?? '', [gameState.threeCardDealerRank]);
    const dealerQualifies = useMemo(
        () => gameState.threeCardDealerQualifies === true,
        [gameState.threeCardDealerQualifies]
    );

    const totalBet = useMemo(
        () =>
            (gameState.bet || 0) +
            (gameState.threeCardPairPlusBet || 0) +
            (gameState.threeCardSixCardBonusBet || 0) +
            (gameState.threeCardProgressiveBet || 0),
        [
            gameState.bet,
            gameState.threeCardPairPlusBet,
            gameState.threeCardSixCardBonusBet,
            gameState.threeCardProgressiveBet,
        ]
    );

    const isBonusActive = (action: string) => {
        if (action === 'PAIR_PLUS') return (gameState.threeCardPairPlusBet || 0) > 0;
        if (action === 'SIX_CARD') return (gameState.threeCardSixCardBonusBet || 0) > 0;
        if (action === 'PROGRESSIVE') return (gameState.threeCardProgressiveBet || 0) > 0;
        return false;
    };

    const handleBonusSelect = (action: string) => {
        if (action === 'PAIR_PLUS') actions?.threeCardTogglePairPlus?.();
        if (action === 'SIX_CARD') actions?.threeCardToggleSixCardBonus?.();
        if (action === 'PROGRESSIVE') actions?.threeCardToggleProgressive?.();
    };
    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-4 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20 md:px-24 lg:px-40">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">THREE CARD POKER</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="THREE CARD POKER">
                        <div className="space-y-3">
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Pair Plus
                                </div>
                                <div className="space-y-2 text-[10px]">
                                    <div className="flex justify-between"><span className="text-gray-400">Straight Flush</span><span className="text-mono-0 dark:text-mono-1000">40:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Three of Kind</span><span className="text-mono-0 dark:text-mono-1000">30:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Straight</span><span className="text-mono-0 dark:text-mono-1000">6:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Flush</span><span className="text-mono-0 dark:text-mono-1000">3:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Pair</span><span className="text-mono-0 dark:text-mono-1000">1:1</span></div>
                                </div>
                            </div>
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Rules
                                </div>
                                <div className="space-y-2 text-[10px] text-gray-400">
                                    <div>• Dealer qualifies with Queen-high or better</div>
                                    <div>• If dealer doesn't qualify: Ante pays 1:1, Play pushes</div>
                                    <div>• If dealer qualifies and you win: Ante and Play pay 1:1</div>
                                    <div>• Pair Plus pays regardless of dealer hand</div>
                                </div>
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Dealer Area */}
                <div className="min-h-[96px] sm:min-h-[120px] flex items-center justify-center opacity-75">
                    {gameState.dealerCards.length > 0 ? (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-bold tracking-widest text-mono-400 dark:text-mono-500">DEALER</span>
                            <Hand
                                cards={gameState.dealerCards}
                                title={dealerRank ? `(${dealerRank})` : ''}
                                forcedColor="text-mono-400 dark:text-mono-500"
                            />
                            {dealerRank && (
                                <span className="text-xs text-gray-500 mt-1">
                                    {gameState.dealerCards.every(c => c && !c.isHidden) ?
                                        (dealerQualifies ? 'QUALIFIES' : 'DOES NOT QUALIFY') : ''}
                                </span>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-bold tracking-widest text-mono-400 dark:text-mono-500">DEALER</span>
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                                {[0, 1, 2].map(i => (
                                    <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-mono-400/50 rounded" />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded border bg-black/40 text-[10px] tracking-widest uppercase border-gray-800 text-gray-400">
                        <span className="text-gray-500">{gameState.stage}</span>
                        <span className="text-gray-700">•</span>
                        <span className="text-gray-500">TOTAL</span>
                        <span className="text-mono-0 dark:text-mono-1000">${totalBet.toLocaleString()}</span>
                    </div>
                    <div className="text-base sm:text-lg font-semibold text-mono-0 dark:text-mono-1000 tracking-widest leading-tight animate-pulse zen-hide">
                        {gameState.message}
                    </div>
                    <div className="text-sm text-gray-500 flex flex-col items-center gap-1">
                        <span>ANTE: ${gameState.bet.toLocaleString()}</span>
                        {gameState.threeCardPairPlusBet > 0 && (
                            <span>PAIR+: ${gameState.threeCardPairPlusBet.toLocaleString()}</span>
                        )}
                        {gameState.threeCardSixCardBonusBet > 0 && (
                            <span>6-CARD: ${gameState.threeCardSixCardBonusBet.toLocaleString()}</span>
                        )}
                        {gameState.threeCardProgressiveBet > 0 && (
                            <span>PROG: ${gameState.threeCardProgressiveBet.toLocaleString()}</span>
                        )}
                        <div
                            className={`mt-1 inline-flex items-center gap-2 px-3 py-1 rounded border bg-black/40 text-[10px] tracking-widest ${
                                gameState.threeCardProgressiveBet > 0 ? 'border-mono-0/40 text-mono-0 dark:text-mono-1000' : 'border-gray-800 text-gray-600'
                            }`}
                        >
                            <span>PROG JACKPOT</span>
                            <span key={gameState.threeCardProgressiveJackpot} className="font-bold tabular-nums">
                                ${gameState.threeCardProgressiveJackpot.toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Player Area */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
                    {gameState.playerCards.length > 0 ? (
                        <div className="flex flex-col items-center gap-2 scale-110">
                            <span className="text-lg font-bold tracking-widest text-mono-0 dark:text-mono-1000 font-bold">YOU</span>
                            <Hand
                                cards={gameState.playerCards}
                                title={playerRank ? `(${playerRank})` : ''}
                                forcedColor="text-mono-0 dark:text-mono-1000 font-bold"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 scale-110">
                            <span className="text-lg font-bold tracking-widest text-mono-0 dark:text-mono-1000 font-bold">YOU</span>
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                                {[0, 1, 2].map(i => (
                                    <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-mono-0/50 rounded" />
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
                                    <span className="text-[10px] text-mono-0 dark:text-mono-1000 font-bold font-bold tracking-widest uppercase font-mono">NORMAL:</span>
                                    <div className="h-6 w-px bg-gray-700" />
                                    <span className="text-xs text-gray-500 font-mono">Ante + Play</span>
                                </div>

                                {/* Spacer */}
                                <div className="h-8 w-px bg-gray-700" />

                                <SideBetsDrawer
                                    title="THREE CARD SIDE BETS"
                                    label="Side Bets"
                                    count={BONUS_BETS.filter((bet) => isBonusActive(bet.action)).length}
                                    shortcutHint="P/6/J"
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
                                                            ? 'border-mono-0/60 bg-mono-0/10 text-mono-0 dark:text-mono-1000'
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

                                <PanelDrawer label="Guide" title="THREE CARD GUIDE" className="hidden md:inline-flex">
                                    <div className="space-y-6">
                                        <div>
                                            <Label size="micro" className="mb-2 block">Pair Plus</Label>
                                            <div className="space-y-2 text-[10px]">
                                                <div className="flex justify-between"><span className="text-titanium-600">Straight Flush</span><span className="text-mono-0 dark:text-mono-1000">40:1</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Three of Kind</span><span className="text-mono-0 dark:text-mono-1000">30:1</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Straight</span><span className="text-mono-0 dark:text-mono-1000">6:1</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Flush</span><span className="text-mono-0 dark:text-mono-1000">3:1</span></div>
                                                <div className="flex justify-between"><span className="text-titanium-600">Pair</span><span className="text-mono-0 dark:text-mono-1000">1:1</span></div>
                                            </div>
                                        </div>
                                        <div>
                                            <Label size="micro" className="mb-2 block">Rules</Label>
                                            <div className="space-y-2 text-[10px] text-titanium-500">
                                                <div>• Dealer qualifies with Queen-high or better</div>
                                                <div>• If dealer doesn't qualify: Ante pays 1:1, Play pushes</div>
                                                <div>• If dealer qualifies and you win: Ante and Play pay 1:1</div>
                                                <div>• Pair Plus pays regardless of dealer hand</div>
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
                        ) : gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL') ? (
                            <button
                                onClick={actions?.threeCardFold}
                                className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-mono-400 text-mono-400 dark:text-mono-500 hover:bg-mono-400/10"
                            >
                                FOLD
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
                                        : actions?.threeCardPlay
                            }
                            className={`ns-control-primary h-14 px-8 rounded border-2 font-bold text-base font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL')
                                    ? 'border-mono-0 bg-mono-0 text-black hover:bg-white hover:border-white'
                                    : 'border-mono-0 bg-mono-0 text-black hover:bg-white hover:border-white'
                            } hover:scale-105 active:scale-95`}
                        >
                            {gameState.stage === 'BETTING'
                                ? 'DEAL'
                                : gameState.stage === 'RESULT'
                                    ? 'NEW HAND'
                                    : gameState.message.includes('REVEAL')
                                        ? 'REVEAL'
                                        : 'PLAY'}
                        </button>
                    </div>

                    {/* Mobile: Simplified controls */}
                    <div className="flex md:hidden flex-col gap-2">
                        <div className="flex items-center gap-2">
                            {gameState.stage === 'BETTING' && (
                                <>
                                    <SideBetsDrawer
                                        title="THREE CARD SIDE BETS"
                                        label="Side Bets"
                                        count={BONUS_BETS.filter((bet) => isBonusActive(bet.action)).length}
                                        shortcutHint="P/6/J"
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
                                            : actions?.threeCardPlay
                                }
                                className="ns-control-primary flex-1 h-12 px-6 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-mono-0 bg-mono-0 text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
                            >
                                {gameState.stage === 'BETTING'
                                    ? 'DEAL'
                                    : gameState.stage === 'RESULT'
                                        ? 'NEW HAND'
                                        : gameState.message.includes('REVEAL')
                                            ? 'REVEAL'
                                            : 'PLAY'}
                            </button>
                        </div>

                        {/* Fold button when playing */}
                        {gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL') && (
                            <button
                                onClick={actions?.threeCardFold}
                                className="w-full py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-mono-400 text-mono-400 dark:text-mono-500 hover:bg-mono-400/10"
                            >
                                FOLD
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
});
