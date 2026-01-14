import { Dispatch, SetStateAction, MutableRefObject, useCallback } from 'react';
import { GameState, CrapsBet, PlayerStats, GameType, AutoPlayDraft } from '../../types';
import { canPlaceCrapsBonusBets, crapsBetCost, CRAPS_MAX_BETS } from '../../utils/gameUtils';
import { CasinoChainService } from '../../services/CasinoChainService';
import { CrapsMove } from '@nullspace/constants';
import {
  CRAPS_BONUS_BET_TYPES,
  getBetTypeNum,
  getTargetForBackend,
  invalidTargetMessage,
  isValidCrapsTarget,
} from './crapsHelpers';

interface UseCrapsProps {
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
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
}

export const useCraps = ({
  gameState,
  setGameState,
  stats,
  chainService,
  currentSessionIdRef,
  isPendingRef,
  pendingMoveCountRef,
  setLastTxSig,
  isOnChain,
  startGame,
  autoPlayDraftRef,
  armChainResponseTimeout,
}: UseCrapsProps) => {

  const localBetCost = useCallback((bet: CrapsBet): number => {
    const base = bet.local ? bet.amount : 0;
    const odds = bet.localOddsAmount ?? 0;
    return base + odds;
  }, []);

  const stagedCrapsCost = useCallback((bets: CrapsBet[]) => {
    const hasSession = !!currentSessionIdRef.current;
    const superActive = isOnChain && gameState.activeModifiers.super;

    if (superActive && !hasSession) {
      const totalBase = bets.reduce((sum, b) => sum + (b.local ? b.amount : 0), 0);
      const superFee = Math.floor(totalBase / 5);
      return totalBase + superFee;
    }

    return bets.reduce((sum, b) => {
      const base = b.local ? b.amount : 0;
      const odds = b.localOddsAmount ?? 0;
      const superFee = superActive ? Math.floor(base / 5) + Math.floor(odds / 5) : 0;
      return sum + base + odds + superFee;
    }, 0);
  }, [currentSessionIdRef, gameState.activeModifiers.super, isOnChain]);

  const placeCrapsBet = useCallback((type: CrapsBet['type'], target?: number, stateOverride?: GameState, statsOverride?: PlayerStats) => {
      const state = stateOverride ?? gameState;
      const player = statsOverride ?? stats;
      if (!isValidCrapsTarget(type, target)) {
          setGameState(prev => ({ ...prev, message: invalidTargetMessage(type) }));
          return;
      }
      // Toggle logic: If identical local bet exists, remove it.
      const existingIdx = state.crapsBets.findIndex(b => b.type === type && b.target === target && b.local);
      if (existingIdx !== -1) {
          const betToRemove = state.crapsBets[existingIdx];
          const refund = localBetCost(betToRemove);
          const newBets = [...state.crapsBets];
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

      const betAmount = state.bet;
      const placementCost = betAmount;

      const isBonusBet = CRAPS_BONUS_BET_TYPES.has(type);
      const canPlaceBonus = canPlaceCrapsBonusBets(state.crapsEpochPointEstablished, state.dice);
      if (isBonusBet && !canPlaceBonus) {
          setGameState(prev => ({ ...prev, message: 'BONUS CLOSED' }));
          return;
      }

      if (state.crapsBets.length >= CRAPS_MAX_BETS) {
          setGameState(prev => ({ ...prev, message: `BET LIMIT ${CRAPS_MAX_BETS}` }));
          return;
      }

      if (type === 'FIRE' && state.crapsBets.some(b => b.type === 'FIRE' && b.local)) {
          setGameState(prev => ({ ...prev, message: 'FIRE BET ALREADY PLACED' }));
          return;
      }

      let bets = [...state.crapsBets];
      if (type === 'PASS') bets = bets.filter(b => b.type !== 'DONT_PASS' || !b.local);
      if (type === 'DONT_PASS') bets = bets.filter(b => b.type !== 'PASS' || !b.local);

      const nextBets: CrapsBet[] = [
        ...bets,
        { type, amount: betAmount, target, status: (type === 'COME' || type === 'DONT_COME') ? 'PENDING' : 'ON', local: true }
      ];
      const totalRequired = stagedCrapsCost(nextBets);

      if (player.chips < totalRequired) {
          setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
          return;
      }
      setGameState(prev => ({
          ...prev,
          crapsUndoStack: [...prev.crapsUndoStack, prev.crapsBets],
          crapsBets: nextBets,
          message: `BET ${type}`,
          crapsInputMode: 'NONE',
          sessionWager: prev.sessionWager + placementCost // Track wager
      }));
  }, [gameState.crapsBets, gameState.bet, gameState.dice, gameState.crapsEpochPointEstablished, stats.chips, localBetCost, stagedCrapsCost, setGameState]);

  const undoCrapsBet = useCallback(() => {
       if (gameState.crapsUndoStack.length === 0) return;
       setGameState(prev => {
           const nextBets = prev.crapsUndoStack[prev.crapsUndoStack.length - 1];
           const localCost = (bets: CrapsBet[]) => bets.filter(b => b.local).reduce((s, b) => s + localBetCost(b), 0);
           const delta = localCost(nextBets) - localCost(prev.crapsBets);
           return {
               ...prev,
               crapsBets: nextBets,
               crapsUndoStack: prev.crapsUndoStack.slice(0, -1),
               sessionWager: prev.sessionWager + delta,
           };
       });
  }, [gameState.crapsUndoStack.length, localBetCost, setGameState]);

  const rebetCraps = useCallback(() => {
      if (gameState.crapsLastRoundBets.length === 0) {
          setGameState(prev => ({ ...prev, message: 'NO PREVIOUS BETS' }));
          return;
      }
      const targetCount = gameState.crapsBets.length + gameState.crapsLastRoundBets.length;
      if (targetCount > CRAPS_MAX_BETS) {
          setGameState(prev => ({ ...prev, message: `BET LIMIT ${CRAPS_MAX_BETS}` }));
          return;
      }
      const rebets = gameState.crapsLastRoundBets.map(b => ({ ...b, local: true }));
      const nextBets = [...gameState.crapsBets, ...rebets];
      const totalRequired = stagedCrapsCost(nextBets);
      if (stats.chips < totalRequired) {
          setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
          return;
      }
      const rebetWager = gameState.crapsLastRoundBets.reduce((a, b) => a + crapsBetCost(b), 0);
      setGameState(prev => ({
          ...prev,
          crapsUndoStack: [...prev.crapsUndoStack, prev.crapsBets],
          crapsBets: [...prev.crapsBets, ...rebets],
          message: 'REBET PLACED',
          sessionWager: prev.sessionWager + rebetWager,
      }));
  }, [gameState.crapsBets, gameState.crapsLastRoundBets, stats.chips, stagedCrapsCost, setGameState]);

  const placeCrapsNumberBet = useCallback((mode: string, num: number) => {
      // Map input mode to bet type
      const betType = mode as CrapsBet['type'];
      if (!isValidCrapsTarget(betType, num)) {
          setGameState(prev => ({ ...prev, message: invalidTargetMessage(betType) }));
          return;
      }
      placeCrapsBet(betType, num);
  }, [placeCrapsBet, setGameState]);

  const executeAddOdds = useCallback((idx: number) => {
      const targetBet = gameState.crapsBets[idx];
      // No odds on the come-out roll for Pass/Don't Pass (Point must be established)
      if ((targetBet.type === 'PASS' || targetBet.type === 'DONT_PASS') && gameState.crapsPoint === null) {
          setGameState(prev => ({ ...prev, message: "WAIT FOR POINT BEFORE ODDS" }));
          return;
      }

      // Total odds = confirmed (chain) + pending (local)
      const confirmedOdds = targetBet.oddsAmount || 0;
      const pendingOdds = targetBet.localOddsAmount || 0;
      const totalCurrentOdds = confirmedOdds + pendingOdds;
      const maxOdds = targetBet.amount * 5; // 5x cap

      if (totalCurrentOdds >= maxOdds) {
          setGameState(prev => ({ ...prev, message: "MAX ODDS REACHED (5X)" }));
          return;
      }

      const oddsToAdd = Math.min(gameState.bet, maxOdds - totalCurrentOdds);

      if (oddsToAdd <= 0) {
          setGameState(prev => ({ ...prev, message: "MAX ODDS REACHED" }));
          return;
      }

      const nextBets = [...gameState.crapsBets];
      nextBets[idx] = { ...nextBets[idx], localOddsAmount: pendingOdds + oddsToAdd };
      const totalRequired = stagedCrapsCost(nextBets);
      if (stats.chips < totalRequired) {
          setGameState(prev => ({ ...prev, message: "INSUFFICIENT FUNDS" }));
          return;
      }

      // Stage odds locally - will be sent to chain with roll
      // The confirmed oddsAmount will be updated from chain state after roll
      setGameState(prev => {
          const bets = [...prev.crapsBets];
          bets[idx] = { ...bets[idx], localOddsAmount: pendingOdds + oddsToAdd };
          return {
              ...prev,
              crapsBets: bets,
              message: `ODDS +$${oddsToAdd} (STAGED)`,
              sessionWager: prev.sessionWager + oddsToAdd
          };
      });
  }, [gameState.crapsBets, gameState.crapsPoint, gameState.bet, stats.chips, stagedCrapsCost, setGameState]);

  const addCrapsOdds = useCallback((selectionIndex?: number) => {
      // If we have a selection index, resolve the pending selection
      if (selectionIndex !== undefined && gameState.crapsOddsCandidates) {
          if (selectionIndex < 0 || selectionIndex >= gameState.crapsOddsCandidates.length) return;
          const targetBetIndex = gameState.crapsOddsCandidates[selectionIndex];
          setGameState(prev => ({ ...prev, crapsOddsCandidates: null })); // Clear selection mode

          executeAddOdds(targetBetIndex);
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
          executeAddOdds(candidates[0].index);
          return;
      }

      // Multiple candidates: Enter selection mode
      setGameState(prev => ({
          ...prev,
          crapsOddsCandidates: candidates.map(c => c.index),
          message: "SELECT BET FOR ODDS (1-9)"
      }));
  }, [gameState.crapsOddsCandidates, gameState.crapsBets, executeAddOdds, setGameState]);

  const rollCraps = useCallback(async (stateOverride?: GameState) => {
       const state = stateOverride ?? gameState;
       const hasSession = !!currentSessionIdRef.current;
       const stagedLocalBets = state.crapsBets.filter(b => b.local === true);
       const betsWithStagedOdds = state.crapsBets.filter(b => (b.localOddsAmount ?? 0) > 0);

       // No auto-rebet - only use explicitly staged bets
       const betsToPlace = stagedLocalBets;
       const invalidBet = betsToPlace.find(b => !isValidCrapsTarget(b.type, b.target));
       if (invalidBet) {
         setGameState(prev => ({ ...prev, message: invalidTargetMessage(invalidBet.type) }));
         return;
       }

       const hasOutstandingBets = hasSession && (state.crapsBets.some(b => !b.local) || state.crapsPoint !== null);

       if (betsToPlace.length === 0 && !hasOutstandingBets) {
         setGameState(prev => ({ ...prev, message: 'PLACE BET FIRST' }));
         return;
       }

       if (isOnChain && chainService && !hasSession) {
         if (betsToPlace.length === 0) {
           setGameState(prev => ({ ...prev, message: 'PLACE BET FIRST' }));
           return;
         }

         autoPlayDraftRef.current = { type: GameType.CRAPS, crapsBets: betsToPlace };
         setGameState(prev => ({ ...prev, message: 'STARTING NEW SESSION...' }));
         startGame(GameType.CRAPS);
         return;
       }

       // On-chain with session: Place any new local bets, send staged odds, then roll dice
       if (isOnChain && chainService && hasSession) {
           if (isPendingRef.current) return;

           try {
             isPendingRef.current = true;

             // Validate session is still active before placing bets
             // This prevents using a stale session that completed after a seven-out
             const isActive = await chainService.isSessionActive(currentSessionIdRef.current!);
             if (isActive === false) {
               currentSessionIdRef.current = null;
               isPendingRef.current = false;
               pendingMoveCountRef.current = 0;
               autoPlayDraftRef.current = { type: GameType.CRAPS, crapsBets: stagedLocalBets };
               setGameState(prev => ({ ...prev, message: 'SESSION ENDED - STARTING NEW...' }));
               startGame(GameType.CRAPS);
               return;
             }

             pendingMoveCountRef.current = stagedLocalBets.length + betsWithStagedOdds.length + 1;

             // First, place any staged local bets on chain (command 0: place bet)
             // Each bet is: [0, bet_type, target, amount:u64 BE]
             for (const bet of stagedLocalBets) {
               const betTypeNum = getBetTypeNum(bet);
               const targetToSend = getTargetForBackend(bet);

               const payload = new Uint8Array(11);
               payload[0] = 0; // Command 0: Place bet
               payload[1] = betTypeNum;
               payload[2] = targetToSend;
               new DataView(payload.buffer).setBigUint64(3, BigInt(bet.amount), false);

               try {
                 const betResult = await chainService.sendMove(currentSessionIdRef.current!, payload);
                 if (betResult.txHash) setLastTxSig(betResult.txHash);
                 armChainResponseTimeout('CRAPS BET', currentSessionIdRef.current);
               } catch (err) {
                 console.error('[useCraps] Bet placement error:', err);
                 throw err;
               }
             }

             // Mark local bets as committed to chain
             if (stagedLocalBets.length > 0) {
               setGameState(prev => ({
                 ...prev,
                 crapsBets: prev.crapsBets.map(b => b.local ? { ...b, local: false } : b),
               }));
             }

             // Second, send any staged odds (command 1: add odds)
             // Each odds is: [1, amount:u64 BE]
             for (const bet of betsWithStagedOdds) {
               const oddsAmount = bet.localOddsAmount!;
               const payload = new Uint8Array(9);
               payload[0] = 1; // Command 1: Add odds
               new DataView(payload.buffer).setBigUint64(1, BigInt(oddsAmount), false);

               const oddsResult = await chainService.sendMove(currentSessionIdRef.current!, payload);
               if (oddsResult.txHash) setLastTxSig(oddsResult.txHash);
               armChainResponseTimeout('CRAPS ODDS', currentSessionIdRef.current);
             }

             // Clear localOddsAmount after sending (chain state will update oddsAmount)
             if (betsWithStagedOdds.length > 0) {
               setGameState(prev => ({
                 ...prev,
                 crapsBets: prev.crapsBets.map(b => b.localOddsAmount ? { ...b, localOddsAmount: 0 } : b),
               }));
             }

             // Then roll dice
             const result = await chainService.sendMove(currentSessionIdRef.current!, new Uint8Array([CrapsMove.Roll]));
             if (result.txHash) setLastTxSig(result.txHash);
             armChainResponseTimeout('CRAPS ROLL', currentSessionIdRef.current);
             setGameState(prev => ({ ...prev, message: 'ROLLING...' }));
           } catch (e) {
               console.error('Roll failed', e);
               isPendingRef.current = false;
               pendingMoveCountRef.current = 0;
               setGameState(prev => ({ ...prev, message: 'ROLL FAILED' }));
           }
           return;
       }

       // Local mode not supported - require on-chain session
       setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));

  }, [gameState.crapsBets, gameState.crapsPoint, currentSessionIdRef, chainService, isOnChain, isPendingRef, pendingMoveCountRef, startGame, setGameState, setLastTxSig, autoPlayDraftRef, armChainResponseTimeout]);

  return {
    placeCrapsBet,
    undoCrapsBet,
    rebetCraps,
    placeCrapsNumberBet,
    addCrapsOdds,
    rollCraps
  };
};
