/**
 * Casino War game handler
 *
 * TODO: Import CasinoWarMove from @nullspace/constants when complete
 * The shared package has PlaceBet=0, Deal=1, GoToWar=2, Surrender=3
 */
import { GameHandler, type HandlerContext, type HandleResult } from './base.js';
export declare class CasinoWarHandler extends GameHandler {
    constructor();
    handleMessage(ctx: HandlerContext, msg: Record<string, unknown>): Promise<HandleResult>;
    private handleDeal;
    private handleWar;
    private handleSurrender;
}
//# sourceMappingURL=casinowar.d.ts.map