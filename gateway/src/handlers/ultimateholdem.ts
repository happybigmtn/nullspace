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
// Import shared UltimateHoldemMove from @nullspace/constants
import { UltimateHoldemMove as SharedUltimateHoldemMove } from '@nullspace/constants';

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
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const msgType = msg.type as string;

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

  private async handleDeal(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const ante = typeof msg.ante === 'number' ? msg.ante : msg.anteBet;
    const blind = typeof msg.blind === 'number' ? msg.blind : msg.blindBet;
    const trips = (typeof msg.trips === 'number' ? msg.trips : msg.tripsBet) as number | undefined;
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

    if (typeof blind !== 'number' || blind <= 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid blind amount'),
      };
    }
    if (typeof trips === 'number' && trips < 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid trips amount'),
      };
    }
    if (typeof sixCard !== 'number' || sixCard < 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid six-card amount'),
      };
    }
    if (typeof progressive !== 'number' || progressive < 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid progressive amount'),
      };
    }
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
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const multiplier = msg.multiplier as number | undefined;

    // Map multiplier to action code
    let action: number;
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
