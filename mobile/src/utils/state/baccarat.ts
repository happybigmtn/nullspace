import type { Card } from '../../types';
import { decodeCardId } from '../cards';
import { parseBaccaratState as parseBaccaratStateBlob } from '@nullspace/game-state';

export interface BaccaratStateUpdate {
  playerCards: Card[];
  bankerCards: Card[];
  playerTotal: number;
  bankerTotal: number;
}

const cardValue = (card: Card): number => {
  if (card.rank === 'A') return 1;
  if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J' || card.rank === '10') return 0;
  return Number(card.rank);
};

const totalValue = (cards: Card[]): number =>
  cards.reduce((sum, card) => sum + cardValue(card), 0) % 10;

export function parseBaccaratState(stateBlob: Uint8Array): BaccaratStateUpdate | null {
  const parsed = parseBaccaratStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }

  const playerCards = parsed.playerCards
    .map(decodeCardId)
    .filter((card): card is Card => !!card);
  const bankerCards = parsed.bankerCards
    .map(decodeCardId)
    .filter((card): card is Card => !!card);

  if (playerCards.length === 0 && bankerCards.length === 0) {
    return null;
  }

  return {
    playerCards,
    bankerCards,
    playerTotal: totalValue(playerCards),
    bankerTotal: totalValue(bankerCards),
  };
}
