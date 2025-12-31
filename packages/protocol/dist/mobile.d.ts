/**
 * Zod schemas for mobile WebSocket messages (gateway <-> mobile).
 * Consolidated from mobile app to keep message validation in sync.
 */
import { z } from 'zod';
export declare const BaseMessageSchema: z.ZodObject<{
    type: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: string;
}, {
    type: string;
}>;
export declare const CardSchema: z.ZodObject<{
    suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
    rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
}, "strip", z.ZodTypeAny, {
    suit: "hearts" | "diamonds" | "clubs" | "spades";
    rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
}, {
    suit: "hearts" | "diamonds" | "clubs" | "spades";
    rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
}>;
export declare const GamePhaseSchema: z.ZodEnum<["betting", "playing", "waiting", "result"]>;
export declare const StateUpdateMessageSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"state_update">;
    balance: z.ZodOptional<z.ZodNumber>;
    phase: z.ZodOptional<z.ZodEnum<["betting", "playing", "waiting", "result"]>>;
}, "strip", z.ZodTypeAny, {
    type: "state_update";
    balance?: number | undefined;
    phase?: "betting" | "playing" | "waiting" | "result" | undefined;
}, {
    type: "state_update";
    balance?: number | undefined;
    phase?: "betting" | "playing" | "waiting" | "result" | undefined;
}>;
export declare const GameResultMessageSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"game_result">;
    won: z.ZodBoolean;
    payout: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    message: z.ZodOptional<z.ZodString>;
    finalChips: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"game_result">;
    won: z.ZodBoolean;
    payout: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    message: z.ZodOptional<z.ZodString>;
    finalChips: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"game_result">;
    won: z.ZodBoolean;
    payout: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    message: z.ZodOptional<z.ZodString>;
    finalChips: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const ErrorMessageSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"error">;
    code: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "error";
    code: string;
    message: string;
}, {
    type: "error";
    code: string;
    message: string;
}>;
export declare const SessionReadyMessageSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"session_ready">;
    sessionId: z.ZodString;
    publicKey: z.ZodString;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"session_ready">;
    sessionId: z.ZodString;
    publicKey: z.ZodString;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"session_ready">;
    sessionId: z.ZodString;
    publicKey: z.ZodString;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const BalanceMessageSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"balance">;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    publicKey: z.ZodString;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    message: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"balance">;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    publicKey: z.ZodString;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    message: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"balance">;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    publicKey: z.ZodString;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    message: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const GameStartedMessageSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"game_started">;
    gameType: z.ZodOptional<z.ZodNumber>;
    sessionId: z.ZodString;
    bet: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    initialState: z.ZodOptional<z.ZodUnknown>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"game_started">;
    gameType: z.ZodOptional<z.ZodNumber>;
    sessionId: z.ZodString;
    bet: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    initialState: z.ZodOptional<z.ZodUnknown>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"game_started">;
    gameType: z.ZodOptional<z.ZodNumber>;
    sessionId: z.ZodString;
    bet: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    initialState: z.ZodOptional<z.ZodUnknown>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const GameMoveMessageSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    moveNumber: z.ZodOptional<z.ZodNumber>;
    gameType: z.ZodOptional<z.ZodNumber>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    moveNumber: z.ZodOptional<z.ZodNumber>;
    gameType: z.ZodOptional<z.ZodNumber>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    moveNumber: z.ZodOptional<z.ZodNumber>;
    gameType: z.ZodOptional<z.ZodNumber>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const MoveAcceptedMessageSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"move_accepted">;
    sessionId: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"move_accepted">;
    sessionId: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"move_accepted">;
    sessionId: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const GameMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{} & {
    type: z.ZodLiteral<"session_ready">;
    sessionId: z.ZodString;
    publicKey: z.ZodString;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"session_ready">;
    sessionId: z.ZodString;
    publicKey: z.ZodString;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"session_ready">;
    sessionId: z.ZodString;
    publicKey: z.ZodString;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{} & {
    type: z.ZodLiteral<"balance">;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    publicKey: z.ZodString;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    message: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"balance">;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    publicKey: z.ZodString;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    message: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"balance">;
    registered: z.ZodBoolean;
    hasBalance: z.ZodBoolean;
    publicKey: z.ZodString;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    message: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{} & {
    type: z.ZodLiteral<"game_started">;
    gameType: z.ZodOptional<z.ZodNumber>;
    sessionId: z.ZodString;
    bet: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    initialState: z.ZodOptional<z.ZodUnknown>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"game_started">;
    gameType: z.ZodOptional<z.ZodNumber>;
    sessionId: z.ZodString;
    bet: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    initialState: z.ZodOptional<z.ZodUnknown>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"game_started">;
    gameType: z.ZodOptional<z.ZodNumber>;
    sessionId: z.ZodString;
    bet: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    initialState: z.ZodOptional<z.ZodUnknown>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{} & {
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    moveNumber: z.ZodOptional<z.ZodNumber>;
    gameType: z.ZodOptional<z.ZodNumber>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    moveNumber: z.ZodOptional<z.ZodNumber>;
    gameType: z.ZodOptional<z.ZodNumber>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    moveNumber: z.ZodOptional<z.ZodNumber>;
    gameType: z.ZodOptional<z.ZodNumber>;
    state: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{} & {
    type: z.ZodLiteral<"move_accepted">;
    sessionId: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"move_accepted">;
    sessionId: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"move_accepted">;
    sessionId: z.ZodString;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{} & {
    type: z.ZodLiteral<"state_update">;
    balance: z.ZodOptional<z.ZodNumber>;
    phase: z.ZodOptional<z.ZodEnum<["betting", "playing", "waiting", "result"]>>;
}, "strip", z.ZodTypeAny, {
    type: "state_update";
    balance?: number | undefined;
    phase?: "betting" | "playing" | "waiting" | "result" | undefined;
}, {
    type: "state_update";
    balance?: number | undefined;
    phase?: "betting" | "playing" | "waiting" | "result" | undefined;
}>, z.ZodObject<{} & {
    type: z.ZodLiteral<"game_result">;
    won: z.ZodBoolean;
    payout: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    message: z.ZodOptional<z.ZodString>;
    finalChips: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{} & {
    type: z.ZodLiteral<"game_result">;
    won: z.ZodBoolean;
    payout: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    message: z.ZodOptional<z.ZodString>;
    finalChips: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{} & {
    type: z.ZodLiteral<"game_result">;
    won: z.ZodBoolean;
    payout: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    message: z.ZodOptional<z.ZodString>;
    finalChips: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
    balance: z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{} & {
    type: z.ZodLiteral<"error">;
    code: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "error";
    code: string;
    message: string;
}, {
    type: "error";
    code: string;
    message: string;
}>]>;
export declare const BlackjackMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "card_dealt"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    playerCards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    dealerCards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    playerTotal: z.ZodOptional<z.ZodNumber>;
    dealerTotal: z.ZodOptional<z.ZodNumber>;
    canDouble: z.ZodOptional<z.ZodBoolean>;
    canSplit: z.ZodOptional<z.ZodBoolean>;
    won: z.ZodOptional<z.ZodBoolean>;
    push: z.ZodOptional<z.ZodBoolean>;
    blackjack: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "card_dealt";
    message?: string | undefined;
    push?: boolean | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    playerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    dealerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    playerTotal?: number | undefined;
    dealerTotal?: number | undefined;
    canDouble?: boolean | undefined;
    canSplit?: boolean | undefined;
    blackjack?: boolean | undefined;
}, {
    type: "state_update" | "game_result" | "card_dealt";
    message?: string | undefined;
    push?: boolean | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    playerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    dealerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    playerTotal?: number | undefined;
    dealerTotal?: number | undefined;
    canDouble?: boolean | undefined;
    canSplit?: boolean | undefined;
    blackjack?: boolean | undefined;
}>;
export declare const RouletteMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "spin_start"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    result: z.ZodOptional<z.ZodNumber>;
    won: z.ZodOptional<z.ZodBoolean>;
    winAmount: z.ZodOptional<z.ZodNumber>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "spin_start";
    message?: string | undefined;
    result?: number | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    winAmount?: number | undefined;
}, {
    type: "state_update" | "game_result" | "spin_start";
    message?: string | undefined;
    result?: number | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    winAmount?: number | undefined;
}>;
export declare const HiLoMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    card: z.ZodOptional<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>>;
    nextCard: z.ZodOptional<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>>;
    won: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result";
    message?: string | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    card?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    } | undefined;
    nextCard?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    } | undefined;
}, {
    type: "state_update" | "game_result";
    message?: string | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    card?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    } | undefined;
    nextCard?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    } | undefined;
}>;
export declare const BaccaratBetTypeSchema: z.ZodEnum<["PLAYER", "BANKER", "TIE", "P_PAIR", "B_PAIR", "LUCKY6", "P_DRAGON", "B_DRAGON", "PANDA8", "P_PERFECT_PAIR", "B_PERFECT_PAIR"]>;
export declare const BaccaratOutcomeSchema: z.ZodEnum<["PLAYER", "BANKER", "TIE"]>;
export declare const BaccaratMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "cards_dealt"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    playerCards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    bankerCards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    playerTotal: z.ZodOptional<z.ZodNumber>;
    bankerTotal: z.ZodOptional<z.ZodNumber>;
    winner: z.ZodOptional<z.ZodEnum<["PLAYER", "BANKER", "TIE"]>>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "cards_dealt";
    message?: string | undefined;
    balance?: number | undefined;
    playerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    playerTotal?: number | undefined;
    bankerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    bankerTotal?: number | undefined;
    winner?: "PLAYER" | "BANKER" | "TIE" | undefined;
}, {
    type: "state_update" | "game_result" | "cards_dealt";
    message?: string | undefined;
    balance?: number | undefined;
    playerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    playerTotal?: number | undefined;
    bankerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    bankerTotal?: number | undefined;
    winner?: "PLAYER" | "BANKER" | "TIE" | undefined;
}>;
export declare const CrapsMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "dice_roll"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    dice: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
    point: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    won: z.ZodOptional<z.ZodBoolean>;
    winAmount: z.ZodOptional<z.ZodNumber>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "dice_roll";
    message?: string | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    winAmount?: number | undefined;
    dice?: [number, number] | undefined;
    point?: number | null | undefined;
}, {
    type: "state_update" | "game_result" | "dice_roll";
    message?: string | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    winAmount?: number | undefined;
    dice?: [number, number] | undefined;
    point?: number | null | undefined;
}>;
export declare const CasinoWarMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "cards_dealt", "tie"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    playerCard: z.ZodOptional<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>>;
    dealerCard: z.ZodOptional<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>>;
    won: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "cards_dealt" | "tie";
    message?: string | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    playerCard?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    } | undefined;
    dealerCard?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    } | undefined;
}, {
    type: "state_update" | "game_result" | "cards_dealt" | "tie";
    message?: string | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    playerCard?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    } | undefined;
    dealerCard?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    } | undefined;
}>;
export declare const PokerHandSchema: z.ZodEnum<["ROYAL_FLUSH", "STRAIGHT_FLUSH", "FOUR_OF_A_KIND", "FULL_HOUSE", "FLUSH", "STRAIGHT", "THREE_OF_A_KIND", "TWO_PAIR", "JACKS_OR_BETTER", "NOTHING"]>;
export declare const VideoPokerMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "cards_dealt"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    cards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    hand: z.ZodOptional<z.ZodEnum<["ROYAL_FLUSH", "STRAIGHT_FLUSH", "FOUR_OF_A_KIND", "FULL_HOUSE", "FLUSH", "STRAIGHT", "THREE_OF_A_KIND", "TWO_PAIR", "JACKS_OR_BETTER", "NOTHING"]>>;
    payout: z.ZodOptional<z.ZodNumber>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "cards_dealt";
    message?: string | undefined;
    balance?: number | undefined;
    payout?: number | undefined;
    cards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    hand?: "ROYAL_FLUSH" | "STRAIGHT_FLUSH" | "FOUR_OF_A_KIND" | "FULL_HOUSE" | "FLUSH" | "STRAIGHT" | "THREE_OF_A_KIND" | "TWO_PAIR" | "JACKS_OR_BETTER" | "NOTHING" | undefined;
}, {
    type: "state_update" | "game_result" | "cards_dealt";
    message?: string | undefined;
    balance?: number | undefined;
    payout?: number | undefined;
    cards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    hand?: "ROYAL_FLUSH" | "STRAIGHT_FLUSH" | "FOUR_OF_A_KIND" | "FULL_HOUSE" | "FLUSH" | "STRAIGHT" | "THREE_OF_A_KIND" | "TWO_PAIR" | "JACKS_OR_BETTER" | "NOTHING" | undefined;
}>;
export declare const SicBoMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "dice_roll"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    dice: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>>;
    won: z.ZodOptional<z.ZodBoolean>;
    winAmount: z.ZodOptional<z.ZodNumber>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "dice_roll";
    message?: string | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    winAmount?: number | undefined;
    dice?: [number, number, number] | undefined;
}, {
    type: "state_update" | "game_result" | "dice_roll";
    message?: string | undefined;
    balance?: number | undefined;
    won?: boolean | undefined;
    winAmount?: number | undefined;
    dice?: [number, number, number] | undefined;
}>;
export declare const ThreeCardPokerHandSchema: z.ZodEnum<["STRAIGHT_FLUSH", "THREE_OF_A_KIND", "STRAIGHT", "FLUSH", "PAIR", "HIGH_CARD"]>;
export declare const ThreeCardPokerMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "cards_dealt"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    playerCards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    dealerCards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    playerHand: z.ZodOptional<z.ZodEnum<["STRAIGHT_FLUSH", "THREE_OF_A_KIND", "STRAIGHT", "FLUSH", "PAIR", "HIGH_CARD"]>>;
    dealerHand: z.ZodOptional<z.ZodEnum<["STRAIGHT_FLUSH", "THREE_OF_A_KIND", "STRAIGHT", "FLUSH", "PAIR", "HIGH_CARD"]>>;
    dealerQualifies: z.ZodOptional<z.ZodBoolean>;
    anteResult: z.ZodOptional<z.ZodEnum<["win", "loss", "push"]>>;
    pairPlusResult: z.ZodOptional<z.ZodEnum<["win", "loss"]>>;
    payout: z.ZodOptional<z.ZodNumber>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "cards_dealt";
    message?: string | undefined;
    balance?: number | undefined;
    payout?: number | undefined;
    playerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    dealerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    playerHand?: "STRAIGHT_FLUSH" | "FLUSH" | "STRAIGHT" | "THREE_OF_A_KIND" | "PAIR" | "HIGH_CARD" | undefined;
    dealerHand?: "STRAIGHT_FLUSH" | "FLUSH" | "STRAIGHT" | "THREE_OF_A_KIND" | "PAIR" | "HIGH_CARD" | undefined;
    dealerQualifies?: boolean | undefined;
    anteResult?: "push" | "win" | "loss" | undefined;
    pairPlusResult?: "win" | "loss" | undefined;
}, {
    type: "state_update" | "game_result" | "cards_dealt";
    message?: string | undefined;
    balance?: number | undefined;
    payout?: number | undefined;
    playerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    dealerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    playerHand?: "STRAIGHT_FLUSH" | "FLUSH" | "STRAIGHT" | "THREE_OF_A_KIND" | "PAIR" | "HIGH_CARD" | undefined;
    dealerHand?: "STRAIGHT_FLUSH" | "FLUSH" | "STRAIGHT" | "THREE_OF_A_KIND" | "PAIR" | "HIGH_CARD" | undefined;
    dealerQualifies?: boolean | undefined;
    anteResult?: "push" | "win" | "loss" | undefined;
    pairPlusResult?: "win" | "loss" | undefined;
}>;
export declare const UltimateTXPhaseSchema: z.ZodEnum<["betting", "preflop", "flop", "river", "showdown", "result"]>;
export declare const UltimateTXMessageSchema: z.ZodObject<{} & {
    type: z.ZodEnum<["state_update", "game_result", "cards_dealt", "community_dealt"]>;
    balance: z.ZodOptional<z.ZodNumber>;
    playerCards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    communityCards: z.ZodOptional<z.ZodArray<z.ZodObject<{
        suit: z.ZodEnum<["hearts", "diamonds", "clubs", "spades"]>;
        rank: z.ZodEnum<["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]>;
    }, "strip", z.ZodTypeAny, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }, {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }>, "many">>;
    phase: z.ZodOptional<z.ZodEnum<["betting", "preflop", "flop", "river", "showdown", "result"]>>;
    won: z.ZodOptional<z.ZodBoolean>;
    payout: z.ZodOptional<z.ZodNumber>;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "state_update" | "game_result" | "cards_dealt" | "community_dealt";
    message?: string | undefined;
    balance?: number | undefined;
    phase?: "betting" | "result" | "preflop" | "flop" | "river" | "showdown" | undefined;
    won?: boolean | undefined;
    payout?: number | undefined;
    playerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    communityCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
}, {
    type: "state_update" | "game_result" | "cards_dealt" | "community_dealt";
    message?: string | undefined;
    balance?: number | undefined;
    phase?: "betting" | "result" | "preflop" | "flop" | "river" | "showdown" | undefined;
    won?: boolean | undefined;
    payout?: number | undefined;
    playerCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
    communityCards?: {
        suit: "hearts" | "diamonds" | "clubs" | "spades";
        rank: "2" | "3" | "A" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
    }[] | undefined;
}>;
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
export declare const BlackjackDealRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"blackjack_deal">;
    amount: z.ZodNumber;
    sideBet21Plus3: z.ZodOptional<z.ZodNumber>;
    sideBet21p3: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_deal";
    amount: number;
    sideBet21Plus3?: number | undefined;
    sideBet21p3?: number | undefined;
}, {
    type: "blackjack_deal";
    amount: number;
    sideBet21Plus3?: number | undefined;
    sideBet21p3?: number | undefined;
}>;
export declare const BlackjackHitRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"blackjack_hit">;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_hit";
}, {
    type: "blackjack_hit";
}>;
export declare const BlackjackStandRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"blackjack_stand">;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_stand";
}, {
    type: "blackjack_stand";
}>;
export declare const BlackjackDoubleRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"blackjack_double">;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_double";
}, {
    type: "blackjack_double";
}>;
export declare const BlackjackSplitRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"blackjack_split">;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_split";
}, {
    type: "blackjack_split";
}>;
export declare const RouletteBetSchema: z.ZodObject<{
    type: z.ZodString;
    amount: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
    value: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: string;
    amount: number;
    number?: number | undefined;
    value?: number | undefined;
    target?: number | undefined;
}, {
    type: string;
    amount: number;
    number?: number | undefined;
    value?: number | undefined;
    target?: number | undefined;
}>;
export declare const RouletteSpinRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"roulette_spin">;
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        amount: z.ZodNumber;
        target: z.ZodOptional<z.ZodNumber>;
        number: z.ZodOptional<z.ZodNumber>;
        value: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "roulette_spin";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}, {
    type: "roulette_spin";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}>;
export declare const CrapsBetSchema: z.ZodObject<{
    type: z.ZodString;
    amount: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: string;
    amount: number;
    target?: number | undefined;
}, {
    type: string;
    amount: number;
    target?: number | undefined;
}>;
export declare const CrapsRollRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"craps_roll">;
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        amount: z.ZodNumber;
        target: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        amount: number;
        target?: number | undefined;
    }, {
        type: string;
        amount: number;
        target?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "craps_roll";
    bets: {
        type: string;
        amount: number;
        target?: number | undefined;
    }[];
}, {
    type: "craps_roll";
    bets: {
        type: string;
        amount: number;
        target?: number | undefined;
    }[];
}>;
export declare const CrapsSingleBetRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"craps_bet">;
    betType: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    amount: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "craps_bet";
    amount: number;
    betType: string | number;
    target?: number | undefined;
}, {
    type: "craps_bet";
    amount: number;
    betType: string | number;
    target?: number | undefined;
}>;
export declare const HiLoBetRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"hilo_bet">;
    amount: z.ZodNumber;
    choice: z.ZodEnum<["higher", "lower"]>;
}, "strip", z.ZodTypeAny, {
    type: "hilo_bet";
    amount: number;
    choice: "higher" | "lower";
}, {
    type: "hilo_bet";
    amount: number;
    choice: "higher" | "lower";
}>;
export declare const HiLoDealRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"hilo_deal">;
}, "strip", z.ZodTypeAny, {
    type: "hilo_deal";
}, {
    type: "hilo_deal";
}>;
export declare const BaccaratBetSchema: z.ZodObject<{
    type: z.ZodEnum<["PLAYER", "BANKER", "TIE", "P_PAIR", "B_PAIR", "LUCKY6", "P_DRAGON", "B_DRAGON", "PANDA8", "P_PERFECT_PAIR", "B_PERFECT_PAIR"]>;
    amount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
    amount: number;
}, {
    type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
    amount: number;
}>;
export declare const BaccaratDealRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"baccarat_deal">;
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["PLAYER", "BANKER", "TIE", "P_PAIR", "B_PAIR", "LUCKY6", "P_DRAGON", "B_DRAGON", "PANDA8", "P_PERFECT_PAIR", "B_PERFECT_PAIR"]>;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
        amount: number;
    }, {
        type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
        amount: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "baccarat_deal";
    bets: {
        type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
        amount: number;
    }[];
}, {
    type: "baccarat_deal";
    bets: {
        type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
        amount: number;
    }[];
}>;
export declare const CasinoWarDealRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"casino_war_deal">;
    amount: z.ZodNumber;
    tieBet: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "casino_war_deal";
    amount: number;
    tieBet?: number | undefined;
}, {
    type: "casino_war_deal";
    amount: number;
    tieBet?: number | undefined;
}>;
export declare const CasinoWarWarRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"casino_war_war">;
}, "strip", z.ZodTypeAny, {
    type: "casino_war_war";
}, {
    type: "casino_war_war";
}>;
export declare const CasinoWarSurrenderRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"casino_war_surrender">;
}, "strip", z.ZodTypeAny, {
    type: "casino_war_surrender";
}, {
    type: "casino_war_surrender";
}>;
export declare const CasinoWarLegacyDealRequestSchema: z.ZodObject<{
    amount: z.ZodNumber;
    tieBet: z.ZodOptional<z.ZodNumber>;
} & {
    type: z.ZodLiteral<"casinowar_deal">;
}, "strip", z.ZodTypeAny, {
    type: "casinowar_deal";
    amount: number;
    tieBet?: number | undefined;
}, {
    type: "casinowar_deal";
    amount: number;
    tieBet?: number | undefined;
}>;
export declare const CasinoWarLegacyWarRequestSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"casinowar_war">;
}, "strip", z.ZodTypeAny, {
    type: "casinowar_war";
}, {
    type: "casinowar_war";
}>;
export declare const CasinoWarLegacySurrenderRequestSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"casinowar_surrender">;
}, "strip", z.ZodTypeAny, {
    type: "casinowar_surrender";
}, {
    type: "casinowar_surrender";
}>;
export declare const VideoPokerDealRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"video_poker_deal">;
    amount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "video_poker_deal";
    amount: number;
}, {
    type: "video_poker_deal";
    amount: number;
}>;
export declare const VideoPokerDrawRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"video_poker_draw">;
    held: z.ZodArray<z.ZodBoolean, "many">;
}, "strip", z.ZodTypeAny, {
    type: "video_poker_draw";
    held: boolean[];
}, {
    type: "video_poker_draw";
    held: boolean[];
}>;
export declare const VideoPokerLegacyDealRequestSchema: z.ZodObject<{
    amount: z.ZodNumber;
} & {
    type: z.ZodLiteral<"videopoker_deal">;
}, "strip", z.ZodTypeAny, {
    type: "videopoker_deal";
    amount: number;
}, {
    type: "videopoker_deal";
    amount: number;
}>;
export declare const VideoPokerLegacyHoldRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"videopoker_hold">;
    holds: z.ZodArray<z.ZodBoolean, "many">;
}, "strip", z.ZodTypeAny, {
    type: "videopoker_hold";
    holds: boolean[];
}, {
    type: "videopoker_hold";
    holds: boolean[];
}>;
export declare const SicBoBetSchema: z.ZodObject<{
    type: z.ZodString;
    amount: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
    number: z.ZodOptional<z.ZodNumber>;
    value: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: string;
    amount: number;
    number?: number | undefined;
    value?: number | undefined;
    target?: number | undefined;
}, {
    type: string;
    amount: number;
    number?: number | undefined;
    value?: number | undefined;
    target?: number | undefined;
}>;
export declare const SicBoRollRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"sic_bo_roll">;
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        amount: z.ZodNumber;
        target: z.ZodOptional<z.ZodNumber>;
        number: z.ZodOptional<z.ZodNumber>;
        value: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "sic_bo_roll";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}, {
    type: "sic_bo_roll";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}>;
export declare const SicBoLegacyRollRequestSchema: z.ZodObject<{
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        amount: z.ZodNumber;
        target: z.ZodOptional<z.ZodNumber>;
        number: z.ZodOptional<z.ZodNumber>;
        value: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }>, "many">;
} & {
    type: z.ZodLiteral<"sicbo_roll">;
}, "strip", z.ZodTypeAny, {
    type: "sicbo_roll";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}, {
    type: "sicbo_roll";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}>;
export declare const ThreeCardPokerDealRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"three_card_poker_deal">;
    ante: z.ZodNumber;
    pairPlus: z.ZodOptional<z.ZodNumber>;
    sixCard: z.ZodOptional<z.ZodNumber>;
    sixCardBonus: z.ZodOptional<z.ZodNumber>;
    progressive: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "three_card_poker_deal";
    ante: number;
    pairPlus?: number | undefined;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
}, {
    type: "three_card_poker_deal";
    ante: number;
    pairPlus?: number | undefined;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
}>;
export declare const ThreeCardPokerPlayRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"three_card_poker_play">;
}, "strip", z.ZodTypeAny, {
    type: "three_card_poker_play";
}, {
    type: "three_card_poker_play";
}>;
export declare const ThreeCardPokerFoldRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"three_card_poker_fold">;
}, "strip", z.ZodTypeAny, {
    type: "three_card_poker_fold";
}, {
    type: "three_card_poker_fold";
}>;
export declare const ThreeCardPokerLegacyDealRequestSchema: z.ZodObject<{
    ante: z.ZodNumber;
    pairPlus: z.ZodOptional<z.ZodNumber>;
    sixCard: z.ZodOptional<z.ZodNumber>;
    sixCardBonus: z.ZodOptional<z.ZodNumber>;
    progressive: z.ZodOptional<z.ZodNumber>;
} & {
    type: z.ZodLiteral<"threecardpoker_deal">;
}, "strip", z.ZodTypeAny, {
    type: "threecardpoker_deal";
    ante: number;
    pairPlus?: number | undefined;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
}, {
    type: "threecardpoker_deal";
    ante: number;
    pairPlus?: number | undefined;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
}>;
export declare const ThreeCardPokerLegacyPlayRequestSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"threecardpoker_play">;
}, "strip", z.ZodTypeAny, {
    type: "threecardpoker_play";
}, {
    type: "threecardpoker_play";
}>;
export declare const ThreeCardPokerLegacyFoldRequestSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"threecardpoker_fold">;
}, "strip", z.ZodTypeAny, {
    type: "threecardpoker_fold";
}, {
    type: "threecardpoker_fold";
}>;
export declare const UltimateTXDealRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"ultimate_tx_deal">;
    ante: z.ZodNumber;
    blind: z.ZodNumber;
    trips: z.ZodOptional<z.ZodNumber>;
    sixCard: z.ZodOptional<z.ZodNumber>;
    sixCardBonus: z.ZodOptional<z.ZodNumber>;
    progressive: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "ultimate_tx_deal";
    ante: number;
    blind: number;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
    trips?: number | undefined;
}, {
    type: "ultimate_tx_deal";
    ante: number;
    blind: number;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
    trips?: number | undefined;
}>;
export declare const UltimateTXBetRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"ultimate_tx_bet">;
    multiplier: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "ultimate_tx_bet";
    multiplier: number;
}, {
    type: "ultimate_tx_bet";
    multiplier: number;
}>;
export declare const UltimateTXCheckRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"ultimate_tx_check">;
}, "strip", z.ZodTypeAny, {
    type: "ultimate_tx_check";
}, {
    type: "ultimate_tx_check";
}>;
export declare const UltimateTXFoldRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"ultimate_tx_fold">;
}, "strip", z.ZodTypeAny, {
    type: "ultimate_tx_fold";
}, {
    type: "ultimate_tx_fold";
}>;
export declare const UltimateTXLegacyDealRequestSchema: z.ZodObject<{
    ante: z.ZodNumber;
    blind: z.ZodNumber;
    trips: z.ZodOptional<z.ZodNumber>;
    sixCard: z.ZodOptional<z.ZodNumber>;
    sixCardBonus: z.ZodOptional<z.ZodNumber>;
    progressive: z.ZodOptional<z.ZodNumber>;
} & {
    type: z.ZodLiteral<"ultimateholdem_deal">;
}, "strip", z.ZodTypeAny, {
    type: "ultimateholdem_deal";
    ante: number;
    blind: number;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
    trips?: number | undefined;
}, {
    type: "ultimateholdem_deal";
    ante: number;
    blind: number;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
    trips?: number | undefined;
}>;
export declare const UltimateTXLegacyBetRequestSchema: z.ZodObject<{
    multiplier: z.ZodNumber;
} & {
    type: z.ZodLiteral<"ultimateholdem_bet">;
}, "strip", z.ZodTypeAny, {
    type: "ultimateholdem_bet";
    multiplier: number;
}, {
    type: "ultimateholdem_bet";
    multiplier: number;
}>;
export declare const UltimateTXLegacyCheckRequestSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"ultimateholdem_check">;
}, "strip", z.ZodTypeAny, {
    type: "ultimateholdem_check";
}, {
    type: "ultimateholdem_check";
}>;
export declare const UltimateTXLegacyFoldRequestSchema: z.ZodObject<{} & {
    type: z.ZodLiteral<"ultimateholdem_fold">;
}, "strip", z.ZodTypeAny, {
    type: "ultimateholdem_fold";
}, {
    type: "ultimateholdem_fold";
}>;
export declare const FaucetClaimRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"faucet_claim">;
    amount: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "faucet_claim";
    amount?: number | undefined;
}, {
    type: "faucet_claim";
    amount?: number | undefined;
}>;
export declare const OutboundMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"blackjack_deal">;
    amount: z.ZodNumber;
    sideBet21Plus3: z.ZodOptional<z.ZodNumber>;
    sideBet21p3: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_deal";
    amount: number;
    sideBet21Plus3?: number | undefined;
    sideBet21p3?: number | undefined;
}, {
    type: "blackjack_deal";
    amount: number;
    sideBet21Plus3?: number | undefined;
    sideBet21p3?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"blackjack_hit">;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_hit";
}, {
    type: "blackjack_hit";
}>, z.ZodObject<{
    type: z.ZodLiteral<"blackjack_stand">;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_stand";
}, {
    type: "blackjack_stand";
}>, z.ZodObject<{
    type: z.ZodLiteral<"blackjack_double">;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_double";
}, {
    type: "blackjack_double";
}>, z.ZodObject<{
    type: z.ZodLiteral<"blackjack_split">;
}, "strip", z.ZodTypeAny, {
    type: "blackjack_split";
}, {
    type: "blackjack_split";
}>, z.ZodObject<{
    type: z.ZodLiteral<"roulette_spin">;
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        amount: z.ZodNumber;
        target: z.ZodOptional<z.ZodNumber>;
        number: z.ZodOptional<z.ZodNumber>;
        value: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "roulette_spin";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}, {
    type: "roulette_spin";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"craps_roll">;
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        amount: z.ZodNumber;
        target: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        amount: number;
        target?: number | undefined;
    }, {
        type: string;
        amount: number;
        target?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "craps_roll";
    bets: {
        type: string;
        amount: number;
        target?: number | undefined;
    }[];
}, {
    type: "craps_roll";
    bets: {
        type: string;
        amount: number;
        target?: number | undefined;
    }[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"craps_bet">;
    betType: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    amount: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "craps_bet";
    amount: number;
    betType: string | number;
    target?: number | undefined;
}, {
    type: "craps_bet";
    amount: number;
    betType: string | number;
    target?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"hilo_bet">;
    amount: z.ZodNumber;
    choice: z.ZodEnum<["higher", "lower"]>;
}, "strip", z.ZodTypeAny, {
    type: "hilo_bet";
    amount: number;
    choice: "higher" | "lower";
}, {
    type: "hilo_bet";
    amount: number;
    choice: "higher" | "lower";
}>, z.ZodObject<{
    type: z.ZodLiteral<"hilo_deal">;
}, "strip", z.ZodTypeAny, {
    type: "hilo_deal";
}, {
    type: "hilo_deal";
}>, z.ZodObject<{
    type: z.ZodLiteral<"baccarat_deal">;
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["PLAYER", "BANKER", "TIE", "P_PAIR", "B_PAIR", "LUCKY6", "P_DRAGON", "B_DRAGON", "PANDA8", "P_PERFECT_PAIR", "B_PERFECT_PAIR"]>;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
        amount: number;
    }, {
        type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
        amount: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "baccarat_deal";
    bets: {
        type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
        amount: number;
    }[];
}, {
    type: "baccarat_deal";
    bets: {
        type: "PLAYER" | "BANKER" | "TIE" | "P_PAIR" | "B_PAIR" | "LUCKY6" | "P_DRAGON" | "B_DRAGON" | "PANDA8" | "P_PERFECT_PAIR" | "B_PERFECT_PAIR";
        amount: number;
    }[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"casino_war_deal">;
    amount: z.ZodNumber;
    tieBet: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "casino_war_deal";
    amount: number;
    tieBet?: number | undefined;
}, {
    type: "casino_war_deal";
    amount: number;
    tieBet?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"casino_war_war">;
}, "strip", z.ZodTypeAny, {
    type: "casino_war_war";
}, {
    type: "casino_war_war";
}>, z.ZodObject<{
    type: z.ZodLiteral<"casino_war_surrender">;
}, "strip", z.ZodTypeAny, {
    type: "casino_war_surrender";
}, {
    type: "casino_war_surrender";
}>, z.ZodObject<{
    amount: z.ZodNumber;
    tieBet: z.ZodOptional<z.ZodNumber>;
} & {
    type: z.ZodLiteral<"casinowar_deal">;
}, "strip", z.ZodTypeAny, {
    type: "casinowar_deal";
    amount: number;
    tieBet?: number | undefined;
}, {
    type: "casinowar_deal";
    amount: number;
    tieBet?: number | undefined;
}>, z.ZodObject<{} & {
    type: z.ZodLiteral<"casinowar_war">;
}, "strip", z.ZodTypeAny, {
    type: "casinowar_war";
}, {
    type: "casinowar_war";
}>, z.ZodObject<{} & {
    type: z.ZodLiteral<"casinowar_surrender">;
}, "strip", z.ZodTypeAny, {
    type: "casinowar_surrender";
}, {
    type: "casinowar_surrender";
}>, z.ZodObject<{
    type: z.ZodLiteral<"video_poker_deal">;
    amount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "video_poker_deal";
    amount: number;
}, {
    type: "video_poker_deal";
    amount: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"video_poker_draw">;
    held: z.ZodArray<z.ZodBoolean, "many">;
}, "strip", z.ZodTypeAny, {
    type: "video_poker_draw";
    held: boolean[];
}, {
    type: "video_poker_draw";
    held: boolean[];
}>, z.ZodObject<{
    amount: z.ZodNumber;
} & {
    type: z.ZodLiteral<"videopoker_deal">;
}, "strip", z.ZodTypeAny, {
    type: "videopoker_deal";
    amount: number;
}, {
    type: "videopoker_deal";
    amount: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"videopoker_hold">;
    holds: z.ZodArray<z.ZodBoolean, "many">;
}, "strip", z.ZodTypeAny, {
    type: "videopoker_hold";
    holds: boolean[];
}, {
    type: "videopoker_hold";
    holds: boolean[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"sic_bo_roll">;
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        amount: z.ZodNumber;
        target: z.ZodOptional<z.ZodNumber>;
        number: z.ZodOptional<z.ZodNumber>;
        value: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "sic_bo_roll";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}, {
    type: "sic_bo_roll";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}>, z.ZodObject<{
    bets: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        amount: z.ZodNumber;
        target: z.ZodOptional<z.ZodNumber>;
        number: z.ZodOptional<z.ZodNumber>;
        value: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }, {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }>, "many">;
} & {
    type: z.ZodLiteral<"sicbo_roll">;
}, "strip", z.ZodTypeAny, {
    type: "sicbo_roll";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}, {
    type: "sicbo_roll";
    bets: {
        type: string;
        amount: number;
        number?: number | undefined;
        value?: number | undefined;
        target?: number | undefined;
    }[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"three_card_poker_deal">;
    ante: z.ZodNumber;
    pairPlus: z.ZodOptional<z.ZodNumber>;
    sixCard: z.ZodOptional<z.ZodNumber>;
    sixCardBonus: z.ZodOptional<z.ZodNumber>;
    progressive: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "three_card_poker_deal";
    ante: number;
    pairPlus?: number | undefined;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
}, {
    type: "three_card_poker_deal";
    ante: number;
    pairPlus?: number | undefined;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"three_card_poker_play">;
}, "strip", z.ZodTypeAny, {
    type: "three_card_poker_play";
}, {
    type: "three_card_poker_play";
}>, z.ZodObject<{
    type: z.ZodLiteral<"three_card_poker_fold">;
}, "strip", z.ZodTypeAny, {
    type: "three_card_poker_fold";
}, {
    type: "three_card_poker_fold";
}>, z.ZodObject<{
    ante: z.ZodNumber;
    pairPlus: z.ZodOptional<z.ZodNumber>;
    sixCard: z.ZodOptional<z.ZodNumber>;
    sixCardBonus: z.ZodOptional<z.ZodNumber>;
    progressive: z.ZodOptional<z.ZodNumber>;
} & {
    type: z.ZodLiteral<"threecardpoker_deal">;
}, "strip", z.ZodTypeAny, {
    type: "threecardpoker_deal";
    ante: number;
    pairPlus?: number | undefined;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
}, {
    type: "threecardpoker_deal";
    ante: number;
    pairPlus?: number | undefined;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
}>, z.ZodObject<{} & {
    type: z.ZodLiteral<"threecardpoker_play">;
}, "strip", z.ZodTypeAny, {
    type: "threecardpoker_play";
}, {
    type: "threecardpoker_play";
}>, z.ZodObject<{} & {
    type: z.ZodLiteral<"threecardpoker_fold">;
}, "strip", z.ZodTypeAny, {
    type: "threecardpoker_fold";
}, {
    type: "threecardpoker_fold";
}>, z.ZodObject<{
    type: z.ZodLiteral<"ultimate_tx_deal">;
    ante: z.ZodNumber;
    blind: z.ZodNumber;
    trips: z.ZodOptional<z.ZodNumber>;
    sixCard: z.ZodOptional<z.ZodNumber>;
    sixCardBonus: z.ZodOptional<z.ZodNumber>;
    progressive: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "ultimate_tx_deal";
    ante: number;
    blind: number;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
    trips?: number | undefined;
}, {
    type: "ultimate_tx_deal";
    ante: number;
    blind: number;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
    trips?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"ultimate_tx_bet">;
    multiplier: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "ultimate_tx_bet";
    multiplier: number;
}, {
    type: "ultimate_tx_bet";
    multiplier: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"ultimate_tx_check">;
}, "strip", z.ZodTypeAny, {
    type: "ultimate_tx_check";
}, {
    type: "ultimate_tx_check";
}>, z.ZodObject<{
    type: z.ZodLiteral<"ultimate_tx_fold">;
}, "strip", z.ZodTypeAny, {
    type: "ultimate_tx_fold";
}, {
    type: "ultimate_tx_fold";
}>, z.ZodObject<{
    ante: z.ZodNumber;
    blind: z.ZodNumber;
    trips: z.ZodOptional<z.ZodNumber>;
    sixCard: z.ZodOptional<z.ZodNumber>;
    sixCardBonus: z.ZodOptional<z.ZodNumber>;
    progressive: z.ZodOptional<z.ZodNumber>;
} & {
    type: z.ZodLiteral<"ultimateholdem_deal">;
}, "strip", z.ZodTypeAny, {
    type: "ultimateholdem_deal";
    ante: number;
    blind: number;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
    trips?: number | undefined;
}, {
    type: "ultimateholdem_deal";
    ante: number;
    blind: number;
    sixCard?: number | undefined;
    sixCardBonus?: number | undefined;
    progressive?: number | undefined;
    trips?: number | undefined;
}>, z.ZodObject<{
    multiplier: z.ZodNumber;
} & {
    type: z.ZodLiteral<"ultimateholdem_bet">;
}, "strip", z.ZodTypeAny, {
    type: "ultimateholdem_bet";
    multiplier: number;
}, {
    type: "ultimateholdem_bet";
    multiplier: number;
}>, z.ZodObject<{} & {
    type: z.ZodLiteral<"ultimateholdem_check">;
}, "strip", z.ZodTypeAny, {
    type: "ultimateholdem_check";
}, {
    type: "ultimateholdem_check";
}>, z.ZodObject<{} & {
    type: z.ZodLiteral<"ultimateholdem_fold">;
}, "strip", z.ZodTypeAny, {
    type: "ultimateholdem_fold";
}, {
    type: "ultimateholdem_fold";
}>, z.ZodObject<{
    type: z.ZodLiteral<"faucet_claim">;
    amount: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "faucet_claim";
    amount?: number | undefined;
}, {
    type: "faucet_claim";
    amount?: number | undefined;
}>]>;
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
export type BaccaratBet = z.infer<typeof BaccaratBetSchema>;
export type BaccaratDealRequest = z.infer<typeof BaccaratDealRequestSchema>;
export type CasinoWarDealRequest = z.infer<typeof CasinoWarDealRequestSchema>;
export type CasinoWarWarRequest = z.infer<typeof CasinoWarWarRequestSchema>;
export type CasinoWarSurrenderRequest = z.infer<typeof CasinoWarSurrenderRequestSchema>;
export type VideoPokerDealRequest = z.infer<typeof VideoPokerDealRequestSchema>;
export type VideoPokerDrawRequest = z.infer<typeof VideoPokerDrawRequestSchema>;
export type VideoPokerLegacyHoldRequest = z.infer<typeof VideoPokerLegacyHoldRequestSchema>;
export type SicBoBet = z.infer<typeof SicBoBetSchema>;
export type SicBoRollRequest = z.infer<typeof SicBoRollRequestSchema>;
export type ThreeCardPokerDealRequest = z.infer<typeof ThreeCardPokerDealRequestSchema>;
export type ThreeCardPokerPlayRequest = z.infer<typeof ThreeCardPokerPlayRequestSchema>;
export type ThreeCardPokerFoldRequest = z.infer<typeof ThreeCardPokerFoldRequestSchema>;
export type UltimateTXDealRequest = z.infer<typeof UltimateTXDealRequestSchema>;
export type UltimateTXBetRequest = z.infer<typeof UltimateTXBetRequestSchema>;
export type UltimateTXCheckRequest = z.infer<typeof UltimateTXCheckRequestSchema>;
export type UltimateTXFoldRequest = z.infer<typeof UltimateTXFoldRequestSchema>;
export type FaucetClaimRequest = z.infer<typeof FaucetClaimRequestSchema>;
export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;
/**
 * Validates a raw WebSocket message and returns the parsed result or null
 */
export declare function validateMessage<T>(raw: unknown, schema: z.ZodSchema<T>): {
    success: true;
    data: T;
} | {
    success: false;
    error: z.ZodError;
};
//# sourceMappingURL=mobile.d.ts.map