/**
 * Protocol constants matching the Rust backend
 * See: types/src/execution.rs
 */
export { GameType } from '@nullspace/types';
import {
  BACCARAT_BET_TYPES,
  CRAPS_BET_TYPES,
  ROULETTE_BET_TYPES,
  SICBO_BET_TYPES,
} from '@nullspace/constants/bet-types';

// Transaction signing namespace - used for Ed25519 signatures
// CRITICAL: Must match TRANSACTION_NAMESPACE in Rust (b"_NULLSPACE_TX")
export const TRANSACTION_NAMESPACE = new TextEncoder().encode('_NULLSPACE_TX');

// Instruction tags (matching types/src/execution.rs)
export const InstructionTag = {
  CasinoRegister: 10,
  CasinoDeposit: 11,
  CasinoStartGame: 12,
  CasinoGameMove: 13,
  CasinoPlayerAction: 14,
  CasinoSetTournamentLimit: 15,
  CasinoJoinTournament: 16,
  CasinoStartTournament: 17,
} as const;

// Submission tags (matching types/src/api.rs)
export const SubmissionTag = {
  Seed: 0,
  Transactions: 1,  // CRITICAL: Use this for /submit, NOT 0
  Summary: 2,
} as const;

// Player actions (matching types/src/casino/game.rs)
export const PlayerAction = {
  Hit: 0,
  Stand: 1,
  Double: 2,
  Split: 3,
  ToggleShield: 10,
  ToggleDouble: 11,
  ActivateSuper: 12,
  CashOut: 20,
} as const;

export type PlayerAction = typeof PlayerAction[keyof typeof PlayerAction];

// Hi-Lo guess types (matching execution/src/casino/hilo.rs Move enum)
export const HiLoGuess = {
  Higher: 0,
  Lower: 1,
  // Note: 2 is reserved/unused in Rust enum
  Same: 3,
} as const;

// Baccarat bet types (matching execution/src/casino/baccarat.rs BetType enum)
export const BaccaratBet = {
  Player: BACCARAT_BET_TYPES.PLAYER,
  Banker: BACCARAT_BET_TYPES.BANKER,
  Tie: BACCARAT_BET_TYPES.TIE,
  PlayerPair: BACCARAT_BET_TYPES.P_PAIR,
  BankerPair: BACCARAT_BET_TYPES.B_PAIR,
  Lucky6: BACCARAT_BET_TYPES.LUCKY6,
  PlayerDragon: BACCARAT_BET_TYPES.P_DRAGON,
  BankerDragon: BACCARAT_BET_TYPES.B_DRAGON,
  Panda8: BACCARAT_BET_TYPES.PANDA8,
  PlayerPerfectPair: BACCARAT_BET_TYPES.P_PERFECT_PAIR,
  BankerPerfectPair: BACCARAT_BET_TYPES.B_PERFECT_PAIR,
} as const;

export type BaccaratBet = typeof BaccaratBet[keyof typeof BaccaratBet];

// Roulette bet types (matching execution/src/casino/roulette.rs BetType enum)
export const RouletteBetType = {
  Straight: ROULETTE_BET_TYPES.STRAIGHT,  // Single number (35:1)
  Red: ROULETTE_BET_TYPES.RED,            // Red (1:1)
  Black: ROULETTE_BET_TYPES.BLACK,        // Black (1:1)
  Even: ROULETTE_BET_TYPES.EVEN,          // Even (1:1)
  Odd: ROULETTE_BET_TYPES.ODD,            // Odd (1:1)
  Low: ROULETTE_BET_TYPES.LOW,            // 1-18 (1:1)
  High: ROULETTE_BET_TYPES.HIGH,          // 19-36 (1:1)
  Dozen: ROULETTE_BET_TYPES.DOZEN,        // 1-12, 13-24, 25-36 (2:1) - number = 0/1/2
  Column: ROULETTE_BET_TYPES.COLUMN,      // First, second, third column (2:1) - number = 0/1/2
  SplitH: ROULETTE_BET_TYPES.SPLIT_H,     // Horizontal split (17:1) - number is left cell
  SplitV: ROULETTE_BET_TYPES.SPLIT_V,     // Vertical split (17:1) - number is top cell
  Street: ROULETTE_BET_TYPES.STREET,      // 3-number row (11:1) - number is row start (1,4,...,34)
  Corner: ROULETTE_BET_TYPES.CORNER,      // 4-number corner (8:1) - number is top-left (1-32)
  SixLine: ROULETTE_BET_TYPES.SIX_LINE,   // 6 numbers (5:1) - number is row start (1,4,...,31)
} as const;

export type RouletteBetTypeValue = typeof RouletteBetType[keyof typeof RouletteBetType];

// SicBo bet types (matching execution/src/casino/sic_bo.rs BetType enum)
export const SicBoBetType = {
  Small: SICBO_BET_TYPES.SMALL,
  Big: SICBO_BET_TYPES.BIG,
  Odd: SICBO_BET_TYPES.ODD,
  Even: SICBO_BET_TYPES.EVEN,
  SpecificTriple: SICBO_BET_TYPES.TRIPLE_SPECIFIC,
  AnyTriple: SICBO_BET_TYPES.TRIPLE_ANY,
  SpecificDouble: SICBO_BET_TYPES.DOUBLE_SPECIFIC,
  Total: SICBO_BET_TYPES.SUM,           // Sum of all dice
  Single: SICBO_BET_TYPES.SINGLE_DIE,   // Single die bet
  Domino: SICBO_BET_TYPES.DOMINO,
  ThreeNumberEasyHop: SICBO_BET_TYPES.HOP3_EASY,
  ThreeNumberHardHop: SICBO_BET_TYPES.HOP3_HARD,
  FourNumberEasyHop: SICBO_BET_TYPES.HOP4_EASY,
} as const;

export type SicBoBetTypeValue = typeof SicBoBetType[keyof typeof SicBoBetType];

// Craps bet types (matching execution/src/casino/craps.rs BetType enum)
export const CrapsBet = {
  Pass: CRAPS_BET_TYPES.PASS,
  DontPass: CRAPS_BET_TYPES.DONT_PASS,
  Come: CRAPS_BET_TYPES.COME,
  DontCome: CRAPS_BET_TYPES.DONT_COME,
  Field: CRAPS_BET_TYPES.FIELD,
  Yes: CRAPS_BET_TYPES.YES,           // Place bet - uses target (4, 5, 6, 8, 9, 10)
  No: CRAPS_BET_TYPES.NO,            // Lay bet - uses target
  Next: CRAPS_BET_TYPES.NEXT,          // Hop bet - uses target
  Hardway4: 8,
  Hardway6: 9,
  Hardway8: 10,
  Hardway10: 11,
  Fire: CRAPS_BET_TYPES.FIRE,
  AtsSmall: CRAPS_BET_TYPES.ATS_SMALL,
  AtsTall: CRAPS_BET_TYPES.ATS_TALL,
  AtsAll: CRAPS_BET_TYPES.ATS_ALL,
  Muggsy: CRAPS_BET_TYPES.MUGGSY,
  DiffDoubles: CRAPS_BET_TYPES.DIFF_DOUBLES,
  RideLine: CRAPS_BET_TYPES.RIDE_LINE,
  Replay: CRAPS_BET_TYPES.REPLAY,
  HotRoller: CRAPS_BET_TYPES.HOT_ROLLER,
} as const;

export type CrapsBet = typeof CrapsBet[keyof typeof CrapsBet];
