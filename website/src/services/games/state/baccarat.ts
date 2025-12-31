import type { Card, GameState } from '../../../types';
import { GameType } from '../../../types';
import { decodeCard } from '../shared/cards';
import { parseBaccaratState as parseBaccaratStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type BaccaratStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  fallbackState: GameState;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
};

export const applyBaccaratState = ({
  stateBlob,
  gameType,
  fallbackState,
  setGameState,
  gameStateRef,
}: BaccaratStateArgs): void => {
  const parsed = parseBaccaratStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid baccarat state blob');
    return;
  }

  const pCards: Card[] = parsed.playerCards.map((cardId) => decodeCard(cardId));
  const bCards: Card[] = parsed.bankerCards.map((cardId) => decodeCard(cardId));

  if (pCards.length === 0 && bCards.length === 0) {
    setGameState((prev) => ({
      ...prev,
      type: gameType,
      playerCards: [],
      dealerCards: [],
      stage: 'PLAYING',
      message: 'PLACE BETS & DEAL',
    }));
    return;
  }

  const prevState = gameStateRef.current ?? fallbackState;
  const newState: GameState = {
    ...prevState,
    type: gameType,
    playerCards: pCards,
    dealerCards: bCards,
    baccaratPlayerTotal: null,
    baccaratBankerTotal: null,
    stage: 'RESULT',
    message: 'BACCARAT DEALT',
  };
  gameStateRef.current = newState;
  setGameState(newState);
};
