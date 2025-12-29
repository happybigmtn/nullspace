/**
 * Move opcodes per game
 * MUST match Rust constants in execution/src/casino/*.rs
 *
 * These are the actual u8 values sent in transaction payloads.
 * Do NOT rename or reorder without updating Rust.
 */
export declare const BlackjackMove: {
    readonly Hit: 0;
    readonly Stand: 1;
    readonly Double: 2;
    readonly Split: 3;
    readonly Deal: 4;
    readonly Set21Plus3: 5;
    readonly Reveal: 6;
    readonly Surrender: 7;
};
export declare const RouletteMove: {
    readonly PlaceBet: 0;
    readonly Spin: 1;
    readonly ClearBets: 2;
    readonly SetRules: 3;
    readonly AtomicBatch: 4;
};
export declare const CrapsMove: {
    readonly PlaceBet: 0;
    readonly AddOdds: 1;
    readonly Roll: 2;
    readonly ClearBets: 3;
    readonly AtomicBatch: 4;
};
export declare const CrapsBetType: {
    readonly Pass: 0;
    readonly DontPass: 1;
    readonly Come: 2;
    readonly DontCome: 3;
    readonly Field: 4;
    readonly Yes: 5;
    readonly No: 6;
    readonly Next: 7;
    readonly Hardway4: 8;
    readonly Hardway6: 9;
    readonly Hardway8: 10;
    readonly Hardway10: 11;
    readonly Fire: 12;
    readonly AtsSmall: 15;
    readonly AtsTall: 16;
    readonly AtsAll: 17;
    readonly Muggsy: 18;
    readonly DiffDoubles: 19;
    readonly RideLine: 20;
    readonly Replay: 21;
    readonly HotRoller: 22;
};
export declare const BaccaratMove: {
    readonly PlaceBet: 0;
    readonly Deal: 1;
    readonly ClearBets: 2;
    readonly AtomicBatch: 3;
    readonly SetRules: 4;
};
export declare const CasinoWarMove: {
    readonly Play: 0;
    readonly War: 1;
    readonly Surrender: 2;
    readonly SetTieBet: 3;
    readonly SetRules: 5;
};
export declare const VideoPokerMove: {
    readonly SetRules: 255;
};
export declare const HiLoMove: {
    readonly Higher: 0;
    readonly Lower: 1;
    readonly Cashout: 2;
    readonly Same: 3;
};
export declare const SicBoMove: {
    readonly PlaceBet: 0;
    readonly Roll: 1;
    readonly ClearBets: 2;
    readonly AtomicBatch: 3;
    readonly SetRules: 4;
};
export declare const ThreeCardMove: {
    readonly Play: 0;
    readonly Fold: 1;
    readonly Deal: 2;
    readonly SetPairPlus: 3;
    readonly Reveal: 4;
    readonly SetSixCardBonus: 5;
    readonly SetProgressive: 6;
    readonly AtomicDeal: 7;
    readonly SetRules: 8;
};
export declare const UltimateHoldemMove: {
    readonly Check: 0;
    readonly Bet4x: 1;
    readonly Bet2x: 2;
    readonly Bet1x: 3;
    readonly Fold: 4;
    readonly Deal: 5;
    readonly SetTrips: 6;
    readonly Reveal: 7;
    readonly Bet3x: 8;
    readonly SetSixCardBonus: 9;
    readonly SetProgressive: 10;
    readonly AtomicDeal: 11;
    readonly SetRules: 12;
};
export type BlackjackMoveType = (typeof BlackjackMove)[keyof typeof BlackjackMove];
export type RouletteMoveType = (typeof RouletteMove)[keyof typeof RouletteMove];
export type CrapsMoveType = (typeof CrapsMove)[keyof typeof CrapsMove];
export type BaccaratMoveType = (typeof BaccaratMove)[keyof typeof BaccaratMove];
export type CasinoWarMoveType = (typeof CasinoWarMove)[keyof typeof CasinoWarMove];
export type VideoPokerMoveType = (typeof VideoPokerMove)[keyof typeof VideoPokerMove];
export type HiLoMoveType = (typeof HiLoMove)[keyof typeof HiLoMove];
export type SicBoMoveType = (typeof SicBoMove)[keyof typeof SicBoMove];
export type ThreeCardMoveType = (typeof ThreeCardMove)[keyof typeof ThreeCardMove];
export type UltimateHoldemMoveType = (typeof UltimateHoldemMove)[keyof typeof UltimateHoldemMove];
//# sourceMappingURL=moves.d.ts.map