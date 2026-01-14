import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, PlayerStats, GameType } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';
import { BlackjackMove } from '@nullspace/constants';

interface UseBlackjackProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  chainService: CasinoChainService | null;
  isOnChain: boolean;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  setLastTxSig: (sig: string | null) => void;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
}

export const useBlackjack = ({
  gameState,
  setGameState,
  stats,
  chainService,
  isOnChain,
  currentSessionIdRef,
  isPendingRef,
  setLastTxSig,
  armChainResponseTimeout,
}: UseBlackjackProps) => {

  const bjHit = useCallback(async () => {
    if (isPendingRef.current) {
      return;
    }
    if (!gameState.blackjackActions?.canHit) {
      setGameState(prev => ({ ...prev, message: 'CANNOT HIT' }));
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([BlackjackMove.Hit]));
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('BLACKJACK HIT', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'HITTING...' }));
        return;
      } catch (error) {
        console.error('[useBlackjack] Hit failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    // Local mode not supported - require on-chain session
    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [gameState.blackjackActions, isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState, armChainResponseTimeout]);

  const bjStand = useCallback(async () => {
    if (isPendingRef.current) {
      return;
    }
    if (!gameState.blackjackActions?.canStand) {
      setGameState(prev => ({ ...prev, message: 'CANNOT STAND' }));
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([BlackjackMove.Stand]));
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('BLACKJACK STAND', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'STANDING...' }));
        return;
      } catch (error) {
        console.error('[useBlackjack] Stand failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    // Local mode not supported - require on-chain session
    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [gameState.blackjackActions, isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState, armChainResponseTimeout]);

  const bjDouble = useCallback(async () => {
    if (isPendingRef.current) {
      return;
    }
    if (!gameState.blackjackActions?.canDouble) {
      setGameState(prev => ({ ...prev, message: 'CANNOT DOUBLE' }));
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([BlackjackMove.Double]));
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('BLACKJACK DOUBLE', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'DOUBLING...' }));
        return;
      } catch (error) {
        console.error('[useBlackjack] Double failed:', error);
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        isPendingRef.current = false;
        return;
      }
    }

    // Local mode not supported - require on-chain session
    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [gameState.blackjackActions, isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState, armChainResponseTimeout]);

  const bjSplit = useCallback(async () => {
    if (!gameState.blackjackActions?.canSplit) {
      setGameState(prev => ({ ...prev, message: 'CANNOT SPLIT' }));
      return;
    }
    if (stats.chips < gameState.bet) {
      setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS TO SPLIT' }));
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        if (isPendingRef.current) {
          return;
        }
        isPendingRef.current = true;
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([BlackjackMove.Split]));
        if (result.txHash) setLastTxSig(result.txHash);
        armChainResponseTimeout('BLACKJACK SPLIT', currentSessionIdRef.current);
        setGameState(prev => ({ ...prev, message: 'SPLITTING...' }));
        return;
      } catch (error) {
        console.error('[useBlackjack] Split failed:', error);
        isPendingRef.current = false;
        setGameState(prev => ({ ...prev, message: 'SPLIT FAILED' }));
        return;
      }
    }

    // Local mode not supported - require on-chain session
    setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [gameState.blackjackActions, gameState.bet, stats.chips, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState, armChainResponseTimeout]);

  const bjInsurance = useCallback((take: boolean) => {
    // Insurance is only available on-chain via chain events
    if (!isOnChain) {
      setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
      return;
    }
    // On-chain insurance is handled via game flow, just acknowledge the choice
    setGameState(prev => ({ ...prev, message: take ? "INSURANCE TAKEN" : "INSURANCE DECLINED" }));
  }, [isOnChain, setGameState]);

  type BlackjackSideBetKey =
    | 'blackjack21Plus3Bet'
    | 'blackjackLuckyLadiesBet'
    | 'blackjackPerfectPairsBet'
    | 'blackjackBustItBet'
    | 'blackjackRoyalMatchBet';

  const toggleSideBet = useCallback(
    (key: BlackjackSideBetKey, label: string) => {
      if (gameState.type !== GameType.BLACKJACK) return;
      const prevAmount = Number(gameState[key] ?? 0);
      const nextAmount = prevAmount > 0 ? 0 : gameState.bet;

      if (gameState.stage !== 'BETTING') {
        setGameState(prev => ({ ...prev, message: `${label} CLOSED` }));
        return;
      }

      const currentSideBets =
        Number(gameState.blackjack21Plus3Bet || 0)
        + Number(gameState.blackjackLuckyLadiesBet || 0)
        + Number(gameState.blackjackPerfectPairsBet || 0)
        + Number(gameState.blackjackBustItBet || 0)
        + Number(gameState.blackjackRoyalMatchBet || 0);
      const nextSideBetsTotal = currentSideBets - prevAmount + nextAmount;
      const projectedWager = Number(gameState.bet || 0) + nextSideBetsTotal;
      if (projectedWager > stats.chips) {
        setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
        return;
      }

      setGameState(prev => ({
        ...(prev as GameState),
        [key]: nextAmount,
        message: nextAmount > 0 ? `${label} +$${nextAmount}` : `${label} OFF`,
      }));
    },
    [
      gameState.type,
      gameState.stage,
      gameState.bet,
      gameState.blackjack21Plus3Bet,
      gameState.blackjackLuckyLadiesBet,
      gameState.blackjackPerfectPairsBet,
      gameState.blackjackBustItBet,
      gameState.blackjackRoyalMatchBet,
      stats.chips,
      gameState,
      setGameState,
    ]
  );

  const bjToggle21Plus3 = useCallback(() => toggleSideBet('blackjack21Plus3Bet', '21+3'), [toggleSideBet]);
  const bjToggleLuckyLadies = useCallback(() => toggleSideBet('blackjackLuckyLadiesBet', 'LUCKY LADIES'), [toggleSideBet]);
  const bjTogglePerfectPairs = useCallback(() => toggleSideBet('blackjackPerfectPairsBet', 'PERFECT PAIRS'), [toggleSideBet]);
  const bjToggleBustIt = useCallback(() => toggleSideBet('blackjackBustItBet', 'BUST IT'), [toggleSideBet]);
  const bjToggleRoyalMatch = useCallback(() => toggleSideBet('blackjackRoyalMatchBet', 'ROYAL MATCH'), [toggleSideBet]);

  return {
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
  };
};
