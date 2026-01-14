import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { GameState, GameType, AutoPlayPlan } from '../../types';
import { CasinoChainService } from '../../services/CasinoChainService';
import { logDebug } from '../../utils/logger';
import {
  getBaccaratBetsToPlace,
  serializeBaccaratAtomicBatch,
  serializeRouletteAtomicBatch,
  serializeSicBoAtomicBatch,
  serializeCrapsAtomicBatch,
} from '../../services/games';

type AutoPlayDeps = {
  chainService: CasinoChainService | null;
  autoPlayPlanRef: MutableRefObject<AutoPlayPlan | null>;
  pendingMoveCountRef: MutableRefObject<number>;
  isPendingRef: MutableRefObject<boolean>;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  setGameState: Dispatch<SetStateAction<GameState>>;
  setLastTxSig: (sig: string | null) => void;
};

export const runAutoPlayPlanForSession = (
  sessionId: bigint,
  frontendGameType: GameType,
  {
    chainService,
    autoPlayPlanRef,
    pendingMoveCountRef,
    isPendingRef,
    currentSessionIdRef,
    setGameState,
    setLastTxSig,
  }: AutoPlayDeps,
) => {
  const plan = autoPlayPlanRef.current;
  console.error('[qa-autoplay] runAutoPlayPlanForSession called, session:', sessionId.toString(), 'gameType:', frontendGameType, 'plan:', plan ? `type=${plan.type} planSession=${plan.sessionId?.toString()}` : 'null');
  if (!plan || plan.sessionId !== sessionId) {
    console.error('[qa-autoplay] skipping - no plan or session mismatch');
    return;
  }

  autoPlayPlanRef.current = null;

  if (plan.type !== frontendGameType) {
    console.warn('[autoPlay] plan type mismatch:', plan.type, '!=', frontendGameType);
    return;
  }
  if (!chainService) return;
  if (isPendingRef.current) {
    logDebug('[autoPlay] blocked - transaction pending');
    return;
  }
  if (!currentSessionIdRef.current) return;

  void (async () => {
    isPendingRef.current = true;
    try {
      if (plan.type === GameType.BACCARAT) {
        const betsToPlace = getBaccaratBetsToPlace(
          plan.baccaratSelection,
          plan.baccaratSideBets,
          plan.mainBetAmount,
        );
        pendingMoveCountRef.current = 1;

        setGameState(prev => ({
          ...prev,
          baccaratLastRoundBets: plan.baccaratSideBets,
          baccaratUndoStack: [],
          sessionWager: betsToPlace.reduce((s, b) => s + b.amount, 0),
          message: 'DEALING...',
        }));

        const atomicPayload = serializeBaccaratAtomicBatch(betsToPlace);
        const result = await chainService.sendMove(sessionId, atomicPayload);
        if (result.txHash) setLastTxSig(result.txHash);
        return;
      }

      if (plan.type === GameType.ROULETTE) {
        const ruleByte =
          plan.rouletteZeroRule === 'LA_PARTAGE'
            ? 1
            : plan.rouletteZeroRule === 'EN_PRISON'
              ? 2
              : plan.rouletteZeroRule === 'EN_PRISON_DOUBLE'
                ? 3
                : plan.rouletteZeroRule === 'AMERICAN'
                  ? 4
                  : 0;

        const totalWager = plan.rouletteBets.reduce((s, b) => s + b.amount, 0);
        setGameState(prev => ({ ...prev, sessionWager: totalWager, message: 'PLACING BETS...' }));

        if (ruleByte !== 0) {
          pendingMoveCountRef.current = 2;
          const rulePayload = new Uint8Array([3, ruleByte]);
          const ruleRes = await chainService.sendMove(sessionId, rulePayload);
          if (ruleRes.txHash) setLastTxSig(ruleRes.txHash);
        } else {
          pendingMoveCountRef.current = 1;
        }

        setGameState(prev => ({ ...prev, message: 'SPINNING ON CHAIN...' }));
        const atomicPayload = serializeRouletteAtomicBatch(plan.rouletteBets);
        const result = await chainService.sendMove(sessionId, atomicPayload);
        if (result.txHash) setLastTxSig(result.txHash);

        setGameState(prev => ({
          ...prev,
          rouletteLastRoundBets: plan.rouletteBets,
          rouletteBets: [],
          rouletteUndoStack: [],
        }));
        return;
      }

      if (plan.type === GameType.SIC_BO) {
        pendingMoveCountRef.current = 1;
        const totalWager = plan.sicBoBets.reduce((s, b) => s + b.amount, 0);
        setGameState(prev => ({ ...prev, sessionWager: totalWager, message: 'ROLLING...' }));

        const atomicPayload = serializeSicBoAtomicBatch(plan.sicBoBets);
        const result = await chainService.sendMove(sessionId, atomicPayload);
        if (result.txHash) setLastTxSig(result.txHash);

        setGameState(prev => ({
          ...prev,
          sicBoLastRoundBets: plan.sicBoBets,
          sicBoBets: [],
          sicBoUndoStack: [],
        }));
        return;
      }

      if (plan.type === GameType.CRAPS) {
        pendingMoveCountRef.current = 1;
        const totalWager = plan.crapsBets.reduce((s, b) => s + b.amount, 0);
        setGameState(prev => ({ ...prev, sessionWager: totalWager, message: 'ROLLING...' }));

        const atomicPayload = serializeCrapsAtomicBatch(plan.crapsBets);
        const result = await chainService.sendMove(sessionId, atomicPayload);
        if (result.txHash) setLastTxSig(result.txHash);

        setGameState(prev => ({
          ...prev,
          crapsLastRoundBets: plan.crapsBets,
          crapsBets: [],
          crapsUndoStack: [],
        }));
        return;
      }
    } catch (error) {
      console.error('[autoPlay] execution failed:', error);
      isPendingRef.current = false;
      pendingMoveCountRef.current = 0;
      setGameState(prev => ({ ...prev, message: 'AUTO PLAY FAILED' }));
    }
  })();
};
