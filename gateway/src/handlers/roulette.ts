/**
 * Roulette game handler
 *
 * Uses atomic batch (action 4) for placing bets and spinning in one transaction.
 *
 * Payload format from execution/src/casino/roulette.rs:
 * [4, bet_count, bets...] - Atomic batch: place all bets + spin in one transaction
 * Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import type { OutboundMessage, RouletteSpinRequest } from '@nullspace/protocol/mobile';
import { encodeAtomicBatchPayload, type RouletteAtomicBetInput } from '@nullspace/protocol';

export class RouletteHandler extends GameHandler {
  constructor() {
    super(GameType.Roulette);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: OutboundMessage
  ): Promise<HandleResult> {
    switch (msg.type) {
      case 'roulette_spin':
        return this.handleSpin(ctx, msg);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown roulette message: ${msg.type}`),
        };
    }
  }

  private async handleSpin(
    ctx: HandlerContext,
    msg: RouletteSpinRequest
  ): Promise<HandleResult> {
    const bets: RouletteAtomicBetInput[] = msg.bets.map((bet) => ({
      type: typeof bet.type === 'string' ? bet.type.toUpperCase() as RouletteAtomicBetInput['type'] : bet.type,
      amount: BigInt(bet.amount),
      target: bet.target,
      number: bet.number,
      value: bet.value,
    }));

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    // Start game with bet=0; roulette bets are deducted via moves.
    const startResult = await this.startGame(ctx, 0n, gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    try {
      const payload = encodeAtomicBatchPayload('roulette', bets);
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
