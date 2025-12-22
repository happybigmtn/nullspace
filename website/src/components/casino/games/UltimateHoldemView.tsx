
import React, { useMemo, useEffect, useState } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { CardAnimationOverlay } from '../3d/CardAnimationOverlay';
import { buildCardsById, buildRowSlots } from '../3d/cardLayouts';
import { deriveSessionRoundId } from '../3d/engine/GuidedRound';

// Simple mobile detection hook
const useIsMobile = () => {
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 640);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);
    return isMobile;
};

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

export const UltimateHoldemView = React.memo<UltimateHoldemViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null; onAnimationBlockingChange?: (blocking: boolean) => void }>(({ gameState, actions, lastWin, playMode, onAnimationBlockingChange }) => {
    const isMobile = useIsMobile();
    const roundId = useMemo(() => {
        if (gameState.sessionId === null || !Number.isFinite(gameState.moveNumber)) return undefined;
        return deriveSessionRoundId(gameState.sessionId, gameState.moveNumber);
    }, [gameState.moveNumber, gameState.sessionId]);
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

    const animationActive = useMemo(
        () => /DEALING|CHECKING|BETTING|REVEALING|WAITING FOR CHAIN/.test(gameState.message),
        [gameState.message]
    );
    const dealerSlots = useMemo(() => buildRowSlots('dealer', 2, -1.6, { mirror: true, spacing: 1.5 }), []);
    const communitySlots = useMemo(() => buildRowSlots('community', 5, 0.1, { spacing: 1.35, fan: 0.05 }), []);
    const bonusSlots = useMemo(() => buildRowSlots('bonus', 4, 0.85, { spacing: 1.2, fan: 0.04 }), []);
    const playerSlots = useMemo(() => buildRowSlots('player', 2, 1.75, { spacing: 1.5 }), []);
    const slots = useMemo(
        () => [...dealerSlots, ...communitySlots, ...bonusSlots, ...playerSlots],
        [dealerSlots, communitySlots, bonusSlots, playerSlots]
    );
    const dealOrder = useMemo(
        () => [
            'player-0',
            'dealer-0',
            'player-1',
            'dealer-1',
            'community-0',
            'community-1',
            'community-2',
            'community-3',
            'community-4',
            'bonus-0',
            'bonus-1',
            'bonus-2',
            'bonus-3',
        ],
        []
    );
    const cardsById = useMemo(() => ({
        ...buildCardsById('player', gameState.playerCards, 2),
        ...buildCardsById('dealer', gameState.dealerCards, 2),
        ...buildCardsById('community', gameState.communityCards, 5),
        ...buildCardsById('bonus', gameState.uthBonusCards, 4),
    }), [gameState.playerCards, gameState.dealerCards, gameState.communityCards, gameState.uthBonusCards]);

    return (
        <>
            <CardAnimationOverlay
                slots={slots}
                dealOrder={dealOrder}
                cardsById={cardsById}
                isActionActive={animationActive}
                storageKey="uth-3d-mode"
                guidedGameType="ultimateHoldem"
                roundId={roundId}
                onAnimationBlockingChange={onAnimationBlockingChange}
                isMobile={isMobile}
            />
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
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 sm:sticky sm:bottom-0 bg-terminal-black/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] sm:pb-0">
                <div className="h-auto sm:h-20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between sm:justify-center gap-2 p-2 sm:px-4">
                    {/* Desktop: Grouped Controls */}
                    <div className="hidden sm:flex items-center gap-4 flex-1">
                        {gameState.stage === 'BETTING' ? (
                            <>
                                {/* NORMAL BETS GROUP */}
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-terminal-green font-bold tracking-widest uppercase font-mono">NORMAL:</span>
                                    <div className="h-6 w-px bg-gray-700" />
                                    <span className="text-xs text-gray-500 font-mono">Ante + Blind</span>
                                </div>

                                {/* Spacer */}
                                <div className="h-8 w-px bg-gray-700" />

                                {/* BONUS BETS GROUP */}
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-terminal-amber font-bold tracking-widest uppercase font-mono">BONUS:</span>
                                    <button
                                        onClick={actions?.uthToggleTrips}
                                        className={`px-3 py-1 rounded border-2 text-xs font-bold font-mono tracking-wider transition-colors ${
                                            (gameState.uthTripsBet || 0) > 0
                                                ? 'border-terminal-amber bg-terminal-amber/20 text-terminal-amber'
                                                : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                        }`}
                                    >
                                        TRIPS{(gameState.uthTripsBet || 0) > 0 ? ` $${gameState.uthTripsBet}` : ''}
                                    </button>
                                    <button
                                        onClick={actions?.uthToggleSixCardBonus}
                                        className={`px-3 py-1 rounded border-2 text-xs font-bold font-mono tracking-wider transition-colors ${
                                            (gameState.uthSixCardBonusBet || 0) > 0
                                                ? 'border-terminal-amber bg-terminal-amber/20 text-terminal-amber'
                                                : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                        }`}
                                    >
                                        6-CARD{(gameState.uthSixCardBonusBet || 0) > 0 ? ` $${gameState.uthSixCardBonusBet}` : ''}
                                    </button>
                                    <button
                                        onClick={actions?.uthToggleProgressive}
                                        className={`px-3 py-1 rounded border-2 text-xs font-bold font-mono tracking-wider transition-colors ${
                                            (gameState.uthProgressiveBet || 0) > 0
                                                ? 'border-terminal-gold bg-terminal-gold/20 text-terminal-gold'
                                                : 'border-gray-700 bg-black/50 text-gray-400 hover:bg-gray-800'
                                        }`}
                                    >
                                        PROG{(gameState.uthProgressiveBet || 0) > 0 ? ` $${gameState.uthProgressiveBet}` : ''}
                                    </button>
                                </div>

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
                                    className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-terminal-gold text-terminal-gold hover:bg-terminal-gold/10"
                                >
                                    BET 4X
                                </button>
                                <button
                                    onClick={() => actions?.uhBet?.(3)}
                                    className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-terminal-gold text-terminal-gold hover:bg-terminal-gold/10"
                                >
                                    BET 3X
                                </button>
                            </>
                        ) : gameState.communityCards.length === 3 ? (
                            <button
                                onClick={() => actions?.uhBet?.(2)}
                                className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-terminal-gold text-terminal-gold hover:bg-terminal-gold/10"
                            >
                                BET 2X
                            </button>
                        ) : gameState.communityCards.length === 5 && !gameState.message.includes('REVEAL') ? (
                            <button
                                onClick={actions?.uhFold}
                                className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-terminal-accent text-terminal-accent hover:bg-terminal-accent/10"
                            >
                                FOLD
                            </button>
                        ) : null}
                    </div>

                    {/* Desktop: Primary Action */}
                    <div className="hidden sm:flex items-center gap-3">
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
                            className={`h-14 px-8 rounded border-2 font-bold text-base font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                gameState.communityCards.length === 5 && gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL')
                                    ? 'border-terminal-gold bg-terminal-gold text-black hover:bg-white hover:border-white'
                                    : 'border-terminal-green bg-terminal-green text-black hover:bg-white hover:border-white'
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

                    {/* Mobile: Simplified controls */}
                    <div className="flex sm:hidden flex-col gap-2">
                        <div className="flex items-center gap-2">
                            {gameState.stage === 'BETTING' && (
                                <MobileDrawer label="BETS" title="PLACE BETS">
                                    <div className="space-y-4">
                                        {/* Bonus Bets */}
                                        <div>
                                            <div className="text-[10px] text-amber-500 font-bold tracking-widest mb-2 border-b border-gray-800 pb-1">BONUS BETS</div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={actions?.uthToggleTrips}
                                                    className={`py-3 rounded border text-xs font-bold ${
                                                        (gameState.uthTripsBet || 0) > 0
                                                            ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                                                    }`}
                                                >
                                                    TRIPS
                                                </button>
                                                <button
                                                    onClick={actions?.uthToggleSixCardBonus}
                                                    className={`py-3 rounded border text-xs font-bold ${
                                                        (gameState.uthSixCardBonusBet || 0) > 0
                                                            ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                                                    }`}
                                                >
                                                    6-CARD
                                                </button>
                                                <button
                                                    onClick={actions?.uthToggleProgressive}
                                                    className={`py-3 rounded border text-xs font-bold ${
                                                        (gameState.uthProgressiveBet || 0) > 0
                                                            ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300'
                                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                                                    }`}
                                                >
                                                    PROG
                                                </button>
                                            </div>
                                        </div>

                                        {/* Modifiers */}
                                        <div>
                                            <div className="text-[10px] text-cyan-500 font-bold tracking-widest mb-2 border-b border-gray-800 pb-1">MODIFIERS</div>
                                            <div className="grid grid-cols-3 gap-2">
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
                                    </div>
                                </MobileDrawer>
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
                                className={`flex-1 h-12 px-6 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                    gameState.communityCards.length === 5 && gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL')
                                        ? 'border-terminal-gold bg-terminal-gold text-black hover:bg-white hover:border-white'
                                        : 'border-terminal-green bg-terminal-green text-black hover:bg-white hover:border-white'
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
                                            className="flex-1 py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-terminal-gold text-terminal-gold hover:bg-terminal-gold/10"
                                        >
                                            BET 4X
                                        </button>
                                        <button
                                            onClick={() => actions?.uhBet?.(3)}
                                            className="flex-1 py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-terminal-gold text-terminal-gold hover:bg-terminal-gold/10"
                                        >
                                            BET 3X
                                        </button>
                                    </>
                                )}
                                {gameState.communityCards.length === 3 && (
                                    <button
                                        onClick={() => actions?.uhBet?.(2)}
                                        className="flex-1 py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-terminal-gold text-terminal-gold hover:bg-terminal-gold/10"
                                    >
                                        BET 2X
                                    </button>
                                )}
                                {gameState.communityCards.length === 5 && (
                                    <button
                                        onClick={actions?.uhFold}
                                        className="flex-1 py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-terminal-accent text-terminal-accent hover:bg-terminal-accent/10"
                                    >
                                        FOLD
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
