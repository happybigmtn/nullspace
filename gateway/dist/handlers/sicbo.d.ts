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
import type { OutboundMessage } from '@nullspace/protocol/mobile';
export declare class SicBoHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: OutboundMessage): Promise<HandleResult>;
    private handleRoll;
}
//# sourceMappingURL=sicbo.d.ts.map