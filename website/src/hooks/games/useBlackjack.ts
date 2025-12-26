import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, Card, PlayerStats, GameType } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';

interface UseBlackjackProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  deck: Card[];
  setDeck: Dispatch<SetStateAction<Card[]>>;
  chainService: CasinoChainService | null;
  isOnChain: boolean;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  setLastTxSig: (sig: string | null) => void;
}

export const useBlackjack = ({
  gameState,
  setGameState,
  stats,
  chainService,
  isOnChain,
  currentSessionIdRef,
  isPendingRef,
  setLastTxSig
}: UseBlackjackProps) => {

  const bjHit = useCallback(async () => {
    if (isPendingRef.current) {
      console.log('[useBlackjack] Hit blocked - transaction already pending');
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        console.log('[useBlackjack] Set isPending = true, sending move...');
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([0]));
        if (result.txHash) setLastTxSig(result.txHash);
        setGameState(prev => ({ ...prev, message: 'HITTING...' }));
        console.log('[useBlackjack] Move sent successfully, waiting for chain event...');
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
  }, [isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState]);

  const bjStand = useCallback(async () => {
    if (isPendingRef.current) {
      console.log('[useBlackjack] Stand blocked - transaction already pending');
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        console.log('[useBlackjack] Set isPending = true, sending move...');
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([1]));
        if (result.txHash) setLastTxSig(result.txHash);
        setGameState(prev => ({ ...prev, message: 'STANDING...' }));
        console.log('[useBlackjack] Move sent successfully, waiting for chain event...');
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
  }, [isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState]);

  const bjDouble = useCallback(async () => {
    if (isPendingRef.current) {
      console.log('[useBlackjack] Double blocked - transaction already pending');
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        console.log('[useBlackjack] Set isPending = true, sending move...');
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([2]));
        if (result.txHash) setLastTxSig(result.txHash);
        setGameState(prev => ({ ...prev, message: 'DOUBLING...' }));
        console.log('[useBlackjack] Move sent successfully, waiting for chain event...');
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
  }, [isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState]);

  const bjSplit = useCallback(async () => {
    if (gameState.stage !== 'PLAYING') {
      console.log('[useBlackjack] Split rejected - not in PLAYING stage');
      return;
    }
    if (gameState.playerCards.length !== 2) {
      console.log('[useBlackjack] Split rejected - not 2 cards:', gameState.playerCards.length);
      setGameState(prev => ({ ...prev, message: 'CANNOT SPLIT' }));
      return;
    }
    if (gameState.playerCards[0].rank !== gameState.playerCards[1].rank) {
      console.log('[useBlackjack] Split rejected - ranks do not match:', gameState.playerCards[0].rank, gameState.playerCards[1].rank);
      setGameState(prev => ({ ...prev, message: 'CARDS MUST MATCH TO SPLIT' }));
      return;
    }
    if (stats.chips < gameState.bet) {
      console.log('[useBlackjack] Split rejected - insufficient chips');
      setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS TO SPLIT' }));
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        if (isPendingRef.current) {
          console.log('[useBlackjack] Split blocked - transaction pending');
          return;
        }
        isPendingRef.current = true;
        console.log('[useBlackjack] Sending split command to chain');
        const result = await chainService.sendMove(currentSessionIdRef.current, new Uint8Array([3]));
        if (result.txHash) setLastTxSig(result.txHash);
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
  }, [gameState.stage, gameState.playerCards, gameState.bet, stats.chips, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState]);

  const bjInsurance = useCallback((take: boolean) => {
    // Insurance is only available on-chain via chain events
    if (!isOnChain) {
      setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
      return;
    }
    // On-chain insurance is handled via game flow, just acknowledge the choice
    setGameState(prev => ({ ...prev, message: take ? "INSURANCE TAKEN" : "INSURANCE DECLINED" }));
  }, [isOnChain, setGameState]);

  const bjToggle21Plus3 = useCallback(async () => {
    if (gameState.type !== GameType.BLACKJACK) return;

    const prevAmount = gameState.blackjack21Plus3Bet || 0;
    const nextAmount = prevAmount > 0 ? 0 : gameState.bet;

    // Side bet toggle - only UI state update, sent atomically with Deal
    if (gameState.stage !== 'BETTING') {
      setGameState(prev => ({ ...prev, message: '21+3 CLOSED' }));
      return;
    }

    setGameState(prev => ({
        ...prev,
        blackjack21Plus3Bet: nextAmount,
        message: nextAmount > 0 ? `21+3 +$${nextAmount}` : '21+3 OFF',
      }));
  }, [gameState.type, gameState.blackjack21Plus3Bet, gameState.bet, gameState.stage, setGameState]);

  const bjStartGame = useCallback((newDeck: Card[]) => {
    // Initial deal is handled by the chain via CasinoGameStarted event
    // This function is only for setting initial UI state from deal cards
    // Stage and outcome determination comes from chain events, not local calculation
    const p1 = newDeck.pop()!, d1 = newDeck.pop()!, p2 = newDeck.pop()!, d2 = { ...newDeck.pop()!, isHidden: true };

    setGameState(prev => ({
      ...prev,
      stage: 'PLAYING',
      playerCards: [p1, p2],
      dealerCards: [d1, d2],
      message: "Your move",
      lastResult: 0,
      insuranceBet: 0,
      blackjackStack: [],
      completedHands: []
    }));
  }, [setGameState]);

  return {
    bjHit,
    bjStand,
    bjDouble,
    bjSplit,
    bjInsurance,
    bjToggle21Plus3,
    bjStartGame
  };
};
