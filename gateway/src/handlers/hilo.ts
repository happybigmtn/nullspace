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
import type { HiLoBetRequest, HiLoDealRequest, OutboundMessage } from '@nullspace/protocol/mobile';
import { HiLoMove as SharedHiLoMove } from '@nullspace/constants';

export class HiLoHandler extends GameHandler {
  constructor() {
    super(GameType.HiLo);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: OutboundMessage
  ): Promise<HandleResult> {
    switch (msg.type) {
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
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown hilo message: ${msg.type}`),
        };
    }
  }

  private async handleDeal(
    ctx: HandlerContext,
    msg: HiLoDealRequest
  ): Promise<HandleResult> {
    const amount = msg.amount;

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
    msg: HiLoBetRequest
  ): Promise<HandleResult> {
    const amount = msg.amount;
    const choice = msg.choice;

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
    const payload = buildHiLoPayload(choice);
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
    const payload = new Uint8Array([SharedHiLoMove.Cashout]);
    return this.makeMove(ctx, payload);
  }
}
