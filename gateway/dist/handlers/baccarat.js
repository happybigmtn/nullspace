/**
 * Baccarat game handler
 */
import { GameHandler } from './base.js';
import { GameType } from '../codec/index.js';
import { BACCARAT_BET_TYPES, encodeBaccaratBet } from '../codec/bet-types.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
export class BaccaratHandler extends GameHandler {
    constructor() {
        super(GameType.Baccarat);
    }
    async handleMessage(ctx, msg) {
        const msgType = msg.type;
        switch (msgType) {
            case 'baccarat_deal':
                return this.handleDeal(ctx, msg);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown baccarat message: ${msgType}`),
                };
        }
    }
    async handleDeal(ctx, msg) {
        const normalizedBets = [];
        const betsArray = Array.isArray(msg.bets) ? msg.bets : null;
        if (betsArray) {
            for (const bet of betsArray) {
                const betType = bet.type;
                const amount = bet.amount;
                if ((typeof betType !== 'number' && typeof betType !== 'string') || typeof amount !== 'number') {
                    return {
                        success: false,
                        error: createError(ErrorCodes.INVALID_BET, 'Invalid bet format'),
                    };
                }
                if (amount <= 0) {
                    return {
                        success: false,
                        error: createError(ErrorCodes.INVALID_BET, 'Bet amount must be positive'),
                    };
                }
                let encodedType;
                if (typeof betType === 'string') {
                    const betKey = betType.toUpperCase();
                    if (!(betKey in BACCARAT_BET_TYPES)) {
                        return {
                            success: false,
                            error: createError(ErrorCodes.INVALID_BET, `Invalid bet type: ${betType}`),
                        };
                    }
                    encodedType = encodeBaccaratBet(betKey);
                }
                else {
                    encodedType = betType;
                }
                normalizedBets.push({ betType: encodedType, amount });
            }
        }
        else if (msg.bets && typeof msg.bets === 'object') {
            const betMap = msg.bets;
            for (const [key, value] of Object.entries(betMap)) {
                if (typeof value !== 'number' || value <= 0) {
                    continue;
                }
                const betKey = key.toUpperCase();
                if (!(betKey in BACCARAT_BET_TYPES)) {
                    continue;
                }
                normalizedBets.push({ betType: encodeBaccaratBet(betKey), amount: value });
            }
        }
        else {
            const amount = msg.amount;
            const betType = msg.betType;
            if (typeof amount !== 'number' || amount <= 0) {
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_BET, 'Invalid bet amount'),
                };
            }
            if (!betType || !['player', 'banker', 'tie'].includes(betType)) {
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_BET, 'Invalid bet type (must be player, banker, or tie)'),
                };
            }
            const key = betType.toUpperCase();
            normalizedBets.push({ betType: encodeBaccaratBet(key), amount });
        }
        if (normalizedBets.length === 0) {
            return {
                success: false,
                error: createError(ErrorCodes.INVALID_BET, 'No bets placed'),
            };
        }
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        // Start game with bet=0; baccarat bets are deducted via moves.
        const startResult = await this.startGame(ctx, 0n, gameSessionId);
        if (!startResult.success) {
            return startResult;
        }
        // Atomic batch: place all bets + deal
        const payload = new Uint8Array(2 + normalizedBets.length * 9);
        const view = new DataView(payload.buffer);
        payload[0] = 3;
        payload[1] = normalizedBets.length;
        let offset = 2;
        for (const bet of normalizedBets) {
            payload[offset] = bet.betType;
            view.setBigUint64(offset + 1, BigInt(bet.amount), false);
            offset += 9;
        }
        return this.makeMove(ctx, payload);
    }
}
//# sourceMappingURL=baccarat.js.map