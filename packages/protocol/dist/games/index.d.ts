import { blackjackMoveSchema, type BlackjackMoveMessage } from './blackjack.js';
import { rouletteMoveSchema, type RouletteMoveMessage } from './roulette.js';
import { crapsMoveSchema, type CrapsMoveMessage } from './craps.js';
import type { GameCodec } from './types.js';
export declare const GAME_CODECS: readonly [GameCodec<import("zod").ZodObject<{
    type: import("zod").ZodLiteral<"game_move">;
    sessionId: import("zod").ZodString;
    game: import("zod").ZodLiteral<"blackjack">;
    move: import("zod").ZodEnum<["hit", "stand", "double", "split", "deal", "surrender"]>;
    requestId: import("zod").ZodOptional<import("zod").ZodString>;
}, "strip", import("zod").ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}>, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}>, GameCodec<import("zod").ZodUnion<[import("zod").ZodObject<{
    type: import("zod").ZodLiteral<"game_move">;
    sessionId: import("zod").ZodString;
    game: import("zod").ZodLiteral<"roulette">;
    move: import("zod").ZodLiteral<"place_bet">;
    betType: import("zod").ZodNumber;
    number: import("zod").ZodNumber;
    amount: import("zod").ZodEffects<import("zod").ZodEffects<import("zod").ZodString, string, string>, string, string>;
    requestId: import("zod").ZodOptional<import("zod").ZodString>;
}, "strip", import("zod").ZodTypeAny, {
    number: number;
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    amount: string;
    requestId?: string | undefined;
}, {
    number: number;
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    amount: string;
    requestId?: string | undefined;
}>, import("zod").ZodObject<{
    type: import("zod").ZodLiteral<"game_move">;
    sessionId: import("zod").ZodString;
    game: import("zod").ZodLiteral<"roulette">;
    move: import("zod").ZodEnum<["spin", "clear_bets"]>;
    requestId: import("zod").ZodOptional<import("zod").ZodString>;
}, "strip", import("zod").ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}>]>, {
    number: number;
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    amount: string;
    requestId?: string | undefined;
} | {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}>, GameCodec<import("zod").ZodUnion<[import("zod").ZodObject<{
    type: import("zod").ZodLiteral<"game_move">;
    sessionId: import("zod").ZodString;
    game: import("zod").ZodLiteral<"craps">;
    move: import("zod").ZodLiteral<"place_bet">;
    betType: import("zod").ZodNumber;
    target: import("zod").ZodOptional<import("zod").ZodNumber>;
    amount: import("zod").ZodEffects<import("zod").ZodEffects<import("zod").ZodString, string, string>, string, string>;
    requestId: import("zod").ZodOptional<import("zod").ZodString>;
}, "strip", import("zod").ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    amount: string;
    requestId?: string | undefined;
    target?: number | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    amount: string;
    requestId?: string | undefined;
    target?: number | undefined;
}>, import("zod").ZodObject<{
    type: import("zod").ZodLiteral<"game_move">;
    sessionId: import("zod").ZodString;
    game: import("zod").ZodLiteral<"craps">;
    move: import("zod").ZodLiteral<"add_odds">;
    amount: import("zod").ZodEffects<import("zod").ZodEffects<import("zod").ZodString, string, string>, string, string>;
    requestId: import("zod").ZodOptional<import("zod").ZodString>;
}, "strip", import("zod").ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "add_odds";
    amount: string;
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "add_odds";
    amount: string;
    requestId?: string | undefined;
}>, import("zod").ZodObject<{
    type: import("zod").ZodLiteral<"game_move">;
    sessionId: import("zod").ZodString;
    game: import("zod").ZodLiteral<"craps">;
    move: import("zod").ZodLiteral<"roll">;
    requestId: import("zod").ZodOptional<import("zod").ZodString>;
}, "strip", import("zod").ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
}>, import("zod").ZodObject<{
    type: import("zod").ZodLiteral<"game_move">;
    sessionId: import("zod").ZodString;
    game: import("zod").ZodLiteral<"craps">;
    move: import("zod").ZodLiteral<"clear_bets">;
    requestId: import("zod").ZodOptional<import("zod").ZodString>;
}, "strip", import("zod").ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}>]>, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    amount: string;
    requestId?: string | undefined;
    target?: number | undefined;
} | {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "add_odds";
    amount: string;
    requestId?: string | undefined;
} | {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
} | {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}>];
export type GatewayGameMove = BlackjackMoveMessage | RouletteMoveMessage | CrapsMoveMessage;
export type GatewayGameMovePayload = Omit<GatewayGameMove, 'type' | 'sessionId' | 'requestId'>;
export declare const GAME_MOVE_SCHEMAS: import("zod").ZodTypeAny[];
export declare const GAME_CODECS_BY_NAME: {
    blackjack: GameCodec<import("zod").ZodObject<{
        type: import("zod").ZodLiteral<"game_move">;
        sessionId: import("zod").ZodString;
        game: import("zod").ZodLiteral<"blackjack">;
        move: import("zod").ZodEnum<["hit", "stand", "double", "split", "deal", "surrender"]>;
        requestId: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        type: "game_move";
        sessionId: string;
        game: "blackjack";
        move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
        requestId?: string | undefined;
    }, {
        type: "game_move";
        sessionId: string;
        game: "blackjack";
        move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
        requestId?: string | undefined;
    }>, {
        type: "game_move";
        sessionId: string;
        game: "blackjack";
        move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
        requestId?: string | undefined;
    }>;
    roulette: GameCodec<import("zod").ZodUnion<[import("zod").ZodObject<{
        type: import("zod").ZodLiteral<"game_move">;
        sessionId: import("zod").ZodString;
        game: import("zod").ZodLiteral<"roulette">;
        move: import("zod").ZodLiteral<"place_bet">;
        betType: import("zod").ZodNumber;
        number: import("zod").ZodNumber;
        amount: import("zod").ZodEffects<import("zod").ZodEffects<import("zod").ZodString, string, string>, string, string>;
        requestId: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        number: number;
        type: "game_move";
        sessionId: string;
        game: "roulette";
        move: "place_bet";
        betType: number;
        amount: string;
        requestId?: string | undefined;
    }, {
        number: number;
        type: "game_move";
        sessionId: string;
        game: "roulette";
        move: "place_bet";
        betType: number;
        amount: string;
        requestId?: string | undefined;
    }>, import("zod").ZodObject<{
        type: import("zod").ZodLiteral<"game_move">;
        sessionId: import("zod").ZodString;
        game: import("zod").ZodLiteral<"roulette">;
        move: import("zod").ZodEnum<["spin", "clear_bets"]>;
        requestId: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        type: "game_move";
        sessionId: string;
        game: "roulette";
        move: "spin" | "clear_bets";
        requestId?: string | undefined;
    }, {
        type: "game_move";
        sessionId: string;
        game: "roulette";
        move: "spin" | "clear_bets";
        requestId?: string | undefined;
    }>]>, {
        number: number;
        type: "game_move";
        sessionId: string;
        game: "roulette";
        move: "place_bet";
        betType: number;
        amount: string;
        requestId?: string | undefined;
    } | {
        type: "game_move";
        sessionId: string;
        game: "roulette";
        move: "spin" | "clear_bets";
        requestId?: string | undefined;
    }>;
    craps: GameCodec<import("zod").ZodUnion<[import("zod").ZodObject<{
        type: import("zod").ZodLiteral<"game_move">;
        sessionId: import("zod").ZodString;
        game: import("zod").ZodLiteral<"craps">;
        move: import("zod").ZodLiteral<"place_bet">;
        betType: import("zod").ZodNumber;
        target: import("zod").ZodOptional<import("zod").ZodNumber>;
        amount: import("zod").ZodEffects<import("zod").ZodEffects<import("zod").ZodString, string, string>, string, string>;
        requestId: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "place_bet";
        betType: number;
        amount: string;
        requestId?: string | undefined;
        target?: number | undefined;
    }, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "place_bet";
        betType: number;
        amount: string;
        requestId?: string | undefined;
        target?: number | undefined;
    }>, import("zod").ZodObject<{
        type: import("zod").ZodLiteral<"game_move">;
        sessionId: import("zod").ZodString;
        game: import("zod").ZodLiteral<"craps">;
        move: import("zod").ZodLiteral<"add_odds">;
        amount: import("zod").ZodEffects<import("zod").ZodEffects<import("zod").ZodString, string, string>, string, string>;
        requestId: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "add_odds";
        amount: string;
        requestId?: string | undefined;
    }, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "add_odds";
        amount: string;
        requestId?: string | undefined;
    }>, import("zod").ZodObject<{
        type: import("zod").ZodLiteral<"game_move">;
        sessionId: import("zod").ZodString;
        game: import("zod").ZodLiteral<"craps">;
        move: import("zod").ZodLiteral<"roll">;
        requestId: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "roll";
        requestId?: string | undefined;
    }, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "roll";
        requestId?: string | undefined;
    }>, import("zod").ZodObject<{
        type: import("zod").ZodLiteral<"game_move">;
        sessionId: import("zod").ZodString;
        game: import("zod").ZodLiteral<"craps">;
        move: import("zod").ZodLiteral<"clear_bets">;
        requestId: import("zod").ZodOptional<import("zod").ZodString>;
    }, "strip", import("zod").ZodTypeAny, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "clear_bets";
        requestId?: string | undefined;
    }, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "clear_bets";
        requestId?: string | undefined;
    }>]>, {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "place_bet";
        betType: number;
        amount: string;
        requestId?: string | undefined;
        target?: number | undefined;
    } | {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "add_odds";
        amount: string;
        requestId?: string | undefined;
    } | {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "roll";
        requestId?: string | undefined;
    } | {
        type: "game_move";
        sessionId: string;
        game: "craps";
        move: "clear_bets";
        requestId?: string | undefined;
    }>;
};
export declare function encodeGameMove(message: GatewayGameMove): Uint8Array;
export declare function encodeGameMovePayload(message: GatewayGameMovePayload): Uint8Array;
export { blackjackMoveSchema, rouletteMoveSchema, crapsMoveSchema };
export * from './blackjack.js';
export * from './roulette.js';
export * from './craps.js';
export * from './atomic.js';
export * from './types.js';
//# sourceMappingURL=index.d.ts.map