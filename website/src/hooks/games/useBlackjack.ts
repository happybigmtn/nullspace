import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, Card, PlayerStats, CompletedHand, GameType } from '../../types';
import { getHandValue } from '../../utils/gameUtils';
import { CasinoChainService } from '../../services/CasinoChainService';

const MAX_GRAPH_POINTS = 100;

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
  setStats,
  deck,
  setDeck,
  chainService,
  isOnChain,
  currentSessionIdRef,
  isPendingRef,
  setLastTxSig
}: UseBlackjackProps) => {

  const resolveBlackjackRound = useCallback((hands: CompletedHand[], dealerHand: Card[]) => {
      let totalWin = 0;
      let logs: string[] = [];
      const dVal = getHandValue(dealerHand);
      if (gameState.insuranceBet > 0) {
          if (dVal === 21 && dealerHand.length === 2) { totalWin += gameState.insuranceBet * 3; logs.push(`Insurance WIN (+$${gameState.insuranceBet * 2})`); }
          else { totalWin -= gameState.insuranceBet; logs.push(`Insurance LOSS (-$${gameState.insuranceBet})`); }
      }
      hands.forEach((hand, idx) => {
          const pVal = getHandValue(hand.cards);
          let win = 0;
          if (pVal > 21) win = -hand.bet;
          else if (dVal > 21) win = hand.bet;
          else if (pVal === 21 && hand.cards.length === 2 && !(dVal === 21 && dealerHand.length === 2)) win = Math.floor(hand.bet * 1.5);
          else if (pVal > dVal) win = hand.bet;
          else if (pVal < dVal) win = -hand.bet;
          totalWin += win;
          
          const handName = hands.length > 1 ? `Hand ${idx+1}` : 'Hand';
          if (win > 0) logs.push(`${handName} WIN (+$${win})`);
          else if (win < 0) logs.push(`${handName} LOSS (-$${Math.abs(win)})`);
          else logs.push(`${handName} PUSH`);
      });
      let finalWin = totalWin;
      let summarySuffix = "";
      if (finalWin < 0 && gameState.activeModifiers.shield) { finalWin = 0; summarySuffix = " [SHIELD SAVED]"; }
      if (finalWin > 0 && gameState.activeModifiers.double) { finalWin *= 2; summarySuffix = " [DOUBLE BONUS]"; }

      const summary = `${finalWin >= 0 ? 'WON' : 'LOST'} ${Math.abs(finalWin)}${summarySuffix}`;

      const pnlEntry = { [GameType.BLACKJACK]: (stats.pnlByGame[GameType.BLACKJACK] || 0) + finalWin };
      setStats(prev => ({
        ...prev,
        history: [...prev.history, summary, ...logs],
        pnlByGame: { ...prev.pnlByGame, ...pnlEntry },
        pnlHistory: [...prev.pnlHistory, (prev.pnlHistory[prev.pnlHistory.length - 1] || 0) + finalWin].slice(-MAX_GRAPH_POINTS)
      }));
      setGameState(prev => ({ ...prev, message: finalWin >= 0 ? `WON ${finalWin}` : `LOST ${Math.abs(finalWin)}`, stage: 'RESULT', lastResult: finalWin }));
  }, [gameState.insuranceBet, gameState.activeModifiers, stats.pnlByGame, setStats, setGameState]);

  const bjDealerPlay = useCallback((playerHands: CompletedHand[], lastHand: Card[], currentDealerCards?: Card[], currentDeck?: Card[]) => {
      let dealer = currentDealerCards ? [...currentDealerCards] : gameState.dealerCards.map(c => ({...c, isHidden: false}));
      let d = currentDeck ? [...currentDeck] : [...deck];
      while (getHandValue(dealer) < 17) dealer.push(d.pop()!);
      setDeck(d);
      setGameState(prev => ({ ...prev, dealerCards: dealer, completedHands: playerHands, stage: 'RESULT', playerCards: lastHand }));
      resolveBlackjackRound(playerHands, dealer);
  }, [gameState.dealerCards, deck, setDeck, setGameState, resolveBlackjackRound]);

  const bjStandAuto = useCallback((hand: Card[]) => {
    const stoodHand: CompletedHand = { cards: hand, bet: gameState.bet, isDoubled: gameState.activeModifiers.double };
    const newCompleted = [...gameState.completedHands, stoodHand];
    if (gameState.blackjackStack.length > 0) {
        const nextHand = gameState.blackjackStack[0];
        setGameState(prev => ({
            ...prev,
            playerCards: [...nextHand.cards, deck.pop()!],
            bet: nextHand.bet,
            activeModifiers: { ...prev.activeModifiers, double: nextHand.isDoubled },
            blackjackStack: prev.blackjackStack.slice(1),
            completedHands: newCompleted,
            message: "Your move"
        }));
    } else {
        bjDealerPlay(newCompleted, hand);
    }
  }, [gameState.bet, gameState.activeModifiers.double, gameState.completedHands, gameState.blackjackStack, deck, setGameState, bjDealerPlay]);

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

    if (getHandValue(gameState.playerCards) >= 21) return;
    const newCard = deck.pop()!;
    const newHand = [...gameState.playerCards, newCard];
    const newVal = getHandValue(newHand);

    if (newVal > 21) {
      const lostHand: CompletedHand = { cards: newHand, bet: gameState.bet, result: -gameState.bet, message: "BUST", isDoubled: gameState.activeModifiers.double };
      const newCompleted = [...gameState.completedHands, lostHand];
      if (gameState.blackjackStack.length > 0) {
          const nextHand = gameState.blackjackStack[0];
          setGameState(prev => ({
              ...prev,
              playerCards: [...nextHand.cards, deck.pop()!], 
              bet: nextHand.bet,
              activeModifiers: { ...prev.activeModifiers, double: nextHand.isDoubled },
              blackjackStack: prev.blackjackStack.slice(1),
              completedHands: newCompleted,
              message: "Your move"
          }));
      } else {
          const allBust = newCompleted.every(h => (getHandValue(h.cards) > 21));
          if (allBust) {
              setGameState(prev => ({ ...prev, playerCards: newHand, completedHands: newCompleted, stage: 'RESULT' }));
              resolveBlackjackRound(newCompleted, gameState.dealerCards);
          } else {
              bjDealerPlay(newCompleted, newHand); 
          }
      }
    } else if (newVal === 21) {
      bjStandAuto(newHand);
    } else {
      setGameState(prev => ({ ...prev, playerCards: newHand, message: "Your move" }));
    }
  }, [isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState, gameState.playerCards, gameState.bet, gameState.activeModifiers, gameState.completedHands, gameState.blackjackStack, gameState.dealerCards, deck, bjDealerPlay, bjStandAuto, resolveBlackjackRound]);

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

    bjStandAuto(gameState.playerCards);
  }, [isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState, gameState.playerCards, bjStandAuto]);

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

    if (gameState.playerCards.length !== 2 || stats.chips < gameState.bet) return;
    setGameState(prev => ({ ...prev, bet: prev.bet * 2, message: "DOUBLING..." }));
    const newCard = deck.pop()!;
    const newHand = [...gameState.playerCards, newCard];
    const stoodHand: CompletedHand = { cards: newHand, bet: gameState.bet * 2, isDoubled: true }; 
    const newCompleted = [...gameState.completedHands, stoodHand];
    if (gameState.blackjackStack.length > 0) {
        const nextHand = gameState.blackjackStack[0];
        setGameState(prev => ({
            ...prev,
            playerCards: [...nextHand.cards, deck.pop()!],
            bet: nextHand.bet,
            activeModifiers: { ...prev.activeModifiers, double: nextHand.isDoubled },
            blackjackStack: prev.blackjackStack.slice(1),
            completedHands: newCompleted,
            message: "Your move"
        }));
    } else {
        bjDealerPlay(newCompleted, newHand);
    }
  }, [isPendingRef, isOnChain, chainService, currentSessionIdRef, setLastTxSig, setGameState, gameState.playerCards, gameState.bet, gameState.completedHands, gameState.blackjackStack, stats.chips, deck, bjDealerPlay]);

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

    setGameState(prev => ({
        ...prev,
        playerCards: [gameState.playerCards[0], deck.pop()!],
        blackjackStack: [{ cards: [gameState.playerCards[1]], bet: gameState.bet, isDoubled: false }, ...prev.blackjackStack],
        message: "SPLIT! PLAYING HAND 1."
    }));
  }, [gameState.stage, gameState.playerCards, gameState.bet, stats.chips, isOnChain, chainService, currentSessionIdRef, isPendingRef, setLastTxSig, setGameState, deck]);

  const bjInsurance = useCallback((take: boolean) => {
      if (isOnChain) return;
      if (take && stats.chips >= Math.floor(gameState.bet/2)) setGameState(prev => ({ ...prev, insuranceBet: Math.floor(prev.bet/2), message: "INSURANCE TAKEN" }));
      else setGameState(prev => ({ ...prev, message: "INSURANCE DECLINED" }));
  }, [isOnChain, stats.chips, gameState.bet, setGameState]);

  const bjToggle21Plus3 = useCallback(async () => {
    if (gameState.type !== GameType.BLACKJACK) return;

    const prevAmount = gameState.blackjack21Plus3Bet || 0;
    const nextAmount = prevAmount > 0 ? 0 : gameState.bet;

    if (!isOnChain || !chainService || !currentSessionIdRef.current) {
      setGameState(prev => ({
        ...prev,
        blackjack21Plus3Bet: nextAmount,
        message: nextAmount > 0 ? `21+3 +$${nextAmount}` : '21+3 OFF',
      }));
      return;
    }

    if (gameState.stage !== 'BETTING') {
      setGameState(prev => ({ ...prev, message: '21+3 CLOSED' }));
      return;
    }
    
    setGameState(prev => ({
        ...prev,
        blackjack21Plus3Bet: nextAmount,
        message: nextAmount > 0 ? `21+3 +$${nextAmount}` : '21+3 OFF',
      }));

  }, [gameState.type, gameState.blackjack21Plus3Bet, gameState.bet, gameState.stage, isOnChain, chainService, currentSessionIdRef, setGameState]);

  const bjStartGame = useCallback((newDeck: Card[]) => {
      const p1 = newDeck.pop()!, d1 = newDeck.pop()!, p2 = newDeck.pop()!, d2 = { ...newDeck.pop()!, isHidden: true };
      const val = getHandValue([p1, p2]);
      if (val === 21) {
           const completed: CompletedHand = { cards: [p1, p2], bet: gameState.bet, isDoubled: gameState.activeModifiers.double };
           bjDealerPlay([completed], [p1, p2], [d1, d2], newDeck);
      } else {
             let msg = "Your move";
             if (d1.rank === 'A' && !isOnChain) msg = "INSURANCE? (I) / NO (N)";
             setGameState(prev => ({ ...prev, stage: 'PLAYING', playerCards: [p1, p2], dealerCards: [d1, d2], message: msg, lastResult: 0, insuranceBet: 0, blackjackStack: [], completedHands: [] }));
      }
  }, [gameState.bet, gameState.activeModifiers.double, isOnChain, setGameState, bjDealerPlay]);

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
