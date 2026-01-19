import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { CasinoGameStartedEvent } from '@nullspace/types/casino';
import { GameType as ChainGameType } from '@nullspace/types/casino';
import type { CasinoChainService } from '../../../services/CasinoChainService';
import type { CasinoClient } from '../../../api/client';
import { GameState, GameType } from '../../../types';
import { CHAIN_TO_FRONTEND_GAME_TYPE } from '../../../services/games';
import { logDebug } from '../../../utils/logger';
import { getChainReadyMessage } from '../chainMessages';

type HandleGameStartedArgs = {
  chainService: CasinoChainService;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  gameTypeRef: MutableRefObject<GameType>;
  gameStateRef: MutableRefObject<GameState | null>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  applySessionMeta: (sessionId: bigint | null, moveNumber?: number) => void;
  clearChainResponseTimeout: () => void;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
  clientRef: MutableRefObject<CasinoClient | null>;
  setGameState: Dispatch<SetStateAction<GameState>>;
  parseGameState: (stateBlob: Uint8Array | string, gameType?: GameType) => void;
  setLastTxSig: (sig: string | null) => void;
  runAutoPlayForSession: (sessionId: bigint, frontendGameType: GameType) => void;
};

export const createGameStartedHandler = ({
  chainService,
  currentSessionIdRef,
  gameTypeRef,
  gameStateRef,
  isPendingRef,
  pendingMoveCountRef,
  applySessionMeta,
  clearChainResponseTimeout,
  armChainResponseTimeout,
  clientRef,
  setGameState,
  parseGameState,
  setLastTxSig,
  runAutoPlayForSession,
}: HandleGameStartedArgs) => (event: CasinoGameStartedEvent) => {
  const eventSessionId = BigInt(event.sessionId);
  const currentId = currentSessionIdRef.current ? BigInt(currentSessionIdRef.current) : null;
  console.error('[qa-game] GameStarted received, event session:', eventSessionId.toString(), 'current ref:', currentId?.toString() ?? 'null', 'match:', currentId !== null && eventSessionId === currentId);

  if (currentId === null) {
    logDebug('[handleGameStarted] event without current session', {
      eventSessionId: eventSessionId.toString(),
    });
  } else if (eventSessionId !== currentId) {
    logDebug('[handleGameStarted] session mismatch', {
      eventSessionId: eventSessionId.toString(),
      currentSessionId: currentId.toString(),
    });
  }

  if (currentId !== null && eventSessionId === currentId) {
    clearChainResponseTimeout();
    isPendingRef.current = false;
    pendingMoveCountRef.current = 0;
    applySessionMeta(eventSessionId, 0);

    const frontendGameType = CHAIN_TO_FRONTEND_GAME_TYPE[event.gameType as ChainGameType];
    gameTypeRef.current = frontendGameType;

    void (async () => {
      const maxRetries = 3;
      const retryDelayMs = 200;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise(r => setTimeout(r, retryDelayMs));
          }

          const sessionState = await clientRef.current?.getCasinoSession(eventSessionId);
          if (sessionState) {
            setGameState(prev => ({ ...prev, superMode: sessionState.superMode ?? null }));

            if (
              sessionState.superMode?.isActive &&
              Array.isArray(sessionState.superMode.multipliers) &&
              sessionState.superMode.multipliers.length > 0
            ) {
              break;
            }
          }
        } catch (e) {
          logDebug('[chainEvents] Failed to fetch session state after GameStarted:', e);
        }
      }
    })();

    if (event.initialState && event.initialState.length > 0) {
      parseGameState(event.initialState, frontendGameType);

      const initialMessage = getChainReadyMessage(frontendGameType);
      setGameState(prev => {
        const normalized = String(prev.message ?? '').toUpperCase();
        const shouldUpdate =
          prev.stage === 'BETTING' || normalized.includes('WAITING FOR CHAIN');
        return shouldUpdate
          ? { ...prev, stage: 'PLAYING', message: initialMessage }
          : prev;
      });

      if (frontendGameType === GameType.CASINO_WAR && chainService && currentSessionIdRef.current) {
        const stage = event.initialState[2];
        if (stage === 0) {
          if (isPendingRef.current) {
            logDebug('[chainEvents] Casino War auto-confirm blocked - pending');
            return;
          }

          void (async () => {
            isPendingRef.current = true;
            try {
              const payload = new Uint8Array([0]);
              const result = await chainService.sendMove(currentSessionIdRef.current!, payload);
              if (result.txHash) setLastTxSig(result.txHash);
              armChainResponseTimeout('CASINO WAR AUTO-CONFIRM', currentSessionIdRef.current);
              setGameState(prev => ({ ...prev, message: 'COMPARING...' }));
            } catch (error) {
              console.error('[chainEvents] Casino War auto-confirm failed:', error);
              setGameState(prev => ({ ...prev, message: 'CONFIRM FAILED' }));
              isPendingRef.current = false;
            }
          })();
        }
      }
    } else {
      const initialMessage = getChainReadyMessage(frontendGameType);
      setGameState(prev => ({
        ...prev,
        stage: 'PLAYING',
        message: initialMessage,
      }));

      if (frontendGameType === GameType.BLACKJACK && chainService && currentSessionIdRef.current) {
        void (async () => {
          if (isPendingRef.current) return;
          isPendingRef.current = true;
          try {
            const payload = new Uint8Array([0]);
            const result = await chainService.sendMove(currentSessionIdRef.current!, payload);
            if (result.txHash) setLastTxSig(result.txHash);
            armChainResponseTimeout('BLACKJACK AUTO-DEAL', currentSessionIdRef.current);
            setGameState(prev => ({ ...prev, message: 'DEALING...' }));
          } catch (error) {
            console.error('[chainEvents] Blackjack auto-deal failed:', error);
            isPendingRef.current = false;
            setGameState(prev => ({ ...prev, message: 'DEAL FAILED (SPACE)' }));
          }
        })();
      }
    }

    runAutoPlayForSession(eventSessionId, frontendGameType);
  }
};
