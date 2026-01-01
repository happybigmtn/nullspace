/**
 * Video Poker game handler
 *
 * Payload uses a hold mask; there is no move opcode for deal/draw.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import { GameType, buildVideoPokerPayload } from '../codec/index.js';
import { generateSessionId } from '../codec/transactions.js';
import { ErrorCodes, createError } from '../types/errors.js';
import type {
  OutboundMessage,
  VideoPokerDealRequest,
  VideoPokerDrawRequest,
  VideoPokerLegacyDealRequest,
  VideoPokerLegacyHoldRequest,
} from '@nullspace/protocol/mobile';

export class VideoPokerHandler extends GameHandler {
  constructor() {
    super(GameType.VideoPoker);
  }

  async handleMessage(
    ctx: HandlerContext,
    msg: OutboundMessage
  ): Promise<HandleResult> {
    switch (msg.type) {
      case 'videopoker_deal':
      case 'video_poker_deal':
        return this.handleDeal(ctx, msg);
      case 'videopoker_hold':
      case 'video_poker_draw':
        return this.handleHold(ctx, msg);
      default:
        return {
          success: false,
          error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown videopoker message: ${msg.type}`),
        };
    }
  }

  private async handleDeal(
    ctx: HandlerContext,
    msg: VideoPokerDealRequest | VideoPokerLegacyDealRequest
  ): Promise<HandleResult> {
    const amount = msg.amount;

    const gameSessionId = generateSessionId(
      ctx.session.publicKey,
      ctx.session.gameSessionCounter++
    );

    return this.startGame(ctx, BigInt(amount), gameSessionId);
  }

  private async handleHold(
    ctx: HandlerContext,
    msg: VideoPokerDrawRequest | VideoPokerLegacyHoldRequest
  ): Promise<HandleResult> {
    const holds = msg.type === 'video_poker_draw' ? msg.held : msg.holds;
    const payload = buildVideoPokerPayload(holds);
    return this.makeMove(ctx, payload);
  }
}
