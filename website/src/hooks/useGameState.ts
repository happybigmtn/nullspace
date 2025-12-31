import { useState, useCallback } from 'react';
import { GameState, GameType, PlayerStats } from '../types';

const INITIAL_CHIPS = 1000;
const INITIAL_SHIELDS = 3;
const INITIAL_DOUBLES = 3;

export const INITIAL_GAME_STATE: GameState = {
    type: GameType.NONE,
    message: "TYPE '/' FOR FUN",
    bet: 50,
    stage: 'BETTING',
    playerCards: [],
    dealerCards: [],
    communityCards: [],
    dice: [],
    crapsPoint: null,
    crapsEpochPointEstablished: false,
    crapsMadePointsMask: 0,
    crapsBets: [],
    crapsUndoStack: [],
    crapsInputMode: 'NONE',
    crapsRollHistory: [],
    crapsEventLog: [],
    crapsLastRoundBets: [],
    crapsOddsCandidates: null,
    rouletteBets: [],
    rouletteUndoStack: [],
    rouletteLastRoundBets: [],
    rouletteHistory: [],
    rouletteInputMode: 'NONE',
    rouletteZeroRule: 'STANDARD',
    rouletteIsPrison: false,
    sicBoBets: [],
    sicBoHistory: [],
    sicBoInputMode: 'NONE',
    sicBoUndoStack: [],
    sicBoLastRoundBets: [],
    resolvedBets: [],
    resolvedBetsKey: 0,
    baccaratBets: [],
    baccaratUndoStack: [],
    baccaratLastRoundBets: [],
    baccaratPlayerTotal: null,
    baccaratBankerTotal: null,
    lastResult: 0,
    activeModifiers: { shield: false, double: false, super: false },
    baccaratSelection: 'PLAYER',
    insuranceBet: 0,
    blackjackStack: [],
    completedHands: [],
    blackjack21Plus3Bet: 0,
    blackjackPlayerValue: null,
    blackjackDealerValue: null,
    blackjackActions: {
        canHit: false,
        canStand: false,
        canDouble: false,
        canSplit: false,
    },
    threeCardPairPlusBet: 0,
    threeCardSixCardBonusBet: 0,
    threeCardProgressiveBet: 0,
    threeCardProgressiveJackpot: 10000,
    threeCardPlayerRank: null,
    threeCardDealerRank: null,
    threeCardDealerQualifies: null,
    uthTripsBet: 0,
    uthSixCardBonusBet: 0,
    uthProgressiveBet: 0,
    uthProgressiveJackpot: 10000,
    uthBonusCards: [],
    videoPokerHand: null,
    videoPokerMultiplier: null,
    casinoWarTieBet: 0,
    casinoWarOutcome: null,
    hiloAccumulator: 0,
    hiloGraphData: [],
    hiloRules: null,
    hiloNextMultipliers: null,
    sessionId: null,
    moveNumber: 0,
    sessionWager: 0,
    sessionInterimPayout: 0,
    superMode: null
};

export const useGameState = () => {
  const [stats, setStats] = useState<PlayerStats>({
    chips: INITIAL_CHIPS,
    shields: INITIAL_SHIELDS,
    doubles: INITIAL_DOUBLES,
    auraMeter: 0,
    rank: 1,
    history: [],
    pnlByGame: {},
    pnlHistory: []
  });

  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);

  const resetGameState = useCallback(() => {
    setGameState(INITIAL_GAME_STATE);
  }, []);

  return {
    stats,
    setStats,
    gameState,
    setGameState,
    resetGameState,
    initialChips: INITIAL_CHIPS,
    initialShields: INITIAL_SHIELDS,
    initialDoubles: INITIAL_DOUBLES
  };
};
