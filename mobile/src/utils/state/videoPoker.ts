import type { Card } from '../../types';
import { decodeCardId } from '../cards';
import { parseVideoPokerState as parseVideoPokerStateBlob } from '@nullspace/game-state';

export interface VideoPokerStateUpdate {
  cards: Card[];
  stage: 'deal' | 'draw';
}

export function parseVideoPokerState(stateBlob: Uint8Array): VideoPokerStateUpdate | null {
  const parsed = parseVideoPokerStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }
  const stage = parsed.stage === 1 ? 'draw' : 'deal';
  const cards: Card[] = [];
  for (const cardId of parsed.cards) {
    const card = decodeCardId(cardId);
    if (card) {
      cards.push(card);
    }
  }
  return { cards, stage };
}
