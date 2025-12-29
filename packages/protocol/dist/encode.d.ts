/**
 * Encodes frontend actions into Uint8Array payloads for the on-chain program.
 *
 * This is ENCODING ONLY - no game logic here.
 * The on-chain Rust program validates and processes these moves.
 */
import { CrapsBetType } from '@nullspace/constants';
import type { GameType } from '@nullspace/types';
/** Valid blackjack move actions - exported for type-safe fixture typing */
export type BlackjackMoveAction = 'hit' | 'stand' | 'double' | 'split' | 'deal' | 'surrender';
/**
 * Opcode map with type safety via `satisfies`
 * If the type and map diverge, TypeScript will error at compile time
 */
declare const BLACKJACK_OPCODES: {
    readonly hit: 0;
    readonly stand: 1;
    readonly double: 2;
    readonly split: 3;
    readonly deal: 4;
    readonly surrender: 7;
};
/** Valid roulette move actions */
export type RouletteMoveAction = 'place_bet' | 'spin' | 'clear_bets';
declare const ROULETTE_OPCODES: {
    readonly place_bet: 0;
    readonly spin: 1;
    readonly clear_bets: 2;
};
/** Valid craps move actions */
export type CrapsMoveAction = 'place_bet' | 'add_odds' | 'roll' | 'clear_bets';
declare const CRAPS_OPCODES: {
    readonly place_bet: 0;
    readonly add_odds: 1;
    readonly roll: 2;
    readonly clear_bets: 3;
};
/** Encode a blackjack move action into binary payload */
export declare function encodeBlackjackMove(move: BlackjackMoveAction): Uint8Array;
/** Encode a roulette bet placement */
export declare function encodeRouletteBet(betType: number, number: number, amount: bigint): Uint8Array;
/** Encode a roulette spin command */
export declare function encodeRouletteSpin(): Uint8Array;
/** Encode roulette clear bets command */
export declare function encodeRouletteClearBets(): Uint8Array;
/** Roulette place_bet options */
export interface RoulettePlaceBetOptions {
    betType: number;
    number: number;
    amount: bigint;
}
/** Encode a roulette move (dispatcher) */
export declare function encodeRouletteMove(move: 'spin'): Uint8Array;
export declare function encodeRouletteMove(move: 'clear_bets'): Uint8Array;
export declare function encodeRouletteMove(move: 'place_bet', options: RoulettePlaceBetOptions): Uint8Array;
/** Craps place bet options */
export interface CrapsPlaceBetOptions {
    betType: number;
    target: number;
    amount: bigint;
}
/**
 * Encode a craps bet placement
 * Format: [0, bet_type, target, amount (8 bytes BE)]
 */
export declare function encodeCrapsPlaceBet(options: CrapsPlaceBetOptions): Uint8Array;
/**
 * Encode a craps add odds command
 * Format: [1, amount (8 bytes BE)]
 */
export declare function encodeCrapsAddOdds(amount: bigint): Uint8Array;
/** Encode a craps roll command */
export declare function encodeCrapsRoll(): Uint8Array;
/** Encode a craps clear bets command */
export declare function encodeCrapsClearBets(): Uint8Array;
/** Encode a craps move (dispatcher) */
export declare function encodeCrapsMove(move: 'roll'): Uint8Array;
export declare function encodeCrapsMove(move: 'clear_bets'): Uint8Array;
export declare function encodeCrapsMove(move: 'add_odds', amount: bigint): Uint8Array;
export declare function encodeCrapsMove(move: 'place_bet', options: CrapsPlaceBetOptions): Uint8Array;
/** Side bet structure */
export interface SideBet {
    type: number;
    amount: bigint;
}
/** Encode a generic game start with bet amount */
export declare function encodeGameStart(gameType: GameType, betAmount: bigint, sideBets?: SideBet[]): Uint8Array;
export { BLACKJACK_OPCODES, ROULETTE_OPCODES, CRAPS_OPCODES };
export { CrapsBetType };
//# sourceMappingURL=encode.d.ts.map