import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, BaccaratBet, PlayerStats } from '../../types';

interface UseBaccaratProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  baccaratBetsRef: MutableRefObject<BaccaratBet[]>;
  baccaratSelectionRef: MutableRefObject<'PLAYER' | 'BANKER'>;
}

export const useBaccarat = ({
  gameState,
  setGameState,
  stats,
  baccaratBetsRef,
  baccaratSelectionRef
}: UseBaccaratProps) => {

  const toggleSelection = useCallback((sel: 'PLAYER'|'BANKER') => {
    baccaratSelectionRef.current = sel;
    setGameState(prev => ({ ...prev, baccaratSelection: sel }));
  }, [setGameState, baccaratSelectionRef]);

  const placeBet = useCallback((type: BaccaratBet['type']) => {
      // Toggle behavior: remove if exists, add if not
      const existingIndex = gameState.baccaratBets.findIndex(b => b.type === type);
      if (existingIndex >= 0) {
          // Remove the bet
          const amountToRemove = gameState.baccaratBets[existingIndex].amount;
          const newBets = gameState.baccaratBets.filter((_, i) => i !== existingIndex);
          baccaratBetsRef.current = newBets;
          setGameState(prev => ({
              ...prev,
              baccaratUndoStack: [...prev.baccaratUndoStack, prev.baccaratBets],
              baccaratBets: newBets,
              sessionWager: prev.sessionWager - amountToRemove // Decrease wager
          }));
      } else {
          // Add the bet
          if (stats.chips < gameState.bet) return;
          const newBets = [...gameState.baccaratBets, { type, amount: gameState.bet }];
          baccaratBetsRef.current = newBets;
          setGameState(prev => ({
              ...prev,
              baccaratUndoStack: [...prev.baccaratUndoStack, prev.baccaratBets],
              baccaratBets: newBets,
              sessionWager: prev.sessionWager + prev.bet // Increase wager
          }));
      }
  }, [gameState.baccaratBets, gameState.bet, stats.chips, setGameState, baccaratBetsRef]);

  const undo = useCallback(() => {
      if (gameState.baccaratUndoStack.length > 0) {
          const newBets = gameState.baccaratUndoStack[gameState.baccaratUndoStack.length-1];
          baccaratBetsRef.current = newBets;
          setGameState(prev => ({ ...prev, baccaratBets: newBets, baccaratUndoStack: prev.baccaratUndoStack.slice(0, -1) }));
      }
  }, [gameState.baccaratUndoStack, setGameState, baccaratBetsRef]);

  const rebet = useCallback(() => {
      if (gameState.baccaratLastRoundBets.length > 0) {
          const newBets = [...gameState.baccaratBets, ...gameState.baccaratLastRoundBets];
          baccaratBetsRef.current = newBets;
          setGameState(prev => ({ ...prev, baccaratBets: newBets }));
      }
  }, [gameState.baccaratLastRoundBets, gameState.baccaratBets, setGameState, baccaratBetsRef]);

  // Note: baccaratDeal resolution is handled entirely by the chain via CasinoGameCompleted event.
  // The deal action is sent via atomic batch from useTerminalGame, similar to roulette/sic bo.
  // This hook only manages UI state for bet placement.

  return {
    toggleSelection,
    placeBet,
    undo,
    rebet
  };
};
