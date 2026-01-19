import { GameType } from '../../types';

export const getChainReadyMessage = (gameType: GameType): string => {
  switch (gameType) {
    case GameType.CRAPS:
    case GameType.SIC_BO:
      return 'PLACE BETS & ROLL';
    case GameType.ROULETTE:
      return 'PLACE BETS & SPIN';
    case GameType.BACCARAT:
    case GameType.BLACKJACK:
    case GameType.CASINO_WAR:
    case GameType.THREE_CARD:
    case GameType.ULTIMATE_HOLDEM:
      return 'PLACE BETS & DEAL';
    default:
      return 'GAME STARTED';
  }
};
