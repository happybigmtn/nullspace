/**
 * Craps game handler
 *
 * Uses atomic batch (action 4) for placing bets and rolling in one transaction.
 * This is more efficient than chaining separate bet + roll moves.
 *
 * Payload format from execution/src/casino/craps.rs:
 * [4, bet_count, bets...] - Atomic batch: place all bets + roll in one transaction
 * Each bet is 10 bytes: [bet_type:u8, target:u8, amount:u64 BE]
 */
import { GameHandler } from './base.js';
import { GameType } from '../codec/index.js';
import { CRAPS_BET_TYPES, encodeCrapsBet } from '../codec/bet-types.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
/** Craps action codes matching execution/src/casino/craps.rs */
const CrapsAction = {
    PlaceBet: 0,
    AddOdds: 1,
    Roll: 2,
    ClearBets: 3,
    AtomicBatch: 4,
};
export class CrapsHandler extends GameHandler {
    constructor() {
        super(GameType.Craps);
    }
    async handleMessage(ctx, msg) {
        const msgType = msg.type;
        switch (msgType) {
            case 'craps_bet':
                return this.handleBet(ctx, msg);
            case 'craps_roll':
                if (Array.isArray(msg.bets)) {
                    return this.handleBet(ctx, msg);
                }
                return this.handleRoll(ctx);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown craps message: ${msgType}`),
                };
        }
    }
    async handleBet(ctx, msg) {
        const bets = Array.isArray(msg.bets) ? msg.bets : null;
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        // Start game with bet=0 (Craps requires bet as first move, not at start).
        const startResult = await this.startGame(ctx, 0n, gameSessionId);
        if (!startResult.success) {
            return startResult;
        }
        if (!bets) {
            const betType = msg.betType;
            const amount = msg.amount;
            const target = msg.target;
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
            const encoded = typeof betType === 'string'
                ? (() => {
                    const betKey = betType.toUpperCase();
                    if (!(betKey in CRAPS_BET_TYPES)) {
                        return null;
                    }
                    return encodeCrapsBet(betKey, target);
                })()
                : { betType, target: target ?? 0 };
            if (!encoded) {
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_BET, `Invalid bet type: ${betType}`),
                };
            }
            // Use atomic batch: place bet + roll in one transaction
            // Format: [4, bet_count=1, bet_type, target, amount_u64_BE]
            const payload = new Uint8Array(12); // 1 + 1 + 10 bytes per bet
            const view = new DataView(payload.buffer);
            payload[0] = CrapsAction.AtomicBatch;
            payload[1] = 1; // bet_count
            payload[2] = encoded.betType;
            payload[3] = encoded.target;
            view.setBigUint64(4, BigInt(amount), false); // BE
            return this.makeMove(ctx, payload);
        }
        if (bets.length === 0) {
            return {
                success: false,
                error: createError(ErrorCodes.INVALID_BET, 'No bets provided'),
            };
        }
        const payload = new Uint8Array(2 + bets.length * 10);
        const view = new DataView(payload.buffer);
        payload[0] = CrapsAction.AtomicBatch;
        payload[1] = bets.length;
        let offset = 2;
        for (const bet of bets) {
            const betType = bet.type;
            const amount = bet.amount;
            const target = bet.target;
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
            const encoded = typeof betType === 'string'
                ? (() => {
                    const betKey = betType.toUpperCase();
                    if (!(betKey in CRAPS_BET_TYPES)) {
                        return null;
                    }
                    return encodeCrapsBet(betKey, typeof target === 'number' ? target : undefined);
                })()
                : { betType, target: typeof target === 'number' ? target : 0 };
            if (!encoded) {
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_BET, `Invalid bet type: ${betType}`),
                };
            }
            payload[offset] = encoded.betType;
            payload[offset + 1] = encoded.target;
            view.setBigUint64(offset + 2, BigInt(amount), false);
            offset += 10;
        }
        return this.makeMove(ctx, payload);
    }
    async handleRoll(ctx) {
        // Roll the dice (action 2)
        const payload = new Uint8Array([CrapsAction.Roll]);
        return this.makeMove(ctx, payload);
    }
}
//# sourceMappingURL=craps.js.map