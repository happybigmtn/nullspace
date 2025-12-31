import type { UIGameState } from '@nullspace/game-state';
import type {
  Card as GeneratedCard,
  PlayerStats as GeneratedPlayerStats,
  ResolvedBet as GeneratedResolvedBet,
  CompletedHand as GeneratedCompletedHand,
  CrapsBet as GeneratedCrapsBet,
  BaccaratBet as GeneratedBaccaratBet,
  RouletteBet as GeneratedRouletteBet,
  SicBoBet as GeneratedSicBoBet,
  CrapsEventLog as GeneratedCrapsEventLog,
  LeaderboardEntry as GeneratedLeaderboardEntry,
  TournamentPhase as GeneratedTournamentPhase,
} from '@nullspace/types/casino-state';

export type Suit = GeneratedCard['suit'];
export type Rank = GeneratedCard['rank'];
export type Card = GeneratedCard;

export enum GameType {
  NONE = 'NONE',
  BACCARAT = 'BACCARAT',
  BLACKJACK = 'BLACKJACK',
  CASINO_WAR = 'CASINO_WAR',
  CRAPS = 'CRAPS',
  ROULETTE = 'ROULETTE',
  SIC_BO = 'SIC_BO',
  THREE_CARD = 'THREE_CARD',
  ULTIMATE_HOLDEM = 'ULTIMATE_HOLDEM',
  VIDEO_POKER = 'VIDEO_POKER',
  HILO = 'HILO',
}

export type TournamentPhase = GeneratedTournamentPhase;
export type PlayerStats = GeneratedPlayerStats;
export type ResolvedBet = GeneratedResolvedBet;
export type CompletedHand = GeneratedCompletedHand;
export type CrapsBet = GeneratedCrapsBet;
export type BaccaratBet = GeneratedBaccaratBet;
export type RouletteBet = GeneratedRouletteBet;
export type SicBoBet = GeneratedSicBoBet;
export type CrapsEventLog = GeneratedCrapsEventLog;
export type LeaderboardEntry = GeneratedLeaderboardEntry;

export type GameState = Omit<UIGameState, 'type'> & { type: GameType };

export type AutoPlayDraft =
  | {
      type: GameType.BACCARAT;
      baccaratSelection: 'PLAYER' | 'BANKER';
      baccaratSideBets: BaccaratBet[];
      mainBetAmount: number;
    }
  | {
      type: GameType.CRAPS;
      crapsBets: CrapsBet[];
    }
  | {
      type: GameType.ROULETTE;
      rouletteBets: RouletteBet[];
      rouletteZeroRule: GameState['rouletteZeroRule'];
    }
  | {
      type: GameType.SIC_BO;
      sicBoBets: SicBoBet[];
    };

export type AutoPlayPlan = AutoPlayDraft & { sessionId: bigint };

export interface SuperMultiplier {
  id: string;
  multiplier: number;
  type: string;
  label: string;
  meta?: Card;
}
