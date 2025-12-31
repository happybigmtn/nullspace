import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, SicBoBet, PlayerStats, GameType, AutoPlayDraft } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';
import { serializeSicBoAtomicBatch } from '../../services/games';

interface UseSicBoProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  setLastTxSig: (sig: string | null) => void;
  isOnChain: boolean;
  startGame: (type: GameType) => void;
  autoPlayDraftRef: MutableRefObject<AutoPlayDraft | null>;
}

export const useSicBo = ({
  gameState,
  setGameState,
  stats,
  setStats,
  chainService,
  currentSessionIdRef,
  isPendingRef,
  pendingMoveCountRef,
  setLastTxSig,
  isOnChain,
  startGame,
  autoPlayDraftRef
}: UseSicBoProps) => {

  const placeSicBoBet = useCallback((type: SicBoBet['type'], target?: number, stateOverride?: GameState, statsOverride?: PlayerStats) => {
    const state = stateOverride ?? gameState;
    const player = statsOverride ?? stats;
    const existing = state.sicBoBets.some(b => b.type === type && b.target === target);
    if (existing) {
      const newBets = state.sicBoBets.filter(b => !(b.type === type && b.target === target));
      const removedAmount = state.sicBoBets.reduce((sum, b) => (b.type === type && b.target === target) ? sum + b.amount : sum, 0);
      setGameState(prev => ({
        ...prev,
        sicBoBets: newBets,
        sessionWager: Math.max(0, prev.sessionWager - removedAmount),
        message: `REMOVED ${type}`,
        sicBoInputMode: 'NONE'
      }));
      return;
    }

    if (player.chips < state.bet) return;
    setGameState(prev => ({
      ...prev,
      sicBoUndoStack: [...prev.sicBoUndoStack, prev.sicBoBets],
      sicBoBets: [...prev.sicBoBets, { type, amount: prev.bet, target }],
      message: `BET ${type}`,
      sicBoInputMode: 'NONE',
      sessionWager: prev.sessionWager + prev.bet
    }));
  }, [gameState.sicBoBets, gameState.bet, stats.chips, setGameState]);

  const undoSicBoBet = useCallback(() => {
    if (gameState.sicBoUndoStack.length === 0) return;
    setGameState(prev => ({
      ...prev,
      sicBoBets: prev.sicBoUndoStack[prev.sicBoUndoStack.length - 1],
      sicBoUndoStack: prev.sicBoUndoStack.slice(0, -1)
    }));
  }, [gameState.sicBoUndoStack.length, setGameState]);

  const rebetSicBo = useCallback(() => {
    const totalRequired = gameState.sicBoLastRoundBets.reduce((a, b) => a + b.amount, 0);
    if (gameState.sicBoLastRoundBets.length === 0 || stats.chips < totalRequired) return;
    setGameState(prev => ({
      ...prev,
      sicBoUndoStack: [...prev.sicBoUndoStack, prev.sicBoBets],
      sicBoBets: [...prev.sicBoBets, ...prev.sicBoLastRoundBets],
      sessionWager: prev.sessionWager + totalRequired,
      message: "REBET"
    }));
  }, [gameState.sicBoLastRoundBets, gameState.sicBoBets, stats.chips, setGameState]);

  const rollSicBo = useCallback(async (stateOverride?: GameState) => {
    const state = stateOverride ?? gameState;
    const shouldRebet = state.sicBoBets.length === 0 && state.sicBoLastRoundBets.length > 0;
    const betsToRoll = shouldRebet ? state.sicBoLastRoundBets : state.sicBoBets;

    if (betsToRoll.length === 0) {
      setGameState(prev => ({ ...prev, message: "PLACE BET" }));
      return;
    }

    // SPACE should rebet by default if we have a previous roll to reuse.
    if (shouldRebet) {
      const totalRequired = state.sicBoLastRoundBets.reduce((a, b) => a + b.amount, 0);
      if (stats.chips < totalRequired) {
        setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
        return;
      }
      setGameState(prev => ({
        ...prev,
        sicBoUndoStack: [...prev.sicBoUndoStack, prev.sicBoBets],
        sicBoBets: [...state.sicBoLastRoundBets],
        sessionWager: prev.sessionWager + totalRequired,
        message: 'REBET',
      }));
    }

    // Prevent double-submits
    if (isPendingRef.current) {
      return;
    }

    if (isOnChain && chainService && !currentSessionIdRef.current) {
      autoPlayDraftRef.current = { type: GameType.SIC_BO, sicBoBets: betsToRoll };
      setGameState(prev => ({ ...prev, message: 'STARTING NEW SESSION...' }));
      startGame(GameType.SIC_BO);
      return;
    }

    // If on-chain mode, use atomic batch (all bets + roll in one transaction)
    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        pendingMoveCountRef.current = 1;
        setGameState(prev => ({ ...prev, message: 'ROLLING...' }));

        // Use atomic batch: all bets + roll in single transaction
        const atomicPayload = serializeSicBoAtomicBatch(betsToRoll);
        const result = await chainService.sendMove(currentSessionIdRef.current!, atomicPayload);
        if (result.txHash) setLastTxSig(result.txHash);

        // Update UI
        setGameState(prev => ({
          ...prev,
          sicBoLastRoundBets: betsToRoll,
          sicBoBets: [],
          sicBoUndoStack: []
        }));

        return;
      } catch (error) {
        console.error('[useSicBo] Sic Bo roll failed:', error);
        isPendingRef.current = false;
        pendingMoveCountRef.current = 0;
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        return;
      }
    }

    if (!isOnChain) {
      setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
    }
  }, [
    gameState.sicBoBets, gameState.sicBoLastRoundBets, stats.chips,
    isOnChain, chainService, currentSessionIdRef, isPendingRef, pendingMoveCountRef,
    setLastTxSig, startGame, autoPlayDraftRef, setGameState
  ]);

  return {
    placeSicBoBet,
    undoSicBoBet,
    rebetSicBo,
    rollSicBo
  };
};
