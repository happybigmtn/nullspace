/**
 * Move opcodes per game
 * MUST match Rust constants in execution/src/casino/*.rs
 *
 * These are the actual u8 values sent in transaction payloads.
 * Do NOT rename or reorder without updating Rust.
 */

// execution/src/casino/blackjack.rs - Move enum
export const BlackjackMove = {
  Hit: 0,
  Stand: 1,
  Double: 2,
  Split: 3,
  Deal: 4,
  Set21Plus3: 5,
  Reveal: 6,
  Surrender: 7,
} as const;

// execution/src/casino/roulette.rs - Move enum
export const RouletteMove = {
  PlaceBet: 0,
  Spin: 1,
  ClearBets: 2,
  SetRules: 3,
  AtomicBatch: 4,
} as const;

// execution/src/casino/craps.rs - payload format (comment-documented)
// [0, bet_type, target, amount...] = PlaceBet
// [1, amount...] = AddOdds
// [2] = Roll
// [3] = ClearBets
// [4, bet_count, bets...] = AtomicBatch
export const CrapsMove = {
  PlaceBet: 0,
  AddOdds: 1,
  Roll: 2,
  ClearBets: 3,
  AtomicBatch: 4,
} as const;

// execution/src/casino/craps.rs - BetType enum (second byte of PlaceBet payload)
export const CrapsBetType = {
  Pass: 0,
  DontPass: 1,
  Come: 2,
  DontCome: 3,
  Field: 4,
  Yes: 5,         // Place bet (needs target 2-12 except 7)
  No: 6,          // Lay bet (needs target 2-12 except 7)
  Next: 7,        // Next number bet (needs target 2-12)
  Hardway4: 8,
  Hardway6: 9,
  Hardway8: 10,
  Hardway10: 11,
  Fire: 12,
  // 13 (Buy) removed in Rust
  // 14 unused
  AtsSmall: 15,
  AtsTall: 16,
  AtsAll: 17,
  Muggsy: 18,
  DiffDoubles: 19,
  RideLine: 20,
  Replay: 21,
  HotRoller: 22,
} as const;

// execution/src/casino/baccarat.rs - Payload action codes
export const BaccaratMove = {
  PlaceBet: 0,
  Deal: 1,
  ClearBets: 2,
  AtomicBatch: 3,
  SetRules: 4,
} as const;

// execution/src/casino/casino_war.rs - Move enum
export const CasinoWarMove = {
  Play: 0,
  War: 1,
  Surrender: 2,
  SetTieBet: 3,
  // Note: 4 is skipped in Rust enum
  SetRules: 5,
} as const;

// execution/src/casino/video_poker.rs - payload tags (no move enum)
// [holdMask:u8] to hold cards, [0xFF, rules:u8] to set rules
export const VideoPokerMove = {
  SetRules: 0xff,
} as const;

// execution/src/casino/hilo.rs - Move enum
export const HiLoMove = {
  Higher: 0,
  Lower: 1,
  Cashout: 2,
  Same: 3,
} as const;

// execution/src/casino/sicbo.rs - Move enum
export const SicBoMove = {
  PlaceBet: 0,
  Roll: 1,
  ClearBets: 2,
  AtomicBatch: 3,
  SetRules: 4,
} as const;

// execution/src/casino/three_card.rs - Move enum
export const ThreeCardMove = {
  Play: 0,
  Fold: 1,
  Deal: 2,
  SetPairPlus: 3,
  Reveal: 4,
  SetSixCardBonus: 5,
  SetProgressive: 6,
  AtomicDeal: 7,
  SetRules: 8,
} as const;

// execution/src/casino/ultimate_holdem.rs - Action enum
export const UltimateHoldemMove = {
  Check: 0,
  Bet4x: 1,
  Bet2x: 2,
  Bet1x: 3,
  Fold: 4,
  Deal: 5,
  SetTrips: 6,
  Reveal: 7,
  Bet3x: 8,
  SetSixCardBonus: 9,
  SetProgressive: 10,
  AtomicDeal: 11,
  SetRules: 12,
} as const;

// Type exports for each move constant
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
