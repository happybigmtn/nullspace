import { parseSicBoState as parseSicBoStateBlob } from '@nullspace/game-state';

export interface SicBoStateUpdate {
  dice: [number, number, number] | null;
}

export function parseSicBoState(stateBlob: Uint8Array): SicBoStateUpdate | null {
  const parsed = parseSicBoStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }
  return {
    dice: parsed.dice,
  };
}
