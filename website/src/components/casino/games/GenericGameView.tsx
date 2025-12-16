
import React, { useMemo } from 'react';
import { GameState, GameType } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { getVisibleHandValue } from '../../../utils/gameUtils';

export const GenericGameView = React.memo<{ gameState: GameState; actions: any; lastWin?: number }>(({ gameState, actions, lastWin }) => {
    const dealerValue = useMemo(() => getVisibleHandValue(gameState.dealerCards), [gameState.dealerCards]);
    const playerValue = useMemo(() => getVisibleHandValue(gameState.playerCards), [gameState.playerCards]);
    const gameTitle = useMemo(() => gameState.type.replace(/_/g, ' '), [gameState.type]);
    const isWarState = useMemo(() => gameState.type === GameType.CASINO_WAR && gameState.message.includes('WAR'), [gameState.type, gameState.message]);
    const isCasinoWarBetting = useMemo(() => gameState.type === GameType.CASINO_WAR && gameState.stage === 'BETTING', [gameState.type, gameState.stage]);
    const casinoWarTieBet = useMemo(() => gameState.casinoWarTieBet || 0, [gameState.casinoWarTieBet]);
    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">{gameTitle}</h1>
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
                            <span className="text-lg font-bold tracking-widest text-terminal-accent">DEALER</span>
                            <Hand
                                cards={gameState.dealerCards}
                                title={`(${dealerValue})`}
                                forcedColor="text-terminal-accent"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-bold tracking-widest text-terminal-accent">DEALER</span>
                            <div className="w-16 h-24 border border-dashed border-terminal-accent rounded" />
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                    <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight animate-pulse">
                        {gameState.message}{lastWin && lastWin > 0 ? ` (+$${lastWin})` : ''}
                    </div>
                </div>

                {/* Player */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
                     <div className="flex flex-col items-center gap-2 scale-110">
                        <span className="text-lg font-bold tracking-widest text-terminal-green">YOU</span>
                        {gameState.playerCards.length > 0 ? (
                            <Hand
                                cards={gameState.playerCards}
                                title={`(${playerValue})`}
                                forcedColor="text-terminal-green"
                            />
                        ) : (
                            <div className="w-16 h-24 border border-dashed border-terminal-green/50 rounded" />
                        )}
                    </div>
                </div>
            </div>

            {isWarState ? (
                <div className="absolute inset-0 z-[60] flex items-center justify-center px-4">
                    <div className="w-full max-w-md border border-terminal-gold/40 bg-terminal-black/90 backdrop-blur rounded-lg p-4 shadow-2xl">
                        <div className="text-[10px] text-gray-500 tracking-widest uppercase">Tie</div>
                        <div className="mt-1 text-lg font-bold text-terminal-gold tracking-widest">WAR OR SURRENDER?</div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={actions?.casinoWarGoToWar}
                                className="h-12 rounded border border-terminal-green/60 bg-terminal-green/10 text-terminal-green font-bold tracking-widest uppercase hover:bg-terminal-green/20"
                            >
                                WAR
                            </button>
                            <button
                                type="button"
                                onClick={actions?.casinoWarSurrender}
                                className="h-12 rounded border border-terminal-accent/60 bg-terminal-accent/10 text-terminal-accent font-bold tracking-widest uppercase hover:bg-terminal-accent/20"
                            >
                                SURRENDER
                            </button>
                        </div>
                        <div className="mt-3 text-[10px] text-gray-600 leading-relaxed">
                            War usually requires an additional wager; surrender ends the hand with a smaller loss.
                        </div>
                    </div>
                </div>
            ) : null}

            {/* CONTROLS */}
             <GameControlBar
                 primaryAction={
                     isWarState
                         ? { label: 'WAR', onClick: actions?.casinoWarGoToWar, className: 'border-terminal-green bg-terminal-green text-black hover:bg-white' }
                         : { label: gameState.stage === 'RESULT' ? 'NEW HAND' : 'DEAL', onClick: actions?.deal, className: 'w-full sm:w-auto' }
                 }
                 secondaryActions={
                     isWarState
                         ? [
                             { label: 'SURRENDER', onClick: actions?.casinoWarSurrender, className: 'border-terminal-accent text-terminal-accent hover:bg-terminal-accent/10' }
                         ]
                         : [
                             ...(isCasinoWarBetting ? [{
                                 label: `TIE${casinoWarTieBet > 0 ? ` $${casinoWarTieBet}` : ''}`,
                                 onClick: actions?.casinoWarToggleTieBet,
                                 active: casinoWarTieBet > 0,
                             }] : []),
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
