/**
 * Roulette game handler
 *
 * Uses atomic batch (action 4) for placing bets and spinning in one transaction.
 *
 * Payload format from execution/src/casino/roulette.rs:
 * [4, bet_count, bets...] - Atomic batch: place all bets + spin in one transaction
 * Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
 */
import { GameHandler } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { encodeRouletteAtomicBatch } from '@nullspace/protocol/encode';
export class RouletteHandler extends GameHandler {
    constructor() {
        super(GameType.Roulette);
    }
    async handleMessage(ctx, msg) {
        switch (msg.type) {
            case 'roulette_spin':
                return this.handleSpin(ctx, msg);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown roulette message: ${msg.type}`),
                };
        }
    }
    async handleSpin(ctx, msg) {
        const bets = msg.bets.map((bet) => ({
            type: typeof bet.type === 'string' ? bet.type.toUpperCase() : bet.type,
            amount: BigInt(bet.amount),
            target: bet.target,
            number: bet.number,
            value: bet.value,
        }));
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        // Start game with bet=0; roulette bets are deducted via moves.
        const startResult = await this.startGame(ctx, 0n, gameSessionId);
        if (!startResult.success) {
            return startResult;
        }
        try {
            const payload = encodeRouletteAtomicBatch(bets);
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
//# sourceMappingURL=roulette.js.map