import type { Card, GameState } from '../../../types';
import { GameType } from '../../../types';
import { decodeCard } from '../shared/cards';
import { parseThreeCardState as parseThreeCardStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type ThreeCardStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
};

export const applyThreeCardState = ({
  stateBlob,
  gameType,
  setGameState,
  gameStateRef,
}: ThreeCardStateArgs): void => {
  const parsed = parseThreeCardStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid Three Card state blob');
    return;
  }

  const stageVal = parsed.stage;
  const pairplusBet = parsed.pairPlusBet;
  const sixCardBonusBet = parsed.sixCardBonusBet;
  const progressiveBet = parsed.progressiveBet;

  const pBytes = parsed.playerCards;
  const dBytes = parsed.dealerCards;

  const pCards: Card[] = stageVal === 0 ? [] : pBytes.map(decodeCard);
  const dCards: Card[] =
    stageVal === 0
      ? []
      : dBytes.map((b) => ({
          ...decodeCard(b),
          isHidden: stageVal !== 3,
        }));

  const uiStage = stageVal === 0 ? 'BETTING' : stageVal === 3 ? 'RESULT' : 'PLAYING';

  let message = 'PLACE BETS & DEAL';
  if (stageVal === 0) message = 'PAIRPLUS (P), 6-CARD (6), PROG (J), DEAL';
  else if (stageVal === 1) message = 'PLAY (P) OR FOLD (F)';
  else if (stageVal === 2) message = 'REVEAL (SPACE)';
  else if (stageVal === 3) message = 'GAME COMPLETE';

  setGameState((prev) => {
    const newState: GameState = {
      ...prev,
      type: gameType,
      playerCards: pCards,
      dealerCards: dCards,
      threeCardPairPlusBet: pairplusBet,
      threeCardSixCardBonusBet: sixCardBonusBet,
      threeCardProgressiveBet: progressiveBet,
      threeCardPlayerRank: null,
      threeCardDealerRank: null,
      threeCardDealerQualifies: null,
      stage: uiStage,
      message,
    };
    gameStateRef.current = newState;
    return newState;
  });
};
