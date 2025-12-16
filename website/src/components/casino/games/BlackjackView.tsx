
import React, { useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { GameControlBar } from '../GameControlBar';
import { getVisibleHandValue } from '../../../utils/gameUtils';

export const BlackjackView = React.memo<{ gameState: GameState; actions: any }>(({ gameState, actions }) => {
    const dealerValue = useMemo(() => getVisibleHandValue(gameState.dealerCards), [gameState.dealerCards]);
    const playerValue = useMemo(() => getVisibleHandValue(gameState.playerCards), [gameState.playerCards]);
    const showInsurancePrompt = useMemo(() => {
        if (gameState.stage !== 'PLAYING') return false;
        const msg = (gameState.message ?? '').toString().toUpperCase();
        return msg.includes('INSURANCE');
    }, [gameState.message, gameState.stage]);

    const canHit = gameState.stage === 'PLAYING' && !showInsurancePrompt && playerValue < 21;
    const canStand = gameState.stage === 'PLAYING' && !showInsurancePrompt && gameState.playerCards.length > 0;
    const canDouble = gameState.stage === 'PLAYING' && !showInsurancePrompt && gameState.playerCards.length === 2;
    const canSplit =
        gameState.stage === 'PLAYING' &&
        !showInsurancePrompt &&
        gameState.playerCards.length === 2 &&
        gameState.playerCards[0]?.rank === gameState.playerCards[1]?.rank;

    const activeHandNumber = gameState.completedHands.length + 1;

    const formatCompletedTitle = (idx: number, h: any) => {
        const bet = typeof h?.bet === 'number' ? h.bet : 0;
        const res = typeof h?.result === 'number' ? h.result : null;
        const tag =
            h?.surrendered
                ? 'SURRENDER'
                : h?.message
                    ? String(h.message).toUpperCase()
                    : res === null
                        ? 'DONE'
                        : res > 0
                            ? `+${res}`
                            : res < 0
                                ? `-${Math.abs(res)}`
                                : 'PUSH';
        return `HAND ${idx + 1} · $${bet} · ${tag}`;
    };
    return (
        <>
            <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-4 sm:gap-8 relative z-10 pt-8 sm:pt-10 pb-24 sm:pb-20">
                <h1 className="absolute top-0 text-xl font-bold text-gray-500 tracking-widest uppercase">BLACKJACK</h1>
                <div className="absolute top-2 right-2 z-40">
                    <MobileDrawer label="INFO" title="BLACKJACK">
                        <div className="space-y-3">
                            <div className="text-[11px] text-gray-300 leading-relaxed">
                                Get as close to 21 as possible without going over. Dealer stands on 17.
                            </div>
                            <div className="text-[10px] text-gray-600 leading-relaxed">
                                Controls: HIT (H), STAND (S), DOUBLE (D), SPLIT (P). Insurance is local-mode only.
                            </div>
                        </div>
                    </MobileDrawer>
                </div>
                {/* Dealer Area */}
                <div className="min-h-[96px] sm:min-h-[120px] flex items-center justify-center opacity-75">
                    {gameState.dealerCards.length > 0 ? (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-sm font-bold tracking-widest text-white">DEALER <span className="text-white">({dealerValue})</span></span>
                            <Hand
                                cards={gameState.dealerCards}
                                forcedColor="text-terminal-accent"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                             <span className="text-sm font-bold tracking-widest text-white">DEALER</span>
                             <div className="w-16 h-24 border border-dashed border-terminal-accent rounded" />
                        </div>
                    )}
                </div>

                {/* Center Info */}
                <div className="text-center space-y-3 relative z-20">
                        <div className="text-lg sm:text-2xl font-bold text-terminal-gold tracking-widest leading-tight">
                            {gameState.message}
                        </div>
                </div>

                {/* Player Area - Highlighted */}
                <div className="min-h-[96px] sm:min-h-[120px] flex gap-8 items-center justify-center">
                    {/* Finished Split Hands */}
                    {gameState.completedHands.length > 0 && (
                            <div className="flex gap-2 opacity-50 scale-75 origin-right">
                            {gameState.completedHands.map((h, i) => (
                                <Hand
                                    key={i}
                                    cards={h.cards}
                                    title={formatCompletedTitle(i, h)}
                                    forcedColor={h?.result < 0 ? 'text-terminal-accent' : 'text-terminal-green'}
                                />
                            ))}
                            </div>
                    )}

                    <div className="flex flex-col items-center gap-2 scale-110 transition-transform">
                        <span className="text-sm font-bold tracking-widest text-white">
                            YOU <span className="text-white">({playerValue})</span>
                            {gameState.completedHands.length > 0 ? (
                                <span className="text-gray-500 text-xs"> · HAND {activeHandNumber}</span>
                            ) : null}
                        </span>
                        {gameState.playerCards.length > 0 ? (
                             <Hand
                                cards={gameState.playerCards}
                                forcedColor="text-terminal-green"
                            />
                        ) : (
                            <div className="w-16 h-24 border border-dashed border-terminal-green/50 rounded" />
                        )}
                    </div>

                    {/* Pending Split Hands */}
                    {gameState.blackjackStack.length > 0 && (
                            <div className="flex gap-2 opacity-50 scale-75 origin-left">
                            {gameState.blackjackStack.map((h, i) => (
                                <div key={i} className="w-12 h-16 bg-terminal-dim border border-gray-700 rounded flex items-center justify-center">
                                    <span className="text-xs text-gray-500">WAIT</span>
                                </div>
                            ))}
                            </div>
                    )}
                </div>
            </div>

            {/* CONTROLS */}
            <GameControlBar
                primaryAction={
                    (gameState.stage === 'BETTING' || gameState.stage === 'RESULT')
                        ? {
                            label: 'DEAL',
                            onClick: actions?.deal,
                            className: 'w-full sm:w-auto',
                        }
                        : showInsurancePrompt
                            ? {
                                label: 'INSURE',
                                onClick: () => actions?.bjInsurance?.(true),
                                className: 'border-terminal-gold bg-terminal-gold text-black hover:bg-white',
                            }
                            : {
                                label: 'HIT',
                                onClick: actions?.bjHit,
                                disabled: !canHit,
                                className: canHit ? '' : 'opacity-50 cursor-not-allowed',
                            }
                }
                secondaryActions={
                    (gameState.stage === 'BETTING' || gameState.stage === 'RESULT')
                        ? [
                            ...(gameState.stage === 'BETTING' ? [{
                                label: `21+3${(gameState.blackjack21Plus3Bet || 0) > 0 ? ` $${gameState.blackjack21Plus3Bet}` : ''}`,
                                onClick: actions?.bjToggle21Plus3,
                                active: (gameState.blackjack21Plus3Bet || 0) > 0,
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
                        : showInsurancePrompt
                            ? [
                                {
                                    label: 'NO',
                                    onClick: () => actions?.bjInsurance?.(false),
                                }
                            ]
                            : [
                                {
                                    label: 'STAND',
                                    onClick: actions?.bjStand,
                                    disabled: !canStand,
                                },
                                {
                                    label: 'DOUBLE',
                                    onClick: actions?.bjDouble,
                                    disabled: !canDouble,
                                },
                                {
                                    label: 'SPLIT',
                                    onClick: actions?.bjSplit,
                                    disabled: !canSplit,
                                },
                            ]
                }
            />
        </>
    );
});
