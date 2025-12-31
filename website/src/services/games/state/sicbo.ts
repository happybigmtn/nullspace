import type { GameState } from '../../../types';
import { GameType } from '../../../types';
import { MAX_GRAPH_POINTS } from '../constants';
import { parseSicBoState as parseSicBoStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type SicBoStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
};

export const applySicBoState = ({
  stateBlob,
  gameType,
  setGameState,
  gameStateRef,
}: SicBoStateArgs): void => {
  const parsed = parseSicBoStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid SicBo state blob');
    return;
  }

  if (parsed.dice) {
    const dice = parsed.dice;
    const total = dice[0] + dice[1] + dice[2];

    if (gameStateRef.current) {
      gameStateRef.current = {
        ...gameStateRef.current,
        dice,
        sicBoHistory: [...(gameStateRef.current.sicBoHistory || []), dice].slice(-MAX_GRAPH_POINTS),
      };
    }

    setGameState((prev) => ({
      ...prev,
      type: gameType,
      dice,
      sicBoHistory: [...prev.sicBoHistory, dice].slice(-MAX_GRAPH_POINTS),
      stage: 'RESULT',
      message: `ROLLED ${total} (${dice.join('-')})`,
    }));
  } else {
    setGameState((prev) => ({
      ...prev,
      type: gameType,
      stage: 'PLAYING',
      message: 'PLACE YOUR BETS',
    }));
  }
};
