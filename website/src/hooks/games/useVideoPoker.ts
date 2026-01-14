import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, GameType } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';

interface UseVideoPokerProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isOnChain: boolean;
  setLastTxSig: (sig: string | null) => void;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
}

export const useVideoPoker = ({
  gameState,
  setGameState,
  chainService,
  currentSessionIdRef,
  isOnChain,
  setLastTxSig,
  armChainResponseTimeout,
}: UseVideoPokerProps) => {
  const toggleHold = useCallback((idx: number) => {
    if (gameState.type !== GameType.VIDEO_POKER) return;
    const cards = [...gameState.playerCards];
    cards[idx] = { ...cards[idx], isHeld: !cards[idx].isHeld };
    setGameState(prev => ({ ...prev, playerCards: cards }));
  }, [gameState.type, gameState.playerCards, setGameState]);

  const drawVideoPoker = useCallback(async () => {
    let holdMask = 0;
    gameState.playerCards.forEach((c, i) => {
      if (c.isHeld) holdMask |= (1 << i);
    });

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        const payload = new Uint8Array([holdMask]);
        const result = await chainService.sendMove(currentSessionIdRef.current, payload);
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('VIDEO POKER DRAW', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'DRAWING...' }));
        return;
      } catch (error) {
        console.error('[useVideoPoker] Draw failed:', error);
        setGameState(prev => ({ ...prev, message: 'DRAW FAILED' }));
        return;
      }
    }

    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [gameState.playerCards, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState, armChainResponseTimeout]);

  return { toggleHold, drawVideoPoker };
};
