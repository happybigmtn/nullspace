/**
 * Protocol constants matching the Rust backend
 * See: types/src/execution.rs
 */
export { GameType } from '@nullspace/types';
export declare const TRANSACTION_NAMESPACE: Uint8Array<ArrayBuffer>;
export declare const InstructionTag: {
    readonly CasinoRegister: 10;
    readonly CasinoDeposit: 11;
    readonly CasinoStartGame: 12;
    readonly CasinoGameMove: 13;
    readonly CasinoPlayerAction: 14;
    readonly CasinoSetTournamentLimit: 15;
    readonly CasinoJoinTournament: 16;
    readonly CasinoStartTournament: 17;
};
export declare const SubmissionTag: {
    readonly Seed: 0;
    readonly Transactions: 1;
    readonly Summary: 2;
};
export declare const PlayerAction: {
    readonly Hit: 0;
    readonly Stand: 1;
    readonly Double: 2;
    readonly Split: 3;
    readonly ToggleShield: 10;
    readonly ToggleDouble: 11;
    readonly ActivateSuper: 12;
    readonly CashOut: 20;
};
export type PlayerAction = typeof PlayerAction[keyof typeof PlayerAction];
export declare const HiLoGuess: {
    readonly Higher: 0;
    readonly Lower: 1;
    readonly Same: 3;
};
export declare const BaccaratBet: {
    readonly Player: 0;
    readonly Banker: 1;
    readonly Tie: 2;
    readonly PlayerPair: 3;
    readonly BankerPair: 4;
    readonly Lucky6: 5;
    readonly PlayerDragon: 6;
    readonly BankerDragon: 7;
    readonly Panda8: 8;
    readonly PlayerPerfectPair: 9;
    readonly BankerPerfectPair: 10;
};
export type BaccaratBet = typeof BaccaratBet[keyof typeof BaccaratBet];
export declare const RouletteBetType: {
    readonly Straight: 0;
    readonly Red: 1;
    readonly Black: 2;
    readonly Even: 3;
    readonly Odd: 4;
    readonly Low: 5;
    readonly High: 6;
    readonly Dozen: 7;
    readonly Column: 8;
    readonly SplitH: 9;
    readonly SplitV: 10;
    readonly Street: 11;
    readonly Corner: 12;
    readonly SixLine: 13;
};
export type RouletteBetTypeValue = typeof RouletteBetType[keyof typeof RouletteBetType];
export declare const SicBoBetType: {
    readonly Small: 0;
    readonly Big: 1;
    readonly Odd: 2;
    readonly Even: 3;
    readonly SpecificTriple: 4;
    readonly AnyTriple: 5;
    readonly SpecificDouble: 6;
    readonly Total: 7;
    readonly Single: 8;
    readonly Domino: 9;
    readonly ThreeNumberEasyHop: 10;
    readonly ThreeNumberHardHop: 11;
    readonly FourNumberEasyHop: 12;
};
export type SicBoBetTypeValue = typeof SicBoBetType[keyof typeof SicBoBetType];
export declare const CrapsBet: {
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
export type CrapsBet = typeof CrapsBet[keyof typeof CrapsBet];
//# sourceMappingURL=constants.d.ts.map