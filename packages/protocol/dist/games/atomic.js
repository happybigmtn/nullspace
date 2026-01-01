import { encodeBaccaratAtomicBatch, encodeRouletteAtomicBatch, encodeCrapsAtomicBatch, encodeSicBoAtomicBatch, } from '../encode.js';
export function encodeAtomicBatchPayload(game, bets) {
    switch (game) {
        case 'baccarat':
            return encodeBaccaratAtomicBatch(bets);
        case 'roulette':
            return encodeRouletteAtomicBatch(bets);
        case 'craps':
            return encodeCrapsAtomicBatch(bets);
        case 'sicbo':
            return encodeSicBoAtomicBatch(bets);
    }
}
//# sourceMappingURL=atomic.js.map