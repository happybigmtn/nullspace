
import React, { useMemo, useEffect, useState, useRef } from 'react';
import { GameState, GameType } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';

export const GenericGameView = React.memo<{ gameState: GameState; actions: any; lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, actions, lastWin, playMode }) => {
    const gameTitle = useMemo(() => gameState.type.replace(/_/g, ' '), [gameState.type]);
    const isWarState = useMemo(() => gameState.type === GameType.CASINO_WAR && gameState.message.includes('WAR'), [gameState.type, gameState.message]);
    const isCasinoWarBetting = useMemo(() => gameState.type === GameType.CASINO_WAR && gameState.stage === 'BETTING', [gameState.type, gameState.stage]);
    const casinoWarTieBet = useMemo(() => gameState.casinoWarTieBet || 0, [gameState.casinoWarTieBet]);
    const isCasinoWar = gameState.type === GameType.CASINO_WAR;
    const warPlayerCard = gameState.playerCards[0];
    const warDealerCard = gameState.dealerCards[0];
    const warOutcome = useMemo<'player' | 'dealer' | 'tie' | null>(() => {
        if (!isCasinoWar) return null;
        const rawOutcome = gameState.casinoWarOutcome;
        if (!rawOutcome) return null;
        if (rawOutcome.includes('PLAYER')) return 'player';
        if (rawOutcome.includes('DEALER')) return 'dealer';
        if (rawOutcome.includes('TIE')) return 'tie';
        return null;
    }, [isCasinoWar, gameState.casinoWarOutcome]);
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
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase zen-hide">{gameTitle}</h1>
                {isCasinoWar && warTrend.length > 0 && (
                    <div className="absolute top-7 flex items-center gap-2 text-[9px] font-mono tracking-[0.3em] text-gray-500 zen-hide">
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
                            <span className="text-lg font-mono font-bold tracking-widest text-action-destructive">DEALER</span>
                            <Hand
                                cards={gameState.dealerCards}
                                forcedColor="text-action-destructive"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-mono font-bold tracking-widest text-action-destructive">DEALER</span>
                            <div className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border-2 border-dashed border-action-destructive/50 rounded" />
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20 zen-hide">
                    <div className="text-lg sm:text-2xl font-bold text-action-primary tracking-widest leading-tight animate-pulse">
                        {gameState.message}
                    </div>
                </div>

                {/* Player */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
                     <div className="flex flex-col items-center gap-2 scale-110">
                        <span className="text-lg font-mono font-bold tracking-widest text-action-success">YOU</span>
                        {gameState.playerCards.length > 0 ? (
                            <Hand
                                cards={gameState.playerCards}
                                forcedColor="text-action-success"
                            />
                        ) : (
                            <div className="w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border-2 border-dashed border-action-success/50 rounded" />
                        )}
                    </div>
                </div>
            </div>

            {isWarState ? (
                <div className="absolute inset-0 z-[60] flex items-center justify-center px-4 bg-black/80 backdrop-blur-sm">
                    <div className="w-full max-w-md border-2 border-action-primary bg-titanium-900/95 backdrop-blur rounded-lg p-4 shadow-2xl">
                        <div className="text-[10px] text-gray-500 tracking-widest uppercase font-mono">Tie Declared</div>
                        <div className="mt-1 text-lg font-mono font-bold text-action-primary tracking-widest">WAR OR SURRENDER?</div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={actions?.casinoWarGoToWar}
                                className="h-12 rounded border-2 border-action-success bg-action-success/10 text-action-success font-mono font-bold tracking-widest uppercase hover:bg-action-success/20 transition-all"
                            >
                                <span className="ns-keycap">W</span> WAR
                            </button>
                            <button
                                type="button"
                                onClick={actions?.casinoWarSurrender}
                                className="h-12 rounded border-2 border-action-destructive bg-action-destructive/10 text-action-destructive font-mono font-bold tracking-widest uppercase hover:bg-action-destructive/20 transition-all"
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
                         ? { label: 'WAR', onClick: actions?.casinoWarGoToWar, className: 'border-2 border-action-success bg-action-success text-black hover:bg-white' }
                         : { label: gameState.stage === 'RESULT' ? 'NEW HAND' : 'DEAL', onClick: actions?.deal, className: 'w-full md:w-auto' }
                 }
                 secondaryActions={
                     isWarState
                         ? [
                             { label: 'SURRENDER', onClick: actions?.casinoWarSurrender, className: 'border-2 border-action-destructive text-action-destructive hover:bg-action-destructive/10' }
                         ]
                         : [
                             ...(isCasinoWarBetting ? [{
                                 label: `TIE${casinoWarTieBet > 0 ? ` $${casinoWarTieBet}` : ''}`,
                                 onClick: actions?.casinoWarToggleTieBet,
                                 active: casinoWarTieBet > 0,
                             }] : []),
                         ]
                 }
                 /* LUX-012: Modifiers in collapsible accordion */
                 modifiers={!isWarState ? {
                     shield: playMode !== 'CASH' ? {
                         active: gameState.activeModifiers.shield,
                         available: true,
                         onToggle: actions?.toggleShield,
                     } : undefined,
                     double: playMode !== 'CASH' ? {
                         active: gameState.activeModifiers.double,
                         available: true,
                         onToggle: actions?.toggleDouble,
                     } : undefined,
                     super: {
                         active: gameState.activeModifiers.super,
                         available: true,
                         onToggle: actions?.toggleSuper,
                     },
                 } : undefined}
             />
        </>
    );
});
