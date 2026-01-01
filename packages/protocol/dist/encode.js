/**
 * Encodes frontend actions into Uint8Array payloads for the on-chain program.
 *
 * This is ENCODING ONLY - no game logic here.
 * The on-chain Rust program validates and processes these moves.
 */
import { BaccaratMove, BlackjackMove, CrapsMove, CrapsBetType, RouletteMove, SicBoMove, } from '@nullspace/constants';
import { BACCARAT_BET_TYPES, CRAPS_BET_TYPES, ROULETTE_BET_NAMES, SICBO_BET_TYPES, encodeBaccaratBet as encodeBaccaratBetType, encodeCrapsBet as encodeCrapsBetType, encodeRouletteBet as encodeRouletteBetType, encodeSicBoBet as encodeSicBoBetType, } from '@nullspace/constants';
/**
 * Opcode map with type safety via `satisfies`
 * If the type and map diverge, TypeScript will error at compile time
 */
const BLACKJACK_OPCODES = {
    hit: BlackjackMove.Hit,
    stand: BlackjackMove.Stand,
    double: BlackjackMove.Double,
    split: BlackjackMove.Split,
    deal: BlackjackMove.Deal,
    surrender: BlackjackMove.Surrender,
};
const ROULETTE_OPCODES = {
    place_bet: RouletteMove.PlaceBet,
    spin: RouletteMove.Spin,
    clear_bets: RouletteMove.ClearBets,
};
const CRAPS_OPCODES = {
    place_bet: CrapsMove.PlaceBet,
    add_odds: CrapsMove.AddOdds,
    roll: CrapsMove.Roll,
    clear_bets: CrapsMove.ClearBets,
};
/** Encode a blackjack move action into binary payload */
export function encodeBlackjackMove(move) {
    return new Uint8Array([BLACKJACK_OPCODES[move]]);
}
/** Encode a roulette bet placement */
export function encodeRouletteBet(betType, number, amount) {
    // Binary format: [opcode, betType, number, amount (8 bytes BE)]
    const buffer = new ArrayBuffer(11);
    const view = new DataView(buffer);
    view.setUint8(0, RouletteMove.PlaceBet);
    view.setUint8(1, betType);
    view.setUint8(2, number);
    view.setBigUint64(3, amount, false); // big-endian per Rust spec
    return new Uint8Array(buffer);
}
/** Encode a roulette spin command */
export function encodeRouletteSpin() {
    return new Uint8Array([RouletteMove.Spin]);
}
/** Encode roulette clear bets command */
export function encodeRouletteClearBets() {
    return new Uint8Array([RouletteMove.ClearBets]);
}
export function encodeRouletteMove(move, options) {
    switch (move) {
        case 'spin':
            return encodeRouletteSpin();
        case 'clear_bets':
            return encodeRouletteClearBets();
        case 'place_bet':
            // Use explicit undefined check - betType=0 is valid (straight up bet)
            if (options?.betType === undefined || options?.number === undefined || options?.amount === undefined) {
                throw new Error('place_bet requires betType, number, and amount');
            }
            return encodeRouletteBet(options.betType, options.number, options.amount);
    }
}
/**
 * Encode a craps bet placement
 * Format: [0, bet_type, target, amount (8 bytes BE)]
 */
export function encodeCrapsPlaceBet(options) {
    const buffer = new ArrayBuffer(11); // 1 + 1 + 1 + 8
    const view = new DataView(buffer);
    view.setUint8(0, CrapsMove.PlaceBet);
    view.setUint8(1, options.betType);
    view.setUint8(2, options.target);
    view.setBigUint64(3, options.amount, false); // big-endian per Rust spec
    return new Uint8Array(buffer);
}
/**
 * Encode a craps add odds command
 * Format: [1, amount (8 bytes BE)]
 */
export function encodeCrapsAddOdds(amount) {
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, CrapsMove.AddOdds);
    view.setBigUint64(1, amount, false); // big-endian per Rust spec
    return new Uint8Array(buffer);
}
/** Encode a craps roll command */
export function encodeCrapsRoll() {
    return new Uint8Array([CrapsMove.Roll]);
}
/** Encode a craps clear bets command */
export function encodeCrapsClearBets() {
    return new Uint8Array([CrapsMove.ClearBets]);
}
export function encodeCrapsMove(move, optionsOrAmount) {
    switch (move) {
        case 'roll':
            return encodeCrapsRoll();
        case 'clear_bets':
            return encodeCrapsClearBets();
        case 'add_odds':
            if (typeof optionsOrAmount !== 'bigint') {
                throw new Error('add_odds requires an amount');
            }
            return encodeCrapsAddOdds(optionsOrAmount);
        case 'place_bet':
            if (!optionsOrAmount || typeof optionsOrAmount === 'bigint') {
                throw new Error('place_bet requires betType, target, and amount');
            }
            return encodeCrapsPlaceBet(optionsOrAmount);
    }
}
/** Encode a generic game start with bet amount */
export function encodeGameStart(gameType, betAmount, sideBets) {
    // Format depends on game - this is a placeholder for actual binary protocol
    const sideBetData = sideBets ?? [];
    const buffer = new ArrayBuffer(1 + 8 + 1 + sideBetData.length * 9);
    const view = new DataView(buffer);
    view.setUint8(0, gameType);
    view.setBigUint64(1, betAmount, true);
    view.setUint8(9, sideBetData.length);
    sideBetData.forEach((sb, i) => {
        view.setUint8(10 + i * 9, sb.type);
        view.setBigUint64(11 + i * 9, sb.amount, true);
    });
    return new Uint8Array(buffer);
}
export function encodeBaccaratAtomicBatch(bets) {
    if (!bets.length) {
        throw new Error('No bets provided');
    }
    const payload = new Uint8Array(2 + bets.length * 9);
    const view = new DataView(payload.buffer);
    payload[0] = BaccaratMove.AtomicBatch;
    payload[1] = bets.length;
    let offset = 2;
    for (const bet of bets) {
        if (bet.amount <= 0n) {
            throw new Error('Bet amount must be positive');
        }
        const betType = typeof bet.type === 'string'
            ? (() => {
                const key = bet.type.toUpperCase();
                if (!(key in BACCARAT_BET_TYPES)) {
                    throw new Error(`Invalid bet type: ${bet.type}`);
                }
                return encodeBaccaratBetType(key);
            })()
            : bet.type;
        payload[offset] = betType;
        view.setBigUint64(offset + 1, bet.amount, false);
        offset += 9;
    }
    return payload;
}
export function encodeRouletteAtomicBatch(bets) {
    if (!bets.length) {
        throw new Error('No bets provided');
    }
    const payload = new Uint8Array(2 + bets.length * 10);
    const view = new DataView(payload.buffer);
    payload[0] = RouletteMove.AtomicBatch;
    payload[1] = bets.length;
    let offset = 2;
    for (const bet of bets) {
        if (bet.amount <= 0n) {
            throw new Error('Bet amount must be positive');
        }
        const rawValue = bet.value ?? bet.number ?? bet.target ?? 0;
        const encoded = typeof bet.type === 'string'
            ? (() => {
                const key = bet.type.toUpperCase();
                if (!ROULETTE_BET_NAMES.includes(key)) {
                    throw new Error(`Invalid bet type: ${bet.type}`);
                }
                return encodeRouletteBetType(key, rawValue);
            })()
            : { type: bet.type, value: rawValue };
        payload[offset] = encoded.type;
        payload[offset + 1] = encoded.value;
        view.setBigUint64(offset + 2, bet.amount, false);
        offset += 10;
    }
    return payload;
}
export function encodeCrapsAtomicBatch(bets) {
    if (!bets.length) {
        throw new Error('No bets provided');
    }
    const payload = new Uint8Array(2 + bets.length * 10);
    const view = new DataView(payload.buffer);
    payload[0] = CrapsMove.AtomicBatch;
    payload[1] = bets.length;
    let offset = 2;
    for (const bet of bets) {
        if (bet.amount <= 0n) {
            throw new Error('Bet amount must be positive');
        }
        const encoded = typeof bet.type === 'string'
            ? (() => {
                const key = bet.type.toUpperCase();
                if (!(key in CRAPS_BET_TYPES)) {
                    throw new Error(`Invalid bet type: ${bet.type}`);
                }
                return encodeCrapsBetType(key, bet.target);
            })()
            : { betType: bet.type, target: bet.target ?? 0 };
        payload[offset] = encoded.betType;
        payload[offset + 1] = encoded.target;
        view.setBigUint64(offset + 2, bet.amount, false);
        offset += 10;
    }
    return payload;
}
export function encodeSicBoAtomicBatch(bets) {
    if (!bets.length) {
        throw new Error('No bets provided');
    }
    const payload = new Uint8Array(2 + bets.length * 10);
    const view = new DataView(payload.buffer);
    payload[0] = SicBoMove.AtomicBatch;
    payload[1] = bets.length;
    let offset = 2;
    for (const bet of bets) {
        if (bet.amount <= 0n) {
            throw new Error('Bet amount must be positive');
        }
        const rawValue = bet.value ?? bet.number ?? bet.target ?? 0;
        const encoded = typeof bet.type === 'string'
            ? (() => {
                const key = bet.type.toUpperCase();
                if (!(key in SICBO_BET_TYPES)) {
                    throw new Error(`Invalid bet type: ${bet.type}`);
                }
                return encodeSicBoBetType(key, rawValue);
            })()
            : { betType: bet.type, target: rawValue };
        payload[offset] = encoded.betType;
        payload[offset + 1] = encoded.target;
        view.setBigUint64(offset + 2, bet.amount, false);
        offset += 10;
    }
    return payload;
}
// Re-export opcode maps for consumers that need direct access
export { BLACKJACK_OPCODES, ROULETTE_OPCODES, CRAPS_OPCODES };
// Re-export CrapsBetType for convenience
export { CrapsBetType };
//# sourceMappingURL=encode.js.map