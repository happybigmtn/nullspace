import React, { useCallback, useMemo } from 'react';
import { GameState } from '../../../types';
import { Hand } from '../GameComponents';
import { MobileDrawer } from '../MobileDrawer';
import { evaluateVideoPokerHand } from '../../../utils/gameUtils';
import { Label } from '../ui/Label';

interface VideoPokerViewProps {
    gameState: GameState;
    onToggleHold: (index: number) => void;
    actions?: {
        deal?: () => void;
        drawVideoPoker?: () => void;
    };
}

const VIDEO_POKER_PAYTABLE: Array<{ rank: string; multiplier: number }> = [
    { rank: 'ROYAL FLUSH', multiplier: 800 },
    { rank: 'STRAIGHT FLUSH', multiplier: 50 },
    { rank: 'FOUR OF A KIND', multiplier: 25 },
    { rank: 'FULL HOUSE', multiplier: 9 },
    { rank: 'FLUSH', multiplier: 6 },
    { rank: 'STRAIGHT', multiplier: 4 },
    { rank: 'THREE OF A KIND', multiplier: 3 },
    { rank: 'TWO PAIR', multiplier: 2 },
    { rank: 'JACKS OR BETTER', multiplier: 1 },
];

export const VideoPokerView = React.memo<VideoPokerViewProps & { lastWin?: number; playMode?: 'CASH' | 'FREEROLL' | null }>(({ gameState, onToggleHold, actions, lastWin, playMode }) => {
    const handleToggleHold = useCallback((index: number) => {
        onToggleHold(index);
    }, [onToggleHold]);

    const handEval = useMemo(() => {
        if (gameState.playerCards.length !== 5) return null;
        try {
            return evaluateVideoPokerHand(gameState.playerCards);
        } catch {
            return null;
        }
    }, [gameState.playerCards]);

    const highlightRank = gameState.stage === 'RESULT' ? handEval?.rank ?? null : null;
    
    return (
        <div className="flex-1 w-full flex flex-col items-center justify-start sm:justify-center gap-12 relative pt-12 animate-scale-in">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                <Label size="micro">Video Poker</Label>
                <div className="h-1 w-8 bg-titanium-200 rounded-full" />
            </div>

            <div className="absolute top-2 left-2 z-40">
                <MobileDrawer label="INFO" title="VIDEO POKER">
                    <div className="space-y-4 p-2 text-center">
                        <Label size="micro">Paytable</Label>
                        <div className="grid grid-cols-1 gap-1">
                            {VIDEO_POKER_PAYTABLE.slice(0, 5).map(row => (
                                <div key={row.rank} className="flex justify-between text-[10px] font-bold text-titanium-800">
                                    <span>{row.rank}</span>
                                    <span className="text-action-primary">{row.multiplier}x</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </MobileDrawer>
            </div>

            {/* Center Info */}
            <div className="text-center space-y-4 relative z-20">
                <h2 className="text-3xl sm:text-4xl font-extrabold text-titanium-900 tracking-tight font-display">
                    {gameState.message || 'Deal to Start'}
                </h2>
                {handEval && gameState.stage !== 'BETTING' && (
                    <div className="flex items-center justify-center gap-2">
                        <div className={`px-4 py-1.5 rounded-full border-2 transition-all shadow-soft ${
                            handEval.multiplier > 0 
                                ? 'border-action-success bg-action-success/5 text-action-success scale-110' 
                                : 'border-titanium-200 bg-white text-titanium-400 opacity-60'
                        }`}>
                            <span className="text-xs font-black uppercase tracking-widest">
                                {handEval.rank} {handEval.multiplier > 0 ? `· ${handEval.multiplier}x` : ''}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Hand Area */}
            <div className="min-h-[160px] flex gap-3 sm:gap-6 items-center justify-center px-4">
                {gameState.playerCards.length > 0 && gameState.playerCards.map((card, i) => {
                    const isWinningCard = handEval && handEval.multiplier > 0 && card.isHeld;
                    return (
                        <button
                            key={i}
                            type="button"
                            onClick={() => handleToggleHold(i)}
                            className="flex flex-col items-center gap-4 transition-all duration-300 hover:-translate-y-2 active:scale-95 group"
                        >
                             <div className={`relative rounded-2xl transition-all duration-500 ${
                                card.isHeld ? 'ring-4 ring-action-primary ring-offset-4 shadow-float' : ''
                             }`}>
                                <Hand cards={[card]} />
                                {card.isHeld && (
                                    <div className="absolute -top-3 -right-3 bg-action-primary text-white rounded-full w-8 h-8 flex items-center justify-center shadow-lg border-2 border-white">
                                        <span className="text-[10px] font-black">✓</span>
                                    </div>
                                )}
                             </div>
                             
                             <Label 
                                variant={card.isHeld ? 'gold' : 'secondary'} 
                                size="micro"
                                className={`transition-opacity duration-300 ${card.isHeld ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`}
                             >
                                {card.isHeld ? 'Held' : `Key ${i+1}`}
                             </Label>
                        </button>
                    );
                })}
            </div>

            {/* Desktop Pay Table Sidebar */}
            <div className="hidden xl:flex absolute top-8 left-4 bottom-24 w-60 bg-white/60 backdrop-blur-md rounded-[32px] border border-titanium-200 p-6 flex-col shadow-soft">
                <Label size="micro" className="mb-6 text-center block">Pay Table</Label>
                <div className="space-y-2 overflow-y-auto scrollbar-hide">
                    {VIDEO_POKER_PAYTABLE.map((row) => (
                        <div
                            key={row.rank}
                            className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                                highlightRank === row.rank 
                                    ? 'bg-action-success/5 border-action-success shadow-soft' 
                                    : 'bg-white border-titanium-100'
                            }`}
                        >
                            <span className={`text-[10px] font-bold uppercase tracking-tight ${highlightRank === row.rank ? 'text-action-success' : 'text-titanium-800'}`}>
                                {row.rank}
                            </span>
                            <span className={`text-xs font-black ${highlightRank === row.rank ? 'text-action-success' : 'text-action-primary'}`}>
                                {row.multiplier}x
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Control Bar */}
            <div className="ns-controlbar fixed bottom-0 left-0 right-0 md:sticky md:bottom-0 bg-titanium-50/95 backdrop-blur border-t border-titanium-200 z-50 pb-[env(safe-area-inset-bottom)] md:pb-0">
                <div className="h-auto md:h-20 flex flex-col md:flex-row items-stretch md:items-center justify-center gap-2 p-2 md:px-4">
                    <button
                        type="button"
                        onClick={gameState.stage === 'PLAYING' ? actions?.drawVideoPoker : actions?.deal}
                        className="h-14 px-12 rounded-full border-2 font-bold text-lg font-display tracking-tight uppercase transition-all shadow-soft border-action-primary bg-action-primary text-white hover:bg-action-primary-hover hover:scale-105 active:scale-95"
                    >
                        {gameState.stage === 'PLAYING' ? 'DRAW' : gameState.stage === 'RESULT' ? 'NEW HAND' : 'DEAL'}
                    </button>
                </div>
            </div>
        </div>
    );
});