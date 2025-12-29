/**
 * Decodes chain events into typed TypeScript objects for rendering.
 *
 * This is DECODING ONLY - the chain has already computed game state.
 * We simply parse the binary event data into renderable types.
 */
import type { Card, GameType } from '@nullspace/types';
declare const STAGES: readonly ["betting", "playing", "dealer_turn", "complete"];
/** Decode a card from chain binary format */
export declare function decodeCard(data: Uint8Array, offset: number): Card;
/** Decode multiple cards from chain event payload */
export declare function decodeCards(data: Uint8Array, count: number, startOffset: number): Card[];
/** Decoded game result event */
export interface DecodedGameResult {
    sessionId: bigint;
    gameType: GameType;
    won: boolean;
    payout: bigint;
    message: string;
}
/** Decode a game result event */
export declare function decodeGameResult(data: Uint8Array): DecodedGameResult;
/** Decoded blackjack state event */
export interface DecodedBlackjackState {
    sessionId: bigint;
    playerCards: Card[];
    dealerCards: Card[];
    playerTotal: number;
    dealerTotal: number;
    stage: typeof STAGES[number];
    canHit: boolean;
    canStand: boolean;
    canDouble: boolean;
    canSplit: boolean;
}
/** Decode blackjack state update from chain */
export declare function decodeBlackjackState(data: Uint8Array): DecodedBlackjackState;
export {};
//# sourceMappingURL=decode.d.ts.map