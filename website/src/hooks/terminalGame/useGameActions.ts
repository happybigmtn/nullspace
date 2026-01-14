import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { useThreeCardPoker } from '../games/useThreeCardPoker';
import { useBlackjack } from '../games/useBlackjack';
import { useBaccarat } from '../games/useBaccarat';
import { useCraps } from '../games/useCraps';
import { useRoulette } from '../games/useRoulette';
import { useSicBo } from '../games/useSicBo';
import { useVideoPoker } from '../games/useVideoPoker';
import { useHiLo } from '../games/useHiLo';
import { useCasinoWar } from '../games/useCasinoWar';
import { useUltimateHoldem } from '../games/useUltimateHoldem';
import type { AutoPlayDraft, BaccaratBet, GameState, GameType, PlayerStats } from '../../types';
import type { CasinoChainService } from '../../services/CasinoChainService';

interface UseGameActionsArgs {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  chainService: CasinoChainService | null;
  isOnChain: boolean;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  baccaratBetsRef: MutableRefObject<BaccaratBet[]>;
  baccaratSelectionRef: MutableRefObject<'PLAYER' | 'BANKER'>;
  uthBackendStageRef: MutableRefObject<number>;
  autoPlayDraftRef: MutableRefObject<AutoPlayDraft | null>;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
  startGame: (type: GameType) => Promise<void> | void;
  setLastTxSig: (sig: string | null) => void;
}

export const useGameActions = ({
  gameState,
  setGameState,
  stats,
  setStats,
  chainService,
  isOnChain,
  currentSessionIdRef,
  isPendingRef,
  pendingMoveCountRef,
  baccaratBetsRef,
  baccaratSelectionRef,
  uthBackendStageRef,
  autoPlayDraftRef,
  armChainResponseTimeout,
  startGame,
  setLastTxSig,
}: UseGameActionsArgs) => {
  const forceSyncNonce = useCallback(async () => {
    if (!chainService) return;
    if (typeof (chainService as any).forceSyncNonce === 'function') {
      await (chainService as any).forceSyncNonce();
    }
  }, [chainService]);

  // Expose getPlayerState for QA harness HTTP fallback when WS fails
  const getPlayerState = useCallback(async () => {
    if (!chainService) return null;
    if (typeof (chainService as any).getPlayerState === 'function') {
      return (chainService as any).getPlayerState();
    }
    return null;
  }, [chainService]);
  const {
    threeCardPlay,
    threeCardFold,
    threeCardTogglePairPlus,
    threeCardToggleSixCardBonus,
    threeCardToggleProgressive,
  } = useThreeCardPoker({
    gameState,
    setGameState,
    stats,
    setStats,
    chainService,
    isOnChain,
    currentSessionIdRef,
    isPendingRef,
    armChainResponseTimeout,
    setLastTxSig,
  });

  const {
    bjHit,
    bjStand,
    bjDouble,
    bjSplit,
    bjInsurance,
    bjToggle21Plus3,
    bjToggleLuckyLadies,
    bjTogglePerfectPairs,
    bjToggleBustIt,
    bjToggleRoyalMatch,
  } = useBlackjack({
    gameState,
    setGameState,
    stats,
    setStats,
    chainService,
    isOnChain,
    currentSessionIdRef,
    isPendingRef,
    armChainResponseTimeout,
    setLastTxSig,
  });

  const {
    toggleSelection: baccaratToggleSelection,
    placeBet: baccaratPlaceBet,
    undo: baccaratUndo,
    rebet: baccaratRebet,
  } = useBaccarat({
    gameState,
    setGameState,
    stats,
    setStats,
    baccaratBetsRef,
    baccaratSelectionRef,
  });

  const {
    placeCrapsBet,
    undoCrapsBet,
    rebetCraps,
    placeCrapsNumberBet,
    addCrapsOdds,
    rollCraps,
  } = useCraps({
    gameState,
    setGameState,
    stats,
    setStats,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    pendingMoveCountRef,
    armChainResponseTimeout,
    setLastTxSig,
    isOnChain,
    startGame,
    autoPlayDraftRef,
  });

  const {
    placeRouletteBet,
    cycleRouletteZeroRule,
    undoRouletteBet,
    rebetRoulette,
    spinRoulette,
  } = useRoulette({
    gameState,
    setGameState,
    stats,
    setStats,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    pendingMoveCountRef,
    armChainResponseTimeout,
    setLastTxSig,
    isOnChain,
    startGame,
    autoPlayDraftRef,
  });

  const {
    placeSicBoBet,
    undoSicBoBet,
    rebetSicBo,
    rollSicBo,
  } = useSicBo({
    gameState,
    setGameState,
    stats,
    setStats,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    pendingMoveCountRef,
    armChainResponseTimeout,
    setLastTxSig,
    isOnChain,
    startGame,
    autoPlayDraftRef,
  });

  const { toggleHold, drawVideoPoker } = useVideoPoker({
    gameState,
    setGameState,
    chainService,
    currentSessionIdRef,
    isOnChain,
    setLastTxSig,
    armChainResponseTimeout,
  });

  const { hiloPlay, hiloCashout } = useHiLo({
    gameState,
    setGameState,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    isOnChain,
    setLastTxSig,
    armChainResponseTimeout,
  });

  const { casinoWarToggleTieBet, casinoWarGoToWar, casinoWarSurrender } = useCasinoWar({
    gameState,
    setGameState,
    stats,
    setStats,
    chainService,
    currentSessionIdRef,
    isPendingRef,
    armChainResponseTimeout,
    setLastTxSig,
    isOnChain,
  });

  const { uthToggleTrips, uthToggleSixCardBonus, uthToggleProgressive, uhCheck, uhBet, uhFold } =
    useUltimateHoldem({
      gameState,
      setGameState,
      chainService,
      currentSessionIdRef,
      isPendingRef,
      isOnChain,
      uthBackendStageRef,
      armChainResponseTimeout,
      setLastTxSig,
    });

  return {
    forceSyncNonce,
    getPlayerState,
    bjHit,
    bjStand,
    bjDouble,
    bjSplit,
    bjInsurance,
    bjToggle21Plus3,
    bjToggleLuckyLadies,
    bjTogglePerfectPairs,
    bjToggleBustIt,
    bjToggleRoyalMatch,
    toggleHold,
    drawVideoPoker,
    hiloPlay,
    hiloCashout,
    placeRouletteBet,
    cycleRouletteZeroRule,
    undoRouletteBet,
    rebetRoulette,
    spinRoulette,
    placeSicBoBet,
    undoSicBoBet,
    rebetSicBo,
    rollSicBo,
    placeCrapsBet,
    placeCrapsNumberBet,
    undoCrapsBet,
    rebetCraps,
    addCrapsOdds,
    rollCraps,
    baccaratActions: {
      toggleSelection: baccaratToggleSelection,
      placeBet: baccaratPlaceBet,
      undo: baccaratUndo,
      rebet: baccaratRebet,
    },
    threeCardTogglePairPlus,
    threeCardToggleSixCardBonus,
    threeCardToggleProgressive,
    threeCardPlay,
    threeCardFold,
    casinoWarToggleTieBet,
    casinoWarGoToWar,
    casinoWarSurrender,
    uthToggleTrips,
    uthToggleSixCardBonus,
    uthToggleProgressive,
    uhCheck,
    uhBet,
    uhFold,
  };
};
