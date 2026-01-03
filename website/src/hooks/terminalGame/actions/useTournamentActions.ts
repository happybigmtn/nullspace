import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GameState, PlayerStats, TournamentPhase } from '../../../types';
import type { CasinoClient } from '../../../api/client';
import { getStrategicAdvice } from '../../../services/geminiService';
import { syncFreerollLimit } from '../../../services/authClient';
import { getCasinoKeyIdForStorage } from '../../../security/keyVault';
import { FREEROLL_DAILY_LIMIT_FREE, getFreerollSchedule } from '../freeroll';
import { logDebug } from '../../../utils/logger';

interface UseTournamentActionsArgs {
  playMode: 'CASH' | 'FREEROLL' | null;
  clientRef: MutableRefObject<CasinoClient | null>;
  publicKeyBytesRef: MutableRefObject<Uint8Array | null>;
  hasRegisteredRef: MutableRefObject<boolean | null>;
  isRegisteringOrJoining: boolean;
  setIsRegisteringOrJoining: Dispatch<SetStateAction<boolean>>;
  isFaucetClaiming: boolean;
  setIsFaucetClaiming: Dispatch<SetStateAction<boolean>>;
  tournamentDailyLimit: number;
  tournamentsPlayedToday: number;
  freerollNextTournamentId: number | null;
  setFreerollIsJoinedNext: Dispatch<SetStateAction<boolean>>;
  setPlayerActiveTournamentId: Dispatch<SetStateAction<number | null>>;
  setTournamentTime: Dispatch<SetStateAction<number>>;
  setPhase: Dispatch<SetStateAction<TournamentPhase>>;
  setFreerollActiveTournamentId: Dispatch<SetStateAction<number | null>>;
  setManualTournamentEndTime: Dispatch<SetStateAction<number | null>>;
  setFreerollActiveTimeLeft: Dispatch<SetStateAction<number>>;
  setIsRegistered: Dispatch<SetStateAction<boolean>>;
  setGameState: Dispatch<SetStateAction<GameState>>;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  lastBalanceUpdateRef: MutableRefObject<number>;
  balanceUpdateCooldownMs: number;
  setLastTxSig: (sig: string | null) => void;
  gameState: GameState;
  stats: PlayerStats;
  setAiAdvice: Dispatch<SetStateAction<string | null>>;
}

export const useTournamentActions = ({
  playMode,
  clientRef,
  publicKeyBytesRef,
  hasRegisteredRef,
  isRegisteringOrJoining,
  setIsRegisteringOrJoining,
  isFaucetClaiming,
  setIsFaucetClaiming,
  tournamentDailyLimit,
  tournamentsPlayedToday,
  freerollNextTournamentId,
  setFreerollIsJoinedNext,
  setPlayerActiveTournamentId,
  setTournamentTime,
  setPhase,
  setFreerollActiveTournamentId,
  setManualTournamentEndTime,
  setFreerollActiveTimeLeft,
  setIsRegistered,
  setGameState,
  setStats,
  lastBalanceUpdateRef,
  balanceUpdateCooldownMs,
  setLastTxSig,
  gameState,
  stats,
  setAiAdvice,
}: UseTournamentActionsArgs) => {
  const registerForTournament = useCallback(async () => {
    const client: any = clientRef.current;
    if (!client || !client.nonceManager || !publicKeyBytesRef.current) {
      console.warn('[useTournamentActions] Cannot register/join - client not initialized');
      setGameState(prev => ({ ...prev, message: 'CONNECT WALLET / START validators' }));
      return;
    }
    if (isRegisteringOrJoining) return;

    setIsRegisteringOrJoining(true);
    try {
      if (!hasRegisteredRef.current) {
        const playerName = `Player_${Date.now().toString(36)}`;
        await client.nonceManager.submitCasinoRegister(playerName);
        hasRegisteredRef.current = true;
        const keyId = getCasinoKeyIdForStorage();
        if (keyId) {
          localStorage.setItem(`casino_registered_${keyId}`, 'true');
        }
      }
      setIsRegistered(true);

      const syncFreerollLimitWithRetry = async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await syncFreerollLimit();
            if (result.status !== 'player_not_found') {
              return;
            }
          } catch (error) {
            logDebug('[useTournamentActions] Freeroll limit sync failed:', error);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      };
      void syncFreerollLimitWithRetry();

      if (playMode === 'FREEROLL') {
        const maxEntries =
          tournamentDailyLimit > 0 ? tournamentDailyLimit : FREEROLL_DAILY_LIMIT_FREE;
        if (tournamentsPlayedToday >= maxEntries) {
          setGameState((prev) => ({
            ...prev,
            message: `DAILY LIMIT REACHED (${tournamentsPlayedToday}/${maxEntries})`,
          }));
          return;
        }
        const now = Date.now();
        const scheduleNow = getFreerollSchedule(now);
        const defaultNextTid = scheduleNow.isRegistration ? scheduleNow.tournamentId : scheduleNow.tournamentId + 1;
        let tid = freerollNextTournamentId ?? defaultNextTid;

        try {
          const existing = await client.getCasinoTournament(tid);
          if (existing && existing.phase && existing.phase !== 'Registration') {
            tid += 1;
          }
        } catch {
          // ignore
        }

        setGameState(prev => ({ ...prev, message: `JOINING TOURNAMENT ${tid}...` }));
        const result = await client.nonceManager.submitCasinoJoinTournament(tid);
        if (result?.txHash) setLastTxSig(result.txHash);

        let joined = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 300));
          try {
            const ps = await client.getCasinoPlayer(publicKeyBytesRef.current!);
            const activeTid = ps?.activeTournament != null ? Number(ps.activeTournament) : null;
            setPlayerActiveTournamentId(activeTid);
            if (activeTid === tid) {
              joined = true;
              setFreerollIsJoinedNext(true);
              break;
            }
          } catch {
            // ignore
          }
        }

        setGameState(prev => ({
          ...prev,
          message: joined ? `JOINED TOURNAMENT ${tid}` : `JOIN SUBMITTED (${tid})`,
        }));
      } else {
        setGameState(prev => ({ ...prev, message: 'REGISTERED' }));
      }

      setTimeout(async () => {
        try {
          const playerState = await client.getCasinoPlayer(publicKeyBytesRef.current!);
          if (playerState) {
            const timeSinceLastUpdate = Date.now() - lastBalanceUpdateRef.current;
            const shouldUpdateBalance = timeSinceLastUpdate > balanceUpdateCooldownMs;

            setStats(prev => ({
              ...prev,
              chips: shouldUpdateBalance ? playerState.chips : prev.chips,
              shields: playerState.shields,
              doubles: playerState.doubles,
              auraMeter: playerState.auraMeter ?? prev.auraMeter ?? 0,
              history: [],
              pnlByGame: {},
              pnlHistory: [],
            }));
          }
        } catch (e) {
          console.warn('[useTournamentActions] Failed to fetch player state after register/join:', e);
        }
      }, 750);
    } catch (e) {
      console.error('[useTournamentActions] Register/join failed:', e);
      setGameState(prev => ({ ...prev, message: 'REGISTER/JOIN FAILED' }));
    } finally {
      setIsRegisteringOrJoining(false);
    }
  }, [
    balanceUpdateCooldownMs,
    clientRef,
    freerollNextTournamentId,
    hasRegisteredRef,
    isRegisteringOrJoining,
    lastBalanceUpdateRef,
    playMode,
    publicKeyBytesRef,
    setFreerollIsJoinedNext,
    setGameState,
    setIsRegistered,
    setIsRegisteringOrJoining,
    setLastTxSig,
    setPlayerActiveTournamentId,
    setStats,
    tournamentDailyLimit,
    tournamentsPlayedToday,
  ]);

  const claimFaucet = useCallback(async () => {
    if (isFaucetClaiming) return;

    const client = clientRef.current as any;
    if (!client || !client.nonceManager) {
      console.warn('[useTournamentActions] Cannot claim faucet - client not initialized');
      return;
    }
    if (!publicKeyBytesRef.current) {
      console.warn('[useTournamentActions] Cannot claim faucet - public key not initialized');
      return;
    }

    setIsFaucetClaiming(true);
    try {
      if (!hasRegisteredRef.current) {
        const playerName = `Player_${Date.now().toString(36)}`;
        await client.nonceManager.submitCasinoRegister(playerName);
        hasRegisteredRef.current = true;
        setIsRegistered(true);
        const keyId = getCasinoKeyIdForStorage();
        if (keyId) {
          localStorage.setItem(`casino_registered_${keyId}`, 'true');
        }
      }

      const amount = 1000;
      const result = await client.nonceManager.submitCasinoDeposit(amount);
      if (result?.txHash) setLastTxSig(result.txHash);
      setGameState(prev => ({ ...prev, message: 'FAUCET CLAIMED' }));

      setTimeout(async () => {
        try {
          const playerState = await client.getCasinoPlayer(publicKeyBytesRef.current!);
          if (playerState) {
            setStats(prev => ({
              ...prev,
              chips: playerState.chips,
              shields: playerState.shields,
              doubles: playerState.doubles,
              auraMeter: playerState.auraMeter ?? prev.auraMeter ?? 0,
            }));
          }
        } catch (e) {
          logDebug('[useTournamentActions] Failed to sync player state after faucet:', e);
        }
      }, 750);
    } catch (e) {
      console.error('[useTournamentActions] Faucet claim failed:', e);
      setGameState(prev => ({ ...prev, message: 'FAUCET FAILED' }));
    } finally {
      setIsFaucetClaiming(false);
    }
  }, [
    clientRef,
    hasRegisteredRef,
    isFaucetClaiming,
    publicKeyBytesRef,
    setGameState,
    setIsFaucetClaiming,
    setIsRegistered,
    setLastTxSig,
    setStats,
  ]);

  const startTournament = useCallback(async () => {
    console.warn('[useTournamentActions] startTournament() is deprecated; freerolls auto-schedule.');
  }, []);

  const enterTournament = useCallback(async () => {
    const client: any = clientRef.current;
    if (!client || !publicKeyBytesRef.current) return;

    try {
      const playerState = await client.getCasinoPlayer(publicKeyBytesRef.current);
      const tidRaw = playerState?.activeTournament ?? null;
      const tid = tidRaw === null || tidRaw === undefined ? null : Number(tidRaw);
      if (tid === null || !Number.isFinite(tid)) {
        setGameState(prev => ({ ...prev, message: 'NOT IN A TOURNAMENT' }));
        return;
      }

      const tournament = await client.getCasinoTournament(tid);
      if (!tournament) {
        setGameState(prev => ({ ...prev, message: `TOURNAMENT ${tid} NOT FOUND` }));
        return;
      }

      if (tournament.phase !== 'Active') {
        setGameState(prev => ({ ...prev, message: `TOURNAMENT ${tid} NOT ACTIVE` }));
        return;
      }

      const endTimeMs = tournament.endTimeMs ? Number(tournament.endTimeMs) : 0;
      setPhase('ACTIVE');
      setFreerollActiveTournamentId(tid);
      setManualTournamentEndTime(endTimeMs > 0 ? endTimeMs : null);
      const timeLeft = endTimeMs > 0 ? Math.max(0, Math.ceil((endTimeMs - Date.now()) / 1000)) : 0;
      setTournamentTime(timeLeft);
      setFreerollActiveTimeLeft(timeLeft);
    } catch (e) {
      logDebug('[useTournamentActions] enterTournament failed:', e);
      setGameState(prev => ({ ...prev, message: 'ENTER TOURNAMENT FAILED' }));
    }
  }, [
    clientRef,
    publicKeyBytesRef,
    setFreerollActiveTimeLeft,
    setFreerollActiveTournamentId,
    setGameState,
    setManualTournamentEndTime,
    setPhase,
    setTournamentTime,
  ]);

  const getAdvice = useCallback(async () => {
    setAiAdvice('Scanning...');
    const advice = await getStrategicAdvice(
      gameState.type,
      gameState.playerCards,
      gameState.dealerCards[0],
      stats.history,
    );
    setAiAdvice(advice);
  }, [gameState.dealerCards, gameState.playerCards, gameState.type, setAiAdvice, stats.history]);

  return {
    registerForTournament,
    claimFaucet,
    startTournament,
    enterTournament,
    getAdvice,
  };
};
