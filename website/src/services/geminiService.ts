import { GameType, Card } from '../types';

// Stub: AI advice is disabled - on-chain randomness is used instead
export const getStrategicAdvice = async (
  _gameType: GameType,
  _playerCards: Card[],
  _dealerUpCard: Card | null,
  _history: string[]
): Promise<string> => {
  return "AI Strategy Offline (Using On-Chain Randomness)";
};
