import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, GameType } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';
import { logDebug } from '../../utils/logger';

interface UseUltimateHoldemProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  isOnChain: boolean;
  uthBackendStageRef: MutableRefObject<number>;
  setLastTxSig: (sig: string | null) => void;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
}

export const useUltimateHoldem = ({
  gameState,
  setGameState,
  chainService,
  currentSessionIdRef,
  isPendingRef,
  isOnChain,
  uthBackendStageRef,
  setLastTxSig,
  armChainResponseTimeout,
}: UseUltimateHoldemProps) => {
  const uthToggleTrips = useCallback(async () => {
    if (gameState.type !== GameType.ULTIMATE_HOLDEM) return;

    const prevAmount = gameState.uthTripsBet || 0;
    const nextAmount = prevAmount > 0 ? 0 : gameState.bet;

    if (isOnChain && chainService && currentSessionIdRef.current) {
      if (gameState.stage !== 'BETTING') {
        setGameState(prev => ({ ...prev, message: 'TRIPS CLOSED' }));
        return;
      }

      setGameState(prev => ({
        ...prev,
        uthTripsBet: nextAmount,
        message: nextAmount > 0 ? `TRIPS +$${nextAmount}` : 'TRIPS OFF',
      }));
      return;
    }

    setGameState(prev => ({
      ...prev,
      uthTripsBet: nextAmount,
      message: nextAmount > 0 ? `TRIPS +$${nextAmount}` : 'TRIPS OFF',
    }));
  }, [
    gameState.type,
    gameState.uthTripsBet,
    gameState.bet,
    gameState.stage,
    isOnChain,
    chainService,
    currentSessionIdRef,
    setGameState,
  ]);

  const uthToggleSixCardBonus = useCallback(async () => {
    if (gameState.type !== GameType.ULTIMATE_HOLDEM) return;

    const prevAmount = gameState.uthSixCardBonusBet || 0;
    const nextAmount = prevAmount > 0 ? 0 : gameState.bet;

    if (isOnChain && chainService && currentSessionIdRef.current) {
      if (gameState.stage !== 'BETTING') {
        setGameState(prev => ({ ...prev, message: '6-CARD CLOSED' }));
        return;
      }

      setGameState(prev => ({
        ...prev,
        uthSixCardBonusBet: nextAmount,
        message: nextAmount > 0 ? `6-CARD +$${nextAmount}` : '6-CARD OFF',
      }));
      return;
    }

    setGameState(prev => ({
      ...prev,
      uthSixCardBonusBet: nextAmount,
      message: nextAmount > 0 ? `6-CARD +$${nextAmount}` : '6-CARD OFF',
    }));
  }, [
    gameState.type,
    gameState.uthSixCardBonusBet,
    gameState.bet,
    gameState.stage,
    isOnChain,
    chainService,
    currentSessionIdRef,
    setGameState,
  ]);

  const uthToggleProgressive = useCallback(async () => {
    if (gameState.type !== GameType.ULTIMATE_HOLDEM) return;

    const prevAmount = gameState.uthProgressiveBet || 0;
    const nextAmount = prevAmount > 0 ? 0 : 1;

    if (isOnChain && chainService && currentSessionIdRef.current) {
      if (gameState.stage !== 'BETTING') {
        setGameState(prev => ({ ...prev, message: 'PROG CLOSED' }));
        return;
      }

      setGameState(prev => ({
        ...prev,
        uthProgressiveBet: nextAmount,
        message: nextAmount > 0 ? `PROG +$${nextAmount}` : 'PROG OFF',
      }));
      return;
    }

    setGameState(prev => ({
      ...prev,
      uthProgressiveBet: nextAmount,
      message: nextAmount > 0 ? `PROG +$${nextAmount}` : 'PROG OFF',
    }));
  }, [
    gameState.type,
    gameState.uthProgressiveBet,
    gameState.stage,
    isOnChain,
    chainService,
    currentSessionIdRef,
    setGameState,
  ]);

  const uhCheck = useCallback(async () => {
    if (gameState.type !== GameType.ULTIMATE_HOLDEM || gameState.stage !== 'PLAYING') return;

    if (isOnChain && chainService && currentSessionIdRef.current) {
      if (isPendingRef.current) {
        logDebug('[useUltimateHoldem] Check blocked - transaction pending');
        return;
      }

      const backendStage = uthBackendStageRef.current;
      if (backendStage !== 1 && backendStage !== 2) {
        logDebug(`[useUltimateHoldem] Check blocked - wrong stage (have ${backendStage}, need 1 or 2)`);
        return;
      }

      isPendingRef.current = true;
      try {
        const payload = new Uint8Array([0]);
        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('ULTIMATE HOLDEM CHECK', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'CHECKING...' }));
        return;
      } catch (error) {
        console.error('[useUltimateHoldem] Check failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [
    gameState.type,
    gameState.stage,
    isOnChain,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    uthBackendStageRef,
    setLastTxSig,
    setGameState,
    armChainResponseTimeout,
  ]);

  const uhBet = useCallback(async (multiplier: number) => {
    if (gameState.type !== GameType.ULTIMATE_HOLDEM || gameState.stage !== 'PLAYING') return;

    if (isOnChain && chainService && currentSessionIdRef.current) {
      if (isPendingRef.current) {
        logDebug('[useUltimateHoldem] Bet blocked - transaction pending');
        return;
      }

      const backendStage = uthBackendStageRef.current;
      const validStage =
        multiplier === 4 || multiplier === 3
          ? 1
          : multiplier === 2
            ? 2
            : multiplier === 1
              ? 3
              : -1;
      if (backendStage !== validStage) {
        logDebug(`[useUltimateHoldem] Bet ${multiplier}x blocked - wrong stage (have ${backendStage}, need ${validStage})`);
        return;
      }

      isPendingRef.current = true;
      try {
        let payload: Uint8Array;
        if (multiplier === 4) payload = new Uint8Array([1]);
        else if (multiplier === 3) payload = new Uint8Array([8]);
        else if (multiplier === 2) payload = new Uint8Array([2]);
        else if (multiplier === 1) payload = new Uint8Array([3]);
        else {
          console.error('[useUltimateHoldem] Invalid bet multiplier:', multiplier);
          setGameState(prev => ({ ...prev, message: 'INVALID BET' }));
          return;
        }

        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout(`ULTIMATE HOLDEM BET ${multiplier}X`, currentSessionIdRef.current);

        const betAmount = gameState.bet * multiplier;
        setGameState(prev => ({
          ...prev,
          message: `BETTING ${multiplier}X...`,
          sessionWager: prev.sessionWager + betAmount,
        }));
        return;
      } catch (error) {
        console.error('[useUltimateHoldem] Bet failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [
    gameState.type,
    gameState.stage,
    gameState.bet,
    isOnChain,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    uthBackendStageRef,
    setLastTxSig,
    setGameState,
    armChainResponseTimeout,
  ]);

  const uhFold = useCallback(async () => {
    if (gameState.type !== GameType.ULTIMATE_HOLDEM || gameState.stage !== 'PLAYING') return;

    if (isOnChain && chainService && currentSessionIdRef.current) {
      if (isPendingRef.current) {
        logDebug('[useUltimateHoldem] Fold blocked - transaction pending');
        return;
      }

      if (uthBackendStageRef.current !== 3) {
        logDebug(`[useUltimateHoldem] Fold blocked - wrong stage (have ${uthBackendStageRef.current}, need 3)`);
        return;
      }

      isPendingRef.current = true;
      try {
        const payload = new Uint8Array([4]);
        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('ULTIMATE HOLDEM FOLD', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'FOLDING...' }));
        return;
      } catch (error) {
        console.error('[useUltimateHoldem] Fold failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [
    gameState.type,
    gameState.stage,
    isOnChain,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    uthBackendStageRef,
    setLastTxSig,
    setGameState,
    armChainResponseTimeout,
  ]);

  return {
    uthToggleTrips,
    uthToggleSixCardBonus,
    uthToggleProgressive,
    uhCheck,
    uhBet,
    uhFold,
  };
};
