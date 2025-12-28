/**
 * Ultimate Texas Hold'em game handler
 *
 * Multi-stage flow matching execution/src/casino/ultimate_holdem.rs:
 * 1. CasinoStartGame → Betting stage
 * 2. Deal move (4) → Preflop stage (player cards dealt)
 * 3. Check (0) or Bet 4x/3x → Flop or AwaitingReveal
 * 4. Check (0) or Bet 2x → River or AwaitingReveal
 * 5. Bet 1x (3) or Fold (5) → AwaitingReveal or Complete
 * 6. Reveal (7) → Showdown (Complete)
 */
import { GameHandler } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
/** Ultimate Holdem action codes matching execution/src/casino/ultimate_holdem.rs */
const UthAction = {
    Check: 0,
    Bet4x: 1,
    Bet2x: 2,
    Bet1x: 3,
    Fold: 4, // Fold is 4 in Rust
    Deal: 5, // Deal is 5 in Rust
    SetTrips: 6,
    Reveal: 7,
    Bet3x: 8,
    SetSixCardBonus: 9,
    SetProgressive: 10,
    AtomicDeal: 11,
    SetRules: 12,
};
export class UltimateHoldemHandler extends GameHandler {
    constructor() {
        super(GameType.UltimateHoldem);
    }
    async handleMessage(ctx, msg) {
        const msgType = msg.type;
        switch (msgType) {
            case 'ultimateholdem_deal':
            case 'ultimate_tx_deal':
                return this.handleDeal(ctx, msg);
            case 'ultimateholdem_bet':
            case 'ultimate_tx_bet':
                return this.handleBet(ctx, msg);
            case 'ultimateholdem_check':
            case 'ultimate_tx_check':
                return this.handleCheck(ctx);
            case 'ultimateholdem_fold':
            case 'ultimate_tx_fold':
                return this.handleFold(ctx);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown ultimateholdem message: ${msgType}`),
                };
        }
    }
    async handleDeal(ctx, msg) {
        const ante = typeof msg.ante === 'number' ? msg.ante : msg.anteBet;
        const blind = typeof msg.blind === 'number' ? msg.blind : msg.blindBet;
        const trips = (typeof msg.trips === 'number' ? msg.trips : msg.tripsBet);
        if (typeof ante !== 'number' || ante <= 0) {
            return {
                success: false,
                error: createError(ErrorCodes.INVALID_BET, 'Invalid ante amount'),
            };
        }
        if (typeof blind !== 'number' || blind <= 0) {
            return {
                success: false,
                error: createError(ErrorCodes.INVALID_BET, 'Invalid blind amount'),
            };
        }
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        // Step 1: Start game with ante only (blind is deducted on init; trips via Deal payload)
        const startResult = await this.startGame(ctx, BigInt(ante), gameSessionId);
        if (!startResult.success) {
            return startResult;
        }
        // Step 2: Send Deal move to deal cards (moves to Preflop stage)
        let dealPayload = new Uint8Array([UthAction.Deal]);
        if (typeof trips === 'number' && trips > 0) {
            dealPayload = new Uint8Array(1 + 8);
            dealPayload[0] = UthAction.Deal;
            new DataView(dealPayload.buffer).setBigUint64(1, BigInt(trips), false);
        }
        const dealResult = await this.makeMove(ctx, dealPayload);
        if (!dealResult.success) {
            return dealResult;
        }
        // Spread dealResult.response FIRST, then override type to ensure it's 'game_started'
        return {
            success: true,
            response: {
                ...(dealResult.response || {}),
                type: 'game_started',
                gameType: GameType.UltimateHoldem,
                sessionId: ctx.session.activeGameId?.toString(),
                ante: ante.toString(),
                blind: blind.toString(),
            },
        };
    }
    async handleBet(ctx, msg) {
        const multiplier = msg.multiplier;
        // Map multiplier to action code
        let action;
        switch (multiplier) {
            case 4:
                action = UthAction.Bet4x;
                break;
            case 3:
                action = UthAction.Bet3x;
                break;
            case 2:
                action = UthAction.Bet2x;
                break;
            case 1:
                action = UthAction.Bet1x;
                break;
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_BET, 'Invalid bet multiplier (must be 1, 2, 3, or 4)'),
                };
        }
        const payload = new Uint8Array([action]);
        const betResult = await this.makeMove(ctx, payload);
        if (!betResult.success) {
            return betResult;
        }
        // If in AwaitingReveal, auto-reveal
        if (betResult.response?.type === 'game_move') {
            const revealPayload = new Uint8Array([UthAction.Reveal]);
            return this.makeMove(ctx, revealPayload);
        }
        return betResult;
    }
    async handleCheck(ctx) {
        // Check action (0) - pass without betting
        const payload = new Uint8Array([UthAction.Check]);
        return this.makeMove(ctx, payload);
    }
    async handleFold(ctx) {
        // Fold action (5) - forfeit at river
        const payload = new Uint8Array([UthAction.Fold]);
        return this.makeMove(ctx, payload);
    }
}
//# sourceMappingURL=ultimateholdem.js.map