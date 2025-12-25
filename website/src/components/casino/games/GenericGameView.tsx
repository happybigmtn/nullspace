
import React, { useMemo, useEffect, useState, useRef } from 'react';
import { Card, GameState, GameType } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { getVisibleHandValue } from '../../../utils/gameUtils';

const getWarCardValue = (card?: Card | null) => {
    if (!card) return 0;
    if (card.rank === 'A') return 14;
    if (card.rank === 'K') return 13;
    if (card.rank === 'Q') return 12;
    if (card.rank === 'J') return 11;
    const parsed = Number.parseInt(card.rank, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const GenericGameView = React.memo<{ gameState: GameState; actions: any; lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, actions, lastWin, playMode }) => {
    const dealerValue = useMemo(() => getVisibleHandValue(gameState.dealerCards), [gameState.dealerCards]);
    const playerValue = useMemo(() => getVisibleHandValue(gameState.playerCards), [gameState.playerCards]);
    const gameTitle = useMemo(() => gameState.type.replace(/_/g, ' '), [gameState.type]);
    const isWarState = useMemo(() => gameState.type === GameType.CASINO_WAR && gameState.message.includes('WAR'), [gameState.type, gameState.message]);
    const isCasinoWarBetting = useMemo(() => gameState.type === GameType.CASINO_WAR && gameState.stage === 'BETTING', [gameState.type, gameState.stage]);
    const casinoWarTieBet = useMemo(() => gameState.casinoWarTieBet || 0, [gameState.casinoWarTieBet]);
    const isCasinoWar = gameState.type === GameType.CASINO_WAR;
    const warPlayerCard = gameState.playerCards[0];
    const warDealerCard = gameState.dealerCards[0];
    const warOutcome = useMemo(() => {
        if (!isCasinoWar || !warPlayerCard || !warDealerCard) return null;
        const playerVal = getWarCardValue(warPlayerCard);
        const dealerVal = getWarCardValue(warDealerCard);
        if (playerVal > dealerVal) return 'player';
        if (dealerVal > playerVal) return 'dealer';
        return 'tie';
    }, [isCasinoWar, warPlayerCard, warDealerCard]);
    const warAccentColor = useMemo(() => {
        if (!warOutcome) return undefined;
        if (warOutcome === 'player') return '#22ff88';
        if (warOutcome === 'dealer') return '#f87171';
        return '#f4c542';
    }, [warOutcome]);
    const warGlow = useMemo(() => (warAccentColor ? `${warAccentColor}33` : undefined), [warAccentColor]);
    const [warTrend, setWarTrend] = useState<Array<'player' | 'dealer' | 'tie'>>([]);
    const warTrendKeyRef = useRef<string>('');
    const roundKey = useMemo(() => {
        if (gameState.sessionId === null || !Number.isFinite(gameState.moveNumber)) return undefined;
        return `${gameState.sessionId}-${gameState.moveNumber}`;
    }, [gameState.moveNumber, gameState.sessionId]);
    useEffect(() => {
        if (!isCasinoWar || !warOutcome) return;
        const key = roundKey !== undefined
            ? `round-${roundKey}`
            : `${warPlayerCard?.rank ?? ''}${warPlayerCard?.suit ?? ''}-${warDealerCard?.rank ?? ''}${warDealerCard?.suit ?? ''}`;
        if (warTrendKeyRef.current === key) return;
        warTrendKeyRef.current = key;
        setWarTrend((prev) => [...prev, warOutcome].slice(-10));
    }, [isCasinoWar, roundKey, warOutcome, warPlayerCard, warDealerCard]);
    return (
        <>
            <div
                className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-6 md:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20"
                style={warGlow ? { background: `radial-gradient(circle at 50% 20%, ${warGlow}, transparent 65%)` } : undefined}
            >
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">{gameTitle}</h1>
                {isCasinoWar && warTrend.length > 0 && (
                    <div className="absolute top-7 flex items-center gap-2 text-[9px] font-mono tracking-[0.3em] text-gray-500">
                        <span>TREND</span>
                        <div className="flex items-center gap-1">
                            {warTrend.map((outcome, index) => (
                                <span
                                    key={`${outcome}-${index}`}
                                    className="w-2 h-2 rounded-full"
                                    style={{
                                        backgroundColor:
                                            outcome === 'player' ? '#22ff88' : outcome === 'dealer' ? '#f87171' : '#f4c542',
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}
                <div className="absolute top-2 left-2 z-40">
                    <MobileDrawer label="INFO" title={gameTitle}>
                        <div className="space-y-3">
                            <div className="text-[11px] text-gray-300 leading-relaxed">
                                Higher card wins. On a tie you can choose WAR (risk more for a second draw) or SURRENDER (take a smaller loss).
                            </div>
                            <div className="text-[10px] text-gray-600 leading-relaxed">
                                Controls: DEAL (Space). If tie: WAR (W) or SURRENDER (S). Optional TIE side bet (T).
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Dealer/Opponent */}
                <div className="min-h-[96px] sm:min-h-[120px] flex items-center justify-center opacity-75">
                    {gameState.dealerCards.length > 0 ? (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-mono font-bold tracking-widest text-terminal-accent">DEALER</span>
                            <Hand
                                cards={gameState.dealerCards}
                                title={`(${dealerValue})`}
                                forcedColor="text-terminal-accent"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-mono font-bold tracking-widest text-terminal-accent">DEALER</span>
                            <div className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border-2 border-dashed border-terminal-accent/50 rounded" />
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                        {gameState.message}
                    </div>
                </div>

                {/* Player */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
                     <div className="flex flex-col items-center gap-2 scale-110">
                        <span className="text-lg font-mono font-bold tracking-widest text-terminal-green">YOU</span>
                        {gameState.playerCards.length > 0 ? (
                            <Hand
                                cards={gameState.playerCards}
                                title={`(${playerValue})`}
                                forcedColor="text-terminal-green"
                            />
                        ) : (
                            <div className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border-2 border-dashed border-terminal-green/50 rounded" />
                        )}
                    </div>
                </div>
            </div>

            {isWarState ? (
                <div className="absolute inset-0 z-[60] flex items-center justify-center px-4 bg-black/80 backdrop-blur-sm">
                    <div className="w-full max-w-md border-2 border-terminal-gold bg-terminal-black/95 backdrop-blur rounded-lg p-4 shadow-2xl">
                        <div className="text-[10px] text-gray-500 tracking-widest uppercase font-mono">Tie Declared</div>
                        <div className="mt-1 text-lg font-mono font-bold text-terminal-gold tracking-widest">WAR OR SURRENDER?</div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={actions?.casinoWarGoToWar}
                                className="h-12 rounded border-2 border-terminal-green bg-terminal-green/10 text-terminal-green font-mono font-bold tracking-widest uppercase hover:bg-terminal-green/20 transition-all"
                            >
                                <span className="ns-keycap">W</span> WAR
                            </button>
                            <button
                                type="button"
                                onClick={actions?.casinoWarSurrender}
                                className="h-12 rounded border-2 border-terminal-accent bg-terminal-accent/10 text-terminal-accent font-mono font-bold tracking-widest uppercase hover:bg-terminal-accent/20 transition-all"
                            >
                                <span className="ns-keycap">S</span> SURRENDER
                            </button>
                        </div>
                        <div className="mt-3 text-[10px] text-gray-500 leading-relaxed font-mono">
                            War requires an additional wager; surrender ends the hand with a smaller loss.
                        </div>
                    </div>
                </div>
            ) : null}

            {/* CONTROLS */}
             <GameControlBar
                 primaryAction={
                     isWarState
                         ? { label: 'WAR', onClick: actions?.casinoWarGoToWar, className: 'border-2 border-terminal-green bg-terminal-green text-black hover:bg-white' }
                         : { label: gameState.stage === 'RESULT' ? 'NEW HAND' : 'DEAL', onClick: actions?.deal, className: 'w-full md:w-auto' }
                 }
                 secondaryActions={
                     isWarState
                         ? [
                             { label: 'SURRENDER', onClick: actions?.casinoWarSurrender, className: 'border-2 border-terminal-accent text-terminal-accent hover:bg-terminal-accent/10' }
                         ]
                         : [
                             ...(isCasinoWarBetting ? [{
                                 label: `TIE${casinoWarTieBet > 0 ? ` $${casinoWarTieBet}` : ''}`,
                                 onClick: actions?.casinoWarToggleTieBet,
                                 active: casinoWarTieBet > 0,
                             }] : []),
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
                 }
             />
        </>
    );
});
