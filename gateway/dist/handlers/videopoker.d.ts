/**
 * Video Poker game handler
 *
 * Payload uses a hold mask; there is no move opcode for deal/draw.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
export declare class VideoPokerHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: Record<string, unknown>): Promise<HandleResult>;
    private handleDeal;
    private handleHold;
}
//# sourceMappingURL=videopoker.d.ts.map