import type { Card } from '../../types';
import { decodeCardId, isHiddenCard } from '../cards';
import { parseThreeCardState as parseThreeCardStateBlob } from '@nullspace/game-state';

export interface ThreeCardStateUpdate {
  playerCards: Card[];
  dealerCards: Card[];
  stage: 'betting' | 'decision' | 'awaiting' | 'complete';
  pairPlusBet: number;
  sixCardBonusBet: number;
  progressiveBet: number;
}

export function parseThreeCardState(stateBlob: Uint8Array): ThreeCardStateUpdate | null {
  const parsed = parseThreeCardStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }
  const stageMap: Record<number, ThreeCardStateUpdate['stage']> = {
    1: 'decision',
    2: 'awaiting',
    3: 'complete',
  };
  const stage = stageMap[parsed.stage] ?? 'betting';

  const playerCards: Card[] = [];
  for (const cardId of parsed.playerCards) {
    if (!isHiddenCard(cardId)) {
      const card = decodeCardId(cardId);
      if (card) playerCards.push(card);
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
    dealerCards,
    stage,
    pairPlusBet: Number.isFinite(parsed.pairPlusBet) ? parsed.pairPlusBet : 0,
    sixCardBonusBet: Number.isFinite(parsed.sixCardBonusBet) ? parsed.sixCardBonusBet : 0,
    progressiveBet: Number.isFinite(parsed.progressiveBet) ? parsed.progressiveBet : 0,
  };
}
