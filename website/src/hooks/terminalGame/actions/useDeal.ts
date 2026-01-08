import { useCallback } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { AutoPlayDraft, AutoPlayPlan, GameState, GameType, PlayerStats } from '../../../types';
import type { CasinoChainService } from '../../../services/CasinoChainService';
import {
  CHAIN_TO_FRONTEND_GAME_TYPE,
  getBaccaratBetsToPlace,
  serializeBaccaratAtomicBatch,
} from '../../../services/games';
import { logDebug } from '../../../utils/logger';
import { GameType as ChainGameType } from '@nullspace/types/casino';

type UseDealArgs = {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  isOnChain: boolean;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  setCurrentSessionId: Dispatch<SetStateAction<bigint | null>>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  awaitingChainResponseRef: MutableRefObject<boolean>;
  autoPlayDraftRef: MutableRefObject<AutoPlayDraft | null>;
  autoPlayPlanRef: MutableRefObject<AutoPlayPlan | null>;
  gameTypeRef: MutableRefObject<GameType>;
  clientRef: MutableRefObject<any>;
  parseGameState: (stateBlob: Uint8Array, gameType?: GameType) => void;
  rollCraps: () => void;
  spinRoulette: () => void;
  rollSicBo: () => void;
  startGame: (type: GameType) => Promise<void>;
  setLastTxSig: (sig: string | null) => void;
};

export const useDeal = ({
  gameState,
  setGameState,
  stats,
  setStats,
  isOnChain,
  chainService,
  currentSessionIdRef,
  setCurrentSessionId,
  isPendingRef,
  pendingMoveCountRef,
  awaitingChainResponseRef,
  autoPlayDraftRef,
  autoPlayPlanRef,
  gameTypeRef,
  clientRef,
  parseGameState,
  rollCraps,
  spinRoulette,
  rollSicBo,
  startGame,
  setLastTxSig,
}: UseDealArgs) => {
  return useCallback(async () => {
    if (gameState.type === GameType.NONE) return;

    if (isOnChain && awaitingChainResponseRef.current) {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) return;
      if (autoPlayPlanRef.current) return;

      const makeCrapsRebetDraft = (): AutoPlayDraft | null => {
        const stagedLocalBets = gameState.crapsBets.filter(b => b.local === true);
        if (stagedLocalBets.length > 0) return { type: GameType.CRAPS, crapsBets: stagedLocalBets };
        return null;
      };

      let draft: AutoPlayDraft | null = null;
      if (gameState.type === GameType.BACCARAT) {
        draft = {
          type: GameType.BACCARAT,
          baccaratSelection: gameState.baccaratSelection,
          baccaratSideBets: gameState.baccaratBets,
          mainBetAmount: gameState.bet,
        };
      } else if (gameState.type === GameType.ROULETTE) {
        if (!gameState.rouletteIsPrison) {
          const betsToSpin = gameState.rouletteBets.length > 0 ? gameState.rouletteBets : gameState.rouletteLastRoundBets;
          if (betsToSpin.length > 0) {
            draft = { type: GameType.ROULETTE, rouletteBets: betsToSpin, rouletteZeroRule: gameState.rouletteZeroRule };
          }
        }
      } else if (gameState.type === GameType.SIC_BO) {
        const betsToRoll = gameState.sicBoBets.length > 0 ? gameState.sicBoBets : gameState.sicBoLastRoundBets;
        if (betsToRoll.length > 0) {
          draft = { type: GameType.SIC_BO, sicBoBets: betsToRoll };
        }
      } else if (gameState.type === GameType.CRAPS) {
        draft = makeCrapsRebetDraft();
      }

      if (draft) {
        autoPlayPlanRef.current = { ...draft, sessionId };
      }
      return;
    }

    if (gameState.type === GameType.CRAPS) { rollCraps(); return; }
    if (gameState.type === GameType.ROULETTE) { spinRoulette(); return; }
    if (gameState.type === GameType.SIC_BO) { rollSicBo(); return; }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      const sessionId = currentSessionIdRef.current;

      if (gameState.type === GameType.BACCARAT && gameState.stage === 'PLAYING' && gameState.playerCards.length === 0) {
        if (isPendingRef.current) {
          logDebug('[useDeal] Baccarat manual deal blocked - transaction pending');
          return;
        }
        isPendingRef.current = true;
        try {
          const betsToPlace = getBaccaratBetsToPlace(gameState.baccaratSelection, gameState.baccaratBets, gameState.bet);
          pendingMoveCountRef.current = 1;
          setGameState(prev => ({
            ...prev,
            baccaratLastRoundBets: gameState.baccaratBets,
            baccaratUndoStack: [],
            sessionWager: betsToPlace.reduce((s, b) => s + b.amount, 0),
            message: 'DEALING...',
          }));

          const atomicPayload = serializeBaccaratAtomicBatch(betsToPlace);
          const result = await chainService.sendMove(sessionId, atomicPayload);
          if (result.txHash) setLastTxSig(result.txHash);
          return;
        } catch (error) {
          console.error('[useDeal] Baccarat deal failed:', error);
          setGameState(prev => ({ ...prev, message: 'DEAL FAILED' }));
          isPendingRef.current = false;
          pendingMoveCountRef.current = 0;
          return;
        }
      }

      if (
        gameState.type === GameType.CASINO_WAR
        && (gameState.stage === 'BETTING' || (gameState.stage === 'PLAYING' && gameState.message === 'DEALT'))
      ) {
        if (isPendingRef.current) {
          logDebug('[useDeal] Casino War deal blocked - transaction pending');
          return;
        }

        isPendingRef.current = true;
        try {
          const payload = new Uint8Array([0]);
          const result = await chainService.sendMove(sessionId, payload);
          if (result.txHash) setLastTxSig(result.txHash);
          setGameState(prev => ({ ...prev, message: 'DEALING...' }));
          return;
        } catch (error) {
          console.error('[useDeal] Casino War deal failed:', error);
          setGameState(prev => ({ ...prev, message: 'DEAL FAILED' }));
          isPendingRef.current = false;
          return;
        }
      }

        if (gameState.type === GameType.BLACKJACK) {
        if (isPendingRef.current) {
          logDebug('[useDeal] Blackjack deal/reveal blocked - transaction pending');
          return;
        }

        if (gameState.stage === 'BETTING') {
          isPendingRef.current = true;
          try {
            const sideBet21p3 = gameState.blackjack21Plus3Bet || 0;
            const sideBetLuckyLadies = gameState.blackjackLuckyLadiesBet || 0;
            const sideBetPerfectPairs = gameState.blackjackPerfectPairsBet || 0;
            const sideBetBustIt = gameState.blackjackBustItBet || 0;
            const sideBetRoyalMatch = gameState.blackjackRoyalMatchBet || 0;
            const sideBetTotal =
              sideBet21p3 + sideBetLuckyLadies + sideBetPerfectPairs + sideBetBustIt + sideBetRoyalMatch;
            let payload: Uint8Array;
            if (sideBetTotal > 0) {
              payload = new Uint8Array(41);
              payload[0] = 7;
              new DataView(payload.buffer).setBigUint64(1, BigInt(sideBet21p3), false);
              new DataView(payload.buffer).setBigUint64(9, BigInt(sideBetLuckyLadies), false);
              new DataView(payload.buffer).setBigUint64(17, BigInt(sideBetPerfectPairs), false);
              new DataView(payload.buffer).setBigUint64(25, BigInt(sideBetBustIt), false);
              new DataView(payload.buffer).setBigUint64(33, BigInt(sideBetRoyalMatch), false);
            } else {
              payload = new Uint8Array([4]);
            }

            setGameState(prev => ({
              ...prev,
              message: 'DEALING...',
              lastBet: prev.bet, // LUX-013: Store current bet for REBET
              sessionWager: sideBetTotal > 0 ? prev.sessionWager + sideBetTotal : prev.sessionWager,
            }));
            const result = await chainService.sendMove(sessionId, payload);
            if (result.txHash) setLastTxSig(result.txHash);
            return;
          } catch (error) {
            console.error('[useDeal] Blackjack Deal failed:', error);
            setGameState(prev => ({ ...prev, message: 'DEAL FAILED' }));
            isPendingRef.current = false;
            return;
          }
        }

        if (gameState.message.includes('REVEAL')) {
          isPendingRef.current = true;
          try {
            setGameState(prev => ({ ...prev, message: 'REVEALING...' }));
            const result = await chainService.sendMove(sessionId, new Uint8Array([6]));
            if (result.txHash) setLastTxSig(result.txHash);
            return;
          } catch (error) {
            console.error('[useDeal] Blackjack Reveal failed:', error);
            setGameState(prev => ({ ...prev, message: 'REVEAL FAILED' }));
            isPendingRef.current = false;
            return;
          }
        }
      }

      if (gameState.type === GameType.THREE_CARD) {
        if (isPendingRef.current) {
          logDebug('[useDeal] Three Card deal/reveal blocked - transaction pending');
          return;
        }

        if (gameState.stage === 'BETTING') {
          isPendingRef.current = true;
          try {
            setGameState(prev => ({ ...prev, message: 'DEALING...' }));

            const pairPlusBet = gameState.threeCardPairPlusBet || 0;
            const sixCardBet = gameState.threeCardSixCardBonusBet || 0;
            const progressiveBet = gameState.threeCardProgressiveBet || 0;

            const payload = new Uint8Array(25);
            payload[0] = 7;
            new DataView(payload.buffer).setBigUint64(1, BigInt(pairPlusBet), false);
            new DataView(payload.buffer).setBigUint64(9, BigInt(sixCardBet), false);
            new DataView(payload.buffer).setBigUint64(17, BigInt(progressiveBet), false);

            const totalSideBets = pairPlusBet + sixCardBet + progressiveBet;
            setGameState(prev => ({
              ...prev,
              sessionWager: prev.sessionWager + totalSideBets
            }));

            const result = await chainService.sendMove(sessionId, payload);
            if (result.txHash) setLastTxSig(result.txHash);
            return;
          } catch (error) {
            console.error('[useDeal] Three Card Deal failed:', error);
            setGameState(prev => ({ ...prev, message: 'DEAL FAILED' }));
            isPendingRef.current = false;
            return;
          }
        }

        if (gameState.message.includes('REVEAL')) {
          isPendingRef.current = true;
          try {
            setGameState(prev => ({ ...prev, message: 'REVEALING...' }));
            const result = await chainService.sendMove(sessionId, new Uint8Array([4]));
            if (result.txHash) setLastTxSig(result.txHash);
            return;
          } catch (error) {
            console.error('[useDeal] Three Card Reveal failed:', error);
            setGameState(prev => ({ ...prev, message: 'REVEAL FAILED' }));
            isPendingRef.current = false;
            return;
          }
        }
      }

      if (gameState.type === GameType.ULTIMATE_HOLDEM) {
        if (isPendingRef.current) {
          logDebug('[useDeal] Ultimate Holdem deal/reveal blocked - transaction pending');
          return;
        }

        if (gameState.stage === 'BETTING') {
          isPendingRef.current = true;
          try {
            setGameState(prev => ({ ...prev, message: 'DEALING...' }));

            const tripsBet = gameState.uthTripsBet || 0;
            const sixCardBonusBet = gameState.uthSixCardBonusBet || 0;
            const progressiveBet = gameState.uthProgressiveBet || 0;

            const payload = new Uint8Array(25);
            payload[0] = 11;
            const view = new DataView(payload.buffer);
            view.setBigUint64(1, BigInt(tripsBet), false);
            view.setBigUint64(9, BigInt(sixCardBonusBet), false);
            view.setBigUint64(17, BigInt(progressiveBet), false);

            const totalSideBets = tripsBet + sixCardBonusBet + progressiveBet;
            setGameState(prev => ({
              ...prev,
              sessionWager: totalSideBets,
            }));

            const result = await chainService.sendMove(sessionId, payload);
            if (result.txHash) setLastTxSig(result.txHash);
            return;
          } catch (error) {
            console.error('[useDeal] Ultimate Holdem Deal failed:', error);
            setGameState(prev => ({ ...prev, message: 'DEAL FAILED' }));
            isPendingRef.current = false;
            return;
          }
        }

        if (gameState.message.includes('REVEAL')) {
          isPendingRef.current = true;
          try {
            setGameState(prev => ({ ...prev, message: 'REVEALING...' }));
            const result = await chainService.sendMove(sessionId, new Uint8Array([7]));
            if (result.txHash) setLastTxSig(result.txHash);
            return;
          } catch (error) {
            console.error('[useDeal] Ultimate Holdem Reveal failed:', error);
            setGameState(prev => ({ ...prev, message: 'REVEAL FAILED' }));
            isPendingRef.current = false;
            return;
          }
        }
      }
    }

    if (gameState.stage === 'PLAYING') return;
    if (stats.chips < gameState.bet) {
      setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
      return;
    }

    if (isOnChain && chainService && !currentSessionIdRef.current) {
      if (gameState.type === GameType.BACCARAT) {
        autoPlayDraftRef.current = {
          type: GameType.BACCARAT,
          baccaratSelection: gameState.baccaratSelection,
          baccaratSideBets: gameState.baccaratBets,
          mainBetAmount: gameState.bet,
        };
      }
      startGame(gameState.type);
      return;
    }

    if (isOnChain && chainService && currentSessionIdRef.current) {
      try {
        const client: any = clientRef.current;
        const sessionId = currentSessionIdRef.current;
        if (client && sessionId !== null) {
          const sessionState = await client.getCasinoSession(sessionId);
          if (!sessionState || sessionState.isComplete) {
            currentSessionIdRef.current = null;
            setCurrentSessionId(null);
            isPendingRef.current = false;
            await startGame(gameState.type);
            return;
          }
          const frontendGameType =
            CHAIN_TO_FRONTEND_GAME_TYPE[sessionState.gameType as ChainGameType] ?? gameTypeRef.current;
          gameTypeRef.current = frontendGameType;
          parseGameState(sessionState.stateBlob, frontendGameType);
          isPendingRef.current = false;
          return;
        }
      } catch {
        // ignore
      }
      setGameState(prev => ({ ...prev, message: 'WAITING FOR DEAL...' }));
      return;
    }

    let newShields = stats.shields;
    let newDoubles = stats.doubles;
    if (gameState.activeModifiers.shield) newShields--;
    if (gameState.activeModifiers.double) newDoubles--;
    setStats(prev => ({ ...prev, shields: newShields, doubles: newDoubles }));

    // Dev mode bypass - skip chain requirement for local testing
    const devBypass = import.meta.env.VITE_DEV_OFFLINE_PLAY === 'true';

    if (!isOnChain && !devBypass) {
      setGameState(prev => ({ ...prev, message: 'OFFLINE - CHECK CONNECTION' }));
      return;
    }

    if (devBypass && !isOnChain) {
      // In dev mode without chain, simulate a successful deal with mock response
      setGameState(prev => ({ ...prev, message: 'DEV MODE - SIMULATING...' }));
      return;
    }
  }, [
    autoPlayDraftRef,
    autoPlayPlanRef,
    awaitingChainResponseRef,
    chainService,
    clientRef,
    currentSessionIdRef,
    gameState,
    gameTypeRef,
    isOnChain,
    isPendingRef,
    parseGameState,
    pendingMoveCountRef,
    rollCraps,
    spinRoulette,
    rollSicBo,
    setCurrentSessionId,
    setGameState,
    setLastTxSig,
    setStats,
    startGame,
    stats,
  ]);
};
