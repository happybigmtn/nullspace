/**
 * Blackjack game handler
 * Translates mobile JSON messages to backend transactions
 *
 * Blackjack has a multi-stage flow:
 * 1. CasinoStartGame puts game in Betting stage
 * 2. Deal move (4) deals cards and moves to PlayerTurn
 * 3. Hit/Stand/Double/Split moves during PlayerTurn
 * 4. Reveal move (6) resolves the hand after standing
 *
 * The handler chains these automatically for smooth mobile UX.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { BlackjackMove as SharedBlackjackMove } from '@nullspace/constants';
import { encodeGameMovePayload, withVersionHeader } from '@nullspace/protocol';
import type { BlackjackDealRequest, OutboundMessage } from '@nullspace/protocol/mobile';

/**
 * Blackjack move codes matching execution/src/casino/blackjack.rs
 * Uses shared move opcodes; SetRules remains a local admin-only opcode (unused by clients).
 */
const BlackjackMove = {
  Hit: SharedBlackjackMove.Hit,
  Stand: SharedBlackjackMove.Stand,
  Double: SharedBlackjackMove.Double,
  Split: SharedBlackjackMove.Split,
  Deal: SharedBlackjackMove.Deal,
  Set21Plus3: SharedBlackjackMove.Set21Plus3,
  Reveal: SharedBlackjackMove.Reveal,
  Surrender: SharedBlackjackMove.Surrender,
  SetRules: 8,  // Not in shared package yet
} as const;

export class BlackjackHandler extends GameHandler {
  constructor() {
    super(GameType.Blackjack);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: OutboundMessage
  ): Promise<HandleResult> {
    switch (msg.type) {
      case 'blackjack_deal':
        return this.handleDeal(ctx, msg);
      case 'blackjack_hit':
        return this.handleHit(ctx);
      case 'blackjack_stand':
        return this.handleStand(ctx);
      case 'blackjack_double':
        return this.handleDouble(ctx);
      case 'blackjack_split':
        return this.handleSplit(ctx);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown blackjack message: ${msg.type}`),
        };
    }
  }

  private async handleDeal(
    ctx: HandlerContext,
    msg: BlackjackDealRequest
  ): Promise<HandleResult> {
    const amount = msg.amount;
    const sideBet21Plus3 =
      msg.sideBet21Plus3 ?? msg.sideBet21p3 ?? 0;

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    // Step 1: Start game (enters Betting stage)
    const startResult = await this.startGame(ctx, BigInt(amount), gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    // Step 2: Send Deal move to actually deal cards (atomic deal when side bet is set)
    let dealPayload = encodeGameMovePayload({ game: 'blackjack', move: 'deal' });
    if (sideBet21Plus3 > 0) {
      const atomicDeal = new Uint8Array(9);
      atomicDeal[0] = 7; // atomic deal opcode (shares value with Surrender)
      new DataView(atomicDeal.buffer).setBigUint64(1, BigInt(sideBet21Plus3), false);
      dealPayload = withVersionHeader(atomicDeal);
    }
    const dealResult = await this.makeMove(ctx, dealPayload);

    if (!dealResult.success) {
      return dealResult;
    }

    // Merge the results - return game_started with dealt cards info
    // Spread dealResult.response FIRST, then override type to ensure it's 'game_started'
    return {
      success: true,
      response: {
        ...(dealResult.response || {}),
        type: 'game_started',
        gameType: GameType.Blackjack,
        sessionId: ctx.session.activeGameId?.toString(),
        bet: amount.toString(),
      },
    };
  }

  private async handleHit(ctx: HandlerContext): Promise<HandleResult> {
    const payload = encodeGameMovePayload({ game: 'blackjack', move: 'hit' });
    return this.makeMove(ctx, payload);
  }

  private async handleStand(ctx: HandlerContext): Promise<HandleResult> {
    const payload = encodeGameMovePayload({ game: 'blackjack', move: 'stand' });
    const standResult = await this.makeMove(ctx, payload);

    if (!standResult.success) {
      return standResult;
    }

    // If game moved to AwaitingReveal (not completed yet), auto-reveal
    // Check if we got a 'game_move' response (not 'game_result')
    if (standResult.response?.type === 'game_move') {
      // Send Reveal to resolve the hand
      const revealPayload = withVersionHeader(new Uint8Array([BlackjackMove.Reveal]));
      return this.makeMove(ctx, revealPayload);
    }

    return standResult;
  }

  private async handleDouble(ctx: HandlerContext): Promise<HandleResult> {
    const payload = encodeGameMovePayload({ game: 'blackjack', move: 'double' });
    const doubleResult = await this.makeMove(ctx, payload);

    if (!doubleResult.success) {
      return doubleResult;
    }

    // Double usually ends the hand - may need reveal
    if (doubleResult.response?.type === 'game_move') {
      const revealPayload = withVersionHeader(new Uint8Array([BlackjackMove.Reveal]));
      return this.makeMove(ctx, revealPayload);
    }

    return doubleResult;
  }

  private async handleSplit(ctx: HandlerContext): Promise<HandleResult> {
    const payload = encodeGameMovePayload({ game: 'blackjack', move: 'split' });
    return this.makeMove(ctx, payload);
  }
}
