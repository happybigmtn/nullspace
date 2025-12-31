import type { Card, GameState } from '../../../types';
import { GameType } from '../../../types';
import { decodeCard } from '../shared/cards';
import { parseVideoPokerState as parseVideoPokerStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type VideoPokerStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
};

export const applyVideoPokerState = ({
  stateBlob,
  gameType,
  setGameState,
  gameStateRef,
}: VideoPokerStateArgs): void => {
  const parsed = parseVideoPokerStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid Video Poker state blob');
    return;
  }
  const stage = parsed.stage;
  const cards: Card[] = parsed.cards.map((cardId) => decodeCard(cardId));

  if (gameStateRef.current) {
    gameStateRef.current = {
      ...gameStateRef.current,
      playerCards: cards,
    };
  }

  setGameState((prev) => {
    const cardsWithHolds =
      stage === 0
        ? cards.map((c, i) => ({
            ...c,
            isHeld: prev.playerCards?.[i]?.isHeld,
          }))
        : cards;
    const newState: GameState = {
      ...prev,
      type: gameType,
      playerCards: cardsWithHolds,
      videoPokerHand: stage === 1 ? prev.videoPokerHand : null,
      videoPokerMultiplier: stage === 1 ? prev.videoPokerMultiplier : null,
      stage: stage === 1 ? 'RESULT' : 'PLAYING',
      message: stage === 0 ? 'HOLD (1-5), DRAW (D)' : 'GAME COMPLETE',
    };
    gameStateRef.current = newState;
    return newState;
  });
};
