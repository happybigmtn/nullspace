import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, Card, PlayerStats, GameType } from '../../types';
import { evaluateThreeCardHand } from '../../utils/gameUtils';
import { CasinoChainService } from '../../services/CasinoChainService';

const MAX_GRAPH_POINTS = 100;

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
  setStats,
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
          console.log('[useTerminalGame] Three Card Play blocked - transaction pending');
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
          console.error('[useTerminalGame] Three Card Play failed:', error);
          setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
          // Only clear isPending on error, not on success
          isPendingRef.current = false;
          return;
        }
      }

      // Local mode fallback
      if (stats.chips < gameState.bet) { setGameState(prev => ({ ...prev, message: "INSUFFICIENT FUNDS" })); return; }

      // Reveal dealer cards
      const dealerRevealed = gameState.dealerCards.map(c => ({ ...c, isHidden: false }));
      const playerHand = evaluateThreeCardHand(gameState.playerCards);
      const dealerHand = evaluateThreeCardHand(dealerRevealed);

      // Check if dealer qualifies (Queen-high or better)
      // In gameUtils, HIGH CARD is rank 'HIGH CARD'. 
      const dealerQualifies = dealerHand.rank !== 'HIGH CARD' ||
          (dealerHand.rank === 'HIGH CARD' && dealerRevealed.some(c => ['Q', 'K', 'A'].includes(c.rank)));

      let totalWin = 0;
      let message = '';
      const details: string[] = [];

      if (!dealerQualifies) {
          totalWin = gameState.bet; // Ante wins 1:1, Play pushes
          message = "DEALER DOESN'T QUALIFY - ANTE WINS";
          details.push(`Ante WIN (+$${gameState.bet})`);
          details.push(`Play PUSH`);
      } else {
          // Compare hands
          if (playerHand.score > dealerHand.score) {
              totalWin = gameState.bet * 2; // Ante + Play win
              message = `${playerHand.rank} WINS!`;
              details.push(`Ante WIN (+$${gameState.bet})`);
              details.push(`Play WIN (+$${gameState.bet})`);
          } else if (playerHand.score < dealerHand.score) {
              totalWin = -gameState.bet * 2; // Lose ante + play
              message = `DEALER ${dealerHand.rank} WINS`;
              details.push(`Ante LOSS (-$${gameState.bet})`);
              details.push(`Play LOSS (-$${gameState.bet})`);
          } else {
              totalWin = 0;
              message = "PUSH";
              details.push(`Ante PUSH`);
              details.push(`Play PUSH`);
          }
      }

      const summary = `${playerHand.rank} vs ${dealerHand.rank}. ${totalWin >= 0 ? '+' : '-'}$${Math.abs(totalWin)}`;

      setStats(prev => ({
          ...prev,
          chips: prev.chips + totalWin,
          history: [...prev.history, summary, ...details],
          pnlByGame: { ...prev.pnlByGame, [GameType.THREE_CARD]: (prev.pnlByGame[GameType.THREE_CARD] || 0) + totalWin },
          pnlHistory: [...prev.pnlHistory, (prev.pnlHistory[prev.pnlHistory.length - 1] || 0) + totalWin].slice(-MAX_GRAPH_POINTS)
      }));

      setGameState(prev => ({ ...prev, dealerCards: dealerRevealed, stage: 'RESULT' }));
      setGameState(prev => ({ ...prev, message, lastResult: totalWin }));
  }, [gameState.type, gameState.stage, gameState.bet, gameState.playerCards, gameState.dealerCards, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState, stats.chips, setStats]);

  const threeCardFold = useCallback(async () => {
      if (gameState.type !== GameType.THREE_CARD || gameState.stage !== 'PLAYING') return;

      // If on-chain mode, submit move
      if (isOnChain && chainService && currentSessionIdRef.current) {
        // Guard against duplicate submissions
        if (isPendingRef.current) {
          console.log('[useTerminalGame] Three Card Fold blocked - transaction pending');
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
          console.error('[useTerminalGame] Three Card Fold failed:', error);
          setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
          // Only clear isPending on error, not on success
          isPendingRef.current = false;
          return;
        }
      }

      // Local mode fallback
      const dealerRevealed = gameState.dealerCards.map(c => ({ ...c, isHidden: false }));
      const pnl = -gameState.bet;
      const summary = `FOLDED. -$${gameState.bet}`;
      const details = [`Ante LOSS (-$${gameState.bet})`];

      setStats(prev => ({
          ...prev,
          chips: prev.chips + pnl,
          history: [...prev.history, summary, ...details],
          pnlByGame: { ...prev.pnlByGame, [GameType.THREE_CARD]: (prev.pnlByGame[GameType.THREE_CARD] || 0) + pnl },
          pnlHistory: [...prev.pnlHistory, (prev.pnlHistory[prev.pnlHistory.length - 1] || 0) + pnl].slice(-MAX_GRAPH_POINTS)
      }));

      setGameState(prev => ({ ...prev, dealerCards: dealerRevealed, stage: 'RESULT' }));
  }, [gameState.type, gameState.stage, gameState.bet, gameState.dealerCards, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState, setStats]);

  return {
      threeCardPlay,
      threeCardFold,
      threeCardTogglePairPlus,
      threeCardToggleSixCardBonus,
      threeCardToggleProgressive
  };
};
