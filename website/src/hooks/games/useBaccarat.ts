import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, BaccaratBet, PlayerStats, Card, GameType } from '../../types';
import { getBaccaratValue } from '../../utils/gameUtils';

const MAX_GRAPH_POINTS = 100;

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
  setStats,
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

  const baccaratDeal = useCallback((newDeck: Card[]) => {
      const p1 = newDeck.pop()!, b1 = newDeck.pop()!, p2 = newDeck.pop()!, b2 = newDeck.pop()!;
      const pVal = (getBaccaratValue([p1]) + getBaccaratValue([p2])) % 10;
      const bVal = (getBaccaratValue([b1]) + getBaccaratValue([b2])) % 10;
      let winner = pVal > bVal ? 'PLAYER' : bVal > pVal ? 'BANKER' : 'TIE';
      
      let totalWin = 0;
      const results: string[] = [];

      // Main bet resolution
      let mainWin = 0;
      if (winner === 'TIE') {
          results.push(`${gameState.baccaratSelection} PUSH`);
      } else if (winner === gameState.baccaratSelection) {
          mainWin = gameState.bet;
          totalWin += mainWin;
          results.push(`${gameState.baccaratSelection} WIN (+$${mainWin})`);
      } else {
          totalWin -= gameState.bet;
          results.push(`${gameState.baccaratSelection} LOSS (-$${gameState.bet})`);
      }
      
      // Side bets resolution
      const pSuitedPair = p1.suit === p2.suit && p1.rank === p2.rank;
      const bSuitedPair = b1.suit === b2.suit && b1.rank === b2.rank;
      const margin = Math.abs(pVal - bVal);
      const pNatural = pVal >= 8;
      const bNatural = bVal >= 8;

      gameState.baccaratBets.forEach(b => {
           let win = 0;
           let isPush = false;

           if (b.type === 'TIE' && winner === 'TIE') win = b.amount * 8;
           else if (b.type === 'P_PAIR' && p1.rank === p2.rank) win = b.amount * 11;
           else if (b.type === 'B_PAIR' && b1.rank === b2.rank) win = b.amount * 11;
           else if (b.type === 'LUCKY6' && winner === 'BANKER' && bVal === 6) {
              win = b.amount * 12; // Standard lucky 6 for 2 cards
              // Note: 3-card lucky 6 pays 23:1, but this simplified deal is always 2 cards
           }
           // Dragon Bonus (Player side)
           else if (b.type === 'P_DRAGON') {
               if (winner === 'PLAYER') {
                   if (pNatural) win = b.amount * 1; // Natural win: 1:1
                   else if (margin === 9) win = b.amount * 30;
                   else if (margin === 8) win = b.amount * 10;
                   else if (margin === 7) win = b.amount * 6;
                   else if (margin === 6) win = b.amount * 4;
                   else if (margin === 5) win = b.amount * 2;
                   else if (margin === 4) win = b.amount * 1;
               } else if (winner === 'TIE' && pNatural) {
                   isPush = true; // Natural tie is push
               }
           }
           // Dragon Bonus (Banker side)
           else if (b.type === 'B_DRAGON') {
               if (winner === 'BANKER') {
                   if (bNatural) win = b.amount * 1; // Natural win: 1:1
                   else if (margin === 9) win = b.amount * 30;
                   else if (margin === 8) win = b.amount * 10;
                   else if (margin === 7) win = b.amount * 6;
                   else if (margin === 6) win = b.amount * 4;
                   else if (margin === 5) win = b.amount * 2;
                   else if (margin === 4) win = b.amount * 1;
               } else if (winner === 'TIE' && bNatural) {
                   isPush = true; // Natural tie is push
               }
           }
           // Panda 8: Player wins with 3-card total of 8
           else if (b.type === 'PANDA8') {
               // Note: Simplified deal only has 2 cards, so this will rarely win in local sim
               // On-chain handles the full 3-card logic
               if (winner === 'PLAYER' && pVal === 8) {
                   // In simplified 2-card mode, treat as regular win (full rules need 3 cards)
                   win = b.amount * 25;
               }
           }
           // Perfect Pairs (same rank AND same suit)
           else if (b.type === 'P_PERFECT_PAIR' && pSuitedPair) win = b.amount * 25;
           else if (b.type === 'B_PERFECT_PAIR' && bSuitedPair) win = b.amount * 25;

           if (isPush) {
               results.push(`${b.type} PUSH`);
           } else if (win > 0) {
               totalWin += win;
               results.push(`${b.type} WIN (+$${win})`);
           } else {
               totalWin -= b.amount;
               results.push(`${b.type} LOSS (-$${b.amount})`);
           }
      });
      
      const scoreDisplay = winner === 'TIE' ? `${pVal}-${bVal}` : winner === 'PLAYER' ? `${pVal}-${bVal}` : `${bVal}-${pVal}`;
      const summary = `${winner} wins ${scoreDisplay}. ${totalWin >= 0 ? '+' : '-'}$${Math.abs(totalWin)}`;

      setStats(prev => ({
          ...prev,
          chips: prev.chips + totalWin,
          history: [...prev.history, summary, ...results],
          pnlByGame: { ...prev.pnlByGame, [GameType.BACCARAT]: (prev.pnlByGame[GameType.BACCARAT] || 0) + totalWin },
          pnlHistory: [...prev.pnlHistory, (prev.pnlHistory[prev.pnlHistory.length - 1] || 0) + totalWin].slice(-MAX_GRAPH_POINTS)
      }));
      
      setGameState(prev => ({ ...prev, stage: 'RESULT', playerCards: [p1, p2], dealerCards: [b1, b2], baccaratLastRoundBets: prev.baccaratBets, baccaratUndoStack: [] }));
      setGameState(prev => ({ ...prev, message: `${winner} WINS`, lastResult: totalWin }));
  }, [gameState.baccaratBets, gameState.baccaratSelection, gameState.bet, setStats, setGameState]);

  return {
    toggleSelection,
    placeBet,
    undo,
    rebet,
    baccaratDeal
  };
};
