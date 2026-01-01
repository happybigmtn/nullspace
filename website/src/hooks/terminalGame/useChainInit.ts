import { useEffect, useRef } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { GameState, GameType, LeaderboardEntry, PlayerStats } from '../../types';
import { GameType as ChainGameType } from '@nullspace/types/casino';
import { WasmWrapper } from '../../api/wasm';
import { CasinoClient } from '../../api/client';
import { CasinoChainService } from '../../services/CasinoChainService';
import { CHAIN_TO_FRONTEND_GAME_TYPE } from '../../services/games';
import { logDebug } from '../../utils/logger';
import { getCasinoKeyIdForStorage } from '../../security/keyVault';

type UseChainInitArgs = {
  clientRef: MutableRefObject<CasinoClient | null>;
  publicKeyBytesRef: MutableRefObject<Uint8Array | null>;
  setChainService: Dispatch<SetStateAction<CasinoChainService | null>>;
  setIsOnChain: Dispatch<SetStateAction<boolean>>;
  setGameState: Dispatch<SetStateAction<GameState>>;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  setWalletRng: Dispatch<SetStateAction<number | null>>;
  setWalletVusdt: Dispatch<SetStateAction<number | null>>;
  setWalletCredits: Dispatch<SetStateAction<number | null>>;
  setWalletCreditsLocked: Dispatch<SetStateAction<number | null>>;
  setWalletPublicKeyHex: Dispatch<SetStateAction<string | null>>;
  setIsRegistered: Dispatch<SetStateAction<boolean>>;
  hasRegisteredRef: MutableRefObject<boolean | null>;
  lastBalanceUpdateRef: MutableRefObject<number>;
  balanceUpdateCooldownMs: number;
  setLeaderboard: Dispatch<SetStateAction<LeaderboardEntry[]>>;
  lastLeaderboardUpdateRef: MutableRefObject<number>;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  setCurrentSessionId: Dispatch<SetStateAction<bigint | null>>;
  applySessionMeta: (sessionId: bigint | null, moveNumber?: number) => void;
  gameTypeRef: MutableRefObject<GameType>;
  parseGameState: (stateBlob: Uint8Array, gameType?: GameType) => void;
};

export const useChainInit = ({
  clientRef,
  publicKeyBytesRef,
  setChainService,
  setIsOnChain,
  setGameState,
  setStats,
  setWalletRng,
  setWalletVusdt,
  setWalletCredits,
  setWalletCreditsLocked,
  setWalletPublicKeyHex,
  setIsRegistered,
  hasRegisteredRef,
  lastBalanceUpdateRef,
  balanceUpdateCooldownMs,
  setLeaderboard,
  lastLeaderboardUpdateRef,
  currentSessionIdRef,
  setCurrentSessionId,
  applySessionMeta,
  gameTypeRef,
  parseGameState,
}: UseChainInitArgs) => {
  const didInitRef = useRef(false);

  useEffect(() => {
    if (didInitRef.current) {
      return;
    }
    didInitRef.current = true;

    const initChain = async () => {
      try {
        const networkIdentity = import.meta.env.VITE_IDENTITY as string | undefined;
        const wasm = new WasmWrapper(networkIdentity);
        await wasm.init();
        const client = new CasinoClient('/api', wasm);
        await client.init();

        const keypair = client.getOrCreateKeypair();
        if (!keypair) {
          console.warn('[useChainInit] No keypair available (vault locked?)');
          setIsOnChain(false);
          setGameState(prev => ({
            ...prev,
            stage: 'BETTING',
            message: 'UNLOCK VAULT — OPEN VAULT TAB',
          }));
          return;
        }
        logDebug('[useChainInit] Keypair initialized, public key:', keypair.publicKeyHex);
        setWalletPublicKeyHex(keypair.publicKeyHex);

        clientRef.current = client;
        publicKeyBytesRef.current = keypair.publicKey;

        await client.switchUpdates(keypair.publicKey);
        logDebug('[useChainInit] Connected to updates WebSocket');

        const account = await client.getAccount(keypair.publicKey);
        await client.initNonceManager(keypair.publicKeyHex, keypair.publicKey, account);

        try {
          const playerState = await client.getCasinoPlayer(keypair.publicKey);
          if (playerState) {
            const timeSinceLastUpdate = Date.now() - lastBalanceUpdateRef.current;
            const shouldUpdateBalance = timeSinceLastUpdate > balanceUpdateCooldownMs;

            setStats(prev => ({
              ...prev,
              chips: shouldUpdateBalance ? playerState.chips : prev.chips,
              shields: playerState.shields,
              doubles: playerState.doubles,
              auraMeter: playerState.auraMeter ?? prev.auraMeter ?? 0,
            }));
            setWalletRng(prev => (shouldUpdateBalance ? Number(playerState.chips) : prev));
            setWalletVusdt(Number(playerState.vusdtBalance ?? 0));
            setWalletCredits(Number(playerState.freerollCredits ?? 0));
            setWalletCreditsLocked(Number(playerState.freerollCreditsLocked ?? 0));

            if (!shouldUpdateBalance) {
              logDebug('[useChainInit] Skipped balance update from polling (within cooldown)');
            }

            setGameState(prev => ({
              ...prev,
              activeModifiers: {
                shield: playerState.activeShield || false,
                double: playerState.activeDouble || false,
                super: playerState.activeSuper || false,
              }
            }));

            setIsRegistered(true);
            hasRegisteredRef.current = true;

            if (playerState.activeSession) {
              const sessionId = BigInt(playerState.activeSession);
              logDebug('[useChainInit] Found active session:', sessionId.toString());
              try {
                const sessionState = await client.getCasinoSession(sessionId);
                if (sessionState && !sessionState.isComplete) {
                  currentSessionIdRef.current = sessionId;
                  setCurrentSessionId(sessionId);
                  applySessionMeta(sessionId, Number(sessionState.moveCount ?? 0));
                  const frontendGameType = CHAIN_TO_FRONTEND_GAME_TYPE[sessionState.gameType as ChainGameType];
                  if (frontendGameType) {
                    gameTypeRef.current = frontendGameType;
                    setGameState(prev => ({
                      ...prev,
                      type: frontendGameType,
                      bet: Number(sessionState.bet),
                      stage: 'PLAYING',
                      message: 'GAME IN PROGRESS - RESTORED FROM CHAIN',
                      superMode: sessionState.superMode ?? null,
                    }));
                    parseGameState(sessionState.stateBlob, frontendGameType);
                  }
                }
              } catch (sessionError) {
                console.warn('[useChainInit] Failed to fetch session state:', sessionError);
              }
            }
          } else {
            hasRegisteredRef.current = false;
            setIsRegistered(false);
            const keyId = getCasinoKeyIdForStorage();
            if (keyId) {
              localStorage.removeItem(`casino_registered_${keyId}`);
              logDebug('[useChainInit] Cleared localStorage registration flag for key:', keyId.substring(0, 8) + '...');
            }
          }
        } catch (playerError) {
          console.warn('[useChainInit] Failed to fetch player state:', playerError);
        }

        try {
          const house: any = await client.getHouse();
          if (house) {
            setGameState(prev => ({
              ...prev,
              threeCardProgressiveJackpot: Number(house.threeCardProgressiveJackpot ?? prev.threeCardProgressiveJackpot),
              uthProgressiveJackpot: Number(house.uthProgressiveJackpot ?? prev.uthProgressiveJackpot),
            }));
          }
        } catch (houseError) {
          logDebug('[useChainInit] Failed to fetch house state:', houseError);
        }

        const service = new CasinoChainService(client);
        setChainService(service);
        setIsOnChain(true);

        try {
          const leaderboardData = await client.getCasinoLeaderboard();
          if (leaderboardData && leaderboardData.entries) {
            const myPublicKeyHex = keypair.publicKey
              ? Array.from(keypair.publicKey).map(b => b.toString(16).padStart(2, '0')).join('')
              : null;

            const newBoard = leaderboardData.entries.map((entry: { player?: string; name?: string; chips: bigint | number }) => ({
              name: entry.name || `Player_${entry.player?.substring(0, 8)}`,
              chips: Number(entry.chips),
              status: 'ALIVE' as const
            }));

            const isPlayerInBoard = myPublicKeyHex && leaderboardData.entries.some(
              (entry: { player?: string }) => entry.player && entry.player.toLowerCase() === myPublicKeyHex.toLowerCase()
            );

            if (isPlayerInBoard && myPublicKeyHex) {
              const playerIdx = leaderboardData.entries.findIndex(
                (entry: { player?: string }) => entry.player && entry.player.toLowerCase() === myPublicKeyHex.toLowerCase()
              );
              if (playerIdx >= 0) {
                newBoard[playerIdx].name = `${newBoard[playerIdx].name} (YOU)`;
              }
            }

            newBoard.sort((a, b) => b.chips - a.chips);
            setLeaderboard(newBoard);
            lastLeaderboardUpdateRef.current = Date.now();
          }
        } catch (leaderboardError) {
          logDebug('[useChainInit] Failed to fetch initial leaderboard:', leaderboardError);
        }
      } catch (error) {
        console.error('[useChainInit] Failed to initialize chain service:', error);
        setIsOnChain(false);
      }
    };
    void initChain();
  }, [
    applySessionMeta,
    balanceUpdateCooldownMs,
    clientRef,
    currentSessionIdRef,
    gameTypeRef,
    hasRegisteredRef,
    lastBalanceUpdateRef,
    lastLeaderboardUpdateRef,
    parseGameState,
    publicKeyBytesRef,
    setLeaderboard,
    setChainService,
    setCurrentSessionId,
    setGameState,
    setIsOnChain,
    setIsRegistered,
    setStats,
    setWalletCredits,
    setWalletCreditsLocked,
    setWalletPublicKeyHex,
    setWalletRng,
    setWalletVusdt,
  ]);
};
