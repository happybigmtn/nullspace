import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { CasinoGameCompletedEvent } from '@nullspace/types/casino';
import { GameType as ChainGameType } from '@nullspace/types/casino';
import type { CasinoClient } from '../../../api/client';
import { GameState, GameType, PlayerStats } from '../../../types';
import { buildHistoryEntry, parseGameLogs, prependPnlLine } from '../../../utils/gameUtils';
import { logDebug } from '../../../utils/logger';
import { track } from '../../../services/telemetry';
import {
  MAX_GRAPH_POINTS,
  CHAIN_TO_FRONTEND_GAME_TYPE,
  adjustResolvedBetsForNetPnl,
} from '../../../services/games';
import { generateGameResult } from '../generateGameResult';

type CrapsPendingRollLog = {
  sessionId: bigint;
  prevDice: [number, number] | null;
  point: number | null;
  bets: any[];
} | null;

type HandleGameCompletedArgs = {
  currentSessionIdRef: MutableRefObject<bigint | null>;
  setCurrentSessionId: Dispatch<SetStateAction<bigint | null>>;
  clearChainResponseTimeout: () => void;
  gameTypeRef: MutableRefObject<GameType>;
  gameStateRef: MutableRefObject<GameState | null>;
  setGameState: Dispatch<SetStateAction<GameState>>;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  stats: PlayerStats;
  playModeRef: MutableRefObject<'CASH' | 'FREEROLL' | null>;
  lastBalanceUpdateRef: MutableRefObject<number>;
  currentChipsRef: MutableRefObject<number>;
  sessionStartChipsRef: MutableRefObject<Map<bigint, number>>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  crapsPendingRollLogRef: MutableRefObject<CrapsPendingRollLog>;
  crapsChainRollLogRef: MutableRefObject<{ sessionId: bigint; roll: any } | null>;
  clientRef: MutableRefObject<CasinoClient | null>;
  setWalletRng: Dispatch<SetStateAction<number | null>>;
  setWalletVusdt: Dispatch<SetStateAction<number | null>>;
};

export const createGameCompletedHandler = ({
  currentSessionIdRef,
  setCurrentSessionId,
  clearChainResponseTimeout,
  gameTypeRef,
  gameStateRef,
  setGameState,
  setStats,
  stats,
  playModeRef,
  lastBalanceUpdateRef,
  currentChipsRef,
  sessionStartChipsRef,
  isPendingRef,
  pendingMoveCountRef,
  crapsPendingRollLogRef,
  crapsChainRollLogRef,
  clientRef,
  setWalletRng,
  setWalletVusdt,
}: HandleGameCompletedArgs) => (event: CasinoGameCompletedEvent) => {
  const eventSessionId = BigInt(event.sessionId);
  const currentId = currentSessionIdRef.current ? BigInt(currentSessionIdRef.current) : null;

  if (currentId !== null && eventSessionId === currentId) {
    clearChainResponseTimeout();
    const payout = Number(event.payout);
    const finalChips = Number(event.finalChips);
    const balances = event.playerBalances;
    const showTournamentStack =
      balances && playModeRef.current === 'FREEROLL' && balances.activeTournament != null;
    const nextChips = balances
      ? Number(showTournamentStack ? balances.tournamentChips : balances.chips)
      : finalChips;
    const nextShields = balances
      ? Number(showTournamentStack ? balances.tournamentShields : balances.shields)
      : null;
    const nextDoubles = balances
      ? Number(showTournamentStack ? balances.tournamentDoubles : balances.doubles)
      : null;

    lastBalanceUpdateRef.current = Date.now();

    const sessionWager = gameStateRef.current?.sessionWager || 0;
    const interimPayout = gameStateRef.current?.sessionInterimPayout || 0;
    const startChips = sessionStartChipsRef.current.get(eventSessionId);
    const netFromPayout = Number.isFinite(payout)
      ? (payout >= 0 ? (payout + interimPayout - sessionWager) : (payout + interimPayout))
      : NaN;

    let netPnL =
      Number.isFinite(startChips) && Number.isFinite(nextChips)
        ? nextChips - startChips
        : NaN;
    if (!Number.isFinite(netPnL)) {
      netPnL = netFromPayout;
    }
    if (Number.isFinite(netPnL) && netPnL === 0 && Number.isFinite(netFromPayout) && netFromPayout !== 0) {
      netPnL = netFromPayout;
    }
    if (!Number.isFinite(netPnL)) {
      netPnL = 0;
    }

    const eventGameType = CHAIN_TO_FRONTEND_GAME_TYPE[event.gameType as ChainGameType] ?? gameTypeRef.current;
    const parsed = (event.logs && event.logs.length > 0)
      ? parseGameLogs(eventGameType, event.logs, netPnL, gameStateRef.current)
      : null;
    const fallback = generateGameResult(eventGameType, gameStateRef.current, netPnL);
    const isPlaceholder = (summary?: string | null) => {
      if (!summary) return true;
      const normalized = summary.replace(/\.$/, '').trim().toUpperCase();
      return normalized === 'OUTCOME PENDING' || normalized === 'ROUND COMPLETE';
    };
    const resultMessage = parsed && !isPlaceholder(parsed.summary) ? parsed.summary : fallback.summary;
    const resolvedBets = adjustResolvedBetsForNetPnl(parsed?.resolvedBets ?? [], netPnL);
    const rouletteResult = (() => {
      if (eventGameType !== GameType.ROULETTE) return null;
      if (!parsed?.raw || typeof parsed.raw !== 'object') return null;
      const raw: any = parsed.raw;
      const value = raw.result ?? raw.number ?? raw.roll ?? null;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    })();

    const wasSuperRound = gameStateRef.current?.superMode?.isActive || gameStateRef.current?.activeModifiers?.super;
    if (wasSuperRound) {
      track('casino.super.round_completed', {
        game: eventGameType,
        mode: playModeRef.current,
        netPnL,
        wager: sessionWager,
        multipliers: gameStateRef.current?.superMode?.multipliers?.length ?? 0,
        auraMeter: stats.auraMeter,
      });
    }

    setStats(prev => {
      const currentGameType = eventGameType;
      const pnlEntry = { [currentGameType]: (prev.pnlByGame[currentGameType] || 0) + netPnL };
      const historyEntry = buildHistoryEntry(resultMessage, prependPnlLine([], netPnL));

      return {
        ...prev,
        chips: nextChips,
        shields: nextShields !== null ? nextShields : (event.wasShielded ? prev.shields - 1 : prev.shields),
        doubles: nextDoubles !== null ? nextDoubles : (event.wasDoubled ? prev.doubles - 1 : prev.doubles),
        history: [...prev.history, historyEntry],
        pnlByGame: { ...prev.pnlByGame, ...pnlEntry },
        pnlHistory: [...prev.pnlHistory, (prev.pnlHistory[prev.pnlHistory.length - 1] || 0) + netPnL].slice(-MAX_GRAPH_POINTS),
      };
    });

    currentChipsRef.current = nextChips;
    if (balances) {
      setWalletRng(Number(balances.chips));
      setWalletVusdt(Number(balances.vusdtBalance ?? 0));
    }

    if (event.wasShielded || event.wasDoubled) {
      setGameState(prev => ({
        ...prev,
        activeModifiers: { shield: false, double: false, super: prev.activeModifiers.super }
      }));
    }

    setGameState(prev => ({
      ...prev,
      stage: 'RESULT',
      message: resultMessage,
      lastResult: netPnL,
      resolvedBets,
      resolvedBetsKey: resolvedBets.length > 0 ? prev.resolvedBetsKey + 1 : prev.resolvedBetsKey,
      rouletteHistory: rouletteResult === null
        ? prev.rouletteHistory
        : (prev.rouletteHistory[prev.rouletteHistory.length - 1] === rouletteResult
          ? prev.rouletteHistory
          : [...prev.rouletteHistory, rouletteResult].slice(-MAX_GRAPH_POINTS)),
      sessionId: null,
      moveNumber: 0,
      sessionWager: 0,
      sessionInterimPayout: 0,
      rouletteIsPrison: false,
      superMode: null,
    }));

    void (async () => {
      try {
        const client: any = clientRef.current;
        const house: any = await client?.getHouse?.();
        if (house) {
          setGameState(prev => ({
            ...prev,
            threeCardProgressiveJackpot: Number(house.threeCardProgressiveJackpot ?? prev.threeCardProgressiveJackpot),
            uthProgressiveJackpot: Number(house.uthProgressiveJackpot ?? prev.uthProgressiveJackpot),
          }));
        }
      } catch (e) {
        logDebug('[chainEvents] Failed to refresh house state after completion:', e);
      }
    })();

    currentSessionIdRef.current = null;
    setCurrentSessionId(null);
    isPendingRef.current = false;
    pendingMoveCountRef.current = 0;
    crapsPendingRollLogRef.current = null;
    crapsChainRollLogRef.current = null;
    sessionStartChipsRef.current.delete(eventSessionId);
  }
};
