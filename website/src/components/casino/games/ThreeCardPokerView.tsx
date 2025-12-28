
import React, { useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { getVisibleHandValue } from '../../../utils/gameUtils';
import { MobileDrawer } from '../MobileDrawer';
import { SideBetMenu } from './SideBetMenu';

interface ThreeCardPokerViewProps {
    gameState: GameState;
    actions: any;
}

const getHandRankName = (cards: { rank: string; suit: string }[]): string => {
    if (cards.length !== 3) return '';

    const getRankValue = (r: string) => {
        if (r === 'A') return 12;
        if (r === 'K') return 11;
        if (r === 'Q') return 10;
        if (r === 'J') return 9;
        return parseInt(r) - 2;
    };

    const ranks = cards.map(c => getRankValue(c.rank)).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);

    const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
    const isStraight = (ranks[0] - ranks[1] === 1 && ranks[1] - ranks[2] === 1) ||
                       (ranks[0] === 12 && ranks[1] === 1 && ranks[2] === 0);
    const isTrips = ranks[0] === ranks[1] && ranks[1] === ranks[2];
    const isPair = ranks[0] === ranks[1] || ranks[1] === ranks[2] || ranks[0] === ranks[2];

    if (isStraight && isFlush) return 'STRAIGHT FLUSH';
    if (isTrips) return 'THREE OF A KIND';
    if (isStraight) return 'STRAIGHT';
    if (isFlush) return 'FLUSH';
    if (isPair) return 'PAIR';
    return 'HIGH CARD';
};

const BONUS_BETS = [
    { key: 'P', action: 'PAIR_PLUS', label: 'PAIR+' },
    { key: '6', action: 'SIX_CARD', label: '6-CARD' },
    { key: 'J', action: 'PROGRESSIVE', label: 'PROG' },
];

export const ThreeCardPokerView = React.memo<ThreeCardPokerViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, actions, lastWin, playMode }) => {
    const playerRank = useMemo(() =>
        gameState.playerCards.length === 3 ? getHandRankName(gameState.playerCards) : '',
        [gameState.playerCards]
    );

    const dealerRank = useMemo(() =>
        gameState.dealerCards.length === 3 && !gameState.dealerCards.some(c => c && c.isHidden)
            ? getHandRankName(gameState.dealerCards) : '',
        [gameState.dealerCards]
    );

    const dealerQualifies = useMemo(() =>
        gameState.dealerCards.every(c => c && !c.isHidden) &&
        getVisibleHandValue(gameState.dealerCards.slice(0, 1)) >= 10,
        [gameState.dealerCards]
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
                                    <div className="flex justify-between"><span className="text-gray-400">Straight Flush</span><span className="text-action-primary">40:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Three of Kind</span><span className="text-action-primary">30:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Straight</span><span className="text-action-primary">6:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Flush</span><span className="text-action-primary">3:1</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Pair</span><span className="text-action-primary">1:1</span></div>
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
                            <span className="text-lg font-bold tracking-widest text-action-destructive">DEALER</span>
                            <Hand
                                cards={gameState.dealerCards}
                                title={dealerRank ? `(${dealerRank})` : ''}
                                forcedColor="text-action-destructive"
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
                            <span className="text-lg font-bold tracking-widest text-action-destructive">DEALER</span>
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                                {[0, 1, 2].map(i => (
                                    <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-action-destructive/50 rounded" />
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
                        <span className="text-action-primary">${totalBet.toLocaleString()}</span>
                    </div>
                    <div className="text-lg sm:text-2xl font-bold text-action-primary tracking-widest leading-tight animate-pulse">
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
                                gameState.threeCardProgressiveBet > 0 ? 'border-action-success/40 text-action-primary' : 'border-gray-800 text-gray-600'
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
                            <span className="text-lg font-bold tracking-widest text-action-success">YOU</span>
                            <Hand
                                cards={gameState.playerCards}
                                title={playerRank ? `(${playerRank})` : ''}
                                forcedColor="text-action-success"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 scale-110">
                            <span className="text-lg font-bold tracking-widest text-action-success">YOU</span>
                            <div className="flex gap-1 sm:gap-1.5 md:gap-2">
                                {[0, 1, 2].map(i => (
                                    <div key={i} className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed border-action-success/50 rounded" />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Pair Plus Info Sidebar */}
            <div className="hidden lg:flex absolute top-0 left-0 bottom-24 w-36 bg-titanium-900/80 border-r-2 border-gray-700 p-2 overflow-y-auto backdrop-blur-sm z-30 flex-col">
                <h3 className="text-[10px] font-bold text-gray-500 mb-2 tracking-widest text-center border-b border-gray-800 pb-1 flex-none">PAIR PLUS</h3>
                <div className="flex-1 flex flex-col justify-center space-y-2 text-[10px]">
                    <div className="flex justify-between"><span className="text-gray-400">Straight Flush</span><span className="text-action-primary">40:1</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Three of Kind</span><span className="text-action-primary">30:1</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Straight</span><span className="text-action-primary">6:1</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Flush</span><span className="text-action-primary">3:1</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Pair</span><span className="text-action-primary">1:1</span></div>
                </div>
            </div>

            {/* Game Rules Sidebar */}
            <div className="hidden lg:flex absolute top-0 right-0 bottom-24 w-36 bg-titanium-900/80 border-l-2 border-gray-700 p-2 backdrop-blur-sm z-30 flex-col">
                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 flex-none text-center">Rules</div>
                <div className="flex-1 overflow-y-auto flex flex-col justify-center space-y-2 text-[9px] text-gray-400">
                    <div>• Dealer qualifies with Queen-high or better</div>
                    <div>• If dealer doesn't qualify: Ante pays 1:1, Play pushes</div>
                    <div>• If dealer qualifies and you win: Ante and Play pay 1:1</div>
                    <div>• Pair Plus pays regardless of dealer hand</div>
                </div>
            </div>

            {/* Controls */}
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 bg-titanium-900/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-auto md:h-20 flex flex-col md:flex-row items-stretch md:items-center justify-between md:justify-center gap-2 p-2 md:px-4">
                    {/* Desktop: Grouped Controls */}
                    <div className="hidden md:flex items-center gap-4 flex-1">
                        {gameState.stage === 'BETTING' ? (
                            <>
                                {/* NORMAL BETS GROUP */}
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-action-success font-bold tracking-widest uppercase font-mono">NORMAL:</span>
                                    <div className="h-6 w-px bg-gray-700" />
                                    <span className="text-xs text-gray-500 font-mono">Ante + Play</span>
                                </div>

                                {/* Spacer */}
                                <div className="h-8 w-px bg-gray-700" />

                                <SideBetMenu
                                    bets={BONUS_BETS}
                                    isActive={isBonusActive}
                                    onSelect={handleBonusSelect}
                                />

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
                                className="px-6 py-2 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-destructive text-action-destructive hover:bg-action-destructive/10"
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
                            className={`h-14 px-8 rounded border-2 font-bold text-base font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                                gameState.stage === 'PLAYING' && !gameState.message.includes('REVEAL')
                                    ? 'border-action-success bg-action-success text-black hover:bg-white hover:border-white'
                                    : 'border-action-success bg-action-success text-black hover:bg-white hover:border-white'
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
                                <MobileDrawer label="BETS" title="PLACE BETS">
                                    <div className="space-y-4">
                                        {/* Bonus Bets */}
                                        <div className="rounded border border-gray-800 bg-black/40 p-2 space-y-2">
                                            <div className="text-[10px] text-amber-500 font-bold tracking-widest border-b border-gray-800 pb-1">BONUS BETS</div>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                <button
                                                    onClick={actions?.threeCardTogglePairPlus}
                                                    className={`py-3 rounded border text-xs font-bold ${
                                                        (gameState.threeCardPairPlusBet || 0) > 0
                                                            ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                                                    }`}
                                                >
                                                    PAIR+
                                                </button>
                                                <button
                                                    onClick={actions?.threeCardToggleSixCardBonus}
                                                    className={`py-3 rounded border text-xs font-bold ${
                                                        (gameState.threeCardSixCardBonusBet || 0) > 0
                                                            ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                                                    }`}
                                                >
                                                    6-CARD
                                                </button>
                                                <button
                                                    onClick={actions?.threeCardToggleProgressive}
                                                    className={`py-3 rounded border text-xs font-bold ${
                                                        (gameState.threeCardProgressiveBet || 0) > 0
                                                            ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300'
                                                            : 'border-gray-700 bg-gray-900 text-gray-400'
                                                    }`}
                                                >
                                                    PROG
                                                </button>
                                            </div>
                                        </div>

                                        {/* Modifiers */}
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
                                            : actions?.threeCardPlay
                                }
                                className="flex-1 h-12 px-6 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] border-action-success bg-action-success text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95"
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
                                className="w-full py-3 rounded border-2 font-bold text-sm font-mono tracking-widest uppercase transition-all border-action-destructive text-action-destructive hover:bg-action-destructive/10"
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
