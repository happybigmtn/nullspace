import type { GameState as GeneratedGameState, GameType as GeneratedGameType } from '@nullspace/types/casino-state';
export type UIGameType = GeneratedGameType;
export type UIGameState = GeneratedGameState;
export declare const toUIGameState: (state: GeneratedGameState) => UIGameState;
export declare const toGeneratedGameState: (state: UIGameState) => GeneratedGameState;
export declare class SafeReader {
    private readonly data;
    private offset;
    constructor(data: Uint8Array);
    remaining(): number;
    readU8(field: string): number;
    readU8At(offset: number, field: string): number;
    readBytes(length: number, field: string): Uint8Array;
    skip(length: number, field: string): void;
    readU64BE(field: string): bigint;
    readI64BE(field: string): bigint;
}
export type BlackjackHand = {
    betMult: number;
    status: number;
    wasSplit: number;
    cards: number[];
};
export type BlackjackParsedState = {
    version: number;
    stage: number;
    sideBet21Plus3: number;
    initPlayerCards: [number, number];
    activeHandIndex: number;
    hands: BlackjackHand[];
    dealerCards: number[];
    playerValue: number | null;
    dealerValue: number | null;
    actionMask: number | null;
};
export declare const parseBlackjackState: (stateBlob: Uint8Array) => BlackjackParsedState | null;
export type BaccaratParsedState = {
    betCount: number;
    playerCards: number[];
    bankerCards: number[];
};
export declare const parseBaccaratState: (stateBlob: Uint8Array) => BaccaratParsedState | null;
export type RouletteParsedState = {
    betCount: number;
    zeroRule: number;
    phase: number;
    result: number | null;
};
export declare const parseRouletteState: (stateBlob: Uint8Array) => RouletteParsedState | null;
export type SicBoParsedState = {
    betCount: number;
    dice: [number, number, number] | null;
};
export declare const parseSicBoState: (stateBlob: Uint8Array) => SicBoParsedState | null;
export type CrapsRawBet = {
    betType: number;
    target: number;
    status: number;
    amount: number;
    oddsAmount: number;
};
export type CrapsParsedState = {
    version: number;
    phase: number;
    mainPoint: number;
    dice: [number, number];
    madePointsMask: number;
    epochPointEstablished: boolean;
    betCount: number;
    betsOffset: number;
    bets: CrapsRawBet[];
};
export declare const parseCrapsState: (stateBlob: Uint8Array) => CrapsParsedState | null;
export type HiLoParsedState = {
    cardId: number;
    accumulatorBasisPoints: bigint;
    rulesByte: number;
    nextMultipliers: {
        higher: number;
        lower: number;
        same: number;
    } | null;
};
export declare const parseHiLoState: (stateBlob: Uint8Array) => HiLoParsedState | null;
export type VideoPokerParsedState = {
    stage: number;
    cards: number[];
};
export declare const parseVideoPokerState: (stateBlob: Uint8Array) => VideoPokerParsedState | null;
export type CasinoWarParsedState = {
    version: number;
    stage: number;
    playerCard: number;
    dealerCard: number;
    tieBet: bigint;
};
export declare const parseCasinoWarState: (stateBlob: Uint8Array) => CasinoWarParsedState | null;
export type ThreeCardParsedState = {
    version: number;
    stage: number;
    playerCards: number[];
    dealerCards: number[];
    pairPlusBet: number;
    sixCardBonusBet: number;
    progressiveBet: number;
};
export declare const parseThreeCardState: (stateBlob: Uint8Array) => ThreeCardParsedState | null;
export type UltimateHoldemParsedState = {
    version: number;
    stage: number;
    playerCards: number[];
    communityCards: number[];
    dealerCards: number[];
    playMultiplier: number;
    bonusCards: number[];
    tripsBet: number;
    sixCardBonusBet: number;
    progressiveBet: number;
};
export declare const parseUltimateHoldemState: (stateBlob: Uint8Array) => UltimateHoldemParsedState | null;
//# sourceMappingURL=index.d.ts.map