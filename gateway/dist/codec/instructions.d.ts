import { GameType, PlayerAction } from './constants.js';
import type { BlackjackMoveAction } from '@nullspace/protocol/encode';
/**
 * CasinoRegister - Register a new casino player
 * Binary: [10] [nameLen:u32 BE] [nameBytes...]
 */
export declare function encodeCasinoRegister(name: string): Uint8Array;
/**
 * CasinoDeposit - Deposit chips (testing/faucet)
 * Binary: [11] [amount:u64 BE]
 */
export declare function encodeCasinoDeposit(amount: bigint): Uint8Array;
/**
 * CasinoStartGame - Start a new casino game session
 * Binary: [12] [gameType:u8] [bet:u64 BE] [sessionId:u64 BE]
 */
export declare function encodeCasinoStartGame(gameType: GameType, bet: bigint, sessionId: bigint): Uint8Array;
/**
 * CasinoGameMove - Make a move in an active game
 * Binary: [13] [sessionId:u64 BE] [payloadLen:u32 BE] [payload...]
 */
export declare function encodeCasinoGameMove(sessionId: bigint, payload: Uint8Array): Uint8Array;
/**
 * CasinoPlayerAction - Toggle modifiers (shield, double, super)
 * Binary: [14] [action:u8]
 */
export declare function encodeCasinoPlayerAction(action: PlayerAction): Uint8Array;
/**
 * CasinoJoinTournament - Join a tournament
 * Binary: [16] [tournamentId:u64 BE]
 */
export declare function encodeCasinoJoinTournament(tournamentId: bigint): Uint8Array;
/**
 * Blackjack move payload
 * Just a single byte for the action
 */
export declare function buildBlackjackPayload(move: BlackjackMoveAction): Uint8Array;
/**
 * Hi-Lo move payload (from execution/src/casino/hilo.rs)
 * Single byte: 0=higher, 1=lower, 2=cashout, 3=same
 */
export declare function buildHiLoPayload(guess: 'higher' | 'lower' | 'same'): Uint8Array;
/**
 * Baccarat start payload (initial bet type)
 * Single byte: 0=player, 1=banker, 2=tie
 */
export declare function buildBaccaratStartPayload(betType: 'player' | 'banker' | 'tie'): Uint8Array;
/**
 * Roulette bet payload
 * Format: [numBets:u8] [bet1Type:u8][bet1Value:u8][bet1Amount:u64]...
 */
export interface RouletteBet {
    type: number;
    value: number;
    amount: bigint;
}
export declare function buildRoulettePayload(bets: RouletteBet[]): Uint8Array;
/**
 * Video Poker hold payload
 * 5 bits for which cards to hold (bit 0 = card 0, etc.)
 */
export declare function buildVideoPokerPayload(holds: boolean[]): Uint8Array;
/**
 * Craps place bet payload
 * Action 0: [0][betType:u8][target:u8][amount:u64 BE]
 *
 * Bet types:
 * - 0 = Pass Line, 1 = Don't Pass, 2 = Come, 3 = Don't Come
 * - 4 = Place (target = point number), 5 = Field
 * - etc. (see craps.rs for full list)
 */
export declare function buildCrapsPayload(betType: number, amount: bigint, target?: number): Uint8Array;
/**
 * Craps roll dice payload
 * Action 2: [2]
 */
export declare function buildCrapsRollPayload(): Uint8Array;
/**
 * Sic Bo bet payload
 * [numBets:u8] [bet1Type:u8][bet1Amount:u64]...
 */
export interface SicBoBet {
    type: number;
    amount: bigint;
}
export declare function buildSicBoPayload(bets: SicBoBet[]): Uint8Array;
/**
 * Casino War surrender/go to war
 * 0 = surrender, 1 = go to war
 */
export declare function buildCasinoWarPayload(goToWar: boolean): Uint8Array;
/**
 * Three Card Poker play/fold
 * 0 = fold, 1 = play
 */
export declare function buildThreeCardPayload(play: boolean): Uint8Array;
/**
 * Ultimate Texas Hold'em action
 * [action:u8][multiplier:u8]
 * action: 0=check, 1=bet
 * multiplier: 4x, 3x, 2x, 1x preflop/flop/river
 */
export declare function buildUltimateHoldemPayload(action: 'check' | 'bet', multiplier?: number): Uint8Array;
//# sourceMappingURL=instructions.d.ts.map