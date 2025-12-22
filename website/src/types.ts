export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number;
  isHidden?: boolean;
  isHeld?: boolean;
}

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

export type TournamentPhase = 'REGISTRATION' | 'ACTIVE' | 'ELIMINATION';

export interface PlayerStats {
  chips: number;
  shields: number;
  doubles: number;
  auraMeter?: number;
  rank: number;
  history: string[];
  pnlByGame: Record<string, number>;
  pnlHistory: number[];
}

export interface CompletedHand {
  cards: Card[];
  bet: number;
  result?: number; // Calculated after dealer plays
  message?: string;
  isDoubled?: boolean;
  surrendered?: boolean;
}

export interface CrapsBet {
  type:
    | 'PASS'
    | 'DONT_PASS'
    | 'COME'
    | 'DONT_COME'
    | 'FIELD'
    | 'YES'
    | 'NO'
    | 'NEXT'
    | 'HARDWAY'
    | 'FIRE'
    | 'ATS_SMALL'
    | 'ATS_TALL'
    | 'ATS_ALL'
    | 'MUGGSY'
    | 'DIFF_DOUBLES'
    | 'RIDE_LINE'
    | 'REPLAY'
    | 'HOT_ROLLER'
    | 'REPEATER';
  amount: number;
  target?: number; // The number (e.g., 4 for a Place 4, or the Point for a Come bet)
  oddsAmount?: number; // Attached odds amount (confirmed on-chain)
  localOddsAmount?: number; // Pending odds amount (staged locally, not yet confirmed)
  progressMask?: number; // ATS/side bet progress (bitmask), if applicable
  status?: 'PENDING' | 'ON'; // PENDING means Come bet waiting to travel
  local?: boolean; // true = locally staged bet not yet sent to chain, undefined/false = on-chain bet
}

export interface BaccaratBet {
    type: 'TIE' | 'P_PAIR' | 'B_PAIR' | 'LUCKY6' | 'P_DRAGON' | 'B_DRAGON' | 'PANDA8' | 'P_PERFECT_PAIR' | 'B_PERFECT_PAIR';
    amount: number;
    local?: boolean; // true = locally staged bet not yet sent to chain, undefined/false = on-chain bet
}

export interface RouletteBet {
    type:
      | 'STRAIGHT'
      | 'RED'
      | 'BLACK'
      | 'ODD'
      | 'EVEN'
      | 'LOW'
      | 'HIGH'
      | 'DOZEN_1'
      | 'DOZEN_2'
      | 'DOZEN_3'
      | 'COL_1'
      | 'COL_2'
      | 'COL_3'
      | 'ZERO'
      | 'SPLIT_H'
      | 'SPLIT_V'
      | 'STREET'
      | 'CORNER'
      | 'SIX_LINE';
    target?: number;
    amount: number;
    local?: boolean; // true = locally staged bet not yet sent to chain, undefined/false = on-chain bet
}

export interface SicBoBet {
    type:
      | 'BIG'
      | 'SMALL'
      | 'ODD'
      | 'EVEN'
      | 'TRIPLE_ANY'
      | 'TRIPLE_SPECIFIC'
      | 'DOUBLE_SPECIFIC'
      | 'SUM'
      | 'SINGLE_DIE'
      | 'DOMINO'
      | 'HOP3_EASY'
      | 'HOP3_HARD'
      | 'HOP4_EASY';
    target?: number;
    amount: number;
    local?: boolean; // true = locally staged bet not yet sent to chain, undefined/false = on-chain bet
}

// Craps event log entry for roll history with PnL
export interface CrapsEventLog {
    dice: [number, number];
    total: number;
    pnl: number; // Positive for win, negative for loss, 0 for push
    point: number | null; // Point at time of roll
    isSevenOut: boolean;
    results: string[]; // e.g. ["PASS WIN (+$50)", "YES 4 LOSS (-$25)"]
}

export interface GameState {
  type: GameType;
  message: string;
  bet: number;
  stage: 'BETTING' | 'PLAYING' | 'RESULT';
  playerCards: Card[]; // Represents the ACTIVE hand
  dealerCards: Card[];
  communityCards: Card[];
  dice: number[];
  
  // Craps
  crapsPoint: number | null;
  crapsEpochPointEstablished: boolean;
  crapsMadePointsMask: number; // Bitmask of unique points made this epoch (bits 0-5 = points 4,5,6,8,9,10)
  crapsBets: CrapsBet[];
  crapsUndoStack: CrapsBet[][]; // History of bet arrays for current turn
  crapsInputMode: 'NONE' | 'YES' | 'NO' | 'NEXT' | 'HARDWAY'; // Replaces string buffer
  crapsRollHistory: number[];
  crapsEventLog: CrapsEventLog[]; // Roll history with PnL for event log display
  crapsLastRoundBets: CrapsBet[]; // Bets from the previous roll (for rebet)
  crapsOddsCandidates: number[] | null; // Indices of bets eligible for odds attachment
  
  // Roulette
  rouletteBets: RouletteBet[];
  rouletteUndoStack: RouletteBet[][]; // History of bets for current spin
  rouletteLastRoundBets: RouletteBet[]; // Bets from the previous spin (for rebet)
  rouletteHistory: number[];
  rouletteInputMode: 'NONE' | 'STRAIGHT' | 'SPLIT_H' | 'SPLIT_V' | 'STREET' | 'CORNER' | 'SIX_LINE';
  rouletteZeroRule: 'STANDARD' | 'LA_PARTAGE' | 'EN_PRISON' | 'EN_PRISON_DOUBLE';
  rouletteIsPrison: boolean;

  // Sic Bo
  sicBoBets: SicBoBet[];
  sicBoHistory: number[][]; // Array of dice triplets
  sicBoInputMode:
    | 'NONE'
    | 'SINGLE'
    | 'DOUBLE'
    | 'TRIPLE'
    | 'SUM'
    | 'DOMINO'
    | 'HOP3_EASY'
    | 'HOP3_HARD'
    | 'HOP4_EASY';
  sicBoUndoStack: SicBoBet[][];
  sicBoLastRoundBets: SicBoBet[];

  lastResult: number;
  activeModifiers: {
    shield: boolean;
    double: boolean;
    super?: boolean;
  };
  
  // Baccarat
  baccaratSelection: 'PLAYER' | 'BANKER';
  baccaratBets: BaccaratBet[];
  baccaratUndoStack: BaccaratBet[][];
  baccaratLastRoundBets: BaccaratBet[];
  
  // Blackjack Specifics
  insuranceBet: number;
  blackjackStack: { cards: Card[], bet: number, isDoubled: boolean }[]; // Hands waiting to be played (Split)
  completedHands: CompletedHand[]; // Hands finished by player, waiting for dealer
  blackjack21Plus3Bet: number;

  // Three Card Poker
  threeCardPairPlusBet: number;
  threeCardSixCardBonusBet: number;
  threeCardProgressiveBet: number;
  threeCardProgressiveJackpot: number;

  // Ultimate Texas Hold'em
  uthTripsBet: number;
  uthSixCardBonusBet: number;
  uthProgressiveBet: number;
  uthProgressiveJackpot: number;
  uthBonusCards: Card[];

  // Casino War
  casinoWarTieBet: number;

  // HiLo
  hiloAccumulator: number;
  hiloGraphData: number[];
  
  // Session Tracking
  sessionId: number | null;
  moveNumber: number;
  sessionWager: number;
  sessionInterimPayout: number; // Mid-game credits not reflected in completion payout

  // Super/Aura mode (on-chain)
  superMode?: {
    isActive: boolean;
    streakLevel: number;
    multipliers: Array<{ id: number; multiplier: number; superType: string }>;
  } | null;
}

export interface LeaderboardEntry {
  name: string;
  chips: number;
  status: 'ALIVE' | 'ELIMINATED';
}

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
