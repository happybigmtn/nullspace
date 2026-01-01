/**
 * Sic Bo game handler
 *
 * Uses atomic batch (action 3) for placing bets and rolling in one transaction.
 *
 * Payload format from execution/src/casino/sic_bo.rs:
 * [3, bet_count, bets...] - Atomic batch: place all bets + roll in one transaction
 * Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
 */
import { GameHandler } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { encodeSicBoAtomicBatch } from '@nullspace/protocol/encode';
export class SicBoHandler extends GameHandler {
    constructor() {
        super(GameType.SicBo);
    }
    async handleMessage(ctx, msg) {
        switch (msg.type) {
            case 'sicbo_roll':
            case 'sic_bo_roll':
                return this.handleRoll(ctx, msg);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown sicbo message: ${msg.type}`),
                };
        }
    }
    async handleRoll(ctx, msg) {
        const bets = msg.bets.map((bet) => ({
            type: typeof bet.type === 'string' ? bet.type.toUpperCase() : bet.type,
            amount: BigInt(bet.amount),
            target: bet.target,
            number: bet.number,
            value: bet.value,
        }));
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        // Start game with bet=0; sic bo bets are deducted via moves.
        const startResult = await this.startGame(ctx, 0n, gameSessionId);
        if (!startResult.success) {
            return startResult;
        }
        try {
            const payload = encodeSicBoAtomicBatch(bets);
            return this.makeMove(ctx, payload);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Invalid bet payload';
            return {
                success: false,
                error: createError(ErrorCodes.INVALID_BET, message),
            };
        }
    }
}
//# sourceMappingURL=sicbo.js.map