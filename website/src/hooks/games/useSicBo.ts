import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, SicBoBet, PlayerStats, GameType, AutoPlayDraft } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';

const MAX_GRAPH_POINTS = 100;

/**
 * Convert SicBoBet to numeric format for serialization
 */
const sicBoBetToNumeric = (bet: SicBoBet): {betType: number, number: number, amount: number} => {
  const betTypeMap: Record<SicBoBet['type'], number> = {
    'SMALL': 0, 'BIG': 1, 'ODD': 2, 'EVEN': 3,
    'TOTAL': 4, 'SINGLE': 5, 'DOUBLE': 6, 'TRIPLE': 7, 'ANY_TRIPLE': 8,
    'TWO_DICE': 9
  };
  return { betType: betTypeMap[bet.type], number: bet.target ?? 0, amount: bet.amount };
};

/**
 * Serialize Sic Bo atomic batch: [3, bet_count, bets...]
 * Each bet is 10 bytes: [bet_type:u8] [number:u8] [amount:u64 BE]
 */
const serializeSicBoAtomicBatch = (bets: SicBoBet[]): Uint8Array => {
  const numericBets = bets.map(sicBoBetToNumeric);
  const payload = new Uint8Array(2 + numericBets.length * 10);
  payload[0] = 3; // Action 3: Atomic batch
  payload[1] = numericBets.length;
  const view = new DataView(payload.buffer);
  numericBets.forEach((b, i) => {
    const offset = 2 + i * 10;
    payload[offset] = b.betType;
    payload[offset + 1] = b.number;
    view.setBigUint64(offset + 2, BigInt(b.amount), false);
  });
  return payload;
};

interface UseSicBoProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  setLastTxSig: (sig: string | null) => void;
  isOnChain: boolean;
  startGame: (type: GameType) => void;
  autoPlayDraftRef: MutableRefObject<AutoPlayDraft | null>;
}

export const useSicBo = ({
  gameState,
  setGameState,
  stats,
  setStats,
  chainService,
  currentSessionIdRef,
  isPendingRef,
  pendingMoveCountRef,
  setLastTxSig,
  isOnChain,
  startGame,
  autoPlayDraftRef
}: UseSicBoProps) => {

  const placeSicBoBet = useCallback((type: SicBoBet['type'], target?: number) => {
    const existing = gameState.sicBoBets.some(b => b.type === type && b.target === target);
    if (existing) {
      const newBets = gameState.sicBoBets.filter(b => !(b.type === type && b.target === target));
      const removedAmount = gameState.sicBoBets.reduce((sum, b) => (b.type === type && b.target === target) ? sum + b.amount : sum, 0);
      setGameState(prev => ({
        ...prev,
        sicBoBets: newBets,
        sessionWager: Math.max(0, prev.sessionWager - removedAmount),
        message: `REMOVED ${type}`,
        sicBoInputMode: 'NONE'
      }));
      return;
    }

    if (stats.chips < gameState.bet) return;
    setGameState(prev => ({
      ...prev,
      sicBoUndoStack: [...prev.sicBoUndoStack, prev.sicBoBets],
      sicBoBets: [...prev.sicBoBets, { type, amount: prev.bet, target }],
      message: `BET ${type}`,
      sicBoInputMode: 'NONE',
      sessionWager: prev.sessionWager + prev.bet
    }));
  }, [gameState.sicBoBets, gameState.bet, stats.chips, setGameState]);

  const undoSicBoBet = useCallback(() => {
    if (gameState.sicBoUndoStack.length === 0) return;
    setGameState(prev => ({
      ...prev,
      sicBoBets: prev.sicBoUndoStack[prev.sicBoUndoStack.length - 1],
      sicBoUndoStack: prev.sicBoUndoStack.slice(0, -1)
    }));
  }, [gameState.sicBoUndoStack.length, setGameState]);

  const rebetSicBo = useCallback(() => {
    const totalRequired = gameState.sicBoLastRoundBets.reduce((a, b) => a + b.amount, 0);
    if (gameState.sicBoLastRoundBets.length === 0 || stats.chips < totalRequired) return;
    setGameState(prev => ({
      ...prev,
      sicBoUndoStack: [...prev.sicBoUndoStack, prev.sicBoBets],
      sicBoBets: [...prev.sicBoBets, ...prev.sicBoLastRoundBets],
      sessionWager: prev.sessionWager + totalRequired,
      message: "REBET"
    }));
  }, [gameState.sicBoLastRoundBets, gameState.sicBoBets, stats.chips, setGameState]);

  const rollSicBo = useCallback(async () => {
    const shouldRebet = gameState.sicBoBets.length === 0 && gameState.sicBoLastRoundBets.length > 0;
    const betsToRoll = shouldRebet ? gameState.sicBoLastRoundBets : gameState.sicBoBets;

    if (betsToRoll.length === 0) {
      setGameState(prev => ({ ...prev, message: "PLACE BET" }));
      return;
    }

    // SPACE should rebet by default if we have a previous roll to reuse.
    if (shouldRebet) {
      const totalRequired = gameState.sicBoLastRoundBets.reduce((a, b) => a + b.amount, 0);
      if (stats.chips < totalRequired) {
        setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
        return;
      }
      setGameState(prev => ({
        ...prev,
        sicBoUndoStack: [...prev.sicBoUndoStack, prev.sicBoBets],
        sicBoBets: [...gameState.sicBoLastRoundBets],
        sessionWager: prev.sessionWager + totalRequired,
        message: 'REBET',
      }));
    }

    // Prevent double-submits
    if (isPendingRef.current) {
      console.log('[useSicBo] rollSicBo - Already pending, ignoring');
      return;
    }

    if (isOnChain && chainService && !currentSessionIdRef.current) {
      autoPlayDraftRef.current = { type: GameType.SIC_BO, sicBoBets: betsToRoll };
      console.log('[useSicBo] No active session, starting new sic bo game (auto-roll queued)');
      setGameState(prev => ({ ...prev, message: 'STARTING NEW SESSION...' }));
      startGame(GameType.SIC_BO);
      return;
    }

    // If on-chain mode, use atomic batch (all bets + roll in one transaction)
    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        isPendingRef.current = true;
        pendingMoveCountRef.current = 1;
        setGameState(prev => ({ ...prev, message: 'ROLLING...' }));

        // Use atomic batch: all bets + roll in single transaction
        const atomicPayload = serializeSicBoAtomicBatch(betsToRoll);
        const result = await chainService.sendMove(currentSessionIdRef.current!, atomicPayload);
        if (result.txHash) setLastTxSig(result.txHash);

        // Update UI
        setGameState(prev => ({
          ...prev,
          sicBoLastRoundBets: betsToRoll,
          sicBoBets: [],
          sicBoUndoStack: []
        }));

        return;
      } catch (error) {
        console.error('[useSicBo] Sic Bo roll failed:', error);
        isPendingRef.current = false;
        pendingMoveCountRef.current = 0;
        setGameState(prev => ({ ...prev, message: 'MOVE FAILED' }));
        return;
      }
    }

    if (!isOnChain) {
      setGameState(prev => ({ ...prev, message: 'OFFLINE - START BACKEND' }));
    }
  }, [
    gameState.sicBoBets, gameState.sicBoLastRoundBets, stats.chips,
    isOnChain, chainService, currentSessionIdRef, isPendingRef, pendingMoveCountRef,
    setLastTxSig, startGame, autoPlayDraftRef, setGameState
  ]);

  return {
    placeSicBoBet,
    undoSicBoBet,
    rebetSicBo,
    rollSicBo
  };
};
