/**
 * Ultimate Texas Hold'em game handler
 *
 * Multi-stage flow matching execution/src/casino/ultimate_holdem.rs:
 * 1. CasinoStartGame → Betting stage
 * 2. Deal move (4) → Preflop stage (player cards dealt)
 * 3. Check (0) or Bet 4x/3x → Flop or AwaitingReveal
 * 4. Check (0) or Bet 2x → River or AwaitingReveal
 * 5. Bet 1x (3) or Fold (5) → AwaitingReveal or Complete
 * 6. Reveal (7) → Showdown (Complete)
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import type { OutboundMessage } from '@nullspace/protocol/mobile';
export declare class UltimateHoldemHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: OutboundMessage): Promise<HandleResult>;
    private handleDeal;
    private handleBet;
    private handleCheck;
    private handleFold;
}
//# sourceMappingURL=ultimateholdem.d.ts.map