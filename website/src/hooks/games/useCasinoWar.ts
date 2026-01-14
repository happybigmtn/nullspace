import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, GameType, PlayerStats } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';
import { logDebug } from '../../utils/logger';

interface UseCasinoWarProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  isOnChain: boolean;
  setLastTxSig: (sig: string | null) => void;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
}

export const useCasinoWar = ({
  gameState,
  setGameState,
  stats,
  chainService,
  currentSessionIdRef,
  isPendingRef,
  isOnChain,
  setLastTxSig,
  armChainResponseTimeout,
}: UseCasinoWarProps) => {
  const casinoWarToggleTieBet = useCallback(async () => {
    if (gameState.type !== GameType.CASINO_WAR) return;
    if (gameState.stage !== 'BETTING') {
      setGameState(prev => ({ ...prev, message: 'TIE BET CLOSED' }));
      return;
    }

    const prevAmount = gameState.casinoWarTieBet || 0;
    const nextAmount = prevAmount > 0 ? 0 : gameState.bet;
    const delta = nextAmount - prevAmount;

    if (isPendingRef.current) return;
    if (delta > 0 && stats.chips < delta) {
      setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
      return;
    }

    isPendingRef.current = true;
    setGameState(prev => ({
      ...prev,
      casinoWarTieBet: nextAmount,
      sessionWager: prev.sessionWager + delta,
      message: nextAmount > 0 ? `TIE BET +$${nextAmount}` : 'TIE BET OFF',
    }));

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        const payload = new Uint8Array(9);
        payload[0] = 3;
        new DataView(payload.buffer).setBigUint64(1, BigInt(nextAmount), false);
        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('CASINO WAR TIE BET', currentSessionIdRef.current);
        return;
      } catch (error) {
        console.error('[useCasinoWar] Tie bet update failed:', error);
        isPendingRef.current = false;
        setGameState(prev => ({
          ...prev,
          casinoWarTieBet: prevAmount,
          sessionWager: prev.sessionWager - delta,
          message: 'TIE BET FAILED',
        }));
        return;
      }
    }

    isPendingRef.current = false;
  }, [
    gameState.type,
    gameState.stage,
    gameState.casinoWarTieBet,
    gameState.bet,
    stats.chips,
    isPendingRef,
    isOnChain,
    chainService,
    currentSessionIdRef,
    setLastTxSig,
    setGameState,
  ]);

  const casinoWarGoToWar = useCallback(async () => {
    if (gameState.type !== GameType.CASINO_WAR || gameState.stage !== 'PLAYING' || !gameState.message.includes('WAR')) {
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      if (isPendingRef.current) {
        logDebug('[useCasinoWar] Go to War blocked - transaction pending');
        return;
      }

      isPendingRef.current = true;
      try {
        const payload = new Uint8Array([1]);
        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('CASINO WAR GO', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'GOING TO WAR...' }));
        return;
      } catch (error) {
        console.error('[useCasinoWar] Go to War failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [
    gameState.type,
    gameState.stage,
    gameState.message,
    isPendingRef,
    isOnChain,
    chainService,
    currentSessionIdRef,
    setLastTxSig,
    setGameState,
  ]);

  const casinoWarSurrender = useCallback(async () => {
    if (gameState.type !== GameType.CASINO_WAR || gameState.stage !== 'PLAYING' || !gameState.message.includes('WAR')) {
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      if (isPendingRef.current) {
        logDebug('[useCasinoWar] Surrender blocked - transaction pending');
        return;
      }

      isPendingRef.current = true;
      try {
        const payload = new Uint8Array([2]);
        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('CASINO WAR SURRENDER', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'SURRENDERING...' }));
        return;
      } catch (error) {
        console.error('[useCasinoWar] Surrender failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [
    gameState.type,
    gameState.stage,
    gameState.message,
    isPendingRef,
    isOnChain,
    chainService,
    currentSessionIdRef,
    setLastTxSig,
    setGameState,
    armChainResponseTimeout,
  ]);

  return { casinoWarToggleTieBet, casinoWarGoToWar, casinoWarSurrender };
};
