import type { Session } from './types/session.js';
export declare const trackGatewayResponse: (session: Session | undefined, response: Record<string, unknown>) => void;
export declare const trackGatewaySession: (session: Session | undefined) => void;
export declare const trackGatewayFaucet: (session: Session | undefined, amount: bigint) => void;
//# sourceMappingURL=ops.d.ts.map