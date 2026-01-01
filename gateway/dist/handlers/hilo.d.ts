/**
 * Hi-Lo game handler
 *
 * Handles HiLo game messages from mobile clients, submitting transactions
 * to the backend and returning real on-chain game results via the updates stream.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import type { OutboundMessage } from '@nullspace/protocol/mobile';
export declare class HiLoHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: OutboundMessage): Promise<HandleResult>;
    private handleDeal;
    /**
     * Handle combined bet+choice from mobile app
     * Starts the game and immediately makes the guess, returning real on-chain results
     */
    private handleBet;
    private handleGuess;
    private handleCashout;
}
//# sourceMappingURL=hilo.d.ts.map