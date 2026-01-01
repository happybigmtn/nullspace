/**
 * Zod schemas for mobile WebSocket messages (gateway <-> mobile).
 * Consolidated from mobile app to keep message validation in sync.
 */
import { z } from 'zod';
import { GameType } from '@nullspace/types';

// Base message schema - all messages must have a type field
export const BaseMessageSchema = z.object({
  type: z.string(),
});

// Card schema for card-based games
export const CardSchema = z.object({
  suit: z.enum(['hearts', 'diamonds', 'clubs', 'spades']),
  rank: z.enum(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']),
});

// Common game phases
export const GamePhaseSchema = z.enum(['betting', 'playing', 'waiting', 'result']);

// State update message
export const StateUpdateMessageSchema = BaseMessageSchema.extend({
  type: z.literal('state_update'),
  balance: z.number().optional(),
  phase: GamePhaseSchema.optional(),
});

// Game result message
export const GameResultMessageSchema = BaseMessageSchema.extend({
  type: z.literal('game_result'),
  won: z.boolean(),
  payout: z.union([z.number(), z.string()]),
  message: z.string().optional(),
  finalChips: z.union([z.number(), z.string()]).optional(),
  balance: z.union([z.number(), z.string()]).optional(),
}).passthrough();

// Error message
export const ErrorMessageSchema = BaseMessageSchema.extend({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
});

export const SessionReadyMessageSchema = BaseMessageSchema.extend({
  type: z.literal('session_ready'),
  sessionId: z.string(),
  publicKey: z.string(),
  registered: z.boolean(),
  hasBalance: z.boolean(),
  balance: z.union([z.number(), z.string()]).optional(),
}).passthrough();

export const BalanceMessageSchema = BaseMessageSchema.extend({
  type: z.literal('balance'),
  registered: z.boolean(),
  hasBalance: z.boolean(),
  publicKey: z.string(),
  balance: z.union([z.number(), z.string()]).optional(),
  message: z.string().optional(),
}).passthrough();

export const GameStartedMessageSchema = BaseMessageSchema.extend({
  type: z.literal('game_started'),
  gameType: z.number().optional(),
  sessionId: z.string(),
  bet: z.union([z.number(), z.string()]).optional(),
  state: z.array(z.number()).optional(),
  initialState: z.unknown().optional(),
  balance: z.union([z.number(), z.string()]).optional(),
}).passthrough();

export const GameMoveMessageSchema = BaseMessageSchema.extend({
  type: z.literal('game_move'),
  sessionId: z.string(),
  moveNumber: z.number().optional(),
  gameType: z.number().optional(),
  state: z.array(z.number()).optional(),
  balance: z.union([z.number(), z.string()]).optional(),
}).passthrough();

export const MoveAcceptedMessageSchema = BaseMessageSchema.extend({
  type: z.literal('move_accepted'),
  sessionId: z.string(),
}).passthrough();

// Generic game message union (base types)
export const GameMessageSchema = z.discriminatedUnion('type', [
  SessionReadyMessageSchema,
  BalanceMessageSchema,
  GameStartedMessageSchema,
  GameMoveMessageSchema,
  MoveAcceptedMessageSchema,
  StateUpdateMessageSchema,
  GameResultMessageSchema,
  ErrorMessageSchema,
]);

// Blackjack-specific schemas
export const BlackjackMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'card_dealt']),
  balance: z.number().optional(),
  playerCards: z.array(CardSchema).optional(),
  dealerCards: z.array(CardSchema).optional(),
  playerTotal: z.number().optional(),
  dealerTotal: z.number().optional(),
  canDouble: z.boolean().optional(),
  canSplit: z.boolean().optional(),
  won: z.boolean().optional(),
  push: z.boolean().optional(),
  blackjack: z.boolean().optional(),
  message: z.string().optional(),
});

// Roulette-specific schemas
export const RouletteMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'spin_start']),
  balance: z.number().optional(),
  result: z.number().optional(),
  won: z.boolean().optional(),
  winAmount: z.number().optional(),
  message: z.string().optional(),
});

// Hi-Lo-specific schemas
export const HiLoMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result']),
  balance: z.number().optional(),
  card: CardSchema.optional(),
  nextCard: CardSchema.optional(),
  won: z.boolean().optional(),
  message: z.string().optional(),
});

// Baccarat-specific schemas
export const BaccaratBetTypeSchema = z.enum([
  'PLAYER',
  'BANKER',
  'TIE',
  'P_PAIR',
  'B_PAIR',
  'LUCKY6',
  'P_DRAGON',
  'B_DRAGON',
  'PANDA8',
  'P_PERFECT_PAIR',
  'B_PERFECT_PAIR',
]);
export const BaccaratOutcomeSchema = z.enum(['PLAYER', 'BANKER', 'TIE']);
export const BaccaratMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'cards_dealt']),
  balance: z.number().optional(),
  playerCards: z.array(CardSchema).optional(),
  bankerCards: z.array(CardSchema).optional(),
  playerTotal: z.number().optional(),
  bankerTotal: z.number().optional(),
  winner: BaccaratOutcomeSchema.optional(),
  message: z.string().optional(),
});

// Craps-specific schemas
export const CrapsMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'dice_roll']),
  balance: z.number().optional(),
  dice: z.tuple([z.number(), z.number()]).optional(),
  point: z.number().nullable().optional(),
  won: z.boolean().optional(),
  winAmount: z.number().optional(),
  message: z.string().optional(),
});

// Casino War-specific schemas
export const CasinoWarMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'cards_dealt', 'tie']),
  balance: z.number().optional(),
  playerCard: CardSchema.optional(),
  dealerCard: CardSchema.optional(),
  won: z.boolean().optional(),
  message: z.string().optional(),
});

// Video Poker-specific schemas
export const PokerHandSchema = z.enum([
  'ROYAL_FLUSH',
  'STRAIGHT_FLUSH',
  'FOUR_OF_A_KIND',
  'FULL_HOUSE',
  'FLUSH',
  'STRAIGHT',
  'THREE_OF_A_KIND',
  'TWO_PAIR',
  'JACKS_OR_BETTER',
  'NOTHING',
]);

export const VideoPokerMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'cards_dealt']),
  balance: z.number().optional(),
  cards: z.array(CardSchema).optional(),
  hand: PokerHandSchema.optional(),
  payout: z.number().optional(),
  message: z.string().optional(),
});

// Sic Bo-specific schemas
export const SicBoMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'dice_roll']),
  balance: z.number().optional(),
  dice: z.tuple([z.number(), z.number(), z.number()]).optional(),
  won: z.boolean().optional(),
  winAmount: z.number().optional(),
  message: z.string().optional(),
});

// Three Card Poker-specific schemas
export const ThreeCardPokerHandSchema = z.enum([
  'STRAIGHT_FLUSH',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'PAIR',
  'HIGH_CARD',
]);

export const ThreeCardPokerMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'cards_dealt']),
  balance: z.number().optional(),
  playerCards: z.array(CardSchema).optional(),
  dealerCards: z.array(CardSchema).optional(),
  playerHand: ThreeCardPokerHandSchema.optional(),
  dealerHand: ThreeCardPokerHandSchema.optional(),
  dealerQualifies: z.boolean().optional(),
  anteResult: z.enum(['win', 'loss', 'push']).optional(),
  pairPlusResult: z.enum(['win', 'loss']).optional(),
  payout: z.number().optional(),
  message: z.string().optional(),
});

// Ultimate TX Hold'em-specific schemas
export const UltimateTXPhaseSchema = z.enum(['betting', 'preflop', 'flop', 'river', 'showdown', 'result']);

export const UltimateTXMessageSchema = BaseMessageSchema.extend({
  type: z.enum(['state_update', 'game_result', 'cards_dealt', 'community_dealt']),
  balance: z.number().optional(),
  playerCards: z.array(CardSchema).optional(),
  communityCards: z.array(CardSchema).optional(),
  phase: UltimateTXPhaseSchema.optional(),
  won: z.boolean().optional(),
  payout: z.number().optional(),
  message: z.string().optional(),
});

export type GameMessage = z.infer<typeof GameMessageSchema>;
export type SessionReadyMessage = z.infer<typeof SessionReadyMessageSchema>;
export type BalanceMessage = z.infer<typeof BalanceMessageSchema>;
export type GameStartedMessage = z.infer<typeof GameStartedMessageSchema>;
export type GameMoveMessage = z.infer<typeof GameMoveMessageSchema>;
export type MoveAcceptedMessage = z.infer<typeof MoveAcceptedMessageSchema>;
export type BlackjackMessage = z.infer<typeof BlackjackMessageSchema>;
export type RouletteMessage = z.infer<typeof RouletteMessageSchema>;
export type HiLoMessage = z.infer<typeof HiLoMessageSchema>;
export type BaccaratMessage = z.infer<typeof BaccaratMessageSchema>;
export type CrapsMessage = z.infer<typeof CrapsMessageSchema>;
export type CasinoWarMessage = z.infer<typeof CasinoWarMessageSchema>;
export type VideoPokerMessage = z.infer<typeof VideoPokerMessageSchema>;
export type SicBoMessage = z.infer<typeof SicBoMessageSchema>;
export type ThreeCardPokerMessage = z.infer<typeof ThreeCardPokerMessageSchema>;
export type UltimateTXMessage = z.infer<typeof UltimateTXMessageSchema>;
export type ThreeCardPokerHand = z.infer<typeof ThreeCardPokerHandSchema>;

// =============================================================================
// OUTBOUND MESSAGE SCHEMAS (Client -> Server)
// =============================================================================

// --- Blackjack Outbound ---
export const BlackjackDealRequestSchema = z.object({
  type: z.literal('blackjack_deal'),
  amount: z.number().positive(),
  sideBet21Plus3: z.number().nonnegative().optional(),
  sideBet21p3: z.number().nonnegative().optional(),
});

export const BlackjackHitRequestSchema = z.object({
  type: z.literal('blackjack_hit'),
});

export const BlackjackStandRequestSchema = z.object({
  type: z.literal('blackjack_stand'),
});

export const BlackjackDoubleRequestSchema = z.object({
  type: z.literal('blackjack_double'),
});

export const BlackjackSplitRequestSchema = z.object({
  type: z.literal('blackjack_split'),
});

// --- Roulette Outbound ---
export const RouletteBetSchema = z.object({
  type: z.union([z.string(), z.number().int().min(0).max(255)]),
  amount: z.number().positive(),
  target: z.number().int().min(0).max(37).optional(),
  number: z.number().int().min(0).max(37).optional(),
  value: z.number().int().min(0).max(37).optional(),
});

export const RouletteSpinRequestSchema = z.object({
  type: z.literal('roulette_spin'),
  bets: z.array(RouletteBetSchema).min(1),
});

// --- Craps Outbound ---
export const CrapsBetSchema = z.object({
  type: z.string(),
  amount: z.number().positive(),
  target: z.number().int().min(0).max(12).optional(),
});

export const CrapsRollRequestSchema = z.object({
  type: z.literal('craps_roll'),
  bets: z.array(CrapsBetSchema).min(1),
});

export const CrapsSingleBetRequestSchema = z.object({
  type: z.literal('craps_bet'),
  betType: z.union([z.string(), z.number().int().min(0)]),
  amount: z.number().positive(),
  target: z.number().int().min(0).max(12).optional(),
});

// --- Hi-Lo Outbound ---
export const HiLoBetRequestSchema = z.object({
  type: z.literal('hilo_bet'),
  amount: z.number().positive(),
  choice: z.enum(['higher', 'lower']),
});

export const HiLoDealRequestSchema = z.object({
  type: z.literal('hilo_deal'),
  amount: z.number().positive(),
});

export const HiLoHigherRequestSchema = z.object({
  type: z.literal('hilo_higher'),
});

export const HiLoLowerRequestSchema = z.object({
  type: z.literal('hilo_lower'),
});

export const HiLoSameRequestSchema = z.object({
  type: z.literal('hilo_same'),
});

export const HiLoCashoutRequestSchema = z.object({
  type: z.literal('hilo_cashout'),
});

// --- Baccarat Outbound ---
export const BaccaratBetSchema = z.object({
  type: BaccaratBetTypeSchema,
  amount: z.number().positive(),
});

export const BaccaratDealRequestSchema = z.object({
  type: z.literal('baccarat_deal'),
  bets: z.array(BaccaratBetSchema).min(1),
});

// --- Casino War Outbound ---
export const CasinoWarDealRequestSchema = z.object({
  type: z.literal('casino_war_deal'),
  amount: z.number().positive(),
  tieBet: z.number().nonnegative().optional(),
});

export const CasinoWarWarRequestSchema = z.object({
  type: z.literal('casino_war_war'),
});

export const CasinoWarSurrenderRequestSchema = z.object({
  type: z.literal('casino_war_surrender'),
});

export const CasinoWarLegacyDealRequestSchema = CasinoWarDealRequestSchema.extend({
  type: z.literal('casinowar_deal'),
});

export const CasinoWarLegacyWarRequestSchema = CasinoWarWarRequestSchema.extend({
  type: z.literal('casinowar_war'),
});

export const CasinoWarLegacySurrenderRequestSchema = CasinoWarSurrenderRequestSchema.extend({
  type: z.literal('casinowar_surrender'),
});

// --- Video Poker Outbound ---
export const VideoPokerDealRequestSchema = z.object({
  type: z.literal('video_poker_deal'),
  amount: z.number().positive(),
});

export const VideoPokerDrawRequestSchema = z.object({
  type: z.literal('video_poker_draw'),
  held: z.array(z.boolean()).length(5),
});

export const VideoPokerLegacyDealRequestSchema = VideoPokerDealRequestSchema.extend({
  type: z.literal('videopoker_deal'),
});

export const VideoPokerLegacyHoldRequestSchema = z.object({
  type: z.literal('videopoker_hold'),
  holds: z.array(z.boolean()).length(5),
});

// --- Sic Bo Outbound ---
export const SicBoBetSchema = z.object({
  type: z.union([z.string(), z.number().int().min(0).max(255)]),
  amount: z.number().positive(),
  target: z.number().int().min(0).max(255).optional(),
  number: z.number().int().min(0).max(255).optional(),
  value: z.number().int().min(0).max(255).optional(),
});

export const SicBoRollRequestSchema = z.object({
  type: z.literal('sic_bo_roll'),
  bets: z.array(SicBoBetSchema).min(1),
});

export const SicBoLegacyRollRequestSchema = SicBoRollRequestSchema.extend({
  type: z.literal('sicbo_roll'),
});

// --- Three Card Poker Outbound ---
export const ThreeCardPokerDealRequestSchema = z.object({
  type: z.literal('three_card_poker_deal'),
  ante: z.number().positive(),
  pairPlus: z.number().nonnegative().optional(),
  sixCard: z.number().nonnegative().optional(),
  sixCardBonus: z.number().nonnegative().optional(),
  progressive: z.number().nonnegative().optional(),
});

export const ThreeCardPokerPlayRequestSchema = z.object({
  type: z.literal('three_card_poker_play'),
});

export const ThreeCardPokerFoldRequestSchema = z.object({
  type: z.literal('three_card_poker_fold'),
});

export const ThreeCardPokerLegacyDealRequestSchema = ThreeCardPokerDealRequestSchema.extend({
  type: z.literal('threecardpoker_deal'),
});

export const ThreeCardPokerLegacyPlayRequestSchema = ThreeCardPokerPlayRequestSchema.extend({
  type: z.literal('threecardpoker_play'),
});

export const ThreeCardPokerLegacyFoldRequestSchema = ThreeCardPokerFoldRequestSchema.extend({
  type: z.literal('threecardpoker_fold'),
});

// --- Ultimate TX Hold'em Outbound ---
export const UltimateTXDealRequestSchema = z.object({
  type: z.literal('ultimate_tx_deal'),
  ante: z.number().positive(),
  blind: z.number().positive(),
  trips: z.number().nonnegative().optional(),
  sixCard: z.number().nonnegative().optional(),
  sixCardBonus: z.number().nonnegative().optional(),
  progressive: z.number().nonnegative().optional(),
});

export const UltimateTXBetRequestSchema = z.object({
  type: z.literal('ultimate_tx_bet'),
  multiplier: z.number().int().min(1).max(4),
});

export const UltimateTXCheckRequestSchema = z.object({
  type: z.literal('ultimate_tx_check'),
});

export const UltimateTXFoldRequestSchema = z.object({
  type: z.literal('ultimate_tx_fold'),
});

export const UltimateTXLegacyDealRequestSchema = UltimateTXDealRequestSchema.extend({
  type: z.literal('ultimateholdem_deal'),
});

export const UltimateTXLegacyBetRequestSchema = UltimateTXBetRequestSchema.extend({
  type: z.literal('ultimateholdem_bet'),
});

export const UltimateTXLegacyCheckRequestSchema = UltimateTXCheckRequestSchema.extend({
  type: z.literal('ultimateholdem_check'),
});

export const UltimateTXLegacyFoldRequestSchema = UltimateTXFoldRequestSchema.extend({
  type: z.literal('ultimateholdem_fold'),
});

// --- System Outbound ---
export const FaucetClaimRequestSchema = z.object({
  type: z.literal('faucet_claim'),
  amount: z.number().positive().optional(),
});

// --- Outbound Message Union ---
export const OutboundMessageSchema = z.discriminatedUnion('type', [
  // Blackjack
  BlackjackDealRequestSchema,
  BlackjackHitRequestSchema,
  BlackjackStandRequestSchema,
  BlackjackDoubleRequestSchema,
  BlackjackSplitRequestSchema,
  // Roulette
  RouletteSpinRequestSchema,
  // Craps
  CrapsRollRequestSchema,
  CrapsSingleBetRequestSchema,
  // Hi-Lo
  HiLoBetRequestSchema,
  HiLoDealRequestSchema,
  HiLoHigherRequestSchema,
  HiLoLowerRequestSchema,
  HiLoSameRequestSchema,
  HiLoCashoutRequestSchema,
  // Baccarat
  BaccaratDealRequestSchema,
  // Casino War
  CasinoWarDealRequestSchema,
  CasinoWarWarRequestSchema,
  CasinoWarSurrenderRequestSchema,
  CasinoWarLegacyDealRequestSchema,
  CasinoWarLegacyWarRequestSchema,
  CasinoWarLegacySurrenderRequestSchema,
  // Video Poker
  VideoPokerDealRequestSchema,
  VideoPokerDrawRequestSchema,
  VideoPokerLegacyDealRequestSchema,
  VideoPokerLegacyHoldRequestSchema,
  // Sic Bo
  SicBoRollRequestSchema,
  SicBoLegacyRollRequestSchema,
  // Three Card Poker
  ThreeCardPokerDealRequestSchema,
  ThreeCardPokerPlayRequestSchema,
  ThreeCardPokerFoldRequestSchema,
  ThreeCardPokerLegacyDealRequestSchema,
  ThreeCardPokerLegacyPlayRequestSchema,
  ThreeCardPokerLegacyFoldRequestSchema,
  // Ultimate TX Hold'em
  UltimateTXDealRequestSchema,
  UltimateTXBetRequestSchema,
  UltimateTXCheckRequestSchema,
  UltimateTXFoldRequestSchema,
  UltimateTXLegacyDealRequestSchema,
  UltimateTXLegacyBetRequestSchema,
  UltimateTXLegacyCheckRequestSchema,
  UltimateTXLegacyFoldRequestSchema,
  FaucetClaimRequestSchema,
]);

// Outbound type exports
export type BlackjackDealRequest = z.infer<typeof BlackjackDealRequestSchema>;
export type BlackjackHitRequest = z.infer<typeof BlackjackHitRequestSchema>;
export type BlackjackStandRequest = z.infer<typeof BlackjackStandRequestSchema>;
export type BlackjackDoubleRequest = z.infer<typeof BlackjackDoubleRequestSchema>;
export type BlackjackSplitRequest = z.infer<typeof BlackjackSplitRequestSchema>;
export type RouletteBet = z.infer<typeof RouletteBetSchema>;
export type RouletteSpinRequest = z.infer<typeof RouletteSpinRequestSchema>;
export type CrapsBet = z.infer<typeof CrapsBetSchema>;
export type CrapsRollRequest = z.infer<typeof CrapsRollRequestSchema>;
export type CrapsSingleBetRequest = z.infer<typeof CrapsSingleBetRequestSchema>;
export type HiLoBetRequest = z.infer<typeof HiLoBetRequestSchema>;
export type HiLoDealRequest = z.infer<typeof HiLoDealRequestSchema>;
export type HiLoHigherRequest = z.infer<typeof HiLoHigherRequestSchema>;
export type HiLoLowerRequest = z.infer<typeof HiLoLowerRequestSchema>;
export type HiLoSameRequest = z.infer<typeof HiLoSameRequestSchema>;
export type HiLoCashoutRequest = z.infer<typeof HiLoCashoutRequestSchema>;
export type BaccaratBet = z.infer<typeof BaccaratBetSchema>;
export type BaccaratDealRequest = z.infer<typeof BaccaratDealRequestSchema>;
export type CasinoWarDealRequest = z.infer<typeof CasinoWarDealRequestSchema>;
export type CasinoWarWarRequest = z.infer<typeof CasinoWarWarRequestSchema>;
export type CasinoWarSurrenderRequest = z.infer<typeof CasinoWarSurrenderRequestSchema>;
export type CasinoWarLegacyDealRequest = z.infer<typeof CasinoWarLegacyDealRequestSchema>;
export type CasinoWarLegacyWarRequest = z.infer<typeof CasinoWarLegacyWarRequestSchema>;
export type CasinoWarLegacySurrenderRequest = z.infer<typeof CasinoWarLegacySurrenderRequestSchema>;
export type VideoPokerDealRequest = z.infer<typeof VideoPokerDealRequestSchema>;
export type VideoPokerDrawRequest = z.infer<typeof VideoPokerDrawRequestSchema>;
export type VideoPokerLegacyDealRequest = z.infer<typeof VideoPokerLegacyDealRequestSchema>;
export type VideoPokerLegacyHoldRequest = z.infer<typeof VideoPokerLegacyHoldRequestSchema>;
export type SicBoBet = z.infer<typeof SicBoBetSchema>;
export type SicBoRollRequest = z.infer<typeof SicBoRollRequestSchema>;
export type SicBoLegacyRollRequest = z.infer<typeof SicBoLegacyRollRequestSchema>;
export type ThreeCardPokerDealRequest = z.infer<typeof ThreeCardPokerDealRequestSchema>;
export type ThreeCardPokerPlayRequest = z.infer<typeof ThreeCardPokerPlayRequestSchema>;
export type ThreeCardPokerFoldRequest = z.infer<typeof ThreeCardPokerFoldRequestSchema>;
export type ThreeCardPokerLegacyDealRequest = z.infer<typeof ThreeCardPokerLegacyDealRequestSchema>;
export type ThreeCardPokerLegacyPlayRequest = z.infer<typeof ThreeCardPokerLegacyPlayRequestSchema>;
export type ThreeCardPokerLegacyFoldRequest = z.infer<typeof ThreeCardPokerLegacyFoldRequestSchema>;
export type UltimateTXDealRequest = z.infer<typeof UltimateTXDealRequestSchema>;
export type UltimateTXBetRequest = z.infer<typeof UltimateTXBetRequestSchema>;
export type UltimateTXCheckRequest = z.infer<typeof UltimateTXCheckRequestSchema>;
export type UltimateTXFoldRequest = z.infer<typeof UltimateTXFoldRequestSchema>;
export type UltimateTXLegacyDealRequest = z.infer<typeof UltimateTXLegacyDealRequestSchema>;
export type UltimateTXLegacyBetRequest = z.infer<typeof UltimateTXLegacyBetRequestSchema>;
export type UltimateTXLegacyCheckRequest = z.infer<typeof UltimateTXLegacyCheckRequestSchema>;
export type UltimateTXLegacyFoldRequest = z.infer<typeof UltimateTXLegacyFoldRequestSchema>;
export type FaucetClaimRequest = z.infer<typeof FaucetClaimRequestSchema>;
export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;

export const OUTBOUND_MESSAGE_GAME_TYPES = {
  blackjack_deal: GameType.Blackjack,
  blackjack_hit: GameType.Blackjack,
  blackjack_stand: GameType.Blackjack,
  blackjack_double: GameType.Blackjack,
  blackjack_split: GameType.Blackjack,
  roulette_spin: GameType.Roulette,
  craps_roll: GameType.Craps,
  craps_bet: GameType.Craps,
  hilo_bet: GameType.HiLo,
  hilo_deal: GameType.HiLo,
  hilo_higher: GameType.HiLo,
  hilo_lower: GameType.HiLo,
  hilo_same: GameType.HiLo,
  hilo_cashout: GameType.HiLo,
  baccarat_deal: GameType.Baccarat,
  casino_war_deal: GameType.CasinoWar,
  casino_war_war: GameType.CasinoWar,
  casino_war_surrender: GameType.CasinoWar,
  casinowar_deal: GameType.CasinoWar,
  casinowar_war: GameType.CasinoWar,
  casinowar_surrender: GameType.CasinoWar,
  video_poker_deal: GameType.VideoPoker,
  video_poker_draw: GameType.VideoPoker,
  videopoker_deal: GameType.VideoPoker,
  videopoker_hold: GameType.VideoPoker,
  sic_bo_roll: GameType.SicBo,
  sicbo_roll: GameType.SicBo,
  three_card_poker_deal: GameType.ThreeCard,
  three_card_poker_play: GameType.ThreeCard,
  three_card_poker_fold: GameType.ThreeCard,
  threecardpoker_deal: GameType.ThreeCard,
  threecardpoker_play: GameType.ThreeCard,
  threecardpoker_fold: GameType.ThreeCard,
  ultimate_tx_deal: GameType.UltimateHoldem,
  ultimate_tx_bet: GameType.UltimateHoldem,
  ultimate_tx_check: GameType.UltimateHoldem,
  ultimate_tx_fold: GameType.UltimateHoldem,
  ultimateholdem_deal: GameType.UltimateHoldem,
  ultimateholdem_bet: GameType.UltimateHoldem,
  ultimateholdem_check: GameType.UltimateHoldem,
  ultimateholdem_fold: GameType.UltimateHoldem,
  faucet_claim: null,
} as const satisfies Record<OutboundMessage['type'], GameType | null>;

export function getOutboundMessageGameType(type: OutboundMessage['type']): GameType | null {
  return OUTBOUND_MESSAGE_GAME_TYPES[type] ?? null;
}

/**
 * Validates a raw WebSocket message and returns the parsed result or null
 */
export function validateMessage<T>(
  raw: unknown,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
