import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';
import { logDebug } from '../../utils/logger';

interface UseHiLoProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  isOnChain: boolean;
  setLastTxSig: (sig: string | null) => void;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
}

export const useHiLo = ({
  gameState,
  setGameState,
  chainService,
  currentSessionIdRef,
  isPendingRef,
  isOnChain,
  setLastTxSig,
  armChainResponseTimeout,
}: UseHiLoProps) => {
  const hiloPlay = useCallback(async (guess: 'HIGHER' | 'LOWER' | 'SAME') => {
    if (isPendingRef.current) {
      logDebug('[useHiLo] Blocked - transaction already pending');
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        const payloadByte = guess === 'HIGHER' ? 0 : guess === 'LOWER' ? 1 : 3;
        const payload = new Uint8Array([payloadByte]);
        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout(`HILO ${guess}`, currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: `GUESSING ${guess}...` }));
        return;
      } catch (error) {
        console.error('[useHiLo] Move failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [chainService, currentSessionIdRef, isOnChain, isPendingRef, setLastTxSig, setGameState, armChainResponseTimeout]);

  const hiloCashout = useCallback(async () => {
    if (isPendingRef.current) {
      logDebug('[useHiLo] Cashout blocked - transaction already pending');
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([2]));
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('HILO CASHOUT', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'CASHING OUT...' }));
        return;
      } catch (error) {
        console.error('[useHiLo] Cashout failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [chainService, currentSessionIdRef, isOnChain, isPendingRef, setLastTxSig, setGameState, armChainResponseTimeout]);

  return { hiloPlay, hiloCashout };
};
