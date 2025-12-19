
import React, { useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';

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

    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-4 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20 md:px-40">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">ULTIMATE TEXAS HOLD'EM</h1>
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title="ULTIMATE TEXAS HOLD'EM">
                        <div className="space-y-3">
                            <div className="border border-gray-800 rounded bg-black/40 p-2">
                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 text-center">
                                    Blind Bonus
                                </div>
                                <div className="space-y-2 text-[10px]">
                                    <div className="flex justify-between"><span className="text-gray-400">Royal Flush</span><span className="text-terminal-gold">500:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Straight Flush</span><span className="text-terminal-gold">50:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Four of Kind</span><span className="text-terminal-gold">10:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Full House</span><span className="text-terminal-gold">3:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Flush</span><span className="text-terminal-gold">3:2</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Straight</span><span className="text-terminal-gold">1:1</span></div>
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
                                        <div className="text-terminal-green mb-1">PRE-FLOP</div>
                                        <div>• Check OR</div>
                                        <div>• Bet 3x/4x Ante</div>
                                    </div>
                                    <div className="border-b border-gray-800 pb-2">
                                        <div className="text-terminal-green mb-1">FLOP</div>
                                        <div>• Check OR</div>
                                        <div>• Bet 2x Ante</div>
                                    </div>
                                    <div>
                                        <div className="text-terminal-green mb-1">RIVER</div>
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
                            <span className="text-lg font-bold tracking-widest text-terminal-accent">DEALER</span>
                            <Hand
                                cards={gameState.dealerCards}
                                forcedColor="text-terminal-accent"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-bold tracking-widest text-terminal-accent">DEALER</span>
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                                {[0, 1].map(i => (
                                    <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-terminal-accent/50 rounded" />
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
                                <span className="text-terminal-gold">{stageDesc}</span>
                            </>
                        ) : null}
                        <span className="text-gray-700">•</span>
                        <span className="text-gray-500">TOTAL</span>
                        <span className="text-terminal-gold">${baseTotalBet.toLocaleString()}</span>
                    </div>
                    <div className="text-lg sm:text-xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
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
                            gameState.uthProgressiveBet > 0 ? 'border-terminal-green/40 text-terminal-gold' : 'border-gray-800 text-gray-600'
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
                            <span className="text-lg font-bold tracking-widest text-terminal-green">YOU</span>
                            <Hand
                                cards={gameState.playerCards}
                                forcedColor="text-terminal-green"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 scale-110">
                            <span className="text-lg font-bold tracking-widest text-terminal-green">YOU</span>
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                                {[0, 1].map(i => (
                                    <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-terminal-green/50 rounded" />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Blind Payouts Sidebar */}
            <div className="hidden md:flex absolute top-0 left-0 bottom-24 w-36 bg-terminal-black/80 border-r-2 border-gray-700 p-2 overflow-y-auto backdrop-blur-sm z-30 flex-col">
                <h3 className="text-[10px] font-bold text-gray-500 mb-2 tracking-widest text-center border-b border-gray-800 pb-1 flex-none">BLIND BONUS</h3>
                <div className="flex-1 flex flex-col justify-center space-y-2 text-[10px]">
                    <div className="flex justify-between"><span className="text-gray-400">Royal Flush</span><span className="text-terminal-gold">500:1</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Straight Flush</span><span className="text-terminal-gold">50:1</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Four of Kind</span><span className="text-terminal-gold">10:1</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Full House</span><span className="text-terminal-gold">3:1</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Flush</span><span className="text-terminal-gold">3:2</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Straight</span><span className="text-terminal-gold">1:1</span></div>
                    <div className="border-t border-gray-800 pt-2 mt-2">
                        <div className="text-[9px] text-gray-500 italic">Dealer must have pair or better to qualify</div>
                    </div>
                </div>
            </div>

            {/* Betting Guide Sidebar */}
            <div className="hidden md:flex absolute top-0 right-0 bottom-24 w-36 bg-terminal-black/80 border-l-2 border-gray-700 p-2 backdrop-blur-sm z-30 flex-col">
                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 flex-none text-center">Betting</div>
                <div className="flex-1 overflow-y-auto flex flex-col justify-center space-y-2 text-[9px] text-gray-400">
                    <div className="border-b border-gray-800 pb-2">
                        <div className="text-terminal-green mb-1">PRE-FLOP</div>
                        <div>• Check OR</div>
                        <div>• Bet 3x/4x Ante</div>
                    </div>
                    <div className="border-b border-gray-800 pb-2">
                        <div className="text-terminal-green mb-1">FLOP</div>
                        <div>• Check OR</div>
                        <div>• Bet 2x Ante</div>
                    </div>
                    <div>
                        <div className="text-terminal-green mb-1">RIVER</div>
                        <div>• Fold OR</div>
                        <div>• Bet 1x Ante</div>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <GameControlBar
                primaryAction={
                    gameState.stage === 'BETTING'
                        ? { label: 'DEAL', onClick: actions?.deal, className: 'w-full sm:w-auto' }
                        : gameState.stage === 'RESULT'
                            ? { label: 'NEW HAND', onClick: actions?.deal, className: 'w-full sm:w-auto' }
                            : gameState.message.includes('REVEAL')
                                ? { label: 'REVEAL', onClick: actions?.deal, className: 'w-full sm:w-auto' }
                                : gameState.communityCards.length === 5
                                    ? { label: 'BET 1X', onClick: () => actions?.uhBet?.(1), className: 'border-terminal-gold bg-terminal-gold text-black hover:bg-white' }
                                    : { label: 'CHECK', onClick: actions?.uhCheck }
                }
                secondaryActions={
                    gameState.stage === 'BETTING'
                        ? [
                            {
                                label: `TRIPS${(gameState.uthTripsBet || 0) > 0 ? ` $${gameState.uthTripsBet}` : ''}`,
                                onClick: actions?.uthToggleTrips,
                                active: (gameState.uthTripsBet || 0) > 0,
                            },
                            {
                                label: `6-CARD${(gameState.uthSixCardBonusBet || 0) > 0 ? ` $${gameState.uthSixCardBonusBet}` : ''}`,
                                onClick: actions?.uthToggleSixCardBonus,
                                active: (gameState.uthSixCardBonusBet || 0) > 0,
                            },
                            {
                                label: `PROG${(gameState.uthProgressiveBet || 0) > 0 ? ` $${gameState.uthProgressiveBet}` : ''}`,
                                onClick: actions?.uthToggleProgressive,
                                active: (gameState.uthProgressiveBet || 0) > 0,
                            },
                            ...(playMode !== 'CASH' ? [
                            {
                                label: 'SHIELD',
                                onClick: actions?.toggleShield,
                                active: gameState.activeModifiers.shield,
                            },
                            {
                                label: 'DOUBLE',
                                onClick: actions?.toggleDouble,
                                active: gameState.activeModifiers.double,
                            },
                            ] : []),
                            {
                                label: 'SUPER',
                                onClick: actions?.toggleSuper,
                                active: gameState.activeModifiers.super,
                            },
                        ]
                        : gameState.communityCards.length === 0
                            ? [
                                { label: 'BET 4X', onClick: () => actions?.uhBet?.(4), className: 'text-terminal-gold border-terminal-gold' },
                                { label: 'BET 3X', onClick: () => actions?.uhBet?.(3), className: 'text-terminal-gold border-terminal-gold' },
                            ]
                            : gameState.communityCards.length === 3
                                ? [
                                    { label: 'BET 2X', onClick: () => actions?.uhBet?.(2), className: 'text-terminal-gold border-terminal-gold' },
                                ]
                                : gameState.communityCards.length === 5 && !gameState.message.includes('REVEAL')
                                    ? [
                                        { label: 'FOLD', onClick: actions?.uhFold, className: 'text-terminal-accent border-terminal-accent' },
                                    ]
                                    : []
                }
            />
        </>
    );
});
