import type { GameState } from '../../../types';
import { GameType } from '../../../types';
import { MAX_GRAPH_POINTS } from '../constants';
import { decodeCard } from '../shared/cards';
import { parseHiLoState as parseHiLoStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type HiLoStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  fallbackState: GameState;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
};

export const applyHiLoState = ({
  stateBlob,
  gameType,
  fallbackState,
  setGameState,
  gameStateRef,
}: HiLoStateArgs): void => {
  const parsed = parseHiLoStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid HiLo state blob');
    return;
  }
  const currentCard = decodeCard(parsed.cardId);
  const accumulatorBasisPoints = Number(parsed.accumulatorBasisPoints);
  const rulesByte = parsed.rulesByte;
  const hiloRules = {
    allowSameAny: (rulesByte & 0x01) !== 0,
    tiePush: (rulesByte & 0x02) !== 0,
  };
  const hiloNextMultipliers = parsed.nextMultipliers;

  setGameState((prev) => {
    const actualPot = Math.floor(prev.bet * accumulatorBasisPoints / 10000);
    const prevCards = prev.playerCards || [];
    const lastCard = prevCards.length > 0 ? prevCards[prevCards.length - 1] : null;
    const nextCards = (lastCard && lastCard.rank === currentCard.rank && lastCard.suit === currentCard.suit)
      ? prevCards
      : [...prevCards, currentCard];

    const newState: GameState = {
      ...prev,
      type: gameType,
      playerCards: nextCards,
      hiloAccumulator: actualPot,
      hiloGraphData: [...(prev.hiloGraphData || []), actualPot].slice(-MAX_GRAPH_POINTS),
      hiloRules,
      hiloNextMultipliers,
      stage: 'PLAYING',
      message: 'YOUR MOVE',
    };
    gameStateRef.current = newState;
    return newState;
  });
};
