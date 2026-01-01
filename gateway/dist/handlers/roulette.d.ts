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
import type { OutboundMessage } from '@nullspace/protocol/mobile';
export declare class RouletteHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: OutboundMessage): Promise<HandleResult>;
    private handleSpin;
}
//# sourceMappingURL=roulette.d.ts.map