/**
 * Video Poker game handler
 *
 * Payload uses a hold mask; there is no move opcode for deal/draw.
 */
import { GameHandler } from './base.js';
import { GameType, buildVideoPokerPayload } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
export class VideoPokerHandler extends GameHandler {
    constructor() {
        super(GameType.VideoPoker);
    }
    async handleMessage(ctx, msg) {
        switch (msg.type) {
            case 'videopoker_deal':
            case 'video_poker_deal':
                return this.handleDeal(ctx, msg);
            case 'videopoker_hold':
            case 'video_poker_draw':
                return this.handleHold(ctx, msg);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown videopoker message: ${msg.type}`),
                };
        }
    }
    async handleDeal(ctx, msg) {
        const amount = msg.amount;
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        return this.startGame(ctx, BigInt(amount), gameSessionId);
    }
    async handleHold(ctx, msg) {
        const holds = msg.type === 'video_poker_draw' ? msg.held : msg.holds;
        const payload = buildVideoPokerPayload(holds);
        return this.makeMove(ctx, payload);
    }
}
//# sourceMappingURL=videopoker.js.map