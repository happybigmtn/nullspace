import type { Card } from '../../types';
import { decodeCardId, isHiddenCard } from '../cards';
import { parseUltimateHoldemState as parseUltimateHoldemStateBlob } from '@nullspace/game-state';

export interface UltimateHoldemStateUpdate {
  playerCards: Card[];
  communityCards: Card[];
  dealerCards: Card[];
  stage: 'betting' | 'preflop' | 'flop' | 'river' | 'showdown' | 'result';
  tripsBet: number;
  sixCardBonusBet: number;
  progressiveBet: number;
}

export function parseUltimateHoldemState(stateBlob: Uint8Array): UltimateHoldemStateUpdate | null {
  const parsed = parseUltimateHoldemStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }

  const stageByte = parsed.stage;
  const stage: UltimateHoldemStateUpdate['stage'] =
    stageByte === 1
      ? 'preflop'
      : stageByte === 2
        ? 'flop'
        : stageByte === 3
          ? 'river'
          : stageByte === 4
            ? 'showdown'
            : stageByte === 5
              ? 'result'
              : 'betting';

  const playerCards: Card[] = [];
  for (const cardId of parsed.playerCards) {
    if (!isHiddenCard(cardId)) {
      const card = decodeCardId(cardId);
      if (card) playerCards.push(card);
    }
  }

  const communityCards: Card[] = [];
  for (const cardId of parsed.communityCards) {
    if (!isHiddenCard(cardId)) {
      const card = decodeCardId(cardId);
      if (card) communityCards.push(card);
    }
  }

  const dealerCards: Card[] = [];
  for (const cardId of parsed.dealerCards) {
    if (!isHiddenCard(cardId)) {
      const card = decodeCardId(cardId);
      if (card) dealerCards.push(card);
    }
  }

  return {
    playerCards,
    communityCards,
    dealerCards,
    stage,
    tripsBet: Number.isFinite(parsed.tripsBet) ? parsed.tripsBet : 0,
    sixCardBonusBet: Number.isFinite(parsed.sixCardBonusBet) ? parsed.sixCardBonusBet : 0,
    progressiveBet: Number.isFinite(parsed.progressiveBet) ? parsed.progressiveBet : 0,
  };
}
