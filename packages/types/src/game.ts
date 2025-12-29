/**
 * Game type definitions
 * MUST match Rust enum in types/src/casino/game.rs
 */

export enum GameType {
  Baccarat = 0,
  Blackjack = 1,
  CasinoWar = 2,
  Craps = 3,
  VideoPoker = 4,
  HiLo = 5,
  Roulette = 6,
  SicBo = 7,
  ThreeCard = 8,
  UltimateHoldem = 9,
}

export type GameId =
  | 'baccarat'
  | 'blackjack'
  | 'casino_war'
  | 'craps'
  | 'video_poker'
  | 'hi_lo'
  | 'roulette'
  | 'sic_bo'
  | 'three_card_poker'
  | 'ultimate_texas_holdem';

export interface GameSession {
  id: bigint;
  gameType: GameType;
  bet: bigint;
  isComplete: boolean;
  moveCount: number;
  createdAt: bigint;
}
