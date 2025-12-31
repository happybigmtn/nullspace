import type { GameState } from '../../../types';
import { GameType } from '../../../types';
import { MAX_GRAPH_POINTS } from '../constants';
import { formatRouletteNumber } from '../../../utils/gameUtils';
import { parseRouletteState as parseRouletteStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type RouletteStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
};

export const applyRouletteState = ({
  stateBlob,
  gameType,
  setGameState,
  gameStateRef,
}: RouletteStateArgs): void => {
  const parsed = parseRouletteStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid roulette state blob');
    return;
  }

  const zeroRuleByte = parsed.zeroRule;
  const phaseByte = parsed.phase;

  const zeroRule =
    zeroRuleByte === 1
      ? 'LA_PARTAGE'
      : zeroRuleByte === 2
        ? 'EN_PRISON'
        : zeroRuleByte === 3
          ? 'EN_PRISON_DOUBLE'
          : zeroRuleByte === 4
            ? 'AMERICAN'
            : 'STANDARD';
  const rouletteIsPrison = phaseByte === 1;

  if (parsed.result !== null) {
    const result = parsed.result;

    if (gameStateRef.current) {
      gameStateRef.current = {
        ...gameStateRef.current,
        rouletteHistory: [...(gameStateRef.current.rouletteHistory || []), result].slice(-MAX_GRAPH_POINTS),
      };
    }

    setGameState((prev) => ({
      ...prev,
      type: gameType,
      rouletteZeroRule: zeroRule,
      rouletteIsPrison,
      rouletteHistory: [...prev.rouletteHistory, result].slice(-MAX_GRAPH_POINTS),
      stage: rouletteIsPrison && result === 0 ? 'PLAYING' : 'RESULT',
      message: rouletteIsPrison && result === 0
        ? 'EN PRISON - SPACE TO SPIN'
        : `LANDED ON ${formatRouletteNumber(result)}`,
    }));
  } else {
    setGameState((prev) => ({
      ...prev,
      type: gameType,
      rouletteZeroRule: zeroRule,
      rouletteIsPrison,
      stage: 'PLAYING',
      message: rouletteIsPrison ? 'EN PRISON - SPACE TO SPIN' : 'PLACE YOUR BETS',
    }));
  }
};
