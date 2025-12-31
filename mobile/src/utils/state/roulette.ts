import { parseRouletteState as parseRouletteStateBlob } from '@nullspace/game-state';

export interface RouletteStateUpdate {
  result: number | null;
  isPrison: boolean;
}

export function parseRouletteState(stateBlob: Uint8Array): RouletteStateUpdate | null {
  const parsed = parseRouletteStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }
  return {
    result: parsed.result,
    isPrison: parsed.phase === 1,
  };
}
