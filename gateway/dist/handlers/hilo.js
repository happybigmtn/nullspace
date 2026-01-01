/**
 * Hi-Lo game handler
 *
 * Handles HiLo game messages from mobile clients, submitting transactions
 * to the backend and returning real on-chain game results via the updates stream.
 */
import { GameHandler } from './base.js';
import { GameType, buildHiLoPayload } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { HiLoMove as SharedHiLoMove } from '@nullspace/constants';
export class HiLoHandler extends GameHandler {
    constructor() {
        super(GameType.HiLo);
    }
    async handleMessage(ctx, msg) {
        switch (msg.type) {
            case 'hilo_deal':
                return this.handleDeal(ctx, msg);
            case 'hilo_bet':
                // Mobile app sends combined bet+choice in one message
                return this.handleBet(ctx, msg);
            case 'hilo_higher':
                return this.handleGuess(ctx, 'higher');
            case 'hilo_lower':
                return this.handleGuess(ctx, 'lower');
            case 'hilo_same':
                return this.handleGuess(ctx, 'same');
            case 'hilo_cashout':
                return this.handleCashout(ctx);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown hilo message: ${msg.type}`),
                };
        }
    }
    async handleDeal(ctx, msg) {
        const amount = msg.amount;
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        return this.startGame(ctx, BigInt(amount), gameSessionId);
    }
    /**
     * Handle combined bet+choice from mobile app
     * Starts the game and immediately makes the guess, returning real on-chain results
     */
    async handleBet(ctx, msg) {
        const amount = msg.amount;
        const choice = msg.choice;
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        // Start game on-chain
        const startResult = await this.startGame(ctx, BigInt(amount), gameSessionId);
        if (!startResult.success) {
            return startResult;
        }
        // Make the guess - base handler waits for real CasinoGameMoved/Completed events
        const payload = buildHiLoPayload(choice);
        return this.makeMove(ctx, payload);
    }
    async handleGuess(ctx, guess) {
        const payload = buildHiLoPayload(guess);
        return this.makeMove(ctx, payload);
    }
    async handleCashout(ctx) {
        const payload = new Uint8Array([SharedHiLoMove.Cashout]);
        return this.makeMove(ctx, payload);
    }
}
//# sourceMappingURL=hilo.js.map