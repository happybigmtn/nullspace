import type { Card, CompletedHand, GameState } from '../../../types';
import { GameType } from '../../../types';
import { decodeCard } from '../shared/cards';
import { parseBlackjackState as parseBlackjackStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type BlackjackStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  fallbackState: GameState;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
};

export const applyBlackjackState = ({
  stateBlob,
  gameType,
  fallbackState,
  setGameState,
  gameStateRef,
}: BlackjackStateArgs): void => {
  const parsed = parseBlackjackStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid blackjack state blob');
    return;
  }

  const bjStage = parsed.stage;
  const sideBet21p3 = parsed.sideBet21Plus3;
  const [initP1, initP2] = parsed.initPlayerCards;
  const activeHandIdx = parsed.activeHandIndex;
  const handCount = parsed.hands.length;

  const prevState = gameStateRef.current ?? fallbackState;
  const baseBet = prevState?.bet || 100;
  let pCards: Card[] = [];
  const dCards: Card[] = [];
  const pendingStack: { cards: Card[]; bet: number; isDoubled: boolean }[] = [];
  const finishedHands: CompletedHand[] = [];
  let mainWagered = handCount === 0 ? baseBet : 0;

  const allHandsFinished = activeHandIdx >= handCount;

  for (let h = 0; h < handCount; h++) {
    const hand = parsed.hands[h];
    const betMult = hand.betMult;
    const status = hand.status; // 0=Play, 1=Stand, 2=Bust, 3=BJ

    const handCards: Card[] = hand.cards.map((cardId) => decodeCard(cardId));

    const isDoubled = betMult === 2;
    const handBet = baseBet * betMult;
    mainWagered += handBet;

    if (!allHandsFinished && h === activeHandIdx) {
      pCards = handCards;
    } else if (allHandsFinished && h === handCount - 1) {
      pCards = handCards;
    } else if (!allHandsFinished && h > activeHandIdx) {
      pendingStack.push({ cards: handCards, bet: handBet, isDoubled });
    } else {
      let msg = '';
      if (status === 2) msg = 'BUST';
      else if (status === 3) msg = 'BLACKJACK';
      else if (status === 1) msg = 'STAND';
      else if (status === 4) msg = 'SURRENDER';
      finishedHands.push({ cards: handCards, bet: handBet, isDoubled, message: msg });
    }
  }

  for (const cardId of parsed.dealerCards) {
    dCards.push(decodeCard(cardId));
  }

  let blackjackPlayerValue: number | null = null;
  let blackjackDealerValue: number | null = null;
  let blackjackActions = {
    canHit: false,
    canStand: false,
    canDouble: false,
    canSplit: false,
  };
  if (parsed.playerValue !== null && parsed.dealerValue !== null && parsed.actionMask !== null) {
    blackjackPlayerValue = parsed.playerValue;
    blackjackDealerValue = parsed.dealerValue;
    const actionMask = parsed.actionMask;
    blackjackActions = {
      canHit: (actionMask & 0x01) !== 0,
      canStand: (actionMask & 0x02) !== 0,
      canDouble: (actionMask & 0x04) !== 0,
      canSplit: (actionMask & 0x08) !== 0,
    };
  }

  const isComplete = bjStage === 3;
  const uiStage = bjStage === 0 ? 'BETTING' : isComplete ? 'RESULT' : 'PLAYING';

  let message = 'PLACE BETS & DEAL';
  if (bjStage === 1) message = 'Your move';
  else if (bjStage === 2) message = 'REVEAL (SPACE)';
  else if (bjStage === 3) message = 'GAME COMPLETE';

  const dealerCardsWithVisibility = dCards.map((card, i) => ({
    ...card,
    isHidden: !isComplete && i > 0,
  }));

  const totalWagered = mainWagered + sideBet21p3;
  const newState: GameState = {
    ...prevState,
    type: gameType,
    playerCards:
      bjStage === 0 || initP1 === 0xff || initP2 === 0xff
        ? []
        : pCards,
    dealerCards: bjStage === 0 ? [] : dealerCardsWithVisibility,
    blackjackStack: pendingStack,
    completedHands: finishedHands,
    blackjack21Plus3Bet: sideBet21p3,
    blackjackPlayerValue,
    blackjackDealerValue,
    blackjackActions,
    sessionWager: totalWagered,
    stage: uiStage,
    message,
  };
  gameStateRef.current = newState;
  setGameState(newState);
};
