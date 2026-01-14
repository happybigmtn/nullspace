import type { Card } from '../../types';
import { decodeCardId, isHiddenCard } from '../cards';
import { parseCasinoWarState as parseCasinoWarStateBlob } from '@nullspace/game-state';

export interface CasinoWarStateUpdate {
  playerCard: Card | null;
  dealerCard: Card | null;
  stage: 'betting' | 'war' | 'complete';
  tieBet: number;
}

export function parseCasinoWarState(stateBlob: Uint8Array): CasinoWarStateUpdate | null {
  const parsed = parseCasinoWarStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }

  const playerCard = isHiddenCard(parsed.playerCard) ? null : decodeCardId(parsed.playerCard);
  const dealerCard = isHiddenCard(parsed.dealerCard) ? null : decodeCardId(parsed.dealerCard);
  const stageMap: Record<number, CasinoWarStateUpdate['stage']> = {
    1: 'war',
    2: 'complete',
  };
  const stage = stageMap[parsed.stage] ?? 'betting';

  const tieBetValue = typeof parsed.tieBet === 'bigint' ? Number(parsed.tieBet) : parsed.tieBet;
  const tieBet = Number.isFinite(tieBetValue) ? tieBetValue : 0;

  return {
    playerCard: playerCard ?? null,
    dealerCard: dealerCard ?? null,
    stage,
    tieBet,
  };
}
