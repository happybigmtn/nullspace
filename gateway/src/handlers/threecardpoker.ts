/**
 * Three Card Poker game handler
 *
 * Multi-stage flow matching execution/src/casino/three_card.rs:
 * 1. CasinoStartGame → Betting stage
 * 2. Deal move (2) → Decision stage (player cards dealt)
 * 3. Play (0) or Fold (1) → AwaitingReveal or Complete
 * 4. Reveal move (4) → Complete
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
// Import shared ThreeCardMove from @nullspace/constants
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

  async handleMessage(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const msgType = msg.type as string;

    switch (msgType) {
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
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown threecardpoker message: ${msgType}`),
        };
    }
  }

  private async handleDeal(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const ante = typeof msg.ante === 'number' ? msg.ante : msg.anteBet;
    const pairPlus = (typeof msg.pairPlus === 'number' ? msg.pairPlus : msg.pairPlusBet) as number | undefined;
    const sixCard =
      typeof msg.sixCard === 'number'
        ? msg.sixCard
        : typeof msg.sixCardBonus === 'number'
          ? msg.sixCardBonus
          : typeof msg.sixCardBet === 'number'
            ? msg.sixCardBet
            : 0;
    const progressive =
      typeof msg.progressive === 'number'
        ? msg.progressive
        : typeof msg.progressiveBet === 'number'
          ? msg.progressiveBet
          : 0;

    if (typeof ante !== 'number' || ante <= 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid ante amount'),
      };
    }
    if (typeof pairPlus === 'number' && pairPlus < 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid Pair Plus amount'),
      };
    }
    if (typeof sixCard !== 'number' || sixCard < 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid Six Card amount'),
      };
    }
    if (typeof progressive !== 'number' || progressive < 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid progressive amount'),
      };
    }

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

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

  private async handlePlay(ctx: HandlerContext): Promise<HandleResult> {
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

  private async handleFold(ctx: HandlerContext): Promise<HandleResult> {
    // Fold action (1) - forfeit ante
    const payload = new Uint8Array([ThreeCardMove.Fold]);
    return this.makeMove(ctx, payload);
  }
}
