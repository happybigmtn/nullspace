import type { GameState } from '../../../types';
import { GameType } from '../../../types';
import { decodeCard } from '../shared/cards';
import { parseCasinoWarState as parseCasinoWarStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type CasinoWarStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
};

export const applyCasinoWarState = ({
  stateBlob,
  gameType,
  setGameState,
  gameStateRef,
}: CasinoWarStateArgs): void => {
  const parsed = parseCasinoWarStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid Casino War state blob');
    return;
  }

  if (parsed.version === 1) {
    const stage = parsed.stage;
    const tieBet = Number(parsed.tieBet);
    const playerCard = stage === 0 ? null : decodeCard(parsed.playerCard);
    const dealerCard = stage === 0 ? null : decodeCard(parsed.dealerCard);

    setGameState((prev) => {
      const shouldRecordTieCredit =
        stage === 1 && tieBet > 0 && (prev.sessionInterimPayout || 0) === 0;
      const tieCredit = shouldRecordTieCredit ? tieBet * 11 : (prev.sessionInterimPayout || 0);

      const newState: GameState = {
        ...prev,
        type: gameType,
        playerCards: playerCard ? [playerCard] : [],
        dealerCards: dealerCard ? [dealerCard] : [],
        casinoWarTieBet: tieBet,
        casinoWarOutcome: null,
        sessionInterimPayout: stage === 0 ? 0 : tieCredit,
        stage: stage === 0 ? 'BETTING' : 'PLAYING',
        message:
          stage === 0
            ? 'PLACE BETS & DEAL'
            : stage === 1
              ? 'WAR! GO TO WAR (W) / SURRENDER (S)'
              : 'DEALT',
      };
      gameStateRef.current = newState;
      return newState;
    });
    return;
  }

  const playerCard = decodeCard(parsed.playerCard);
  const dealerCard = decodeCard(parsed.dealerCard);
  const stage = parsed.stage;

  setGameState((prev) => {
    const newState: GameState = {
      ...prev,
      type: gameType,
      playerCards: [playerCard],
      dealerCards: [dealerCard],
      casinoWarOutcome: null,
      stage: 'PLAYING',
      message: stage === 1 ? 'WAR! GO TO WAR (W) / SURRENDER (S)' : 'DEALT',
    };
    gameStateRef.current = newState;
    return newState;
  });
};
