import { useEffect } from 'react';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import type { CasinoChainService } from '../../services/CasinoChainService';
import type { CasinoClient } from '../../api/client';
import { GameState, GameType, LeaderboardEntry, PlayerStats } from '../../types';
import { GameType as ChainGameType } from '@nullspace/types/casino';
import { logDebug } from '../../utils/logger';
import type { CrapsChainRollLog } from '../../services/games';
import { createGameStartedHandler } from './chainEvents/handleGameStarted';
import { createGameMovedHandler } from './chainEvents/handleGameMoved';
import { createGameCompletedHandler } from './chainEvents/handleGameCompleted';
import { CHAIN_TO_FRONTEND_GAME_TYPE } from '../../services/games';
import { getCasinoKeyIdForStorage } from '../../security/keyVault';

type CrapsPendingRollLog = {
  sessionId: bigint;
  prevDice: [number, number] | null;
  point: number | null;
  bets: any[];
} | null;

type CrapsChainRollRef = MutableRefObject<{ sessionId: bigint; roll: CrapsChainRollLog } | null>;
export type UseChainEventsArgs = {
  chainService: CasinoChainService | null;
  isOnChain: boolean;
  currentSessionId: bigint | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  setCurrentSessionId: Dispatch<SetStateAction<bigint | null>>;
  gameTypeRef: MutableRefObject<GameType>;
  gameStateRef: MutableRefObject<GameState>;
  setGameState: Dispatch<SetStateAction<GameState>>;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  stats: PlayerStats;
  setLeaderboard: Dispatch<SetStateAction<LeaderboardEntry[]>>;
  isRegisteredRef: MutableRefObject<boolean>;
  hasRegisteredRef: MutableRefObject<boolean | null>;
  setIsRegistered: Dispatch<SetStateAction<boolean>>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  crapsPendingRollLogRef: MutableRefObject<CrapsPendingRollLog>;
  crapsChainRollLogRef: CrapsChainRollRef;
  applySessionMeta: (sessionId: bigint | null, moveNumber?: number) => void;
  parseGameState: (stateBlob: Uint8Array | string, gameType?: GameType) => void;
  clearChainResponseTimeout: () => void;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
  runAutoPlayForSession: (sessionId: bigint, frontendGameType: GameType) => void;
  clientRef: MutableRefObject<CasinoClient | null>;
  playModeRef: MutableRefObject<'instant' | 'animated'>;
  publicKeyBytesRef: MutableRefObject<Uint8Array | null>;
  lastBalanceUpdateRef: MutableRefObject<number>;
  currentChipsRef: MutableRefObject<number>;
  lastLeaderboardUpdateRef: MutableRefObject<number>;
  sessionStartChipsRef: MutableRefObject<Map<bigint, number>>;
  lastPlayerSyncRef: MutableRefObject<number>;
  playerSyncMinIntervalMs: number;
  setLastTxSig: Dispatch<SetStateAction<string | null>>;
  setWalletRng: Dispatch<SetStateAction<number | null>>;
  setWalletVusdt: Dispatch<SetStateAction<number | null>>;
  setWalletCredits: Dispatch<SetStateAction<number | null>>;
  setWalletCreditsLocked: Dispatch<SetStateAction<number | null>>;
};

export const useChainEvents = ({
  chainService,
  isOnChain,
  currentSessionId,
  currentSessionIdRef,
  setCurrentSessionId,
  gameTypeRef,
  gameStateRef,
  setGameState,
  setStats,
  stats,
  setLeaderboard,
  isRegisteredRef,
  hasRegisteredRef,
  setIsRegistered,
  isPendingRef,
  pendingMoveCountRef,
  crapsPendingRollLogRef,
  crapsChainRollLogRef,
  applySessionMeta,
  parseGameState,
  clearChainResponseTimeout,
  armChainResponseTimeout,
  runAutoPlayForSession,
  clientRef,
  publicKeyBytesRef,
  setLastTxSig,
  lastBalanceUpdateRef,
  currentChipsRef,
  lastLeaderboardUpdateRef,
  sessionStartChipsRef,
  playModeRef,
  lastPlayerSyncRef,
  playerSyncMinIntervalMs,
  setWalletRng,
  setWalletVusdt,
  setWalletCredits,
  setWalletCreditsLocked,
}: UseChainEventsArgs) => {
   useEffect(() => {
     if (!chainService || !isOnChain) return;

     const unsubStarted = chainService.onGameStarted(createGameStartedHandler({
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
     }));

     const unsubMoved = chainService.onGameMoved(createGameMovedHandler({
       chainService,
       currentSessionIdRef,
       gameTypeRef,
       gameStateRef,
       isPendingRef,
       pendingMoveCountRef,
     crapsPendingRollLogRef,
       crapsChainRollLogRef,
       applySessionMeta,
       clearChainResponseTimeout,
       armChainResponseTimeout,
       parseGameState,
     playModeRef,
     clientRef,
       publicKeyBytesRef,
       lastBalanceUpdateRef,
       currentChipsRef,
       lastPlayerSyncRef,
       playerSyncMinIntervalMs,
       setStats,
       setGameState,
       setWalletRng,
       setWalletVusdt,
       setWalletCredits,
       setWalletCreditsLocked,
       setLastTxSig,
     }));

     const unsubCompleted = chainService.onGameCompleted(createGameCompletedHandler({
       currentSessionIdRef,
       setCurrentSessionId,
       clearChainResponseTimeout,
       gameTypeRef,
       gameStateRef,
       setGameState,
       setStats,
       stats,
       playModeRef,
       lastBalanceUpdateRef,
       currentChipsRef,
       sessionStartChipsRef,
       isPendingRef,
       pendingMoveCountRef,
       crapsPendingRollLogRef,
       crapsChainRollLogRef,
       clientRef,
       setWalletRng,
       setWalletVusdt,
     }));

     const unsubLeaderboard = chainService.onLeaderboardUpdated((leaderboardData: any) => {
       lastLeaderboardUpdateRef.current = Date.now();
       try {
         if (leaderboardData && leaderboardData.entries) {
           const myPublicKeyHex = publicKeyBytesRef.current
             ? Array.from(publicKeyBytesRef.current).map(b => b.toString(16).padStart(2, '0')).join('')
             : null;

           const newBoard = leaderboardData.entries.map((entry: { player?: string; name?: string; chips: bigint | number }) => ({
             name: entry.name || `Player_${entry.player?.substring(0, 8)}`,
             chips: Number(entry.chips),
             status: 'ALIVE' as const
           }));

           const isPlayerInBoard = myPublicKeyHex && leaderboardData.entries.some(
             (entry: { player?: string }) => entry.player && entry.player.toLowerCase() === myPublicKeyHex.toLowerCase()
           );

           if (!isPlayerInBoard && myPublicKeyHex && isRegisteredRef.current) {
             newBoard.push({ name: 'YOU', chips: currentChipsRef.current, status: 'ALIVE' });
           } else if (myPublicKeyHex) {
             const playerIdx = leaderboardData.entries.findIndex(
               (entry: { player?: string }) => entry.player && entry.player.toLowerCase() === myPublicKeyHex.toLowerCase()
             );
             if (playerIdx >= 0) {
               newBoard[playerIdx].name = `${newBoard[playerIdx].name} (YOU)`;
             }
           }

           newBoard.sort((a, b) => b.chips - a.chips);
           setLeaderboard(newBoard);

           const myRank = newBoard.findIndex(p => p.name.includes('YOU')) + 1;
           if (myRank > 0) {
             setStats(s => ({ ...s, rank: myRank }));
           }
         }
       } catch (e) {
         console.error('[useChainEvents] Failed to process leaderboard update:', e);
       }
     });

     const client: any = clientRef.current;
     const unsubError =
       client?.onEvent?.('CasinoError', (e: any) => {
         try {
           const message = (e?.message ?? 'UNKNOWN ERROR').toString();
           const sessionIdRaw = e?.sessionId ?? e?.session_id ?? null;
           const errorSessionId =
             sessionIdRaw === null || sessionIdRaw === undefined ? null : BigInt(sessionIdRaw);
           const current = currentSessionIdRef.current ? BigInt(currentSessionIdRef.current) : null;

           const lowerMessage = message.toLowerCase();
           const isRecoverableError =
             lowerMessage.includes('invalid move') ||
             lowerMessage.includes('invalidmove') ||
             lowerMessage.includes('invalid payload') ||
             lowerMessage.includes('invalidpayload');
           const isNonceError = lowerMessage.includes('nonce') || lowerMessage.includes('expected=');
           const isAlreadyRegistered = lowerMessage.includes('already registered');
           const isPlayerNotFound = lowerMessage.includes('player not found');

           if (isAlreadyRegistered) {
             hasRegisteredRef.current = true;
             isRegisteredRef.current = true;
             setIsRegistered(true);
             const keyId = getCasinoKeyIdForStorage();
             if (keyId) {
               localStorage.setItem(`casino_registered_${keyId}`, 'true');
             }
           }

           if (isPlayerNotFound) {
             hasRegisteredRef.current = false;
             isRegisteredRef.current = false;
             setIsRegistered(false);
             const keyId = getCasinoKeyIdForStorage();
             if (keyId) {
               localStorage.removeItem(`casino_registered_${keyId}`);
             }
             try {
               void chainService?.forceSyncNonce();
             } catch {
               // ignore
             }
           }

           if (isNonceError) {
             void chainService?.forceSyncNonce();
           }

           if (errorSessionId !== null && current !== null && errorSessionId === current && !isRecoverableError) {
             currentSessionIdRef.current = null;
             setCurrentSessionId(null);
             isPendingRef.current = false;
             pendingMoveCountRef.current = 0;
             crapsPendingRollLogRef.current = null;
             crapsChainRollLogRef.current = null;
           }

           const currentMessage = (gameStateRef.current?.message ?? '').toString().toUpperCase();
           const shouldPreserveMessage = isAlreadyRegistered && currentMessage.includes('WAITING FOR CHAIN');
           const nextMessage = shouldPreserveMessage
             ? currentMessage
             : isAlreadyRegistered
               ? 'REGISTERED'
               : isPlayerNotFound
                 ? 'PLAYER NOT REGISTERED'
                 : message.toUpperCase().slice(0, 72);

           setGameState(prev => ({
             ...prev,
             message: nextMessage,
           }));
         } finally {
           clearChainResponseTimeout();
           isPendingRef.current = false;
           pendingMoveCountRef.current = 0;
           crapsPendingRollLogRef.current = null;
           crapsChainRollLogRef.current = null;
         }
       }) ?? (() => {});

     return () => {
       unsubStarted();
       unsubMoved();
       unsubCompleted();
       unsubLeaderboard();
       unsubError();
       clearChainResponseTimeout();
     };
  }, [
    chainService,
    isOnChain,
    applySessionMeta,
    clearChainResponseTimeout,
    armChainResponseTimeout,
     clientRef,
     currentChipsRef,
     currentSessionIdRef,
     gameStateRef,
     gameTypeRef,
     isPendingRef,
     pendingMoveCountRef,
     playModeRef,
     publicKeyBytesRef,
     runAutoPlayForSession,
     setCurrentSessionId,
     setGameState,
     setLastTxSig,
     setLeaderboard,
     setStats,
     setWalletCredits,
     setWalletCreditsLocked,
     setWalletRng,
     setWalletVusdt,
     sessionStartChipsRef,
     stats,
     lastBalanceUpdateRef,
     lastLeaderboardUpdateRef,
     lastPlayerSyncRef,
     playerSyncMinIntervalMs,
     crapsPendingRollLogRef,
     crapsChainRollLogRef,
    isRegisteredRef,
    hasRegisteredRef,
    setIsRegistered,
  ]);

  // Fallback polling for simulator deployments that omit signed update proofs.
  useEffect(() => {
    if (!isOnChain) return;
    let cancelled = false;

    const poll = async () => {
      const client = clientRef.current;
      if (!client || cancelled) return;

      try {
        if (publicKeyBytesRef.current) {
          const playerState = await client.getCasinoPlayer(publicKeyBytesRef.current);
          if (playerState) {
            lastBalanceUpdateRef.current = Date.now();
            setStats((prev) => ({
              ...prev,
              chips: Number(playerState.chips ?? prev.chips),
              shields: playerState.shields ?? prev.shields,
              doubles: playerState.doubles ?? prev.doubles,
              auraMeter: playerState.auraMeter ?? prev.auraMeter ?? 0,
            }));
            setWalletRng(Number(playerState.chips ?? currentChipsRef.current));
            setWalletVusdt(Number(playerState.vusdtBalance ?? 0));
            setWalletCredits(Number(playerState.freerollCredits ?? 0));
            setWalletCreditsLocked(Number(playerState.freerollCreditsLocked ?? 0));
          }
        }

        const sessionId = currentSessionIdRef.current;
        console.error('[qa-poll] Fallback poll, sessionId:', sessionId?.toString() ?? 'null');
        if (sessionId !== null && client?.getCasinoSession) {
          const session = await client.getCasinoSession(sessionId);
          console.error('[qa-poll] getCasinoSession result:', session ? 'exists' : 'null/undefined');
          if (session?.stateBlob) {
            const frontendType =
              CHAIN_TO_FRONTEND_GAME_TYPE[session.gameType as ChainGameType] ??
              gameTypeRef.current ??
              GameType.NONE;
            const prevMoveNumber = gameStateRef.current?.moveNumber ?? 0;
            const nextMoveNumber = Number(session.moveCount ?? prevMoveNumber);
            const moveAdvanced = nextMoveNumber > prevMoveNumber;
            applySessionMeta(sessionId, nextMoveNumber);
            parseGameState(session.stateBlob, frontendType);
            if (moveAdvanced) {
              clearChainResponseTimeout();
              isPendingRef.current = false;
              pendingMoveCountRef.current = 0;
              crapsPendingRollLogRef.current = null;
              crapsChainRollLogRef.current = null;
            }
            // Preserve parsed stage/message instead of forcing PLAYING/SYNCED,
            // which can disable betting or actions when the session is in BETTING/RESULT.
            const sessionBetRaw =
              typeof session.bet === 'bigint'
                ? Number(session.bet)
                : (session.bet ?? null);
            const isTableGame =
              frontendType === GameType.BACCARAT
              || frontendType === GameType.CRAPS
              || frontendType === GameType.ROULETTE
              || frontendType === GameType.SIC_BO;
            const shouldSyncBet =
              sessionBetRaw !== null
              && Number.isFinite(sessionBetRaw)
              && (sessionBetRaw > 0 || !isTableGame);
            setGameState((prev) => ({
              ...prev,
              type: frontendType,
              sessionId: Number(sessionId),
              bet: shouldSyncBet ? Number(sessionBetRaw) : prev.bet,
              superMode: session.superMode ?? prev.superMode ?? null,
            }));
          } else if (!session) {
            // Session was deleted (game completed on chain) - transition to RESULT
            // This handles the case where WebSocket CasinoGameCompleted event wasn't received
            // BUT: Don't reset if:
            // - We're still waiting for the game to start (session pending on chain)
            // - There's a pending transaction (waiting for confirmation)
            const currentStage = gameStateRef.current?.stage;
            const hasPending = isPendingRef.current || pendingMoveCountRef.current > 0;
            console.error('[qa-poll] Session not found! stage:', currentStage, 'hasPending:', hasPending);
            if (currentStage === 'PLAYING' && !hasPending) {
              console.error('[qa-poll] Game was PLAYING with no pending tx, setting currentSessionIdRef to null');
              logDebug('[useChainEvents] Session deleted on chain, transitioning to RESULT');
              currentSessionIdRef.current = null;
              setGameState((prev) => ({
                ...prev,
                stage: 'RESULT',
                sessionId: null,
                message: prev.message?.includes('SYNCED') ? 'ROUND COMPLETE' : prev.message,
                moveNumber: 0,
                sessionWager: 0,
                sessionInterimPayout: 0,
                superMode: null,
              }));
            }
          }
        }
      } catch (error) {
        logDebug('[useChainEvents] Poll fallback failed:', error);
      }
    };

    const interval = setInterval(poll, 2_000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    applySessionMeta,
    clearChainResponseTimeout,
    clientRef,
    currentChipsRef,
    currentSessionIdRef,
    gameStateRef,
    gameTypeRef,
    isOnChain,
    lastBalanceUpdateRef,
    parseGameState,
    publicKeyBytesRef,
    setGameState,
    setStats,
    setWalletCredits,
    setWalletCreditsLocked,
    setWalletRng,
    setWalletVusdt,
    isPendingRef,
    pendingMoveCountRef,
    crapsPendingRollLogRef,
    crapsChainRollLogRef,
  ]);

  useEffect(() => {
    const client = clientRef.current as any;
    if (!client) return;

     void (async () => {
       try {
         if (!isOnChain) {
           await client.disconnectSessionUpdates?.();
           return;
         }
         if (currentSessionId) {
           await client.switchSessionUpdates(currentSessionId);
         } else {
           await client.disconnectSessionUpdates?.();
         }
       } catch (e) {
         logDebug('[useChainEvents] Session updates sync failed:', e);
       }
     })();

     return () => {
       try {
         client.disconnectSessionUpdates?.();
       } catch {
         // ignore
       }
     };
   }, [currentSessionId, isOnChain, clientRef]);
};
