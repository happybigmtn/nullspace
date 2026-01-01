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
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { UltimateHoldemMove as SharedUltimateHoldemMove } from '@nullspace/constants';
import type {
  OutboundMessage,
  UltimateTXBetRequest,
  UltimateTXDealRequest,
  UltimateTXLegacyBetRequest,
  UltimateTXLegacyDealRequest,
} from '@nullspace/protocol/mobile';

/**
 * Ultimate Holdem action codes matching execution/src/casino/ultimate_holdem.rs
 * Now using shared constants directly from @nullspace/constants
 */
const UthAction = SharedUltimateHoldemMove;

export class UltimateHoldemHandler extends GameHandler {
  constructor() {
    super(GameType.UltimateHoldem);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: OutboundMessage
  ): Promise<HandleResult> {
    switch (msg.type) {
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
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown ultimateholdem message: ${msg.type}`),
        };
    }
  }

  private async handleDeal(
    ctx: HandlerContext,
    msg: UltimateTXDealRequest | UltimateTXLegacyDealRequest
  ): Promise<HandleResult> {
    const ante = msg.ante;
    const blind = msg.blind;
    const trips = msg.trips ?? 0;
    const sixCard = msg.sixCard ?? msg.sixCardBonus ?? 0;
    const progressive = msg.progressive ?? 0;

    if (progressive !== 0 && progressive !== 1) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Progressive bet must be 0 or 1'),
      };
    }

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    // Step 1: Start game with ante only (blind is deducted on init; trips via Deal payload)
    const startResult = await this.startGame(ctx, BigInt(ante), gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    // Step 2: Send Deal move to deal cards (atomic batch when side bets are set)
    const tripsValue = typeof trips === 'number' ? trips : 0;
    const hasSideBets = tripsValue > 0 || sixCard > 0 || progressive > 0;
    let dealPayload = new Uint8Array([UthAction.Deal]);
    if (hasSideBets) {
      dealPayload = new Uint8Array(25);
      dealPayload[0] = UthAction.AtomicDeal;
      const view = new DataView(dealPayload.buffer);
      view.setBigUint64(1, BigInt(tripsValue), false);
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
        gameType: GameType.UltimateHoldem,
        sessionId: ctx.session.activeGameId?.toString(),
        ante: ante.toString(),
        blind: blind.toString(),
      },
    };
  }

  private async handleBet(
    ctx: HandlerContext,
    msg: UltimateTXBetRequest | UltimateTXLegacyBetRequest
  ): Promise<HandleResult> {
    const multiplier = msg.multiplier;
    const action = multiplier === 4
      ? UthAction.Bet4x
      : multiplier === 3
        ? UthAction.Bet3x
        : multiplier === 2
          ? UthAction.Bet2x
          : UthAction.Bet1x;

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

  private async handleCheck(ctx: HandlerContext): Promise<HandleResult> {
    // Check action (0) - pass without betting
    const payload = new Uint8Array([UthAction.Check]);
    return this.makeMove(ctx, payload);
  }

  private async handleFold(ctx: HandlerContext): Promise<HandleResult> {
    // Fold action (5) - forfeit at river
    const payload = new Uint8Array([UthAction.Fold]);
    return this.makeMove(ctx, payload);
  }
}
