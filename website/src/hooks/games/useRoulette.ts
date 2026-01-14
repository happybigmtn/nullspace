import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, RouletteBet, PlayerStats, GameType, AutoPlayDraft } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';
import { RouletteMove } from '@nullspace/constants';
import { serializeRouletteAtomicBatch } from '../../services/games';

interface UseRouletteProps {
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
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
}

export const useRoulette = ({
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
  autoPlayDraftRef,
  armChainResponseTimeout,
}: UseRouletteProps) => {

  const placeRouletteBet = useCallback((type: RouletteBet['type'], target?: number, stateOverride?: GameState, statsOverride?: PlayerStats): boolean => {
    const state = stateOverride ?? gameState;
    const player = statsOverride ?? stats;
    if (state.rouletteIsPrison) {
      setGameState(prev => ({ ...prev, message: 'EN PRISON - NO NEW BETS' }));
      return false;
    }

    const existing = state.rouletteBets.some(b => b.type === type && b.target === target);
    if (existing) {
      const newBets = state.rouletteBets.filter(b => !(b.type === type && b.target === target));
      const removedAmount = state.rouletteBets.reduce((sum, b) => (b.type === type && b.target === target) ? sum + b.amount : sum, 0);
      setGameState(prev => ({
        ...prev,
        rouletteBets: newBets,
        message: `REMOVED ${type}`,
        rouletteInputMode: 'NONE',
        sessionWager: Math.max(0, prev.sessionWager - removedAmount)
      }));
      return true;
    }

    if (player.chips < state.bet) {
      setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
      return false;
    }
    setGameState(prev => ({
      ...prev,
      rouletteUndoStack: [...prev.rouletteUndoStack, prev.rouletteBets],
      rouletteBets: [...prev.rouletteBets, { type, amount: prev.bet, target }],
      message: `BET ${type}`,
      rouletteInputMode: 'NONE',
      sessionWager: prev.sessionWager + prev.bet
    }));
    return true;
  }, [gameState.rouletteIsPrison, gameState.rouletteBets, gameState.bet, stats.chips, setGameState]);

  const cycleRouletteZeroRule = useCallback(async () => {
    if (gameState.type !== GameType.ROULETTE) return;

    const nextRule =
      gameState.rouletteZeroRule === 'STANDARD'
        ? 'LA_PARTAGE'
        : gameState.rouletteZeroRule === 'LA_PARTAGE'
          ? 'EN_PRISON'
          : gameState.rouletteZeroRule === 'EN_PRISON'
            ? 'EN_PRISON_DOUBLE'
            : gameState.rouletteZeroRule === 'EN_PRISON_DOUBLE'
              ? 'AMERICAN'
              : 'STANDARD';

    setGameState(prev => ({
      ...prev,
      rouletteZeroRule: nextRule,
      message: `ZERO RULE: ${nextRule.split('_').join(' ')}`,
    }));

    // If we already have an on-chain roulette session (before spinning), sync the rule immediately.
    if (isOnChain && chainService && currentSessionIdRef.current && !gameState.rouletteIsPrison) {
      if (isPendingRef.current) return;
      isPendingRef.current = true;
      try {
        const ruleByte =
          nextRule === 'LA_PARTAGE'
            ? 1
            : nextRule === 'EN_PRISON'
              ? 2
              : nextRule === 'EN_PRISON_DOUBLE'
                ? 3
                : nextRule === 'AMERICAN'
                  ? 4
                  : 0;
        const payload = new Uint8Array([RouletteMove.SetRules, ruleByte]);
        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('ROULETTE RULE', currentSessionIdRef.current);
      } catch (e) {
        console.error('[useRoulette] Rule update failed:', e);
        isPendingRef.current = false;
        setGameState(prev => ({ ...prev, message: 'RULE UPDATE FAILED' }));
      }
    }
  }, [gameState.type, gameState.rouletteZeroRule, gameState.rouletteIsPrison, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState, armChainResponseTimeout]);

  const undoRouletteBet = useCallback(() => {
    if (gameState.rouletteUndoStack.length === 0) return;
    setGameState(prev => ({
      ...prev,
      rouletteBets: prev.rouletteUndoStack[prev.rouletteUndoStack.length - 1],
      rouletteUndoStack: prev.rouletteUndoStack.slice(0, -1)
    }));
  }, [gameState.rouletteUndoStack.length, setGameState]);

  const rebetRoulette = useCallback(() => {
    const totalRequired = gameState.rouletteLastRoundBets.reduce((a, b) => a + b.amount, 0);
    if (gameState.rouletteLastRoundBets.length === 0 || stats.chips < totalRequired) return;
    setGameState(prev => ({
      ...prev,
      rouletteUndoStack: [...prev.rouletteUndoStack, prev.rouletteBets],
      rouletteBets: [...prev.rouletteBets, ...prev.rouletteLastRoundBets],
      sessionWager: prev.sessionWager + totalRequired,
      message: "REBET PLACED"
    }));
  }, [gameState.rouletteLastRoundBets, gameState.rouletteBets, stats.chips, setGameState]);

  const spinRoulette = useCallback(async (stateOverride?: GameState) => {
    const state = stateOverride ?? gameState;
    const shouldRebet = !state.rouletteIsPrison && state.rouletteBets.length === 0 && state.rouletteLastRoundBets.length > 0;
    const betsToSpin = shouldRebet ? state.rouletteLastRoundBets : state.rouletteBets;

    if (!state.rouletteIsPrison && betsToSpin.length === 0) {
      setGameState(prev => ({ ...prev, message: "PLACE BET" }));
      return;
    }

    // SPACE should rebet by default if we have a previous spin to reuse.
    if (shouldRebet) {
      const totalRequired = state.rouletteLastRoundBets.reduce((a, b) => a + b.amount, 0);
      if (stats.chips < totalRequired) {
        setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
        return;
      }
      setGameState(prev => ({
        ...prev,
        rouletteUndoStack: [...prev.rouletteUndoStack, prev.rouletteBets],
        rouletteBets: [...state.rouletteLastRoundBets],
        sessionWager: prev.sessionWager + totalRequired,
        message: "REBET PLACED",
      }));
    }

    // Prevent double-submits
    if (isPendingRef.current) {
      return;
    }

    // If on-chain mode with no session, auto-start a new game
    console.error('[qa-roulette] spinRoulette check - sessionRef:', currentSessionIdRef.current?.toString() ?? 'null', 'isOnChain:', isOnChain);
    if (isOnChain && chainService && !currentSessionIdRef.current) {
      if (state.rouletteIsPrison) {
        setGameState(prev => ({ ...prev, message: 'PRISON - WAIT FOR SESSION' }));
        return;
      }
      autoPlayDraftRef.current = {
        type: GameType.ROULETTE,
        rouletteBets: betsToSpin,
        rouletteZeroRule: state.rouletteZeroRule,
      };
      setGameState(prev => ({ ...prev, message: 'STARTING NEW SESSION...' }));
      startGame(GameType.ROULETTE);
      return;
    }

    // If on-chain mode, submit all bets then spin
    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;

        // Prison mode: just send spin command (action 1) - bets already on chain
      if (state.rouletteIsPrison) {
        pendingMoveCountRef.current = 1;
        setGameState(prev => ({ ...prev, message: 'SPINNING ON CHAIN...' }));
        const spinPayload = new Uint8Array([RouletteMove.Spin]);
        const result = await chainService.sendMove(currentSessionIdRef.current, spinPayload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('ROULETTE SPIN', currentSessionIdRef.current);
        return;
      }

        // Fresh betting round: use atomic batch (single transaction)
        pendingMoveCountRef.current = 1;
        setGameState(prev => ({ ...prev, message: 'SPINNING ON CHAIN...' }));

        // Send atomic batch: all bets + spin in one transaction
        const atomicPayload = serializeRouletteAtomicBatch(betsToSpin);
        const result = await chainService.sendMove(currentSessionIdRef.current, atomicPayload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('ROULETTE SPIN', currentSessionIdRef.current);

        // Update UI
        setGameState(prev => ({
          ...prev,
          rouletteLastRoundBets: prev.rouletteBets,
          rouletteBets: [],
          rouletteUndoStack: []
        }));

        return;
      } catch (error) {
        console.error('[useRoulette] Roulette spin failed:', error);
        isPendingRef.current = false;
        pendingMoveCountRef.current = 0;
        setGameState(prev => ({ ...prev, message: 'SPIN FAILED - TRY AGAIN' }));
        return;
      }
    }

    if (!isOnChain) {
      setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
    }
  }, [
    gameState.rouletteIsPrison,
    gameState.rouletteBets,
    gameState.rouletteLastRoundBets,
    gameState.rouletteZeroRule,
    stats.chips,
    isOnChain,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    pendingMoveCountRef,
    setLastTxSig,
    startGame,
    autoPlayDraftRef,
    setGameState,
    armChainResponseTimeout,
  ]);

  return {
    placeRouletteBet,
    cycleRouletteZeroRule,
    undoRouletteBet,
    rebetRoulette,
    spinRoulette
  };
};
