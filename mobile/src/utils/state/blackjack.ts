import type { Card } from '../../types';
import { decodeCardList } from '../cards';
import { parseBlackjackState as parseBlackjackStateBlob } from '@nullspace/game-state';

export type BlackjackPhase = 'betting' | 'player_turn' | 'dealer_turn' | 'result';

export interface BlackjackStateUpdate {
  playerCards: Card[];
  dealerCards: Card[];
  playerTotal: number;
  dealerTotal: number;
  phase: BlackjackPhase;
  canDouble: boolean;
  canSplit: boolean;
  dealerHidden: boolean;
}

function calculateBlackjackTotal(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      total += 11;
      aces += 1;
    } else if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function parseBlackjackState(stateBlob: Uint8Array): BlackjackStateUpdate | null {
  const parsed = parseBlackjackStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }

  const hands: Card[][] = [];
  for (const hand of parsed.hands) {
    const cards = decodeCardList(hand.cards);
    if (hand.betMult > 0 || cards.length > 0) {
      hands.push(cards);
    }
  }

  const dealerCards = decodeCardList(parsed.dealerCards);
  const activeIndex = parsed.activeHandIndex < hands.length
    ? parsed.activeHandIndex
    : Math.max(hands.length - 1, 0);
  const playerCards = hands[activeIndex] ?? [];

  const derivedPlayerTotal = playerCards.length > 0 ? calculateBlackjackTotal(playerCards) : 0;
  const derivedDealerTotal = dealerCards.length > 0 ? calculateBlackjackTotal(dealerCards) : 0;

  const phaseMap: Record<number, BlackjackPhase> = {
    0: 'betting',
    1: 'player_turn',
    2: 'dealer_turn',
  };
  const phase: BlackjackPhase = phaseMap[parsed.stage] ?? 'result';
  const actionMask = parsed.actionMask ?? 0;

  return {
    playerCards,
    dealerCards,
    playerTotal: parsed.playerValue ?? derivedPlayerTotal,
    dealerTotal: parsed.dealerValue ?? derivedDealerTotal,
    phase,
    canDouble: (actionMask & 0x04) !== 0,
    canSplit: (actionMask & 0x08) !== 0,
    dealerHidden: phase !== 'result',
  };
}
