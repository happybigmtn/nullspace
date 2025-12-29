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
        const msgType = msg.type;
        switch (msgType) {
            case 'videopoker_deal':
            case 'video_poker_deal':
                return this.handleDeal(ctx, msg);
            case 'videopoker_hold':
            case 'video_poker_draw':
                return this.handleHold(ctx, msg);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown videopoker message: ${msgType}`),
                };
        }
    }
    async handleDeal(ctx, msg) {
        const amount = msg.amount;
        if (typeof amount !== 'number' || amount <= 0) {
            return {
                success: false,
                error: createError(ErrorCodes.INVALID_BET, 'Invalid bet amount'),
            };
        }
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        return this.startGame(ctx, BigInt(amount), gameSessionId);
    }
    async handleHold(ctx, msg) {
        // Accept both 'holds' (gateway canonical) and 'held' (mobile app)
        const holds = (msg.holds ?? msg.held);
        if (!holds || !Array.isArray(holds) || holds.length !== 5) {
            return {
                success: false,
                error: createError(ErrorCodes.INVALID_BET, 'Must specify 5 hold values'),
            };
        }
        for (const hold of holds) {
            if (typeof hold !== 'boolean') {
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_BET, 'Hold values must be booleans'),
                };
            }
        }
        const payload = buildVideoPokerPayload(holds);
        return this.makeMove(ctx, payload);
    }
}
//# sourceMappingURL=videopoker.js.map