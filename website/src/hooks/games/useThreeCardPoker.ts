import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, PlayerStats, GameType } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';

interface UseThreeCardPokerProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  chainService: CasinoChainService | null;
  isOnChain: boolean;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  setLastTxSig: (sig: string | null) => void;
}

export const useThreeCardPoker = ({
  gameState,
  setGameState,
  stats,
  chainService,
  isOnChain,
  currentSessionIdRef,
  isPendingRef,
  setLastTxSig
}: UseThreeCardPokerProps) => {

  const threeCardTogglePairPlus = useCallback(async () => {
      if (gameState.type !== GameType.THREE_CARD) return;

      const prevAmount = gameState.threeCardPairPlusBet || 0;
      const nextAmount = prevAmount > 0 ? 0 : gameState.bet;

      // On-chain: only allow before Deal.
      if (isOnChain && gameState.stage !== 'BETTING') {
          setGameState(prev => ({ ...prev, message: 'PAIRPLUS CLOSED' }));
          return;
      }

      if (nextAmount > 0 && stats.chips < nextAmount) {
          setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
          return;
      }

      // Only update local state - side bets are sent atomically with Deal (action 7)
      setGameState(prev => ({
          ...prev,
          threeCardPairPlusBet: nextAmount,
          message: nextAmount > 0 ? `PAIRPLUS +$${nextAmount}` : 'PAIRPLUS OFF',
      }));
  }, [gameState.type, gameState.threeCardPairPlusBet, gameState.bet, gameState.stage, stats.chips, isOnChain, setGameState]);

  const threeCardToggleSixCardBonus = useCallback(async () => {
      if (gameState.type !== GameType.THREE_CARD) return;

      const prevAmount = gameState.threeCardSixCardBonusBet || 0;
      const nextAmount = prevAmount > 0 ? 0 : gameState.bet;

      // On-chain: only allow before Deal.
      if (isOnChain && gameState.stage !== 'BETTING') {
          setGameState(prev => ({ ...prev, message: '6-CARD CLOSED' }));
          return;
      }

      if (nextAmount > 0 && stats.chips < nextAmount) {
          setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
          return;
      }

      // Only update local state - side bets are sent atomically with Deal (action 7)
      setGameState(prev => ({
          ...prev,
          threeCardSixCardBonusBet: nextAmount,
          message: nextAmount > 0 ? `6-CARD +$${nextAmount}` : '6-CARD OFF',
      }));
  }, [gameState.type, gameState.threeCardSixCardBonusBet, gameState.bet, gameState.stage, stats.chips, isOnChain, setGameState]);

  const threeCardToggleProgressive = useCallback(async () => {
      if (gameState.type !== GameType.THREE_CARD) return;

      const prevAmount = gameState.threeCardProgressiveBet || 0;
      const nextAmount = prevAmount > 0 ? 0 : 1;

      // On-chain: only allow before Deal.
      if (isOnChain && gameState.stage !== 'BETTING') {
          setGameState(prev => ({ ...prev, message: 'PROG CLOSED' }));
          return;
      }

      if (nextAmount > 0 && stats.chips < nextAmount) {
          setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
          return;
      }

      // Only update local state - side bets are sent atomically with Deal (action 7)
      setGameState(prev => ({
          ...prev,
          threeCardProgressiveBet: nextAmount,
          message: nextAmount > 0 ? `PROG +$${nextAmount}` : 'PROG OFF',
      }));
  }, [gameState.type, gameState.threeCardProgressiveBet, gameState.stage, stats.chips, isOnChain, setGameState]);

  const threeCardPlay = useCallback(async () => {
      if (gameState.type !== GameType.THREE_CARD || gameState.stage !== 'PLAYING') return;

      // If on-chain mode, submit move
      if (isOnChain && chainService && currentSessionIdRef.current) {
        // Guard against duplicate submissions
        if (isPendingRef.current) {
          console.log('[useThreeCardPoker] Three Card Play blocked - transaction pending');
          return;
        }

        isPendingRef.current = true;
        try {
          // Payload: [0] for Play
          const payload = new Uint8Array([0]);
          const result = await chainService.sendMove(currentSessionIdRef.current, payload);
          if (result.txHash) setLastTxSig(result.txHash);
          setGameState(prev => ({
              ...prev,
              message: 'PLAYING...',
              sessionWager: prev.sessionWager + prev.bet // Track Play bet
          }));
          return;
        // NOTE: Do NOT clear isPendingRef here - wait for CasinoGameMoved event
        } catch (error) {
          console.error('[useThreeCardPoker] Three Card Play failed:', error);
          setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
          // Only clear isPending on error, not on success
          isPendingRef.current = false;
          return;
        }
      }

      // Local mode not supported - require on-chain session
      setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [gameState.type, gameState.stage, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState]);

  const threeCardFold = useCallback(async () => {
      if (gameState.type !== GameType.THREE_CARD || gameState.stage !== 'PLAYING') return;

      // If on-chain mode, submit move
      if (isOnChain && chainService && currentSessionIdRef.current) {
        // Guard against duplicate submissions
        if (isPendingRef.current) {
          console.log('[useThreeCardPoker] Three Card Fold blocked - transaction pending');
          return;
        }

        isPendingRef.current = true;
        try {
          // Payload: [1] for Fold
          const payload = new Uint8Array([1]);
          const result = await chainService.sendMove(currentSessionIdRef.current, payload);
          if (result.txHash) setLastTxSig(result.txHash);
          setGameState(prev => ({ ...prev, message: 'FOLDING...' }));
          return;
        // NOTE: Do NOT clear isPendingRef here - wait for CasinoGameMoved event
        } catch (error) {
          console.error('[useThreeCardPoker] Three Card Fold failed:', error);
          setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
          // Only clear isPending on error, not on success
          isPendingRef.current = false;
          return;
        }
      }

      // Local mode not supported - require on-chain session
      setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
  }, [gameState.type, gameState.stage, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState]);

  return {
      threeCardPlay,
      threeCardFold,
      threeCardTogglePairPlus,
      threeCardToggleSixCardBonus,
      threeCardToggleProgressive
  };
};
