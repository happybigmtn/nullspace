/**
 * Hi-Lo game handler
 *
 * Handles HiLo game messages from mobile clients, submitting transactions
 * to the backend and returning real on-chain game results via the updates stream.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType, buildHiLoPayload } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
// Import shared HiLoMove from @nullspace/constants
import { HiLoMove as SharedHiLoMove } from '@nullspace/constants';

// TODO: The shared HiLoMove has Higher=1, Lower=2, CashOut=3
// This differs from local buildHiLoPayload which uses 0=higher, 1=lower, 3=same
// Need to verify which is correct against execution/src/casino/hilo.rs

export class HiLoHandler extends GameHandler {
  constructor() {
    super(GameType.HiLo);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const msgType = msg.type as string;

    switch (msgType) {
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
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown hilo message: ${msgType}`),
        };
    }
  }

  private async handleDeal(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const amount = msg.amount;
    if (typeof amount !== 'number' || amount <= 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid bet amount'),
      };
    }

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    return this.startGame(ctx, BigInt(amount), gameSessionId);
  }

  /**
   * Handle combined bet+choice from mobile app
   * Starts the game and immediately makes the guess, returning real on-chain results
   */
  private async handleBet(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const amount = msg.amount;
    const choice = msg.choice as string;

    if (typeof amount !== 'number' || amount <= 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid bet amount'),
      };
    }

    if (!['higher', 'lower'].includes(choice)) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'Invalid choice: must be higher or lower'),
      };
    }

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    // Start game on-chain
    const startResult = await this.startGame(ctx, BigInt(amount), gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    // Make the guess - base handler waits for real CasinoGameMoved/Completed events
    const payload = buildHiLoPayload(choice as 'higher' | 'lower');
    return this.makeMove(ctx, payload);
  }

  private async handleGuess(
    ctx: HandlerContext,
    guess: 'higher' | 'lower' | 'same'
  ): Promise<HandleResult> {
    const payload = buildHiLoPayload(guess);
    return this.makeMove(ctx, payload);
  }

  private async handleCashout(ctx: HandlerContext): Promise<HandleResult> {
    // Cash out: payload [2] as per execution/src/casino/hilo.rs Move enum
    const payload = new Uint8Array([2]);
    return this.makeMove(ctx, payload);
  }
}
