import { z } from 'zod';
import type { GameCodec } from './types.js';
export declare const blackjackMoveSchema: z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"blackjack">;
    move: z.ZodEnum<["hit", "stand", "double", "split", "deal", "surrender"]>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
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
}>;
export type BlackjackMoveMessage = z.infer<typeof blackjackMoveSchema>;
export declare const blackjackCodec: GameCodec<typeof blackjackMoveSchema, BlackjackMoveMessage>;
//# sourceMappingURL=blackjack.d.ts.map