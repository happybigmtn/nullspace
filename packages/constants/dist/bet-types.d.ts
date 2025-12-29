/**
 * Bet type constants + helpers shared across gateway/mobile.
 * Must match execution/src/casino/* enums exactly.
 */
export declare const BACCARAT_BET_TYPES: {
    readonly PLAYER: 0;
    readonly BANKER: 1;
    readonly TIE: 2;
    readonly P_PAIR: 3;
    readonly B_PAIR: 4;
    readonly LUCKY6: 5;
    readonly P_DRAGON: 6;
    readonly B_DRAGON: 7;
    readonly PANDA8: 8;
    readonly P_PERFECT_PAIR: 9;
    readonly B_PERFECT_PAIR: 10;
};
export type BaccaratBetName = keyof typeof BACCARAT_BET_TYPES;
export declare function encodeBaccaratBet(type: BaccaratBetName): number;
export declare const CRAPS_BET_TYPES: {
    readonly PASS: 0;
    readonly DONT_PASS: 1;
    readonly COME: 2;
    readonly DONT_COME: 3;
    readonly FIELD: 4;
    readonly YES: 5;
    readonly NO: 6;
    readonly NEXT: 7;
    readonly HARDWAY: 8;
    readonly FIRE: 12;
    readonly ATS_SMALL: 15;
    readonly ATS_TALL: 16;
    readonly ATS_ALL: 17;
    readonly MUGGSY: 18;
    readonly DIFF_DOUBLES: 19;
    readonly RIDE_LINE: 20;
    readonly REPLAY: 21;
    readonly HOT_ROLLER: 22;
};
export type CrapsBetName = keyof typeof CRAPS_BET_TYPES;
export declare function encodeCrapsBet(type: CrapsBetName, target?: number): {
    betType: number;
    target: number;
};
export declare function crapsRequiresTarget(type: CrapsBetName): boolean;
export declare const ROULETTE_BET_TYPES: {
    readonly STRAIGHT: 0;
    readonly RED: 1;
    readonly BLACK: 2;
    readonly EVEN: 3;
    readonly ODD: 4;
    readonly LOW: 5;
    readonly HIGH: 6;
    readonly DOZEN: 7;
    readonly COLUMN: 8;
    readonly SPLIT_H: 9;
    readonly SPLIT_V: 10;
    readonly STREET: 11;
    readonly CORNER: 12;
    readonly SIX_LINE: 13;
};
export declare const ROULETTE_BET_NAMES: readonly ["STRAIGHT", "RED", "BLACK", "EVEN", "ODD", "LOW", "HIGH", "DOZEN_1", "DOZEN_2", "DOZEN_3", "COL_1", "COL_2", "COL_3", "ZERO", "SPLIT_H", "SPLIT_V", "STREET", "CORNER", "SIX_LINE"];
export type RouletteBetName = typeof ROULETTE_BET_NAMES[number];
export declare function encodeRouletteBet(type: RouletteBetName, target?: number): {
    type: number;
    value: number;
};
export declare function rouletteRequiresTarget(type: RouletteBetName): boolean;
export declare const SICBO_BET_TYPES: {
    readonly SMALL: 0;
    readonly BIG: 1;
    readonly ODD: 2;
    readonly EVEN: 3;
    readonly TRIPLE_SPECIFIC: 4;
    readonly TRIPLE_ANY: 5;
    readonly DOUBLE_SPECIFIC: 6;
    readonly SUM: 7;
    readonly SINGLE_DIE: 8;
    readonly DOMINO: 9;
    readonly HOP3_EASY: 10;
    readonly HOP3_HARD: 11;
    readonly HOP4_EASY: 12;
};
export type SicBoBetName = keyof typeof SICBO_BET_TYPES;
export declare function encodeSicBoBet(type: SicBoBetName, target?: number): {
    betType: number;
    target: number;
};
export declare function sicboRequiresTarget(type: SicBoBetName): boolean;
//# sourceMappingURL=bet-types.d.ts.map