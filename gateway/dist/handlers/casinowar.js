/**
 * Casino War game handler
 *
 * Uses shared CasinoWarMove constants to align with execution enum values.
 */
import { GameHandler } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { CasinoWarMove as SharedCasinoWarMove } from '@nullspace/constants';
export class CasinoWarHandler extends GameHandler {
    constructor() {
        super(GameType.CasinoWar);
    }
    async handleMessage(ctx, msg) {
        switch (msg.type) {
            case 'casinowar_deal':
            case 'casino_war_deal':
                return this.handleDeal(ctx, msg);
            case 'casinowar_war':
            case 'casino_war_war':
                return this.handleWar(ctx);
            case 'casinowar_surrender':
            case 'casino_war_surrender':
                return this.handleSurrender(ctx);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown casinowar message: ${msg.type}`),
                };
        }
    }
    async handleDeal(ctx, msg) {
        const amount = msg.amount;
        const tieBet = msg.tieBet ?? 0;
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        const startResult = await this.startGame(ctx, BigInt(amount), gameSessionId);
        if (!startResult.success) {
            return startResult;
        }
        if (tieBet > 0) {
            const tiePayload = new Uint8Array(9);
            tiePayload[0] = SharedCasinoWarMove.SetTieBet;
            new DataView(tiePayload.buffer).setBigUint64(1, BigInt(tieBet), false);
            const tieResult = await this.makeMove(ctx, tiePayload);
            if (!tieResult.success) {
                return tieResult;
            }
        }
        const dealPayload = new Uint8Array([SharedCasinoWarMove.Play]);
        const dealResult = await this.makeMove(ctx, dealPayload);
        if (!dealResult.success) {
            return dealResult;
        }
        return {
            success: true,
            response: {
                ...(dealResult.response || {}),
                type: 'game_started',
                gameType: GameType.CasinoWar,
                sessionId: ctx.session.activeGameId?.toString(),
                bet: amount.toString(),
            },
        };
    }
    async handleWar(ctx) {
        // Go to war action
        const payload = new Uint8Array([SharedCasinoWarMove.War]);
        return this.makeMove(ctx, payload);
    }
    async handleSurrender(ctx) {
        const payload = new Uint8Array([SharedCasinoWarMove.Surrender]);
        return this.makeMove(ctx, payload);
    }
}
//# sourceMappingURL=casinowar.js.map