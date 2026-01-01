/**
 * Binary instruction encoders matching Rust types/src/execution.rs
 * All multi-byte integers are Big Endian
 *
 * Note: This module encodes higher-level casino instructions (CasinoStartGame, CasinoGameMove).
 * Game-specific payloads should defer to @nullspace/protocol where possible.
 */
import { HiLoMove } from '@nullspace/constants';
import { InstructionTag } from './constants.js';
import { encodeGameMovePayload } from '@nullspace/protocol';
/**
 * CasinoRegister - Register a new casino player
 * Binary: [10] [nameLen:u32 BE] [nameBytes...]
 */
export function encodeCasinoRegister(name) {
    const nameBytes = new TextEncoder().encode(name);
    const result = new Uint8Array(1 + 4 + nameBytes.length);
    const view = new DataView(result.buffer);
    result[0] = InstructionTag.CasinoRegister;
    view.setUint32(1, nameBytes.length, false); // BE
    result.set(nameBytes, 5);
    return result;
}
/**
 * CasinoDeposit - Deposit chips (testing/faucet)
 * Binary: [11] [amount:u64 BE]
 */
export function encodeCasinoDeposit(amount) {
    const result = new Uint8Array(9);
    const view = new DataView(result.buffer);
    result[0] = InstructionTag.CasinoDeposit;
    view.setBigUint64(1, amount, false); // BE
    return result;
}
/**
 * CasinoStartGame - Start a new casino game session
 * Binary: [12] [gameType:u8] [bet:u64 BE] [sessionId:u64 BE]
 */
export function encodeCasinoStartGame(gameType, bet, sessionId) {
    const result = new Uint8Array(18);
    const view = new DataView(result.buffer);
    result[0] = InstructionTag.CasinoStartGame;
    result[1] = gameType;
    view.setBigUint64(2, bet, false); // BE
    view.setBigUint64(10, sessionId, false); // BE
    return result;
}
/**
 * CasinoGameMove - Make a move in an active game
 * Binary: [13] [sessionId:u64 BE] [payloadLen:u32 BE] [payload...]
 */
export function encodeCasinoGameMove(sessionId, payload) {
    const result = new Uint8Array(1 + 8 + 4 + payload.length);
    const view = new DataView(result.buffer);
    result[0] = InstructionTag.CasinoGameMove;
    view.setBigUint64(1, sessionId, false); // BE
    view.setUint32(9, payload.length, false); // BE
    result.set(payload, 13);
    return result;
}
/**
 * CasinoPlayerAction - Toggle modifiers (shield, double, super)
 * Binary: [14] [action:u8]
 */
export function encodeCasinoPlayerAction(action) {
    const result = new Uint8Array(2);
    result[0] = InstructionTag.CasinoPlayerAction;
    result[1] = action;
    return result;
}
/**
 * CasinoJoinTournament - Join a tournament
 * Binary: [16] [tournamentId:u64 BE]
 */
export function encodeCasinoJoinTournament(tournamentId) {
    const result = new Uint8Array(9);
    const view = new DataView(result.buffer);
    result[0] = InstructionTag.CasinoJoinTournament;
    view.setBigUint64(1, tournamentId, false); // BE
    return result;
}
// ============================================================
// Game-specific move payload builders
// ============================================================
/**
 * Blackjack move payload
 * Just a single byte for the action
 */
export function buildBlackjackPayload(move) {
    return encodeGameMovePayload({
        game: 'blackjack',
        move,
    });
}
/**
 * Hi-Lo move payload (from execution/src/casino/hilo.rs)
 * Single byte: 0=higher, 1=lower, 2=cashout, 3=same
 */
export function buildHiLoPayload(guess) {
    const guessMap = { higher: HiLoMove.Higher, lower: HiLoMove.Lower, same: HiLoMove.Same };
    return new Uint8Array([guessMap[guess]]);
}
/**
 * Baccarat start payload (initial bet type)
 * Single byte: 0=player, 1=banker, 2=tie
 */
export function buildBaccaratStartPayload(betType) {
    const betMap = { player: 0, banker: 1, tie: 2 };
    return new Uint8Array([betMap[betType]]);
}
export function buildRoulettePayload(bets) {
    const result = new Uint8Array(1 + bets.length * 10);
    const view = new DataView(result.buffer);
    result[0] = bets.length;
    let offset = 1;
    for (const bet of bets) {
        result[offset] = bet.type;
        result[offset + 1] = bet.value;
        view.setBigUint64(offset + 2, bet.amount, false);
        offset += 10;
    }
    return result;
}
/**
 * Video Poker hold payload
 * 5 bits for which cards to hold (bit 0 = card 0, etc.)
 */
export function buildVideoPokerPayload(holds) {
    let holdBits = 0;
    for (let i = 0; i < 5 && i < holds.length; i++) {
        if (holds[i])
            holdBits |= (1 << i);
    }
    return new Uint8Array([holdBits]);
}
/**
 * Craps place bet payload
 * Action 0: [0][betType:u8][target:u8][amount:u64 BE]
 *
 * Bet types:
 * - 0 = Pass Line, 1 = Don't Pass, 2 = Come, 3 = Don't Come
 * - 4 = Place (target = point number), 5 = Field
 * - etc. (see craps.rs for full list)
 */
export function buildCrapsPayload(betType, amount, target = 0) {
    const result = new Uint8Array(11); // 1 + 1 + 1 + 8
    const view = new DataView(result.buffer);
    result[0] = 0; // Action 0 = Place bet
    result[1] = betType;
    result[2] = target;
    view.setBigUint64(3, amount, false);
    return result;
}
/**
 * Craps roll dice payload
 * Action 2: [2]
 */
export function buildCrapsRollPayload() {
    return new Uint8Array([2]);
}
export function buildSicBoPayload(bets) {
    const result = new Uint8Array(1 + bets.length * 9);
    const view = new DataView(result.buffer);
    result[0] = bets.length;
    let offset = 1;
    for (const bet of bets) {
        result[offset] = bet.type;
        view.setBigUint64(offset + 1, bet.amount, false);
        offset += 9;
    }
    return result;
}
/**
 * Casino War surrender/go to war
 * 0 = surrender, 1 = go to war
 */
export function buildCasinoWarPayload(goToWar) {
    return new Uint8Array([goToWar ? 1 : 0]);
}
/**
 * Three Card Poker play/fold
 * 0 = fold, 1 = play
 */
export function buildThreeCardPayload(play) {
    return new Uint8Array([play ? 1 : 0]);
}
/**
 * Ultimate Texas Hold'em action
 * [action:u8][multiplier:u8]
 * action: 0=check, 1=bet
 * multiplier: 4x, 3x, 2x, 1x preflop/flop/river
 */
export function buildUltimateHoldemPayload(action, multiplier = 1) {
    return new Uint8Array([action === 'bet' ? 1 : 0, multiplier]);
}
//# sourceMappingURL=instructions.js.map