/**
 * Encodes frontend actions into Uint8Array payloads for the on-chain program.
 *
 * This is ENCODING ONLY - no game logic here.
 * The on-chain Rust program validates and processes these moves.
 */
import { BlackjackMove, RouletteMove, CrapsMove, CrapsBetType } from '@nullspace/constants';
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
// Re-export opcode maps for consumers that need direct access
export { BLACKJACK_OPCODES, ROULETTE_OPCODES, CRAPS_OPCODES };
// Re-export CrapsBetType for convenience
export { CrapsBetType };
//# sourceMappingURL=encode.js.map