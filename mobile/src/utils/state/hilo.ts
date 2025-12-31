import type { Card } from '../../types';
import { decodeCardId } from '../cards';
import { parseHiLoState as parseHiLoStateBlob } from '@nullspace/game-state';

export interface HiLoStateUpdate {
  currentCard: Card | null;
  accumulator: number | null;
}

export function parseHiLoState(stateBlob: Uint8Array): HiLoStateUpdate | null {
  const parsed = parseHiLoStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }
  const card = decodeCardId(parsed.cardId);
  const accumulator = Number(parsed.accumulatorBasisPoints);
  return {
    currentCard: card,
    accumulator: Number.isFinite(accumulator) ? accumulator : null,
  };
}
