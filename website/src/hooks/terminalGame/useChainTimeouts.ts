import { useCallback } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { GameState, GameType } from '../../types';
import { GameType as ChainGameType } from '@nullspace/types/casino';
import { CHAIN_TO_FRONTEND_GAME_TYPE } from '../../services/games';

type UseChainTimeoutsArgs = {
  chainResponseTimeoutMs: number;
  awaitingChainResponseRef: MutableRefObject<boolean>;
  chainResponseTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  setCurrentSessionId: Dispatch<SetStateAction<bigint | null>>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  crapsPendingRollLogRef: MutableRefObject<any>;
  crapsChainRollLogRef: MutableRefObject<any>;
  setGameState: Dispatch<SetStateAction<GameState>>;
  clientRef: MutableRefObject<{ getCasinoSession?: (id: bigint) => Promise<any> } | null>;
  gameTypeRef: MutableRefObject<GameType>;
  gameStateRef: MutableRefObject<GameState | null>;
  parseGameState: (stateBlob: Uint8Array, gameType?: GameType) => void;
  runAutoPlayForSession: (sessionId: bigint, frontendGameType: GameType) => void;
};

export const useChainTimeouts = ({
  chainResponseTimeoutMs,
  awaitingChainResponseRef,
  chainResponseTimeoutRef,
  currentSessionIdRef,
  setCurrentSessionId,
  isPendingRef,
  pendingMoveCountRef,
  crapsPendingRollLogRef,
  crapsChainRollLogRef,
  setGameState,
  clientRef,
  gameTypeRef,
  gameStateRef,
  parseGameState,
  runAutoPlayForSession,
}: UseChainTimeoutsArgs) => {
  const clearChainResponseTimeout = useCallback(() => {
    awaitingChainResponseRef.current = false;
    if (chainResponseTimeoutRef.current) {
      clearTimeout(chainResponseTimeoutRef.current);
      chainResponseTimeoutRef.current = null;
    }
  }, [awaitingChainResponseRef, chainResponseTimeoutRef]);

  const armChainResponseTimeout = useCallback((context: string, expectedSessionId?: bigint | null) => {
    awaitingChainResponseRef.current = true;
    if (chainResponseTimeoutRef.current) {
      clearTimeout(chainResponseTimeoutRef.current);
    }
    chainResponseTimeoutRef.current = setTimeout(() => {
      void (async () => {
        if (!awaitingChainResponseRef.current) return;

        const sessionId = expectedSessionId ?? currentSessionIdRef.current;
        if (sessionId === null || sessionId === undefined) {
          awaitingChainResponseRef.current = false;
          isPendingRef.current = false;
          pendingMoveCountRef.current = 0;
          crapsPendingRollLogRef.current = null;
          crapsChainRollLogRef.current = null;
          currentSessionIdRef.current = null;
          setCurrentSessionId(null);
          setGameState(prev => ({
            ...prev,
            stage: 'BETTING',
            message: `NO CHAIN RESPONSE (${context}) — START validators`,
          }));
          return;
        }
        if (currentSessionIdRef.current !== sessionId) return;

        try {
          const client: any = clientRef.current;
          if (client) {
            const sessionState = await client.getCasinoSession(sessionId);
            if (!awaitingChainResponseRef.current) return;
            if (currentSessionIdRef.current !== sessionId) return;

            if (sessionState && !sessionState.isComplete) {
              const frontendGameType =
                CHAIN_TO_FRONTEND_GAME_TYPE[sessionState.gameType as ChainGameType] ?? gameTypeRef.current;
              gameTypeRef.current = frontendGameType;
              setCurrentSessionId(sessionId);
              const primedPrev = gameStateRef.current;
              if (primedPrev) {
                const primed = {
                  ...primedPrev,
                  type: frontendGameType,
                  bet:
                    sessionState.bet !== undefined && sessionState.bet !== null
                      ? Number(sessionState.bet)
                      : primedPrev.bet,
                };
                gameStateRef.current = primed;
                setGameState(primed);
              } else {
                setGameState(prev => ({
                  ...prev,
                  type: frontendGameType,
                  bet: sessionState.bet !== undefined && sessionState.bet !== null ? Number(sessionState.bet) : prev.bet,
                }));
              }
              parseGameState(sessionState.stateBlob, frontendGameType);
              clearChainResponseTimeout();
              isPendingRef.current = false;
              pendingMoveCountRef.current = 0;
              crapsPendingRollLogRef.current = null;
              crapsChainRollLogRef.current = null;
              runAutoPlayForSession(sessionId, frontendGameType);
              return;
            }
          }
        } catch {
          // ignore
        }

        awaitingChainResponseRef.current = false;
        isPendingRef.current = false;
        crapsPendingRollLogRef.current = null;
        crapsChainRollLogRef.current = null;
        currentSessionIdRef.current = null;
        setCurrentSessionId(null);
        setGameState(prev => ({
          ...prev,
          stage: 'BETTING',
          message: `NO CHAIN RESPONSE (${context}) — START validators`,
        }));
      })();
    }, chainResponseTimeoutMs);
  }, [
    chainResponseTimeoutMs,
    awaitingChainResponseRef,
    chainResponseTimeoutRef,
    currentSessionIdRef,
    setCurrentSessionId,
    isPendingRef,
    pendingMoveCountRef,
    crapsPendingRollLogRef,
    crapsChainRollLogRef,
    setGameState,
    clientRef,
    gameTypeRef,
    gameStateRef,
    parseGameState,
    runAutoPlayForSession,
    clearChainResponseTimeout,
  ]);

  const ensureChainResponsive = useCallback(async (): Promise<boolean> => {
    const client: any = clientRef.current;
    if (!client) return false;

    try {
      const view = client.getCurrentView?.();
      if (view !== null && view !== undefined) return true;
    } catch {
      // ignore
    }

    try {
      const latest = await client.queryLatestSeed?.();
      if (latest?.found) {
        client.latestSeed = latest.seed;
        return true;
      }
    } catch {
      // ignore
    }

    try {
      await Promise.race([
        client.waitForFirstSeed?.(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('seed-timeout')), 1500)),
      ]);
      const view = client.getCurrentView?.();
      return view !== null && view !== undefined;
    } catch {
      return false;
    }
  }, [clientRef]);

  return { clearChainResponseTimeout, armChainResponseTimeout, ensureChainResponsive };
};
