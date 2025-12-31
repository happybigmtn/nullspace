import type { Card, GameState } from '../../../types';
import { GameType } from '../../../types';
import { decodeCard } from '../shared/cards';
import { parseUltimateHoldemState as parseUltimateHoldemStateBlob } from '@nullspace/game-state';
import type { Ref } from '../refs';
import type { GameStateRef, SetGameState } from './types';

type UltimateHoldemStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
  uthBackendStageRef: Ref<number>;
};

export const applyUltimateHoldemState = ({
  stateBlob,
  gameType,
  setGameState,
  gameStateRef,
  uthBackendStageRef,
}: UltimateHoldemStateArgs): void => {
  const parsed = parseUltimateHoldemStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid Ultimate Holdem state blob');
    return;
  }

  const stageVal = parsed.stage;
  const version = parsed.version ?? 1;
  uthBackendStageRef.current = stageVal;
  const pBytes = parsed.playerCards;
  const cBytes = parsed.communityCards;
  const dBytes = parsed.dealerCards;
  const playMult = parsed.playMultiplier;
  const bonusBytes = parsed.bonusCards.length > 0
    ? parsed.bonusCards
    : [0xff, 0xff, 0xff, 0xff];
  const tripsBet = parsed.tripsBet;
  const sixCardBonusBet = parsed.sixCardBonusBet;
  const progressiveBet = parsed.progressiveBet;

  const pCards: Card[] = pBytes[0] === 0xff ? [] : pBytes.map(decodeCard);

  const community: Card[] = [];
  for (const b of cBytes) {
    if (b !== 0xff) community.push(decodeCard(b));
  }

  const dealerVisible = stageVal === 5;
  const dCards: Card[] =
    stageVal === 0 || pCards.length === 0
      ? []
      : dBytes.map((b) => ({
          ...decodeCard(b),
          isHidden: !dealerVisible,
        }));

  const bonusVisible = stageVal === 5;
  const bonusCards: Card[] =
    version >= 2 && (sixCardBonusBet > 0 || bonusBytes.some((b) => b !== 0xff))
      ? bonusBytes.map((b) => ({
          ...decodeCard(b),
          isHidden: !bonusVisible,
        }))
      : [];

  const uiStage = stageVal === 0 ? 'BETTING' : stageVal === 5 ? 'RESULT' : 'PLAYING';

  let message = 'PLACE BETS & DEAL';
  if (stageVal === 0) message = 'TRIPS (T), 6-CARD (6), PROG (J), DEAL';
  else if (stageVal === 1) message = 'CHECK (C) OR BET 3X/4X';
  else if (stageVal === 2) message = 'CHECK (C) OR BET 2X';
  else if (stageVal === 3) message = playMult > 0 ? 'REVEAL (SPACE)' : 'FOLD (F) OR BET 1X';
  else if (stageVal === 4) message = 'REVEAL (SPACE)';
  else if (stageVal === 5) message = 'GAME COMPLETE';

  setGameState((prev) => {
    const newState: GameState = {
      ...prev,
      type: gameType,
      playerCards: pCards,
      dealerCards: dCards,
      communityCards: community,
      uthTripsBet: tripsBet,
      uthSixCardBonusBet: sixCardBonusBet,
      uthProgressiveBet: progressiveBet,
      uthBonusCards: bonusCards,
      stage: uiStage,
      message,
    };
    gameStateRef.current = newState;
    return newState;
  });
};
