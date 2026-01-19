import { useCallback, useRef } from 'react';
import type { GameType } from '../types';
import { applyGameStateFromBlob } from '../services/games';
import { useTerminalGameState } from './terminalGame/useTerminalGameState';
import { useGameActions } from './terminalGame/useGameActions';
import { useFreerollScheduler } from './terminalGame/useFreerollScheduler';
import { useBotManager } from './terminalGame/useBotManager';
import { runAutoPlayPlanForSession } from './terminalGame/autoPlay';
import { useChainEvents } from './terminalGame/useChainEvents';
import { useChainTimeouts } from './terminalGame/useChainTimeouts';
import { useChainInit } from './terminalGame/useChainInit';
import { useStartGame } from './terminalGame/actions/useStartGame';
import { useBetControls } from './terminalGame/actions/useBetControls';
import { useDeal } from './terminalGame/actions/useDeal';
import { useTournamentActions } from './terminalGame/actions/useTournamentActions';
import {
  BALANCE_UPDATE_COOLDOWN_MS,
  CHAIN_RESPONSE_TIMEOUT_MS,
  PLAYER_SYNC_MIN_INTERVAL_MS,
} from './terminalGame/constants';

export const useTerminalGame = (playMode: 'CASH' | 'FREEROLL' | null = null) => {
  const { state, setters, refs } = useTerminalGameState(playMode);
  const armChainResponseTimeoutRef = useRef<(context: string, expectedSessionId?: bigint | null) => void>(() => {});

  const runAutoPlayForSession = useCallback(
    (sessionId: bigint, frontendGameType: GameType) => {
      runAutoPlayPlanForSession(sessionId, frontendGameType, {
        chainService: state.chainService,
        autoPlayPlanRef: refs.autoPlayPlanRef,
        pendingMoveCountRef: refs.pendingMoveCountRef,
        isPendingRef: refs.isPendingRef,
        currentSessionIdRef: refs.currentSessionIdRef,
        setGameState: setters.setGameState,
        setLastTxSig: setters.setLastTxSig,
        armChainResponseTimeout: armChainResponseTimeoutRef.current,
      });
    },
    [state.chainService, setters.setGameState, setters.setLastTxSig],
  );

  const applySessionMeta = useCallback(
    (sessionId: bigint | null, moveNumber?: number) => {
      const sessionValue = sessionId !== null ? Number(sessionId) : null;
      setters.setGameState((prev) => {
        const next = {
          ...prev,
          sessionId: sessionValue,
          moveNumber: typeof moveNumber === 'number' ? moveNumber : prev.moveNumber,
        };
        refs.gameStateRef.current = next;
        return next;
      });
    },
    [refs.gameStateRef, setters.setGameState],
  );

  // QA helper: Sync sessionId to both state and ref (for HTTP fallback scenarios)
  const syncSessionId = useCallback(
    (sessionId: bigint | null) => {
      refs.currentSessionIdRef.current = sessionId;
      setters.setCurrentSessionId(sessionId);
      const sessionValue = sessionId !== null ? Number(sessionId) : null;
      setters.setGameState((prev) => {
        const next = { ...prev, sessionId: sessionValue };
        refs.gameStateRef.current = next;
        return next;
      });
    },
    [refs.currentSessionIdRef, refs.gameStateRef, setters.setCurrentSessionId, setters.setGameState],
  );

  useFreerollScheduler({
    playMode,
    clientRef: refs.clientRef,
    publicKeyBytesRef: refs.publicKeyBytesRef,
    awaitingChainResponseRef: refs.awaitingChainResponseRef,
    isPendingRef: refs.isPendingRef,
    lastBalanceUpdateRef: refs.lastBalanceUpdateRef,
    balanceUpdateCooldownMs: BALANCE_UPDATE_COOLDOWN_MS,
    currentChipsRef: refs.currentChipsRef,
    lastLeaderboardUpdateRef: refs.lastLeaderboardUpdateRef,
    setStats: setters.setStats,
    setLeaderboard: setters.setLeaderboard,
    setIsRegistered: setters.setIsRegistered,
    hasRegisteredRef: refs.hasRegisteredRef,
    setWalletRng: setters.setWalletRng,
    setWalletVusdt: setters.setWalletVusdt,
    setWalletCredits: setters.setWalletCredits,
    setWalletCreditsLocked: setters.setWalletCreditsLocked,
    setTournamentTime: setters.setTournamentTime,
    setPhase: setters.setPhase,
    setManualTournamentEndTime: setters.setManualTournamentEndTime,
    setFreerollActiveTournamentId: setters.setFreerollActiveTournamentId,
    setFreerollActiveTimeLeft: setters.setFreerollActiveTimeLeft,
    setFreerollActivePrizePool: setters.setFreerollActivePrizePool,
    setFreerollActivePlayerCount: setters.setFreerollActivePlayerCount,
    setPlayerActiveTournamentId: setters.setPlayerActiveTournamentId,
    setFreerollNextTournamentId: setters.setFreerollNextTournamentId,
    setFreerollNextStartIn: setters.setFreerollNextStartIn,
    setFreerollIsJoinedNext: setters.setFreerollIsJoinedNext,
    setTournamentsPlayedToday: setters.setTournamentsPlayedToday,
    setTournamentDailyLimit: setters.setTournamentDailyLimit,
    setIsTournamentStarting: setters.setIsTournamentStarting,
    setLastTxSig: setters.setLastTxSig,
    manualTournamentEndTime: state.manualTournamentEndTime,
    phase: state.phase,
    freerollNextTournamentId: state.freerollNextTournamentId,
    isRegistered: state.isRegistered,
  });

  useBotManager({
    botConfig: state.botConfig,
    playMode,
    phase: state.phase,
    freerollNextTournamentId: state.freerollNextTournamentId,
  });

  const parseGameState = useCallback(
    (stateBlob: Uint8Array | string, gameType?: GameType) => {
      try {
        const currentType = gameType ?? state.gameState.type;
        const fallbackState = refs.gameStateRef.current ?? state.gameState;

        // Convert hex string to Uint8Array if needed (WASM bridge returns hex strings)
        let blobBytes: Uint8Array;
        if (typeof stateBlob === 'string') {
          const hex = stateBlob.startsWith('0x') ? stateBlob.slice(2) : stateBlob;
          blobBytes = new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) ?? []);
        } else {
          blobBytes = stateBlob;
        }

        applyGameStateFromBlob({
          stateBlob: blobBytes,
          gameType: currentType,
          fallbackState,
          setGameState: setters.setGameState,
          gameStateRef: refs.gameStateRef,
          isPendingRef: refs.isPendingRef,
          crapsChainRollLogRef: refs.crapsChainRollLogRef,
          uthBackendStageRef: refs.uthBackendStageRef,
        });
      } catch (error) {
        console.error('[useTerminalGame] Failed to parse state:', error);
      }
    },
    [state.gameState, refs.gameStateRef, refs.isPendingRef, refs.crapsChainRollLogRef, refs.uthBackendStageRef, setters.setGameState],
  );

  useChainInit({
    clientRef: refs.clientRef,
    publicKeyBytesRef: refs.publicKeyBytesRef,
    setChainService: setters.setChainService,
    setIsOnChain: setters.setIsOnChain,
    setGameState: setters.setGameState,
    setStats: setters.setStats,
    setWalletRng: setters.setWalletRng,
    setWalletVusdt: setters.setWalletVusdt,
    setWalletCredits: setters.setWalletCredits,
    setWalletCreditsLocked: setters.setWalletCreditsLocked,
    setWalletPublicKeyHex: setters.setWalletPublicKeyHex,
    setIsRegistered: setters.setIsRegistered,
    hasRegisteredRef: refs.hasRegisteredRef,
    lastBalanceUpdateRef: refs.lastBalanceUpdateRef,
    balanceUpdateCooldownMs: BALANCE_UPDATE_COOLDOWN_MS,
    setLeaderboard: setters.setLeaderboard,
    lastLeaderboardUpdateRef: refs.lastLeaderboardUpdateRef,
    currentSessionIdRef: refs.currentSessionIdRef,
    setCurrentSessionId: setters.setCurrentSessionId,
    applySessionMeta,
    gameTypeRef: refs.gameTypeRef,
    parseGameState,
  });

  const { clearChainResponseTimeout, armChainResponseTimeout, ensureChainResponsive } = useChainTimeouts({
    chainResponseTimeoutMs: CHAIN_RESPONSE_TIMEOUT_MS,
    awaitingChainResponseRef: refs.awaitingChainResponseRef,
    chainResponseTimeoutRef: refs.chainResponseTimeoutRef,
    currentSessionIdRef: refs.currentSessionIdRef,
    setCurrentSessionId: setters.setCurrentSessionId,
    isPendingRef: refs.isPendingRef,
    pendingMoveCountRef: refs.pendingMoveCountRef,
    crapsPendingRollLogRef: refs.crapsPendingRollLogRef,
    crapsChainRollLogRef: refs.crapsChainRollLogRef,
    setGameState: setters.setGameState,
    clientRef: refs.clientRef,
    gameTypeRef: refs.gameTypeRef,
    gameStateRef: refs.gameStateRef,
    parseGameState,
    runAutoPlayForSession,
  });
  armChainResponseTimeoutRef.current = armChainResponseTimeout;

  const startGame = useStartGame({
    gameState: state.gameState,
    setGameState: setters.setGameState,
    setAiAdvice: setters.setAiAdvice,
    setStats: setters.setStats,
    isOnChain: state.isOnChain,
    chainService: state.chainService,
    ensureChainResponsive,
    clearChainResponseTimeout,
    armChainResponseTimeout,
    clientRef: refs.clientRef,
    publicKeyBytesRef: refs.publicKeyBytesRef,
    hasRegisteredRef: refs.hasRegisteredRef,
    setIsRegistered: setters.setIsRegistered,
    lastBalanceUpdateRef: refs.lastBalanceUpdateRef,
    balanceUpdateCooldownMs: BALANCE_UPDATE_COOLDOWN_MS,
    setCurrentSessionId: setters.setCurrentSessionId,
    currentSessionIdRef: refs.currentSessionIdRef,
    gameTypeRef: refs.gameTypeRef,
    sessionStartChipsRef: refs.sessionStartChipsRef,
    currentChipsRef: refs.currentChipsRef,
    pendingMoveCountRef: refs.pendingMoveCountRef,
    isPendingRef: refs.isPendingRef,
    crapsPendingRollLogRef: refs.crapsPendingRollLogRef,
    crapsChainRollLogRef: refs.crapsChainRollLogRef,
    autoPlayDraftRef: refs.autoPlayDraftRef,
    autoPlayPlanRef: refs.autoPlayPlanRef,
    uthBackendStageRef: refs.uthBackendStageRef,
    setLastTxSig: setters.setLastTxSig,
  });

  const { setBetAmount, toggleShield, toggleDouble, toggleSuper, setToLastBet } = useBetControls({
    gameState: state.gameState,
    setGameState: setters.setGameState,
    stats: state.stats,
    chainService: state.chainService,
    isOnChain: state.isOnChain,
    currentSessionIdRef: refs.currentSessionIdRef,
    tournamentTime: state.tournamentTime,
    phase: state.phase,
    playMode,
    setLastTxSig: setters.setLastTxSig,
  });

  const gameActions = useGameActions({
    gameState: state.gameState,
    setGameState: setters.setGameState,
    stats: state.stats,
    setStats: setters.setStats,
    chainService: state.chainService,
    isOnChain: state.isOnChain,
    currentSessionIdRef: refs.currentSessionIdRef,
    isPendingRef: refs.isPendingRef,
    pendingMoveCountRef: refs.pendingMoveCountRef,
    baccaratBetsRef: refs.baccaratBetsRef,
    baccaratSelectionRef: refs.baccaratSelectionRef,
    uthBackendStageRef: refs.uthBackendStageRef,
    autoPlayDraftRef: refs.autoPlayDraftRef,
    armChainResponseTimeout,
    startGame,
    setLastTxSig: setters.setLastTxSig,
  });

  const deal = useDeal({
    gameState: state.gameState,
    setGameState: setters.setGameState,
    stats: state.stats,
    setStats: setters.setStats,
    isOnChain: state.isOnChain,
    chainService: state.chainService,
    currentSessionIdRef: refs.currentSessionIdRef,
    setCurrentSessionId: setters.setCurrentSessionId,
    isPendingRef: refs.isPendingRef,
    pendingMoveCountRef: refs.pendingMoveCountRef,
    awaitingChainResponseRef: refs.awaitingChainResponseRef,
    autoPlayDraftRef: refs.autoPlayDraftRef,
    autoPlayPlanRef: refs.autoPlayPlanRef,
    gameTypeRef: refs.gameTypeRef,
    clientRef: refs.clientRef,
    parseGameState,
    rollCraps: gameActions.rollCraps,
    spinRoulette: gameActions.spinRoulette,
    rollSicBo: gameActions.rollSicBo,
    startGame,
    setLastTxSig: setters.setLastTxSig,
    armChainResponseTimeout,
  });

  const tournamentActions = useTournamentActions({
    playMode,
    clientRef: refs.clientRef,
    publicKeyBytesRef: refs.publicKeyBytesRef,
    hasRegisteredRef: refs.hasRegisteredRef,
    isRegisteringOrJoining: state.isRegisteringOrJoining,
    setIsRegisteringOrJoining: setters.setIsRegisteringOrJoining,
    isFaucetClaiming: state.isFaucetClaiming,
    setIsFaucetClaiming: setters.setIsFaucetClaiming,
    tournamentDailyLimit: state.tournamentDailyLimit,
    tournamentsPlayedToday: state.tournamentsPlayedToday,
    freerollNextTournamentId: state.freerollNextTournamentId,
    setFreerollIsJoinedNext: setters.setFreerollIsJoinedNext,
    setPlayerActiveTournamentId: setters.setPlayerActiveTournamentId,
    setTournamentTime: setters.setTournamentTime,
    setPhase: setters.setPhase,
    setFreerollActiveTournamentId: setters.setFreerollActiveTournamentId,
    setManualTournamentEndTime: setters.setManualTournamentEndTime,
    setFreerollActiveTimeLeft: setters.setFreerollActiveTimeLeft,
    setIsRegistered: setters.setIsRegistered,
    setGameState: setters.setGameState,
    setStats: setters.setStats,
    lastBalanceUpdateRef: refs.lastBalanceUpdateRef,
    balanceUpdateCooldownMs: BALANCE_UPDATE_COOLDOWN_MS,
    setLastTxSig: setters.setLastTxSig,
    gameState: state.gameState,
    stats: state.stats,
    setAiAdvice: setters.setAiAdvice,
  });

  useChainEvents({
    chainService: state.chainService,
    isOnChain: state.isOnChain,
    currentSessionId: state.currentSessionId,
    currentSessionIdRef: refs.currentSessionIdRef,
    setCurrentSessionId: setters.setCurrentSessionId,
    gameTypeRef: refs.gameTypeRef,
    gameStateRef: refs.gameStateRef,
    setGameState: setters.setGameState,
    setStats: setters.setStats,
    stats: state.stats,
    setLeaderboard: setters.setLeaderboard,
    isRegisteredRef: refs.isRegisteredRef,
    hasRegisteredRef: refs.hasRegisteredRef,
    setIsRegistered: setters.setIsRegistered,
    isPendingRef: refs.isPendingRef,
    pendingMoveCountRef: refs.pendingMoveCountRef,
    crapsPendingRollLogRef: refs.crapsPendingRollLogRef,
    crapsChainRollLogRef: refs.crapsChainRollLogRef,
    applySessionMeta,
    parseGameState,
    clearChainResponseTimeout,
    armChainResponseTimeout,
    runAutoPlayForSession,
    clientRef: refs.clientRef,
    publicKeyBytesRef: refs.publicKeyBytesRef,
    setLastTxSig: setters.setLastTxSig,
    lastBalanceUpdateRef: refs.lastBalanceUpdateRef,
    currentChipsRef: refs.currentChipsRef,
    lastLeaderboardUpdateRef: refs.lastLeaderboardUpdateRef,
    sessionStartChipsRef: refs.sessionStartChipsRef,
    playModeRef: refs.playModeRef,
    lastPlayerSyncRef: refs.lastPlayerSyncRef,
    playerSyncMinIntervalMs: PLAYER_SYNC_MIN_INTERVAL_MS,
    setWalletRng: setters.setWalletRng,
    setWalletVusdt: setters.setWalletVusdt,
    setWalletCredits: setters.setWalletCredits,
    setWalletCreditsLocked: setters.setWalletCreditsLocked,
  });

  return {
    stats: state.stats,
    gameState: state.gameState,
    setGameState: setters.setGameState,
    aiAdvice: state.aiAdvice,
    tournamentTime: state.tournamentTime,
    phase: state.phase,
    leaderboard: state.leaderboard,
    isRegistered: state.isRegistered,
    walletRng: state.walletRng,
    walletVusdt: state.walletVusdt,
    walletCredits: state.walletCredits,
    walletCreditsLocked: state.walletCreditsLocked,
    walletPublicKeyHex: state.walletPublicKeyHex,
    lastTxSig: state.lastTxSig,
    isOnChain: state.isOnChain,
    botConfig: state.botConfig,
    setBotConfig: setters.setBotConfig,
    isTournamentStarting: state.isTournamentStarting,
    isRegisteringOrJoining: state.isRegisteringOrJoining,
    isFaucetClaiming: state.isFaucetClaiming,
    freerollActiveTournamentId: state.freerollActiveTournamentId,
    freerollActiveTimeLeft: state.freerollActiveTimeLeft,
    freerollActivePrizePool: state.freerollActivePrizePool,
    freerollActivePlayerCount: state.freerollActivePlayerCount,
    playerActiveTournamentId: state.playerActiveTournamentId,
    freerollNextTournamentId: state.freerollNextTournamentId,
    freerollNextStartIn: state.freerollNextStartIn,
    freerollIsJoinedNext: state.freerollIsJoinedNext,
    tournamentsPlayedToday: state.tournamentsPlayedToday,
    tournamentDailyLimit: state.tournamentDailyLimit,
    actions: {
      startGame,
      setBetAmount,
      setToLastBet, // LUX-013: For REBET functionality
      toggleShield,
      toggleDouble,
      toggleSuper,
      deal,
      syncSessionId, // QA: Sync sessionId to both ref and state for HTTP fallback
      ...gameActions,
      ...tournamentActions,
    },
  };
};
