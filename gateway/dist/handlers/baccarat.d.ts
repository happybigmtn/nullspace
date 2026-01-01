/**
 * Baccarat game handler
 *
 * Uses shared bet types + move opcodes from @nullspace/constants.
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
import type { OutboundMessage } from '@nullspace/protocol/mobile';
export declare class BaccaratHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: OutboundMessage): Promise<HandleResult>;
    private handleDeal;
}
//# sourceMappingURL=baccarat.d.ts.map