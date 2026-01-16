/**
 * Craps game handler
 *
 * Uses atomic batch (action 4) for placing bets and rolling in one transaction.
 * This is more efficient than chaining separate bet + roll moves.
 *
 * Payload format from execution/src/casino/craps.rs:
 * [4, bet_count, bets...] - Atomic batch: place all bets + roll in one transaction
 * Each bet is 10 bytes: [bet_type:u8, target:u8, amount:u64 BE]
 *
 * NOTE: Live-table mode is disabled per specs/gateway-live-mode-deferment.md.
 * Live craps messages (craps_live_join, craps_live_leave, craps_live_bet) return
 * LIVE_MODE_DISABLED errors. Standard session-based craps remains fully functional.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import type {
  CrapsRollRequest,
  CrapsSingleBetRequest,
  OutboundMessage,
} from '@nullspace/protocol/mobile';
import { encodeAtomicBatchPayload, type CrapsAtomicBetInput } from '@nullspace/protocol';

export class CrapsHandler extends GameHandler {
  constructor() {
    super(GameType.Craps);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: OutboundMessage
  ): Promise<HandleResult> {
    switch (msg.type) {
      // Live-table mode disabled (AC-1.2)
      case 'craps_live_join':
      case 'craps_live_leave':
      case 'craps_live_bet':
        return {
          success: false,
          error: createError(
            ErrorCodes.LIVE_MODE_DISABLED,
            'Live table mode is disabled. Use standard craps_bet/craps_roll for session-based play.'
          ),
        };
      case 'craps_bet':
        return this.handleBet(ctx, msg);
      case 'craps_roll':
        return this.handleBet(ctx, msg);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown craps message: ${msg.type}`),
        };
    }
  }

  private async handleBet(
    ctx: HandlerContext,
    msg: CrapsSingleBetRequest | CrapsRollRequest
  ): Promise<HandleResult> {
    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    // Start game with bet=0 (Craps requires bet as first move, not at start).
    const startResult = await this.startGame(ctx, 0n, gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    const normalizeType = (value: string | number): CrapsAtomicBetInput['type'] => (
      typeof value === 'string' ? value.toUpperCase() as CrapsAtomicBetInput['type'] : value
    );

    const bets: CrapsAtomicBetInput[] = msg.type === 'craps_bet'
      ? [{
          type: normalizeType(msg.betType),
          amount: BigInt(msg.amount),
          target: msg.target,
        }]
      : msg.bets.map((bet) => ({
          type: normalizeType(bet.type),
          amount: BigInt(bet.amount),
          target: bet.target,
        }));

    try {
      const payload = encodeAtomicBatchPayload('craps', bets);
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
