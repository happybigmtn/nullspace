/**
 * Sic Bo game handler
 *
 * Uses atomic batch (action 3) for placing bets and rolling in one transaction.
 *
 * Payload format from execution/src/casino/sic_bo.rs:
 * [3, bet_count, bets...] - Atomic batch: place all bets + roll in one transaction
 * Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import type { OutboundMessage, SicBoLegacyRollRequest, SicBoRollRequest } from '@nullspace/protocol/mobile';
import { encodeAtomicBatchPayload, type SicBoAtomicBetInput } from '@nullspace/protocol';

export class SicBoHandler extends GameHandler {
  constructor() {
    super(GameType.SicBo);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: OutboundMessage
  ): Promise<HandleResult> {
    switch (msg.type) {
      case 'sicbo_roll':
      case 'sic_bo_roll':
        return this.handleRoll(ctx, msg);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown sicbo message: ${msg.type}`),
        };
    }
  }

  private async handleRoll(
    ctx: HandlerContext,
    msg: SicBoRollRequest | SicBoLegacyRollRequest
  ): Promise<HandleResult> {
    const bets: SicBoAtomicBetInput[] = msg.bets.map((bet: SicBoRollRequest['bets'][number]) => ({
      type: typeof bet.type === 'string' ? bet.type.toUpperCase() as SicBoAtomicBetInput['type'] : bet.type,
      amount: BigInt(bet.amount),
      target: bet.target,
      number: bet.number,
      value: bet.value,
    }));

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    // Start game with bet=0; sic bo bets are deducted via moves.
    const startResult = await this.startGame(ctx, 0n, gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    try {
      const payload = encodeAtomicBatchPayload('sicbo', bets);
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
