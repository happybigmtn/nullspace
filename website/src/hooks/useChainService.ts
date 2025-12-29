import { useState, useEffect, useRef, useCallback } from 'react';
import { CasinoClient } from '../api/client';
import { WasmWrapper } from '../api/wasm';
import { CasinoChainService } from '../services/CasinoChainService';
import { LeaderboardEntry, GameType } from '../types';
import { GameType as ChainGameType } from '@nullspace/types/casino';

// Reverse mapping from chain game type to frontend game type
const CHAIN_TO_FRONTEND_GAME_TYPE: Record<ChainGameType, GameType> = {
  [ChainGameType.Baccarat]: GameType.BACCARAT,
  [ChainGameType.Blackjack]: GameType.BLACKJACK,
  [ChainGameType.CasinoWar]: GameType.CASINO_WAR,
  [ChainGameType.Craps]: GameType.CRAPS,
  [ChainGameType.VideoPoker]: GameType.VIDEO_POKER,
  [ChainGameType.HiLo]: GameType.HILO,
  [ChainGameType.Roulette]: GameType.ROULETTE,
  [ChainGameType.SicBo]: GameType.SIC_BO,
  [ChainGameType.ThreeCard]: GameType.THREE_CARD,
  [ChainGameType.UltimateHoldem]: GameType.ULTIMATE_HOLDEM,
};

export const useChainService = () => {
  const [chainService, setChainService] = useState<CasinoChainService | null>(null);
  const [client, setClient] = useState<CasinoClient | null>(null);
  const [isOnChain, setIsOnChain] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<bigint | null>(null);
  const currentSessionIdRef = useRef<bigint | null>(null);
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [playerState, setPlayerState] = useState<any | null>(null);
  const [houseState, setHouseState] = useState<any | null>(null);
  
  // Refs to expose to other hooks if needed, or internal use
  const publicKeyBytesRef = useRef<Uint8Array | null>(null);
  
  // Chain response watchdog
  const awaitingChainResponseRef = useRef(false);
  const chainResponseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CHAIN_RESPONSE_TIMEOUT_MS = 15_000;

  useEffect(() => {
    const initChain = async () => {
      try {
        const identityHex = import.meta.env.VITE_IDENTITY as string | undefined;
        if (!identityHex) {
            console.log('[useChainService] No VITE_IDENTITY found, skipping chain init.');
            return;
        }

        // Get base URL from environment or default to /api
        const baseUrl = import.meta.env.VITE_URL || '/api';

        const wasm = new WasmWrapper(identityHex);
        const casinoClient = new CasinoClient(baseUrl, wasm);
        await casinoClient.init();

        const keypair = casinoClient.getOrCreateKeypair();
        if (!keypair) {
            console.log('[useChainService] Failed to get keypair (vault may be locked).');
            return;
        }

        publicKeyBytesRef.current = keypair.publicKey;
        setClient(casinoClient);

        // Verify connection and registration
        try {
          const state = await casinoClient.getCasinoPlayer(keypair.publicKey);
          setPlayerState(state);
        } catch (e: any) {
           console.log('[useChainService] Player check failed:', e);
           // Attempt registration logic could go here if we want to extract it fully
           // For now, mimicking useTerminalGame which just logs warning or tries to register if 404
           if (e.message && e.message.includes('not found')) {
               // Registration logic is skipped here for brevity, assuming standard flow
           }
        }

        // Fetch HouseState
        try {
            const house = await casinoClient.getHouse();
            setHouseState(house);
        } catch (e) {
            console.debug('[useChainService] Failed to fetch house state:', e);
        }

        const service = new CasinoChainService(casinoClient);
        setChainService(service);
        setIsOnChain(true);

        // Initial leaderboard
        try {
            const leaderboardData = await casinoClient.getCasinoLeaderboard();
            if (leaderboardData && leaderboardData.entries) {
                 const myPublicKeyHex = keypair.publicKey
                  ? Array.from(keypair.publicKey).map(b => b.toString(16).padStart(2, '0')).join('')
                  : null;

                const newBoard = leaderboardData.entries.map((entry: { player?: string; name?: string; chips: bigint | number }) => ({
                  name: entry.name || `Player_${entry.player?.substring(0, 8)}`,
                  chips: Number(entry.chips),
                  status: 'ALIVE' as const
                }));
                
                // Highlight YOU
                if (myPublicKeyHex) {
                    const playerIdx = leaderboardData.entries.findIndex(
                        (entry: { player?: string }) => entry.player && entry.player.toLowerCase() === myPublicKeyHex.toLowerCase()
                    );
                    if (playerIdx >= 0) {
                        newBoard[playerIdx].name = `${newBoard[playerIdx].name} (YOU)`;
                    }
                }
                newBoard.sort((a: any, b: any) => b.chips - a.chips);
                setLeaderboard(newBoard);
            }
        } catch (e) {
             console.debug('[useChainService] Failed to fetch initial leaderboard:', e);
        }

      } catch (error) {
        console.error('[useChainService] Failed to initialize chain service:', error);
        setIsOnChain(false);
      }
    };

    initChain();
  }, []);

  const clearChainResponseTimeout = useCallback(() => {
    awaitingChainResponseRef.current = false;
    if (chainResponseTimeoutRef.current) {
      clearTimeout(chainResponseTimeoutRef.current);
      chainResponseTimeoutRef.current = null;
    }
  }, []);

  const armChainResponseTimeout = useCallback((context: string, expectedSessionId?: bigint | null, onTimeout?: () => void) => {
    awaitingChainResponseRef.current = true;
    if (chainResponseTimeoutRef.current) {
      clearTimeout(chainResponseTimeoutRef.current);
    }
    chainResponseTimeoutRef.current = setTimeout(() => {
        void (async () => {
             if (!awaitingChainResponseRef.current) return;
             
             const sessionId = expectedSessionId ?? currentSessionIdRef.current;
             // Timeout logic
             console.warn(`[useChainService] Chain response timeout in context: ${context}`);
             
             // If we have a custom timeout handler (to reset game state etc), call it
             if (onTimeout) onTimeout();
             
             // Default logic from useTerminalGame was:
             // 1. check if session ID is null -> reset
             // 2. check if session ID matches -> fetch session from client
             
             if (sessionId === null || sessionId === undefined) {
                 awaitingChainResponseRef.current = false;
                 setCurrentSessionId(null);
                 currentSessionIdRef.current = null;
                 return;
             }
             
             if (currentSessionIdRef.current !== sessionId) return;
             
             // Fallback fetch
             try {
                 if (client) {
                     const sessionState = await client.getCasinoSession(sessionId);
                     if (!awaitingChainResponseRef.current) return;
                     if (currentSessionIdRef.current !== sessionId) return;
                     
                     if (sessionState && !sessionState.isComplete) {
                         // We are still in the game, so we might need to update game state externally
                         // but useChainService doesn't know about game state details.
                         // So we probably just stop here or signal "recovered".
                         // In useTerminalGame, it updates gameTypeRef etc. 
                     }
                 }
             } catch (e) {
                 console.error('[useChainService] Timeout recovery failed:', e);
             }
             
             awaitingChainResponseRef.current = false;
        })();
    }, CHAIN_RESPONSE_TIMEOUT_MS);
  }, [client]);

  return {
    chainService,
    client,
    isOnChain,
    currentSessionId,
    setCurrentSessionId,
    currentSessionIdRef,
    lastTxSig,
    setLastTxSig,
    leaderboard,
    setLeaderboard,
    playerState,
    setPlayerState,
    houseState,
    publicKeyBytesRef,
    armChainResponseTimeout,
    clearChainResponseTimeout
  };
};
