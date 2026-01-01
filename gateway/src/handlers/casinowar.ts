/**
 * Casino War game handler
 *
 * Uses shared CasinoWarMove constants to align with execution enum values.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import { CasinoWarMove as SharedCasinoWarMove } from '@nullspace/constants';

export class CasinoWarHandler extends GameHandler {
  constructor() {
    super(GameType.CasinoWar);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const msgType = msg.type as string;

    switch (msgType) {
      case 'casinowar_deal':
      case 'casino_war_deal':
        return this.handleDeal(ctx, msg);
      case 'casinowar_war':
      case 'casino_war_war':
        return this.handleWar(ctx);
      case 'casinowar_surrender':
      case 'casino_war_surrender':
        return this.handleSurrender(ctx);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown casinowar message: ${msgType}`),
        };
    }
  }

  private async handleDeal(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult> {
    const amount = msg.amount;
    const tieBet =
      typeof msg.tieBet === 'number'
        ? msg.tieBet
        : typeof msg.tieBetAmount === 'number'
          ? msg.tieBetAmount
          : 0;
    if (typeof amount !== 'number' || amount <= 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid bet amount'),
      };
    }
    if (typeof tieBet !== 'number' || tieBet < 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Invalid tie bet amount'),
      };
    }

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    const startResult = await this.startGame(ctx, BigInt(amount), gameSessionId);
    if (!startResult.success) {
      return startResult;
    }

    if (tieBet > 0) {
      const tiePayload = new Uint8Array(9);
      tiePayload[0] = SharedCasinoWarMove.SetTieBet;
      new DataView(tiePayload.buffer).setBigUint64(1, BigInt(tieBet), false);
      const tieResult = await this.makeMove(ctx, tiePayload);
      if (!tieResult.success) {
        return tieResult;
      }
    }

    const dealPayload = new Uint8Array([SharedCasinoWarMove.Play]);
    const dealResult = await this.makeMove(ctx, dealPayload);

    if (!dealResult.success) {
      return dealResult;
    }

    return {
      success: true,
      response: {
        ...(dealResult.response || {}),
        type: 'game_started',
        gameType: GameType.CasinoWar,
        sessionId: ctx.session.activeGameId?.toString(),
        bet: amount.toString(),
      },
    };
  }

  private async handleWar(ctx: HandlerContext): Promise<HandleResult> {
    // Go to war action
    const payload = new Uint8Array([SharedCasinoWarMove.War]);
    return this.makeMove(ctx, payload);
  }

  private async handleSurrender(ctx: HandlerContext): Promise<HandleResult> {
    const payload = new Uint8Array([SharedCasinoWarMove.Surrender]);
    return this.makeMove(ctx, payload);
  }
}
