/**
 * Baccarat game handler
 *
 * Uses shared bet types + move opcodes from @nullspace/constants.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import type { BaccaratDealRequest, OutboundMessage } from '@nullspace/protocol/mobile';
import { encodeAtomicBatchPayload } from '@nullspace/protocol';

export class BaccaratHandler extends GameHandler {
  constructor() {
    super(GameType.Baccarat);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: OutboundMessage
  ): Promise<HandleResult> {
    switch (msg.type) {
      case 'baccarat_deal':
        return this.handleDeal(ctx, msg);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown baccarat message: ${msg.type}`),
        };
    }
  }

  private async handleDeal(
    ctx: HandlerContext,
    msg: BaccaratDealRequest
  ): Promise<HandleResult> {
    const bets = msg.bets.map((bet) => ({
      type: bet.type,
      amount: BigInt(bet.amount),
    }));

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    // Start game with bet=0; baccarat bets are deducted via moves.
    const startResult = await this.startGame(ctx, 0n, gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    try {
      const payload = encodeAtomicBatchPayload('baccarat', bets);
      return this.makeMove(ctx, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid bet payload';
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, message),
      };
    }
  }
}
