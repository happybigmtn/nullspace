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
export const EVENT_TAGS = {
    CASINO_GAME_STARTED: 21,
    CASINO_GAME_MOVED: 22,
    CASINO_GAME_COMPLETED: 23,
    CASINO_ERROR: 29,
};
/**
 * Binary reader helper class
 */
class BinaryReader {
    view;
    offset;
    data;
    constructor(data) {
        this.data = data;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.offset = 0;
    }
    get remaining() {
        return this.data.length - this.offset;
    }
    readU8() {
        if (this.offset >= this.data.length)
            throw new Error('End of buffer');
        return this.data[this.offset++];
    }
    readU16LE() {
        if (this.remaining < 2)
            throw new Error('End of buffer');
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }
    readU32LE() {
        if (this.remaining < 4)
            throw new Error('End of buffer');
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }
    /**
     * Read u32 as Big Endian (commonware-codec format)
     */
    readU32BE() {
        if (this.remaining < 4)
            throw new Error('End of buffer');
        const value = this.view.getUint32(this.offset, false); // false = BE
        this.offset += 4;
        return value;
    }
    readI64LE() {
        if (this.remaining < 8)
            throw new Error('End of buffer');
        const value = this.view.getBigInt64(this.offset, true);
        this.offset += 8;
        return value;
    }
    /**
     * Read signed i64 as Big Endian (commonware-codec format)
     */
    readI64BE() {
        if (this.remaining < 8)
            throw new Error('End of buffer');
        const value = this.view.getBigInt64(this.offset, false); // false = BE
        this.offset += 8;
        return value;
    }
    /**
     * Read u64 as Little Endian (legacy, kept for compatibility)
     */
    readU64LE() {
        if (this.remaining < 8)
            throw new Error('End of buffer');
        const value = this.view.getBigUint64(this.offset, true);
        this.offset += 8;
        return value;
    }
    /**
     * Read u64 as Big Endian (commonware-codec format)
     */
    readU64BE() {
        if (this.remaining < 8)
            throw new Error('End of buffer');
        const value = this.view.getBigUint64(this.offset, false); // false = BE
        this.offset += 8;
        return value;
    }
    readBool() {
        return this.readU8() !== 0;
    }
    readBytes(length) {
        if (this.remaining < length)
            throw new Error('End of buffer');
        const bytes = this.data.slice(this.offset, this.offset + length);
        this.offset += length;
        return bytes;
    }
    readPublicKey() {
        return this.readBytes(32);
    }
    /**
     * Read a varint-encoded unsigned integer (LEB128 format used by commonware-codec)
     * See: https://en.wikipedia.org/wiki/LEB128
     */
    readVarint() {
        let result = 0;
        let shift = 0;
        while (true) {
            if (this.offset >= this.data.length)
                throw new Error('End of buffer reading varint');
            const byte = this.data[this.offset++];
            result |= (byte & 0x7f) << shift;
            if ((byte & 0x80) === 0)
                break;
            shift += 7;
            if (shift > 35)
                throw new Error('Varint too long');
        }
        return result;
    }
    readVec() {
        const length = this.readVarint();
        if (length > 10000) {
            throw new Error(`Vec length ${length} too large (remaining=${this.remaining})`);
        }
        return this.readBytes(length);
    }
    readString() {
        const bytes = this.readVec();
        return new TextDecoder().decode(bytes);
    }
    readStringVec() {
        const count = this.readVarint();
        const strings = [];
        for (let i = 0; i < count; i++) {
            strings.push(this.readString());
        }
        return strings;
    }
    readOptionU64LE() {
        const hasValue = this.readBool();
        if (hasValue) {
            return this.readU64LE();
        }
        return null;
    }
    /**
     * Read Option<u64> in Big Endian (commonware-codec format)
     */
    readOptionU64BE() {
        const hasValue = this.readBool();
        if (hasValue) {
            return this.readU64BE();
        }
        return null;
    }
    // Skip PlayerBalanceSnapshot (we don't need to parse it fully)
    skipPlayerBalanceSnapshot() {
        // PlayerBalanceSnapshot { chips: u64, vusdt: u64, rng: u64 }
        this.offset += 24; // 3 * 8 bytes
    }
    skip(bytes) {
        this.offset += bytes;
    }
}
/**
 * Parse a CasinoGameStarted event
 * Uses Big Endian for u64 fields (commonware-codec format)
 */
function parseCasinoGameStarted(reader) {
    const sessionId = reader.readU64BE();
    const player = reader.readPublicKey();
    const gameType = reader.readU8();
    const bet = reader.readU64BE();
    const initialState = reader.readVec();
    return {
        type: 'started',
        sessionId,
        player,
        gameType,
        bet,
        initialState,
    };
}
/**
 * Parse a CasinoGameMoved event
 * Uses Big Endian for u64 fields (commonware-codec format)
 */
function parseCasinoGameMoved(reader) {
    const sessionId = reader.readU64BE();
    const moveNumber = reader.readU32BE();
    const newState = reader.readVec();
    const logs = reader.readStringVec();
    reader.skipPlayerBalanceSnapshot();
    return {
        type: 'moved',
        sessionId,
        moveNumber,
        newState,
        logs,
    };
}
/**
 * Parse a CasinoGameCompleted event
 * Uses Big Endian for u64/i64 fields (commonware-codec format)
 */
function parseCasinoGameCompleted(reader) {
    const sessionId = reader.readU64BE();
    const player = reader.readPublicKey();
    const gameType = reader.readU8();
    const payout = reader.readI64BE();
    const finalChips = reader.readU64BE();
    const wasShielded = reader.readBool();
    const wasDoubled = reader.readBool();
    const logs = reader.readStringVec();
    reader.skipPlayerBalanceSnapshot();
    return {
        type: 'completed',
        sessionId,
        player,
        gameType,
        payout,
        finalChips,
        wasShielded,
        wasDoubled,
        logs,
    };
}
/**
 * Parse a CasinoError event
 * Uses Big Endian for u64 fields (commonware-codec format)
 * Note: The errorMessage string may have unreasonable length values if
 * this is a false positive match. We try to parse it, but return without
 * errorMessage if the length is too large.
 */
function parseCasinoError(reader) {
    const player = reader.readPublicKey();
    const sessionId = reader.readOptionU64BE();
    const errorCode = reader.readU8();
    // Try to read errorMessage, but it may fail on false positives
    let errorMessage = '';
    try {
        // Peek at the string length first
        if (reader.remaining >= 4) {
            const view = new DataView(reader['data'].buffer, reader['data'].byteOffset + reader['offset'], 4);
            const length = view.getUint32(0, true);
            // Only try to read if length is reasonable (< 1000 bytes)
            if (length <= 1000 && length <= reader.remaining - 4) {
                errorMessage = reader.readString();
            }
        }
    }
    catch {
        // errorMessage is optional for validation purposes
    }
    return {
        type: 'error',
        sessionId: sessionId ?? 0n,
        player,
        errorCode,
        errorMessage,
    };
}
/**
 * Parse an Event from binary data
 */
function parseEvent(reader) {
    const tag = reader.readU8();
    switch (tag) {
        case EVENT_TAGS.CASINO_GAME_STARTED:
            return parseCasinoGameStarted(reader);
        case EVENT_TAGS.CASINO_GAME_MOVED:
            return parseCasinoGameMoved(reader);
        case EVENT_TAGS.CASINO_GAME_COMPLETED:
            return parseCasinoGameCompleted(reader);
        case EVENT_TAGS.CASINO_ERROR:
            return parseCasinoError(reader);
        default:
            // Unknown or non-casino event
            return null;
    }
}
/**
 * Parse an Output from binary data
 * Output is: Event(0) | Transaction(1) | Commit(2)
 */
function parseOutput(reader) {
    const kind = reader.readU8();
    if (kind === 0) {
        // Event
        return parseEvent(reader);
    }
    // Transaction or Commit - skip (we only care about Events)
    return null;
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
export function extractCasinoEvents(data) {
    const events = [];
    // Skip non-FilteredEvents messages (Seed = 0x00, Events = 0x01)
    if (data[0] !== 0x02) {
        return events;
    }
    // The events_proof_ops Vec is at the END of the message after ~700-900 bytes of header
    // Structure: [Vec length: u32][item1][item2]...
    // Each item: [u64 location][Output discriminant][if Event: tag + event_data]
    //
    // We scan BACKWARDS from the end to find the Vec, avoiding false positives in crypto data.
    // The Vec length should be small (1-10 events) and is preceded by the Proof.
    // Scan the last 500 bytes - the events_proof_ops Vec can appear earlier in the message
    // CasinoGameCompleted events may be at position 500-600 in 800+ byte messages
    const scanStart = Math.max(data.length - 500, 50);
    // Debug: find and show the [05 00 tag] pattern location - scan more of the message
    const debugStart = Math.max(50, data.length - 400); // Scan more
    if (data.length > 100) {
        for (let d = debugStart; d < data.length - 3; d++) {
            if (data[d] === 0x05 && data[d + 1] === 0x00) {
                const tag = data[d + 2];
                const ctx = Array.from(data.slice(d, Math.min(d + 20, data.length)))
                    .map((x) => x.toString(16).padStart(2, '0'))
                    .join(' ');
                console.log(`[extractCasinoEvents] Found [05 00 ${tag.toString(16)}] at ${d}: ${ctx}`);
            }
        }
    }
    // Strategy: Scan BACKWARDS looking for valid Vec header + event structure
    // Each element in events_proof_ops is: (u64 location, Keyless<Output>)
    // Keyless::Append = 0x05 discriminant, Output::Event = 0x00 discriminant
    // Pattern: [Vec len: u32][u64 location][05 = Keyless::Append][00 = Output::Event][event_tag]
    for (let i = data.length - 60; i >= scanStart; i--) {
        // Check for small Vec length (1-10 elements) - we expect very few events
        if (data[i] >= 1 && data[i] <= 10 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 0) {
            // i+0..3 = Vec length (u32 LE)
            // i+4..11 = u64 location (8 bytes)
            // i+12 = Keyless discriminant (0x05 for Append)
            // i+13 = Output discriminant (0x00 for Event)
            // i+14 = Event tag
            if (i + 14 < data.length && data[i + 12] === 0x05 && data[i + 13] === 0x00) {
                const eventTag = data[i + 14];
                if (eventTag === EVENT_TAGS.CASINO_GAME_STARTED ||
                    eventTag === EVENT_TAGS.CASINO_GAME_MOVED ||
                    eventTag === EVENT_TAGS.CASINO_GAME_COMPLETED ||
                    eventTag === EVENT_TAGS.CASINO_ERROR) {
                    const vecLen = data[i];
                    const ctx = Array.from(data.slice(i, Math.min(data.length, i + 30)))
                        .map((x) => x.toString(16).padStart(2, '0'))
                        .join(' ');
                    console.log(`[extractCasinoEvents] Found Vec[${vecLen}] at ${i}: ${ctx}`);
                    try {
                        // Parse the event starting at i+14 (after Vec len + location + Keyless + Output discriminants)
                        const reader = new BinaryReader(data.slice(i + 14));
                        const event = parseEvent(reader);
                        if (event && validateEvent(event)) {
                            console.log(`[extractCasinoEvents] Parsed ${event.type} at ${i + 14}: session=${event.sessionId}`);
                            events.push(event);
                            return events; // Found valid event, return immediately
                        }
                    }
                    catch (err) {
                        console.log(`[extractCasinoEvents] Parse error at Vec[${vecLen}]@${i}: ${err.message}`);
                    }
                }
            }
        }
    }
    // Fallback: scan backwards for [05][00][tag] pattern (Keyless::Append + Output::Event + tag)
    for (let i = data.length - 60; i >= scanStart; i--) {
        if (data[i] === 0x05 && data[i + 1] === 0x00) {
            const eventTag = data[i + 2];
            if (eventTag === EVENT_TAGS.CASINO_GAME_STARTED ||
                eventTag === EVENT_TAGS.CASINO_GAME_MOVED ||
                eventTag === EVENT_TAGS.CASINO_GAME_COMPLETED ||
                eventTag === EVENT_TAGS.CASINO_ERROR) {
                try {
                    // Parse starting from the tag (skip Keyless + Output discriminants)
                    const reader = new BinaryReader(data.slice(i + 2));
                    const event = parseEvent(reader);
                    if (event && validateEvent(event)) {
                        console.log(`[extractCasinoEvents] Found ${event.type} via fallback at ${i}: session=${event.sessionId}`, event.type === 'error' ? `error=${event.errorCode} msg=${event.errorMessage}` : '');
                        events.push(event);
                        return events; // Found valid event
                    }
                }
                catch {
                    // Silent - false positives are expected in crypto data
                }
            }
        }
    }
    if (events.length === 0 && data.length > 100) {
        // Last resort debug: dump the entire last 150 bytes
        const last150 = Array.from(data.slice(Math.max(0, data.length - 150)))
            .map((x) => x.toString(16).padStart(2, '0'))
            .join(' ');
        console.log(`[extractCasinoEvents] No events in ${data.length}b FilteredEvents. Last 150 bytes: ${last150}`);
    }
    return events;
}
/**
 * Validate that an event looks reasonable (not a false positive from random bytes)
 */
function validateEvent(event) {
    // Session ID should be non-zero for most events (except some errors)
    if (event.type !== 'error' && event.sessionId === 0n) {
        return false;
    }
    // Player key should be 32 bytes and not all zeros
    if (event.player) {
        if (event.player.length !== 32)
            return false;
        if (event.player.every((b) => b === 0))
            return false;
    }
    // For started/completed, player is required
    if ((event.type === 'started' || event.type === 'completed') && !event.player) {
        return false;
    }
    return true;
}
/**
 * Parse a single casino game event from raw event data
 * (when we know the exact boundary of the event)
 */
export function parseCasinoEvent(data) {
    try {
        const reader = new BinaryReader(data);
        return parseOutput(reader);
    }
    catch (err) {
        console.error('Failed to parse casino event:', err);
        return null;
    }
}
/**
 * Parse JSON game log from logs array
 */
export function parseGameLog(log) {
    try {
        return JSON.parse(log);
    }
    catch {
        // Some games use non-JSON format (e.g., Video Poker uses "RESULT:hand:multiplier")
        if (log.startsWith('RESULT:')) {
            const parts = log.split(':');
            return {
                type: 'RESULT',
                hand: parseInt(parts[1], 10),
                multiplier: parseInt(parts[2], 10),
            };
        }
        return null;
    }
}
//# sourceMappingURL=events.js.map