/**
 * Blackjack game handler
 * Translates mobile JSON messages to backend transactions
 *
 * Blackjack has a multi-stage flow:
 * 1. CasinoStartGame puts game in Betting stage
 * 2. Deal move (4) deals cards and moves to PlayerTurn
 * 3. Hit/Stand/Double/Split moves during PlayerTurn
 * 4. Reveal move (6) resolves the hand after standing
 *
 * The handler chains these automatically for smooth mobile UX.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import type { OutboundMessage } from '@nullspace/protocol/mobile';
export declare class BlackjackHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: OutboundMessage): Promise<HandleResult>;
    private handleDeal;
    private handleHit;
    private handleStand;
    private handleDouble;
    private handleSplit;
}
//# sourceMappingURL=blackjack.d.ts.map