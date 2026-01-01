import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { GameType } from '../../types';
import type {
  AutoPlayDraft,
  AutoPlayPlan,
  BaccaratBet,
  CrapsBet,
  GameState,
  LeaderboardEntry,
  PlayerStats,
  TournamentPhase,
} from '../../types';
import type { CasinoClient } from '../../api/client';
import { CasinoChainService } from '../../services/CasinoChainService';
import { BotConfig, DEFAULT_BOT_CONFIG } from '../../services/BotService';
import type { CrapsChainRollLog } from '../../services/games';
import { getCasinoKeyIdForStorage } from '../../security/keyVault';
import { FREEROLL_DAILY_LIMIT_FREE } from './freeroll';
import { createInitialGameState, createInitialStats } from './initialState';
import { logDebug } from '../../utils/logger';

export type TerminalGameRefs = {
  playModeRef: MutableRefObject<'CASH' | 'FREEROLL' | null>;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  gameTypeRef: MutableRefObject<GameType>;
  baccaratSelectionRef: MutableRefObject<'PLAYER' | 'BANKER'>;
  baccaratBetsRef: MutableRefObject<BaccaratBet[]>;
  gameStateRef: MutableRefObject<GameState | null>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  uthBackendStageRef: MutableRefObject<number>;
  sessionStartChipsRef: MutableRefObject<Map<bigint, number>>;
  crapsPendingRollLogRef: MutableRefObject<{
    sessionId: bigint;
    prevDice: [number, number] | null;
    point: number | null;
    bets: CrapsBet[];
  } | null>;
  crapsChainRollLogRef: MutableRefObject<{ sessionId: bigint; roll: CrapsChainRollLog } | null>;
  autoPlayDraftRef: MutableRefObject<AutoPlayDraft | null>;
  autoPlayPlanRef: MutableRefObject<AutoPlayPlan | null>;
  clientRef: MutableRefObject<CasinoClient | null>;
  publicKeyBytesRef: MutableRefObject<Uint8Array | null>;
  lastBalanceUpdateRef: MutableRefObject<number>;
  awaitingChainResponseRef: MutableRefObject<boolean>;
  chainResponseTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  currentChipsRef: MutableRefObject<number>;
  lastLeaderboardUpdateRef: MutableRefObject<number>;
  lastPlayerSyncRef: MutableRefObject<number>;
  isRegisteredRef: MutableRefObject<boolean>;
  hasRegisteredRef: MutableRefObject<boolean | null>;
};

export const useTerminalGameState = (playMode: 'CASH' | 'FREEROLL' | null) => {
  const [stats, setStats] = useState<PlayerStats>(createInitialStats);
  const [gameState, setGameState] = useState<GameState>(createInitialGameState);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [tournamentTime, setTournamentTime] = useState(0);
  const [phase, setPhase] = useState<TournamentPhase>('REGISTRATION');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isRegistered, setIsRegistered] = useState(false);
  const isRegisteredRef = useRef(false);
  const [walletRng, setWalletRng] = useState<number | null>(null);
  const [walletVusdt, setWalletVusdt] = useState<number | null>(null);
  const [walletCredits, setWalletCredits] = useState<number | null>(null);
  const [walletCreditsLocked, setWalletCreditsLocked] = useState<number | null>(null);
  const [walletPublicKeyHex, setWalletPublicKeyHex] = useState<string | null>(null);
  const [botConfig, setBotConfig] = useState<BotConfig>(DEFAULT_BOT_CONFIG);
  const [isTournamentStarting, setIsTournamentStarting] = useState(false);
  const [isRegisteringOrJoining, setIsRegisteringOrJoining] = useState(false);
  const [isFaucetClaiming, setIsFaucetClaiming] = useState(false);
  const [manualTournamentEndTime, setManualTournamentEndTime] = useState<number | null>(null);
  const [freerollActiveTournamentId, setFreerollActiveTournamentId] = useState<number | null>(null);
  const [freerollActiveTimeLeft, setFreerollActiveTimeLeft] = useState(0);
  const [freerollActivePrizePool, setFreerollActivePrizePool] = useState<number | null>(null);
  const [freerollActivePlayerCount, setFreerollActivePlayerCount] = useState<number | null>(null);
  const [playerActiveTournamentId, setPlayerActiveTournamentId] = useState<number | null>(null);
  const [freerollNextTournamentId, setFreerollNextTournamentId] = useState<number | null>(null);
  const [freerollNextStartIn, setFreerollNextStartIn] = useState(0);
  const [freerollIsJoinedNext, setFreerollIsJoinedNext] = useState(false);
  const [tournamentsPlayedToday, setTournamentsPlayedToday] = useState(0);
  const [tournamentDailyLimit, setTournamentDailyLimit] = useState(FREEROLL_DAILY_LIMIT_FREE);
  const playModeRef = useRef(playMode);

  const [chainService, setChainService] = useState<CasinoChainService | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<bigint | null>(null);
  const currentSessionIdRef = useRef<bigint | null>(null);
  const gameTypeRef = useRef<GameType>(GameType.NONE);
  const baccaratSelectionRef = useRef<'PLAYER' | 'BANKER'>('PLAYER');
  const baccaratBetsRef = useRef<BaccaratBet[]>([]);
  const gameStateRef = useRef<GameState | null>(null);
  const isPendingRef = useRef<boolean>(false);
  const pendingMoveCountRef = useRef<number>(0);
  const uthBackendStageRef = useRef<number>(0);
  const sessionStartChipsRef = useRef<Map<bigint, number>>(new Map());
  const crapsPendingRollLogRef = useRef<{
    sessionId: bigint;
    prevDice: [number, number] | null;
    point: number | null;
    bets: CrapsBet[];
  } | null>(null);
  const crapsChainRollLogRef = useRef<{ sessionId: bigint; roll: CrapsChainRollLog } | null>(null);
  const autoPlayDraftRef = useRef<AutoPlayDraft | null>(null);
  const autoPlayPlanRef = useRef<AutoPlayPlan | null>(null);
  const [isOnChain, setIsOnChain] = useState(false);
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);

  const clientRef = useRef<CasinoClient | null>(null);
  const publicKeyBytesRef = useRef<Uint8Array | null>(null);
  const lastBalanceUpdateRef = useRef<number>(0);
  const awaitingChainResponseRef = useRef(false);
  const chainResponseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentChipsRef = useRef(stats.chips);
  const lastLeaderboardUpdateRef = useRef(0);
  const lastPlayerSyncRef = useRef(0);

  const hasRegisteredRef = useRef<boolean | null>(null);
  if (hasRegisteredRef.current === null) {
    if (typeof localStorage === 'undefined') {
      hasRegisteredRef.current = false;
    } else {
      const keyId = getCasinoKeyIdForStorage();
      if (keyId) {
        hasRegisteredRef.current = localStorage.getItem(`casino_registered_${keyId}`) === 'true';
        logDebug('[useTerminalGameState] Loaded registration status from localStorage:', hasRegisteredRef.current, 'for key:', keyId.substring(0, 8) + '...');
      } else {
        logDebug('[useTerminalGameState] No key id in localStorage, assuming not registered');
        hasRegisteredRef.current = false;
      }
    }
  }

  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);

  useEffect(() => {
    isRegisteredRef.current = isRegistered;
  }, [isRegistered]);

  useEffect(() => {
    currentChipsRef.current = stats.chips;
  }, [stats.chips]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  return {
    state: {
      stats,
      gameState,
      aiAdvice,
      tournamentTime,
      phase,
      leaderboard,
      isRegistered,
      walletRng,
      walletVusdt,
      walletCredits,
      walletCreditsLocked,
      walletPublicKeyHex,
      botConfig,
      isTournamentStarting,
      isRegisteringOrJoining,
      isFaucetClaiming,
      manualTournamentEndTime,
      freerollActiveTournamentId,
      freerollActiveTimeLeft,
      freerollActivePrizePool,
      freerollActivePlayerCount,
      playerActiveTournamentId,
      freerollNextTournamentId,
      freerollNextStartIn,
      freerollIsJoinedNext,
      tournamentsPlayedToday,
      tournamentDailyLimit,
      chainService,
      currentSessionId,
      isOnChain,
      lastTxSig,
    },
    setters: {
      setStats,
      setGameState,
      setAiAdvice,
      setTournamentTime,
      setPhase,
      setLeaderboard,
      setIsRegistered,
      setWalletRng,
      setWalletVusdt,
      setWalletCredits,
      setWalletCreditsLocked,
      setWalletPublicKeyHex,
      setBotConfig,
      setIsTournamentStarting,
      setIsRegisteringOrJoining,
      setIsFaucetClaiming,
      setManualTournamentEndTime,
      setFreerollActiveTournamentId,
      setFreerollActiveTimeLeft,
      setFreerollActivePrizePool,
      setFreerollActivePlayerCount,
      setPlayerActiveTournamentId,
      setFreerollNextTournamentId,
      setFreerollNextStartIn,
      setFreerollIsJoinedNext,
      setTournamentsPlayedToday,
      setTournamentDailyLimit,
      setChainService,
      setCurrentSessionId,
      setIsOnChain,
      setLastTxSig,
    },
    refs: {
      playModeRef,
      currentSessionIdRef,
      gameTypeRef,
      baccaratSelectionRef,
      baccaratBetsRef,
      gameStateRef,
      isPendingRef,
      pendingMoveCountRef,
      uthBackendStageRef,
      sessionStartChipsRef,
      crapsPendingRollLogRef,
      crapsChainRollLogRef,
      autoPlayDraftRef,
      autoPlayPlanRef,
      clientRef,
      publicKeyBytesRef,
      lastBalanceUpdateRef,
      awaitingChainResponseRef,
      chainResponseTimeoutRef,
      currentChipsRef,
      lastLeaderboardUpdateRef,
      lastPlayerSyncRef,
      isRegisteredRef,
      hasRegisteredRef,
    },
  };
};
