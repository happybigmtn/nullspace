import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, CrapsBet, PlayerStats, GameType, AutoPlayDraft } from '../../types';
import { crapsBetCost, crapsBuyCommission, calculateCrapsExposure } from '../../utils/gameUtils';
import { CasinoChainService } from '../../services/CasinoChainService';

/**
 * Maps frontend bet type strings to backend numeric values
 * For HARDWAY, the specific hardway type (8-11) is determined by target
 */
const CRAPS_BET_TYPE_MAP: Record<CrapsBet['type'], number> = {
  'PASS': 0,
  'DONT_PASS': 1,
  'COME': 2,
  'DONT_COME': 3,
  'FIELD': 4,
  'YES': 5,
  'NO': 6,
  'NEXT': 7,
  'HARDWAY': 8, // Base value, refined based on target
  'FIRE': 12,
  'BUY': 13,
  'ATS_SMALL': 15,
  'ATS_TALL': 16,
  'ATS_ALL': 17,
};

/**
 * Get the numeric bet type, handling HARDWAY special case
 */
const getBetTypeNum = (bet: CrapsBet): number => {
  let betTypeValue = CRAPS_BET_TYPE_MAP[bet.type];
  // For HARDWAY, determine specific type based on target
  if (bet.type === 'HARDWAY' && bet.target) {
    if (bet.target === 4) betTypeValue = 8;
    else if (bet.target === 6) betTypeValue = 9;
    else if (bet.target === 8) betTypeValue = 10;
    else if (bet.target === 10) betTypeValue = 11;
  }
  return betTypeValue;
};

interface UseCrapsProps {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  isPendingRef: MutableRefObject<boolean>;
  setLastTxSig: (sig: string | null) => void;
  isOnChain: boolean;
  startGame: (type: GameType) => void;
  autoPlayDraftRef: MutableRefObject<AutoPlayDraft | null>;
}

export const useCraps = ({
  gameState,
  setGameState,
  stats,
  chainService,
  currentSessionIdRef,
  isPendingRef,
  setLastTxSig,
  isOnChain,
  startGame,
  autoPlayDraftRef
}: UseCrapsProps) => {

  const totalCommittedCraps = useCallback(() =>
    gameState.crapsBets.reduce((sum, b) => sum + crapsBetCost(b), 0), [gameState.crapsBets]);

  const placeCrapsBet = useCallback((type: CrapsBet['type'], target?: number) => {
      // Toggle logic: If identical local bet exists, remove it.
      const existingIdx = gameState.crapsBets.findIndex(b => b.type === type && b.target === target && b.local);
      if (existingIdx !== -1) {
          const betToRemove = gameState.crapsBets[existingIdx];
          const refund = crapsBetCost(betToRemove);
          const newBets = [...gameState.crapsBets];
          newBets.splice(existingIdx, 1);
          setGameState(prev => ({
              ...prev,
              crapsBets: newBets,
              sessionWager: Math.max(0, prev.sessionWager - refund),
              message: `REMOVED ${type}`,
              crapsInputMode: 'NONE'
          }));
          return;
      }

      const committed = totalCommittedCraps();
      const betAmount = gameState.bet;
      const placementCost = type === 'BUY' ? betAmount + crapsBuyCommission(betAmount) : betAmount;

      if (type === 'FIRE' && gameState.crapsRollHistory.length > 0) {
          setGameState(prev => ({ ...prev, message: 'BET ONLY BEFORE FIRST ROLL' }));
          return;
      }

      if (type === 'ATS_SMALL' || type === 'ATS_TALL' || type === 'ATS_ALL') {
          const hasDice = gameState.dice.length === 2 && (gameState.dice[0] ?? 0) > 0 && (gameState.dice[1] ?? 0) > 0;
          const lastTotal = hasDice ? (gameState.dice[0]! + gameState.dice[1]!) : null;
          const canPlaceAts = !gameState.crapsEpochPointEstablished && (!hasDice || lastTotal === 7);
          if (!canPlaceAts) {
              setGameState(prev => ({ ...prev, message: 'ATS CLOSED' }));
              return;
          }
      }

      if (type === 'FIRE' && gameState.crapsBets.some(b => b.type === 'FIRE' && b.local)) {
          setGameState(prev => ({ ...prev, message: 'FIRE BET ALREADY PLACED' }));
          return;
      }

      if (stats.chips - committed < placementCost) {
          setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
          return;
      }
      let bets = [...gameState.crapsBets];
      if (type === 'PASS') bets = bets.filter(b => b.type !== 'DONT_PASS' || !b.local);
      if (type === 'DONT_PASS') bets = bets.filter(b => b.type !== 'PASS' || !b.local);
      setGameState(prev => ({
          ...prev,
          crapsUndoStack: [...prev.crapsUndoStack, prev.crapsBets],
          crapsBets: [...bets, { type, amount: prev.bet, target, status: (type==='COME'||type==='DONT_COME')?'PENDING':'ON', local: true }],
          message: `BET ${type}`,
          crapsInputMode: 'NONE',
          sessionWager: prev.sessionWager + placementCost // Track wager
      }));
  }, [gameState.crapsBets, gameState.bet, gameState.crapsRollHistory.length, gameState.dice, gameState.crapsEpochPointEstablished, stats.chips, totalCommittedCraps, setGameState]);

  const undoCrapsBet = useCallback(() => {
       if (gameState.crapsUndoStack.length === 0) return;
       setGameState(prev => {
           const nextBets = prev.crapsUndoStack[prev.crapsUndoStack.length - 1];
           const localCost = (bets: CrapsBet[]) => bets.filter(b => b.local).reduce((s, b) => s + crapsBetCost(b), 0);
           const delta = localCost(nextBets) - localCost(prev.crapsBets);
           return {
               ...prev,
               crapsBets: nextBets,
               crapsUndoStack: prev.crapsUndoStack.slice(0, -1),
               sessionWager: prev.sessionWager + delta,
           };
       });
  }, [gameState.crapsUndoStack.length, setGameState]);

  const rebetCraps = useCallback(() => {
      if (gameState.crapsLastRoundBets.length === 0) {
          setGameState(prev => ({ ...prev, message: 'NO PREVIOUS BETS' }));
          return;
      }
      const totalRequired = gameState.crapsLastRoundBets.reduce((a, b) => a + crapsBetCost(b), 0);
      const committed = totalCommittedCraps();
      if (stats.chips < totalRequired + committed) {
          setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
          return;
      }
      // Add last round bets as new local bets
      const rebets = gameState.crapsLastRoundBets.map(b => ({ ...b, local: true }));
      setGameState(prev => ({
          ...prev,
          crapsUndoStack: [...prev.crapsUndoStack, prev.crapsBets],
          crapsBets: [...prev.crapsBets, ...rebets],
          message: 'REBET PLACED',
          sessionWager: prev.sessionWager + totalRequired,
      }));
  }, [gameState.crapsLastRoundBets, stats.chips, totalCommittedCraps, setGameState]);

  const placeCrapsNumberBet = useCallback((mode: string, num: number) => {
      // Map input mode to bet type
      const betType = mode as CrapsBet['type'];
      // Validate number for each type
      if (mode === 'YES' || mode === 'NO' || mode === 'BUY') {
          if (![4, 5, 6, 8, 9, 10].includes(num)) return;
      } else if (mode === 'NEXT') {
          if (num < 2 || num > 12) return;
      } else if (mode === 'HARDWAY') {
          if (![4, 6, 8, 10].includes(num)) return;
      }
      placeCrapsBet(betType, num);
  }, [placeCrapsBet]);

  const executeAddOdds = useCallback(async (idx: number) => {
      const targetBet = gameState.crapsBets[idx];
      // No odds on the come-out roll for Pass/Don't Pass (Point must be established)
      if ((targetBet.type === 'PASS' || targetBet.type === 'DONT_PASS') && gameState.crapsPoint === null) {
          setGameState(prev => ({ ...prev, message: "WAIT FOR POINT BEFORE ODDS" }));
          return;
      }

      const currentOdds = targetBet.oddsAmount || 0;
      const maxOdds = targetBet.amount * 5; // 5x cap

      if (currentOdds >= maxOdds) {
          setGameState(prev => ({ ...prev, message: "MAX ODDS REACHED (5X)" }));
          return;
      }

      const oddsToAdd = Math.min(gameState.bet, maxOdds - currentOdds);

      if (oddsToAdd <= 0) {
          setGameState(prev => ({ ...prev, message: "MAX ODDS REACHED" }));
          return;
      }

      const committed = totalCommittedCraps();
      if (stats.chips - committed < oddsToAdd) {
          setGameState(prev => ({ ...prev, message: "INSUFFICIENT FUNDS" }));
          return;
      }

      // Update local state optimistically
      setGameState(prev => {
          const bets = [...prev.crapsBets];
          bets[idx] = { ...bets[idx], oddsAmount: currentOdds + oddsToAdd };
          return {
              ...prev,
              crapsBets: bets,
              message: `ADDING ODDS +$${oddsToAdd}...`,
              sessionWager: prev.sessionWager + oddsToAdd
          };
      });

      // Send to chain if we have an active session
      if (chainService && currentSessionIdRef.current && !isPendingRef.current) {
          isPendingRef.current = true;
          try {
              const payload = new Uint8Array(9);
              payload[0] = 1; // Command: Add odds
              const view = new DataView(payload.buffer);
              view.setBigUint64(1, BigInt(oddsToAdd), false);

              const result = await chainService.sendMove(currentSessionIdRef.current, payload);
              if (result.txHash) setLastTxSig(result.txHash);

              setGameState(prev => ({ ...prev, message: `ODDS +$${oddsToAdd}` }));
          } catch (e) {
              console.error('[addCrapsOdds] Failed to add odds:', e);
              // Revert local state on failure
              setGameState(prev => {
                  const bets = [...prev.crapsBets];
                  bets[idx] = { ...bets[idx], oddsAmount: currentOdds };
                  return { ...prev, crapsBets: bets, message: "ODDS FAILED" };
              });
          } finally {
              isPendingRef.current = false;
          }
      } else {
          setGameState(prev => ({ ...prev, message: `ODDS +$${oddsToAdd}` }));
      }
  }, [gameState.crapsBets, gameState.crapsPoint, gameState.bet, stats.chips, chainService, currentSessionIdRef, isPendingRef, totalCommittedCraps, setGameState, setLastTxSig]);

  const addCrapsOdds = useCallback(async (selectionIndex?: number) => {
      // If we have a selection index, resolve the pending selection
      if (selectionIndex !== undefined && gameState.crapsOddsCandidates) {
          if (selectionIndex < 0 || selectionIndex >= gameState.crapsOddsCandidates.length) return;
          const targetBetIndex = gameState.crapsOddsCandidates[selectionIndex];
          setGameState(prev => ({ ...prev, crapsOddsCandidates: null })); // Clear selection mode

          await executeAddOdds(targetBetIndex);
          return;
      }

      const candidates = gameState.crapsBets
          .map((b, i) => ({ ...b, index: i }))
          .filter(b =>
              (b.type === 'PASS' || b.type === 'DONT_PASS' ||
               (b.type === 'COME' && b.status === 'ON') ||
               (b.type === 'DONT_COME' && b.status === 'ON'))
          );

      if (candidates.length === 0) {
          setGameState(prev => ({ ...prev, message: "NO BET FOR ODDS" }));
          return;
      }

      if (candidates.length === 1) {
          await executeAddOdds(candidates[0].index);
          return;
      }

      // Multiple candidates: Enter selection mode
      setGameState(prev => ({
          ...prev,
          crapsOddsCandidates: candidates.map(c => c.index),
          message: "SELECT BET FOR ODDS (1-9)"
      }));
  }, [gameState.crapsOddsCandidates, gameState.crapsBets, executeAddOdds, setGameState]);

  const rollCraps = useCallback(async () => {
       const hasSession = !!currentSessionIdRef.current;
       const stagedLocalBets = gameState.crapsBets.filter(b => b.local === true);

       const normalizeRebetBets = (bets: CrapsBet[]): CrapsBet[] =>
         bets
           .filter(b => b.type !== 'COME' && b.type !== 'DONT_COME')
           .map(b => ({
             type: b.type,
             amount: b.amount,
             target: b.target,
             status: 'ON' as const,
             local: true,
           }));

       const fallbackRebetBets =
         stagedLocalBets.length > 0 ? [] : normalizeRebetBets(gameState.crapsLastRoundBets);

       const betsToPlace = stagedLocalBets.length > 0 ? stagedLocalBets : (!hasSession ? fallbackRebetBets : []);

       const hasOutstandingBets = hasSession && (gameState.crapsBets.some(b => !b.local) || gameState.crapsPoint !== null);

       if (betsToPlace.length === 0 && !hasOutstandingBets) {
         setGameState(prev => ({ ...prev, message: gameState.crapsLastRoundBets.length > 0 ? 'REBET (T) OR PLACE BET' : 'PLACE BET FIRST' }));
         return;
       }

       if (isOnChain && chainService && !hasSession) {
         if (betsToPlace.length === 0) {
           setGameState(prev => ({ ...prev, message: 'PLACE BET FIRST' }));
           return;
         }

         if (stagedLocalBets.length === 0 && fallbackRebetBets.length > 0) {
           const committed = totalCommittedCraps();
           const totalRequired = fallbackRebetBets.reduce((a, b) => a + crapsBetCost(b), 0);
           if (stats.chips < committed + totalRequired) {
             setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
             return;
           }
           setGameState(prev => ({
             ...prev,
             crapsUndoStack: [...prev.crapsUndoStack, prev.crapsBets],
             crapsBets: [...prev.crapsBets, ...fallbackRebetBets],
             sessionWager: prev.sessionWager + totalRequired,
             message: 'REBET PLACED',
           }));
         }

         autoPlayDraftRef.current = { type: GameType.CRAPS, crapsBets: betsToPlace };
         console.log('[useCraps] rollCraps - No active session, starting new craps game (auto-roll queued)');
         setGameState(prev => ({ ...prev, message: 'STARTING NEW SESSION...' }));
         startGame(GameType.CRAPS);
         return;
       }

       // On-chain with session: Place any new local bets, then roll dice
       if (isOnChain && chainService && hasSession) {
           if (isPendingRef.current) return;

           try {
             isPendingRef.current = true;

             // First, place any staged local bets on chain (command 0: place bet)
             // Each bet is: [0, bet_type, target, amount:u64 BE]
             for (const bet of stagedLocalBets) {
               const betTypeNum = getBetTypeNum(bet);

               // For HARDWAY bets, target is encoded in bet type, so send 0 as target
               const targetToSend = bet.type === 'HARDWAY' ? 0 : (bet.target ?? 0);

               const payload = new Uint8Array(11);
               payload[0] = 0; // Command 0: Place bet
               payload[1] = betTypeNum;
               payload[2] = targetToSend;
               new DataView(payload.buffer).setBigUint64(3, BigInt(bet.amount), false);

               const betResult = await chainService.sendMove(currentSessionIdRef.current!, payload);
               if (betResult.txHash) setLastTxSig(betResult.txHash);
             }

             // Mark local bets as committed to chain
             if (stagedLocalBets.length > 0) {
               setGameState(prev => ({
                 ...prev,
                 crapsBets: prev.crapsBets.map(b => b.local ? { ...b, local: false } : b),
               }));
             }

             // Then roll dice (command 2)
             const result = await chainService.sendMove(currentSessionIdRef.current!, new Uint8Array([2]));
             if (result.txHash) setLastTxSig(result.txHash);
             setGameState(prev => ({ ...prev, message: 'ROLLING...' }));
           } catch (e) {
               console.error('Roll failed', e);
               isPendingRef.current = false;
               setGameState(prev => ({ ...prev, message: 'ROLL FAILED' }));
           }
           return;
       }

       // Local mode not supported - require on-chain session
       setGameState(prev => ({ ...prev, message: 'OFFLINE - START BACKEND' }));

  }, [gameState.crapsBets, gameState.crapsLastRoundBets, gameState.crapsPoint, currentSessionIdRef, chainService, isOnChain, isPendingRef, startGame, setGameState, stats.chips, totalCommittedCraps, setLastTxSig, autoPlayDraftRef]);

  return {
    placeCrapsBet,
    undoCrapsBet,
    rebetCraps,
    placeCrapsNumberBet,
    addCrapsOdds,
    rollCraps
  };
};
