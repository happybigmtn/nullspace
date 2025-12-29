/**
 * Codec for parsing backend Update events
 *
 * The backend sends binary-encoded Update messages via WebSocket.
 * This module decodes them and extracts casino game events.
 *
 * TODO: Consider using @nullspace/protocol decode functions for card/game result decoding
 * The protocol package has decodeCard, decodeCards, decodeGameResult, decodeBlackjackState
 * However, the gateway-specific Update/FilteredEvents parsing is unique to this module.
 */
/**
 * Event tags matching Rust nullspace_types::execution::tags::event
 */
export declare const EVENT_TAGS: {
    readonly CASINO_GAME_STARTED: 21;
    readonly CASINO_GAME_MOVED: 22;
    readonly CASINO_GAME_COMPLETED: 23;
    readonly CASINO_ERROR: 29;
};
/**
 * Parsed casino game event
 */
export interface CasinoGameEvent {
    type: 'started' | 'moved' | 'completed' | 'error';
    sessionId: bigint;
    gameType?: number;
    player?: Uint8Array;
    bet?: bigint;
    initialState?: Uint8Array;
    moveNumber?: number;
    newState?: Uint8Array;
    logs?: string[];
    payout?: bigint;
    finalChips?: bigint;
    wasShielded?: boolean;
    wasDoubled?: boolean;
    errorCode?: number;
    errorMessage?: string;
}
/**
 * Extract casino game events from an Update message
 *
 * The Update structure:
 * - Update::Seed(0) - heartbeat, skip
 * - Update::Events(1) - contains events_proof_ops
 * - Update::FilteredEvents(2) - contains (u64 location, Output) pairs
 *
 * FilteredEvents structure:
 * [02][Progress ~120 bytes][Certificate ~100+ bytes][Proof variable][events_proof_ops: Vec<(u64, Output)>]
 *
 * Each element in events_proof_ops:
 * [u64 location][Output discriminant: u8][if Event: tag + data]
 *
 * Output enum: Event(0), Transaction(1), Commit(2)
 */
export declare function extractCasinoEvents(data: Uint8Array): CasinoGameEvent[];
/**
 * Parse a single casino game event from raw event data
 * (when we know the exact boundary of the event)
 */
export declare function parseCasinoEvent(data: Uint8Array): CasinoGameEvent | null;
/**
 * Parse JSON game log from logs array
 */
export declare function parseGameLog(log: string): Record<string, unknown> | null;
//# sourceMappingURL=events.d.ts.map