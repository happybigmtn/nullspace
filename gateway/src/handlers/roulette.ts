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
import { ROULETTE_BET_NAMES, encodeRouletteBet, type RouletteBetName } from '@nullspace/constants/bet-types';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { RouletteMove as SharedRouletteMove } from '@nullspace/constants';

/**
 * Roulette action codes matching execution/src/casino/roulette.rs
 */
const RouletteAction = SharedRouletteMove;

export class RouletteHandler extends GameHandler {
  constructor() {
    super(GameType.Roulette);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const msgType = msg.type as string;

    switch (msgType) {
      case 'roulette_spin':
        return this.handleSpin(ctx, msg);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown roulette message: ${msgType}`),
        };
    }
  }

  private async handleSpin(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const bets = msg.bets as Array<{ type?: unknown; value?: unknown; number?: unknown; target?: unknown; amount?: unknown }> | undefined;

    if (!bets || !Array.isArray(bets) || bets.length === 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'No bets provided'),
      };
    }

    // Validate bets
    for (const bet of bets) {
      const amount = bet.amount;
      if (typeof amount !== 'number') {
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_BET, 'Invalid bet format'),
        };
      }
      if (amount <= 0) {
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_BET, 'Bet amount must be positive'),
        };
      }
    }

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    // Start game with bet=0; roulette bets are deducted via moves.
    const startResult = await this.startGame(ctx, 0n, gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    // Build atomic batch payload: [4, bet_count, bets...]
    // Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
    const payload = new Uint8Array(2 + bets.length * 10);
    const view = new DataView(payload.buffer);
    payload[0] = RouletteAction.AtomicBatch;
    payload[1] = bets.length;

    let offset = 2;
    for (const bet of bets) {
      const amount = bet.amount as number;
      const betType = bet.type;
      const rawValue = bet.value ?? bet.number ?? bet.target ?? 0;

      if (typeof betType !== 'number' && typeof betType !== 'string') {
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_BET, 'Invalid bet format'),
        };
      }

      const encoded = typeof betType === 'string'
        ? (() => {
            const betKey = betType.toUpperCase() as RouletteBetName;
            if (!ROULETTE_BET_NAMES.includes(betKey)) {
              return null;
            }
            return encodeRouletteBet(betKey, typeof rawValue === 'number' ? rawValue : undefined);
          })()
        : { type: betType, value: typeof rawValue === 'number' ? rawValue : 0 };

      if (!encoded) {
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_BET, `Invalid bet type: ${betType}`),
        };
      }

      payload[offset] = encoded.type;
      payload[offset + 1] = encoded.value;
      view.setBigUint64(offset + 2, BigInt(amount), false); // BE
      offset += 10;
    }

    return this.makeMove(ctx, payload);
  }
}
