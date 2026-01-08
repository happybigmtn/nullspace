/**
 * Decodes chain events into typed TypeScript objects for rendering.
 *
 * This is DECODING ONLY - the chain has already computed game state.
 * We simply parse the binary event data into renderable types.
 *
 * This module also provides utilities for validating protocol version headers
 * on encoded messages.
 */
import type { Card, GameType } from '@nullspace/types';
import { validateVersion, stripVersionHeader, peekVersion, UnsupportedProtocolVersionError, CURRENT_PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, MAX_PROTOCOL_VERSION } from './version.js';
export { validateVersion, stripVersionHeader, peekVersion, UnsupportedProtocolVersionError, CURRENT_PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, MAX_PROTOCOL_VERSION, };
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
/**
 * Decoded versioned payload result
 */
export interface DecodedVersionedPayload {
    /** Protocol version from the header */
    version: number;
    /** The opcode (first byte after version) */
    opcode: number;
    /** Raw payload data (after version byte) */
    payload: Uint8Array;
}
/**
 * Decode a versioned game move payload
 *
 * Validates the version header and extracts the opcode and payload.
 * Use this when receiving encoded messages to validate protocol compatibility.
 *
 * @throws UnsupportedProtocolVersionError if version is not supported
 * @throws ProtocolError if message is too short
 */
export declare function decodeVersionedPayload(data: Uint8Array): DecodedVersionedPayload;
/**
 * Check if a payload has a valid version header without throwing
 *
 * Returns the version if valid, or null if invalid/missing
 */
export declare function tryDecodeVersion(data: Uint8Array): {
    version: number;
    isSupported: boolean;
} | null;
//# sourceMappingURL=decode.d.ts.map