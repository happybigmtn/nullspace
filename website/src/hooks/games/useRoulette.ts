import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, RouletteBet, PlayerStats, GameType, AutoPlayDraft } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';
import { RouletteMove } from '@nullspace/constants';
import { encodeRouletteBet, type RouletteBetName } from '@nullspace/constants/bet-types';

const MAX_GRAPH_POINTS = 100;

/**
 * Convert RouletteBet to numeric format for serialization
 */
const rouletteBetToNumeric = (bet: RouletteBet): {betType: number, number: number, amount: number} => {
  const encoded = encodeRouletteBet(bet.type as RouletteBetName, bet.target);
  return { betType: encoded.type, number: encoded.value, amount: bet.amount };
};

/**
 * Serialize Roulette atomic batch: [4, bet_count, bets...]
 * Each bet is 10 bytes: [bet_type:u8] [number:u8] [amount:u64 BE]
 */
const serializeRouletteAtomicBatch = (bets: RouletteBet[]): Uint8Array => {
  const numericBets = bets.map(rouletteBetToNumeric);
  const payload = new Uint8Array(2 + numericBets.length * 10);
  payload[0] = RouletteMove.AtomicBatch;
  payload[1] = numericBets.length;
  const view = new DataView(payload.buffer);
  numericBets.forEach((b, i) => {
    const offset = 2 + i * 10;
    payload[offset] = b.betType;
    payload[offset + 1] = b.number;
    view.setBigUint64(offset + 2, BigInt(b.amount), false);
  });
  return payload;
};

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
  autoPlayDraftRef
}: UseRouletteProps) => {

  const placeRouletteBet = useCallback((type: RouletteBet['type'], target?: number) => {
    if (gameState.rouletteIsPrison) {
      setGameState(prev => ({ ...prev, message: 'EN PRISON - NO NEW BETS' }));
      return;
    }

    const existing = gameState.rouletteBets.some(b => b.type === type && b.target === target);
    if (existing) {
      const newBets = gameState.rouletteBets.filter(b => !(b.type === type && b.target === target));
      const removedAmount = gameState.rouletteBets.reduce((sum, b) => (b.type === type && b.target === target) ? sum + b.amount : sum, 0);
      setGameState(prev => ({
        ...prev,
        rouletteBets: newBets,
        message: `REMOVED ${type}`,
        rouletteInputMode: 'NONE',
        sessionWager: Math.max(0, prev.sessionWager - removedAmount)
      }));
      return;
    }

    if (stats.chips < gameState.bet) return;
    setGameState(prev => ({
      ...prev,
      rouletteUndoStack: [...prev.rouletteUndoStack, prev.rouletteBets],
      rouletteBets: [...prev.rouletteBets, { type, amount: prev.bet, target }],
      message: `BET ${type}`,
      rouletteInputMode: 'NONE',
      sessionWager: prev.sessionWager + prev.bet
    }));
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
      } catch (e) {
        console.error('[useRoulette] Rule update failed:', e);
        isPendingRef.current = false;
        setGameState(prev => ({ ...prev, message: 'RULE UPDATE FAILED' }));
      }
    }
  }, [gameState.type, gameState.rouletteZeroRule, gameState.rouletteIsPrison, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState]);

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

  const spinRoulette = useCallback(async () => {
    const shouldRebet = !gameState.rouletteIsPrison && gameState.rouletteBets.length === 0 && gameState.rouletteLastRoundBets.length > 0;
    const betsToSpin = shouldRebet ? gameState.rouletteLastRoundBets : gameState.rouletteBets;

    if (!gameState.rouletteIsPrison && betsToSpin.length === 0) {
      setGameState(prev => ({ ...prev, message: "PLACE BET" }));
      return;
    }

    // SPACE should rebet by default if we have a previous spin to reuse.
    if (shouldRebet) {
      const totalRequired = gameState.rouletteLastRoundBets.reduce((a, b) => a + b.amount, 0);
      if (stats.chips < totalRequired) {
        setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
        return;
      }
      setGameState(prev => ({
        ...prev,
        rouletteUndoStack: [...prev.rouletteUndoStack, prev.rouletteBets],
        rouletteBets: [...gameState.rouletteLastRoundBets],
        sessionWager: prev.sessionWager + totalRequired,
        message: "REBET PLACED",
      }));
    }

    // Prevent double-submits
    if (isPendingRef.current) {
      console.log('[useRoulette] spinRoulette - Already pending, ignoring');
      return;
    }

    // If on-chain mode with no session, auto-start a new game
    if (isOnChain && chainService && !currentSessionIdRef.current) {
      if (gameState.rouletteIsPrison) {
        setGameState(prev => ({ ...prev, message: 'PRISON - WAIT FOR SESSION' }));
        return;
      }
      autoPlayDraftRef.current = {
        type: GameType.ROULETTE,
        rouletteBets: betsToSpin,
        rouletteZeroRule: gameState.rouletteZeroRule,
      };
      console.log('[useRoulette] No active session, starting new roulette game (auto-spin queued)');
      setGameState(prev => ({ ...prev, message: 'STARTING NEW SESSION...' }));
      startGame(GameType.ROULETTE);
      return;
    }

    // If on-chain mode, submit all bets then spin
    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;

        // Prison mode: just send spin command (action 1) - bets already on chain
        if (gameState.rouletteIsPrison) {
          pendingMoveCountRef.current = 1;
          setGameState(prev => ({ ...prev, message: 'SPINNING ON CHAIN...' }));
          const spinPayload = new Uint8Array([RouletteMove.Spin]);
          const result = await chainService.sendMove(currentSessionIdRef.current, spinPayload);
          if (result.txHash) setLastTxSig(result.txHash);
          return;
        }

        // Fresh betting round: use atomic batch (single transaction)
        pendingMoveCountRef.current = 1;
        setGameState(prev => ({ ...prev, message: 'SPINNING ON CHAIN...' }));

        // Send atomic batch: all bets + spin in one transaction
        const atomicPayload = serializeRouletteAtomicBatch(betsToSpin);
        console.log('[useRoulette] Roulette spin with bets (atomic batch):', betsToSpin.length, 'bets');
        const result = await chainService.sendMove(currentSessionIdRef.current, atomicPayload);
        if (result.txHash) setLastTxSig(result.txHash);

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
    gameState.rouletteIsPrison, gameState.rouletteBets, gameState.rouletteLastRoundBets,
    gameState.rouletteZeroRule, stats.chips, isOnChain, chainService, currentSessionIdRef,
    isPendingRef, pendingMoveCountRef, setLastTxSig, startGame, autoPlayDraftRef, setGameState
  ]);

  return {
    placeRouletteBet,
    cycleRouletteZeroRule,
    undoRouletteBet,
    rebetRoulette,
    spinRoulette
  };
};
