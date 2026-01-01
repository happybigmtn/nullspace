import type { z } from 'zod';
import type { GameType } from '@nullspace/types';
export interface GameCodec<TSchema extends z.ZodTypeAny, TMove = z.infer<TSchema>> {
    game: string;
    gameType: GameType;
    moveSchema: TSchema;
    moveSchemas: readonly z.ZodTypeAny[];
    encodeMove: (message: TMove) => Uint8Array;
}
//# sourceMappingURL=types.d.ts.map