/**
 * Three Card Poker game handler
 *
 * Multi-stage flow matching execution/src/casino/three_card.rs:
 * 1. CasinoStartGame → Betting stage
 * 2. Deal move (2) → Decision stage (player cards dealt)
 * 3. Play (0) or Fold (1) → AwaitingReveal or Complete
 * 4. Reveal move (4) → Complete
 */
import { GameHandler } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { ThreeCardMove as SharedThreeCardMove } from '@nullspace/constants';
/**
 * Three Card Poker move codes matching execution/src/casino/three_card.rs
 * Now using shared constants directly from @nullspace/constants
 */
const ThreeCardMove = SharedThreeCardMove;
export class ThreeCardPokerHandler extends GameHandler {
    constructor() {
        super(GameType.ThreeCard);
    }
    async handleMessage(ctx, msg) {
        switch (msg.type) {
            case 'threecardpoker_deal':
            case 'three_card_poker_deal':
                return this.handleDeal(ctx, msg);
            case 'threecardpoker_play':
            case 'three_card_poker_play':
                return this.handlePlay(ctx);
            case 'threecardpoker_fold':
            case 'three_card_poker_fold':
                return this.handleFold(ctx);
            default:
                return {
                    success: false,
                    error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown threecardpoker message: ${msg.type}`),
                };
        }
    }
    async handleDeal(ctx, msg) {
        const ante = msg.ante;
        const pairPlus = msg.pairPlus ?? 0;
        const sixCard = msg.sixCard ?? msg.sixCardBonus ?? 0;
        const progressive = msg.progressive ?? 0;
        const gameSessionId = generateSessionId(ctx.session.publicKey, ctx.session.gameSessionCounter++);
        // Step 1: Start game with ante (pair plus placed via Deal payload)
        const startResult = await this.startGame(ctx, BigInt(ante), gameSessionId);
        if (!startResult.success) {
            return startResult;
        }
        // Step 2: Send Deal move to deal cards (atomic batch when side bets are set)
        const pairPlusValue = typeof pairPlus === 'number' ? pairPlus : 0;
        const hasSideBets = pairPlusValue > 0 || sixCard > 0 || progressive > 0;
        let dealPayload = new Uint8Array([ThreeCardMove.Deal]);
        if (hasSideBets) {
            dealPayload = new Uint8Array(25);
            dealPayload[0] = ThreeCardMove.AtomicDeal;
            const view = new DataView(dealPayload.buffer);
            view.setBigUint64(1, BigInt(pairPlusValue), false);
            view.setBigUint64(9, BigInt(sixCard), false);
            view.setBigUint64(17, BigInt(progressive), false);
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
                gameType: GameType.ThreeCard,
                sessionId: ctx.session.activeGameId?.toString(),
                ante: ante.toString(),
            },
        };
    }
    async handlePlay(ctx) {
        // Play action (0) - continue with hand
        const payload = new Uint8Array([ThreeCardMove.Play]);
        const playResult = await this.makeMove(ctx, payload);
        if (!playResult.success) {
            return playResult;
        }
        // If in AwaitingReveal, auto-reveal
        if (playResult.response?.type === 'game_move') {
            const revealPayload = new Uint8Array([ThreeCardMove.Reveal]);
            return this.makeMove(ctx, revealPayload);
        }
        return playResult;
    }
    async handleFold(ctx) {
        // Fold action (1) - forfeit ante
        const payload = new Uint8Array([ThreeCardMove.Fold]);
        return this.makeMove(ctx, payload);
    }
}
//# sourceMappingURL=threecardpoker.js.map