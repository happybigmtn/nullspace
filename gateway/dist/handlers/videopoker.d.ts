/**
 * Video Poker game handler
 *
 * Payload uses a hold mask; there is no move opcode for deal/draw.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import type { OutboundMessage } from '@nullspace/protocol/mobile';
export declare class VideoPokerHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: OutboundMessage): Promise<HandleResult>;
    private handleDeal;
    private handleHold;
}
//# sourceMappingURL=videopoker.d.ts.map