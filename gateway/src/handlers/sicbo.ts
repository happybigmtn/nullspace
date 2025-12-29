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
import { SICBO_BET_TYPES, encodeSicBoBet, type SicBoBetName } from '@nullspace/constants/bet-types';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { SicBoMove as SharedSicBoMove } from '@nullspace/constants';

/**
 * Sic Bo action codes matching execution/src/casino/sic_bo.rs
 */
const SicBoAction = SharedSicBoMove;

export class SicBoHandler extends GameHandler {
  constructor() {
    super(GameType.SicBo);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const msgType = msg.type as string;

    switch (msgType) {
      case 'sicbo_roll':
      case 'sic_bo_roll':
        return this.handleRoll(ctx, msg);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown sicbo message: ${msgType}`),
        };
    }
  }

  private async handleRoll(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const bets = msg.bets as Array<{ type?: unknown; number?: unknown; target?: unknown; value?: unknown; amount?: unknown }> | undefined;

    if (!bets || !Array.isArray(bets) || bets.length === 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'No bets provided'),
      };
    }

    // Validate bets
    for (const bet of bets) {
      if (typeof bet.amount !== 'number' || (typeof bet.type !== 'number' && typeof bet.type !== 'string')) {
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_BET, 'Invalid bet format'),
        };
      }
      if (bet.amount <= 0) {
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

    // Start game with bet=0; sic bo bets are deducted via moves.
    const startResult = await this.startGame(ctx, 0n, gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    // Build atomic batch payload: [3, bet_count, bets...]
    // Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
    const payload = new Uint8Array(2 + bets.length * 10);
    const view = new DataView(payload.buffer);
    payload[0] = SicBoAction.AtomicBatch;
    payload[1] = bets.length;

    let offset = 2;
    for (const bet of bets) {
      const betType = bet.type as number | string;
      const amount = bet.amount as number;
      const rawNumber = bet.number ?? bet.target ?? bet.value ?? 0;
      const encoded = typeof betType === 'string'
        ? (() => {
            const betKey = betType.toUpperCase() as SicBoBetName;
            if (!(betKey in SICBO_BET_TYPES)) {
              return null;
            }
            return encodeSicBoBet(betKey, typeof rawNumber === 'number' ? rawNumber : undefined);
          })()
        : { betType, target: typeof rawNumber === 'number' ? rawNumber : 0 };

      if (!encoded) {
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_BET, `Invalid bet type: ${betType}`),
        };
      }

      payload[offset] = encoded.betType;
      payload[offset + 1] = encoded.target; // target is 0 for simple bets like Small/Big
      view.setBigUint64(offset + 2, BigInt(amount), false); // BE
      offset += 10;
    }

    return this.makeMove(ctx, payload);
  }
}
