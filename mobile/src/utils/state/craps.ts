import { parseCrapsState as parseCrapsStateBlob } from '@nullspace/game-state';

export interface CrapsStateUpdate {
  dice: [number, number] | null;
  point: number | null;
  phase: 'comeout' | 'point';
}

export function parseCrapsState(stateBlob: Uint8Array): CrapsStateUpdate | null {
  const parsed = parseCrapsStateBlob(stateBlob);
  if (!parsed) {
    return null;
  }
  const [d1, d2] = parsed.dice;
  return {
    dice: d1 > 0 && d2 > 0 ? [d1, d2] : null,
    point: parsed.mainPoint > 0 ? parsed.mainPoint : null,
    phase: parsed.phase === 1 ? 'point' : 'comeout',
  };
}
