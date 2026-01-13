import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameState, RouletteBet, CrapsBet, SicBoBet, BaccaratBet, PlayerStats } from '../../types';
import { GameType } from '../../types';

const QA_BET_AMOUNT = 1;
const QA_TIMEOUT_MS = 120_000;
const QA_SESSION_TIMEOUT_MS = 120_000;
const QA_RUN_TIMEOUT_MS = 900_000;
const QA_POLL_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type QALevel = 'info' | 'success' | 'error' | 'warn';

type QALogEntry = {
  id: number;
  ts: number;
  level: QALevel;
  message: string;
};

type QABetResult = {
  game: GameType;
  bet: string;
  ok: boolean;
  detail?: string;
};

type QABetHarnessProps = {
  enabled: boolean;
  gameState: GameState;
  stats: PlayerStats;
  actions: any;
  lastTxSig: string | null;
  isOnChain: boolean;
  className?: string;
};

type CrapsCase = { label: string; type: CrapsBet['type']; target?: number; requiresPoint?: boolean };

type RouletteCase = { label: string; type: RouletteBet['type']; target?: number };

type SicBoCase = { label: string; type: SicBoBet['type']; target?: number };

type BaccaratCase = { label: string; selection: 'PLAYER' | 'BANKER'; sideBet?: BaccaratBet['type'] };

const encodeDomino = (a: number, b: number) => {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return (min << 4) | max;
};

const encodeHopMask = (values: number[]) => values.reduce((mask, v) => mask | (1 << (v - 1)), 0);

const ROULETTE_CASES: RouletteCase[] = [
  { label: 'Straight 17', type: 'STRAIGHT', target: 17 },
  { label: 'Zero', type: 'ZERO' },
  { label: 'Red', type: 'RED' },
  { label: 'Black', type: 'BLACK' },
  { label: 'Odd', type: 'ODD' },
  { label: 'Even', type: 'EVEN' },
  { label: 'Low', type: 'LOW' },
  { label: 'High', type: 'HIGH' },
  { label: 'Dozen 1', type: 'DOZEN_1' },
  { label: 'Dozen 2', type: 'DOZEN_2' },
  { label: 'Dozen 3', type: 'DOZEN_3' },
  { label: 'Column 1', type: 'COL_1' },
  { label: 'Column 2', type: 'COL_2' },
  { label: 'Column 3', type: 'COL_3' },
  { label: 'Split H', type: 'SPLIT_H', target: 1 },
  { label: 'Split V', type: 'SPLIT_V', target: 1 },
  { label: 'Street', type: 'STREET', target: 1 },
  { label: 'Corner', type: 'CORNER', target: 1 },
  { label: 'Six Line', type: 'SIX_LINE', target: 1 },
];

const CRAPS_CASES: CrapsCase[] = [
  { label: 'Pass', type: 'PASS' },
  { label: 'DontPass', type: 'DONT_PASS' },
  { label: 'Come', type: 'COME', requiresPoint: true },
  { label: 'DontCome', type: 'DONT_COME', requiresPoint: true },
  { label: 'Field', type: 'FIELD' },
  { label: 'Yes 2', type: 'YES', target: 2 },
  { label: 'No 11', type: 'NO', target: 11 },
  { label: 'Next 12', type: 'NEXT', target: 12 },
  { label: 'Hardway 4', type: 'HARDWAY', target: 4 },
  { label: 'Fire', type: 'FIRE' },
  { label: 'ATS Small', type: 'ATS_SMALL' },
  { label: 'ATS Tall', type: 'ATS_TALL' },
  { label: 'ATS All', type: 'ATS_ALL' },
  { label: 'Muggsy', type: 'MUGGSY' },
  { label: 'Diff Doubles', type: 'DIFF_DOUBLES' },
  { label: 'Ride Line', type: 'RIDE_LINE' },
  { label: 'Replay', type: 'REPLAY' },
  { label: 'Hot Roller', type: 'HOT_ROLLER' },
];

const SICBO_CASES: SicBoCase[] = [
  { label: 'Small', type: 'SMALL' },
  { label: 'Big', type: 'BIG' },
  { label: 'Odd', type: 'ODD' },
  { label: 'Even', type: 'EVEN' },
  { label: 'Triple Any', type: 'TRIPLE_ANY' },
  { label: 'Triple 2', type: 'TRIPLE_SPECIFIC', target: 2 },
  { label: 'Double 3', type: 'DOUBLE_SPECIFIC', target: 3 },
  { label: 'Sum 10', type: 'SUM', target: 10 },
  { label: 'Single 6', type: 'SINGLE_DIE', target: 6 },
  { label: 'Domino 1-2', type: 'DOMINO', target: encodeDomino(1, 2) },
  { label: 'Hop3 Easy 1-2-3', type: 'HOP3_EASY', target: encodeHopMask([1, 2, 3]) },
  { label: 'Hop3 Hard 2-4', type: 'HOP3_HARD', target: (2 << 4) | 4 },
  { label: 'Hop4 Easy 1-2-3-4', type: 'HOP4_EASY', target: encodeHopMask([1, 2, 3, 4]) },
];

const BACCARAT_CASES: BaccaratCase[] = [
  { label: 'Main Player', selection: 'PLAYER' },
  { label: 'Main Banker', selection: 'BANKER' },
  { label: 'Side Tie', selection: 'PLAYER', sideBet: 'TIE' },
  { label: 'Side Player Pair', selection: 'PLAYER', sideBet: 'P_PAIR' },
  { label: 'Side Banker Pair', selection: 'PLAYER', sideBet: 'B_PAIR' },
  { label: 'Side Lucky 6', selection: 'PLAYER', sideBet: 'LUCKY6' },
  { label: 'Side Player Dragon', selection: 'PLAYER', sideBet: 'P_DRAGON' },
  { label: 'Side Banker Dragon', selection: 'PLAYER', sideBet: 'B_DRAGON' },
  { label: 'Side Panda 8', selection: 'PLAYER', sideBet: 'PANDA8' },
  { label: 'Side Perfect Pair', selection: 'PLAYER', sideBet: 'PERFECT_PAIR' },
];

const isFailureMessage = (message: string | null | undefined): boolean => {
  if (!message) return false;
  const upper = message.toUpperCase();
  return (
    upper.includes('FAILED') ||
    upper.includes('OFFLINE') ||
    upper.includes('INSUFFICIENT') ||
    upper.includes('INVALID') ||
    upper.includes('PLACE BET') ||
    upper.includes('NO BET')
  );
};

const isCrapsFailureMessage = (message: string | null | undefined): boolean => {
  if (!message) return false;
  const normalized = message.toUpperCase();
  return (
    normalized.includes('FAILED') ||
    normalized.includes('OFFLINE') ||
    normalized.includes('INSUFFICIENT') ||
    normalized.includes('INVALID') ||
    normalized.includes('NO BET')
  );
};

export const QABetHarness: React.FC<QABetHarnessProps> = ({ enabled, gameState, stats, actions, lastTxSig, isOnChain, className }) => {
  const [logs, setLogs] = useState<QALogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const resultsRef = useRef<QABetResult[]>([]);
  const gameStateRef = useRef(gameState);
  const lastTxSigRef = useRef(lastTxSig);
  const statsRef = useRef<PlayerStats>(stats);
  const actionsRef = useRef(actions);
  const logIdRef = useRef(0);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    lastTxSigRef.current = lastTxSig;
  }, [lastTxSig]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const log = useCallback((level: QALevel, message: string) => {
    const entry = { id: logIdRef.current++, ts: Date.now(), level, message };
    setLogs((prev) => [...prev.slice(-199), entry]);
    if (level === 'error') {
      console.error('[qa]', message);
    } else {
      console.log('[qa]', message);
    }
  }, []);

  const clearResults = useCallback(() => {
    resultsRef.current = [];
    setLogs([]);
  }, []);

  const waitFor = useCallback(async (predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = QA_TIMEOUT_MS) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = predicate();
      // Support both sync and async predicates
      if (result instanceof Promise ? await result : result) return;
      await sleep(QA_POLL_MS);
    }
    throw new Error(`Timeout waiting for ${label}`);
  }, []);

  const withTimeout = useCallback(async (promise: Promise<any>, label: string, timeoutMs = QA_RUN_TIMEOUT_MS): Promise<any> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise.then((value) => {
          if (timer) clearTimeout(timer);
          return value;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timeout waiting for ${label}`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const ensureChips = useCallback(async (label: string) => {
    if (!isOnChain) return;
    log('info', `ensureChips(${label}) - chips=${statsRef.current.chips}`);
    if (statsRef.current.chips >= QA_BET_AMOUNT) {
      return;
    }
    if (!actionsRef.current?.claimFaucet) {
      throw new Error('Missing claimFaucet action');
    }
    log('info', `Claiming faucet before ${label}`);
    await actionsRef.current?.claimFaucet();
    await waitFor(() => statsRef.current.chips >= QA_BET_AMOUNT, `faucet funds (${label})`, 30_000);
    log('success', `Faucet ready for ${label} chips=${statsRef.current.chips}`);
  }, [isOnChain, log, waitFor]);

  const ensureGame = useCallback(async (type: GameType) => {
    if (!actionsRef.current?.startGame) throw new Error('Missing startGame action');
    // Be tolerant of transient failures to switch games (e.g. slow state update); retry a couple times.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await actionsRef.current.startGame(type);
      try {
        await waitFor(() => gameStateRef.current.type === type, `game type ${type}`, QA_SESSION_TIMEOUT_MS);
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await sleep(250);
      }
    }
    await waitFor(
      () => {
        const message = String(gameStateRef.current.message || '').toUpperCase();
        return !message.includes('STARTING') && !message.includes('WAITING FOR CHAIN');
      },
      `game ready ${type}`,
      QA_SESSION_TIMEOUT_MS
    );
    if (isOnChain) {
      // Wait for sessionId with HTTP fallback poll if WebSocket doesn't deliver
      let lastHttpPoll = 0;
      await waitFor(
        async () => {
          // First check if we already have sessionId from WebSocket
          if (gameStateRef.current.sessionId !== null) {
            return true;
          }
          // HTTP fallback: poll player state every 2s if WebSocket hasn't delivered
          const now = Date.now();
          if (now - lastHttpPoll > 2000 && actionsRef.current?.getPlayerState) {
            lastHttpPoll = now;
            try {
              const playerState = await actionsRef.current.getPlayerState();
              if (playerState?.activeSession) {
                log('info', `[ensureGame] Got sessionId from HTTP fallback: ${playerState.activeSession}`);
                // Use syncSessionId to update both the ref and state (fixes move submission)
                const sessionBigInt = BigInt(playerState.activeSession);
                if (actionsRef.current?.syncSessionId) {
                  actionsRef.current.syncSessionId(sessionBigInt);
                } else if (actionsRef.current?.setGameState) {
                  // Fallback for backwards compatibility
                  actionsRef.current.setGameState((prev: GameState) => ({
                    ...prev,
                    sessionId: sessionBigInt,
                  }));
                }
                return true;
              }
            } catch {
              // HTTP poll failed, continue waiting for WebSocket
            }
          }
          return false;
        },
        `session ready ${type}`,
        QA_SESSION_TIMEOUT_MS
      );
    }
  }, [isOnChain, log, waitFor]);

  const setBetAmount = useCallback(() => {
    actionsRef.current?.setBetAmount?.(QA_BET_AMOUNT);
  }, []);

  const clearTableBets = useCallback((type: GameType) => {
    if (!actionsRef.current?.setGameState) return;
    actionsRef.current.setGameState((prev: GameState) => {
      if (type === 'ROULETTE') {
        return { ...prev, rouletteBets: [], rouletteUndoStack: [], rouletteLastRoundBets: [], rouletteInputMode: 'NONE' };
      }
      if (type === 'CRAPS') {
        return { ...prev, crapsBets: [], crapsUndoStack: [], crapsLastRoundBets: [], crapsOddsCandidates: null, crapsInputMode: 'NONE' };
      }
      if (type === 'SIC_BO') {
        return { ...prev, sicBoBets: [], sicBoUndoStack: [], sicBoLastRoundBets: [], sicBoInputMode: 'NONE' };
      }
      if (type === 'BACCARAT') {
        return { ...prev, baccaratBets: [], baccaratUndoStack: [], baccaratLastRoundBets: [] };
      }
      return prev;
    });
  }, []);

  const runTx = useCallback(async (label: string, action?: () => Promise<void> | void, ack?: () => boolean) => {
    if (!action) {
      throw new Error(`Missing action for ${label}`);
    }
    const prev = lastTxSigRef.current;
    const prevMove = gameStateRef.current.moveNumber ?? 0;
    await action();
    try {
      await waitFor(
        () => {
          const nextSig = lastTxSigRef.current;
          const nextMove = gameStateRef.current.moveNumber ?? 0;
          if (nextSig && nextSig !== prev) return true;
          if (nextMove !== prevMove) return true;
          if (ack) {
            try {
              return Boolean(ack());
            } catch {
              return false;
            }
          }
          return false;
        },
        `${label} tx`
      );
    } catch (error: any) {
      log('info', `Tx not observed for ${label}: ${error?.message ?? String(error)}`);
    }
  }, [log, waitFor]);

  const ensureCrapsPoint = useCallback(async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const point = gameStateRef.current.crapsPoint;
      if (point !== null && point !== undefined) return;
      clearTableBets(GameType.CRAPS);
      const baseState = {
        ...gameStateRef.current,
        bet: QA_BET_AMOUNT,
        crapsBets: [],
        crapsUndoStack: [],
        crapsLastRoundBets: [],
        crapsOddsCandidates: null,
      };
      actionsRef.current?.placeCrapsBet?.('PASS', undefined, baseState, statsRef.current);
      const passOverride = {
        ...gameStateRef.current,
        crapsBets: [{
          type: 'PASS',
          amount: QA_BET_AMOUNT,
          status: 'ON',
          local: true,
        }],
      };
      await actionsRef.current?.rollCraps?.(passOverride);
      const prevDice = gameStateRef.current.dice ?? [];
      await waitFor(
        () => {
          const dice = gameStateRef.current.dice ?? [];
          const hasDice = dice.length >= 2 && dice[0] > 0 && dice[1] > 0;
          const diceChanged = hasDice && (dice[0] !== prevDice[0] || dice[1] !== prevDice[1]);
          return diceChanged || gameStateRef.current.crapsPoint !== null || isCrapsFailureMessage(gameStateRef.current.message);
        },
        'craps point roll'
      );
      if (isCrapsFailureMessage(gameStateRef.current.message)) {
        throw new Error(gameStateRef.current.message);
      }
      if (gameStateRef.current.crapsPoint !== null) return;
    }
    throw new Error('Failed to establish craps point');
  }, [clearTableBets, waitFor]);

  const runRoulette = useCallback(async () => {
    const results: QABetResult[] = [];
    await ensureChips('roulette');
    for (const betCase of ROULETTE_CASES) {
      const label = `roulette:${betCase.label}`;
      try {
        log('info', `Starting ${label}`);
        await ensureGame(GameType.ROULETTE);
        clearTableBets(GameType.ROULETTE);
        setBetAmount();
        const rouletteState = {
          ...gameStateRef.current,
          bet: QA_BET_AMOUNT,
          rouletteBets: [],
          rouletteUndoStack: [],
          rouletteLastRoundBets: [],
        };
        actionsRef.current?.placeRouletteBet?.(betCase.type, betCase.target, rouletteState, statsRef.current);
        if (isFailureMessage(gameStateRef.current.message)) {
          throw new Error(gameStateRef.current.message);
        }
        const rouletteOverride = {
          ...gameStateRef.current,
          rouletteBets: [{ type: betCase.type, amount: QA_BET_AMOUNT, target: betCase.target }],
        };
        const prevHistoryLen = gameStateRef.current.rouletteHistory?.length ?? 0;
        const prevMessage = String(gameStateRef.current.message ?? '');
        const prevSessionId = gameStateRef.current.sessionId ?? null;
        if (!actionsRef.current?.spinRoulette) {
          throw new Error('Missing spinRoulette action');
        }
        await actionsRef.current.spinRoulette(rouletteOverride);
        await waitFor(
          () => {
            const state = gameStateRef.current;
            const historyLen = state.rouletteHistory?.length ?? 0;
            if (historyLen > prevHistoryLen) return true;
            const message = String(state.message ?? '');
            const normalized = message.toUpperCase();
            const prevNormalized = prevMessage.toUpperCase();
            if (normalized !== prevNormalized) {
              if (
                normalized.startsWith('ROLL:') ||
                normalized.startsWith('LANDED') ||
                normalized.includes('EN PRISON') ||
                normalized.includes('SYNCED FROM CHAIN')
              ) {
                return true;
              }
            }
            if (prevSessionId && state.sessionId === null && state.stage === 'RESULT') {
              return true;
            }
            return isFailureMessage(state.message);
          },
          `roulette result ${betCase.label}`,
          QA_TIMEOUT_MS
        );
        if (isCrapsFailureMessage(gameStateRef.current.message)) {
          throw new Error(gameStateRef.current.message);
        }
        results.push({ game: GameType.ROULETTE, bet: betCase.label, ok: true });
        log('success', `Completed ${label}`);
      } catch (error: any) {
        const detail = error?.message ?? String(error);
        const context = `msg=${gameStateRef.current.message ?? ''} session=${gameStateRef.current.sessionId ?? 'null'} move=${gameStateRef.current.moveNumber ?? 'null'}`;
        // No soft-pass: failures are real failures, report them accurately
        results.push({ game: GameType.ROULETTE, bet: betCase.label, ok: false, detail: `${detail} (${context})` });
        log('error', `Failed ${label}: ${detail} (${context})`);
      }
    }
    return results;
  }, [clearTableBets, ensureChips, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runCraps = useCallback(async () => {
    const results: QABetResult[] = [];
    await ensureChips('craps');
    for (const betCase of CRAPS_CASES) {
      const label = `craps:${betCase.label}`;
      try {
        log('info', `Starting ${label}`);
        await ensureGame(GameType.CRAPS);
        clearTableBets(GameType.CRAPS);
        setBetAmount();
        if (betCase.requiresPoint) {
          await ensureCrapsPoint();
        }
        const crapsState = {
          ...gameStateRef.current,
          bet: QA_BET_AMOUNT,
          crapsBets: [],
          crapsUndoStack: [],
          crapsLastRoundBets: [],
          crapsOddsCandidates: null,
        };
        actionsRef.current?.placeCrapsBet?.(betCase.type, betCase.target, crapsState, statsRef.current);
        if (isCrapsFailureMessage(gameStateRef.current.message)) {
          throw new Error(gameStateRef.current.message);
        }
        const crapsOverride = {
          ...gameStateRef.current,
          crapsBets: [{
            type: betCase.type,
            amount: QA_BET_AMOUNT,
            target: betCase.target,
            status: (betCase.type === 'COME' || betCase.type === 'DONT_COME') ? 'PENDING' : 'ON',
            local: true,
          }],
        };
        const prevRollLen = gameStateRef.current.crapsRollHistory?.length ?? 0;
        const prevSig = lastTxSigRef.current;
        const prevMove = gameStateRef.current.moveNumber ?? 0;
        if (!actionsRef.current?.rollCraps) {
          throw new Error('Missing rollCraps action');
        }
        await actionsRef.current.rollCraps(crapsOverride);
        await waitFor(
          () => {
            const dice = gameStateRef.current.dice ?? [];
            const hasDice = dice.length >= 2 && dice[0] > 0 && dice[1] > 0;
            const nextSig = lastTxSigRef.current;
            const nextMove = gameStateRef.current.moveNumber ?? 0;
            const moved = Boolean((nextSig && nextSig !== prevSig) || nextMove !== prevMove);
            return hasDice ||
              moved ||
              (gameStateRef.current.crapsRollHistory?.length ?? 0) > prevRollLen ||
              isCrapsFailureMessage(gameStateRef.current.message);
          },
          `craps roll ${betCase.label}`,
          QA_TIMEOUT_MS
        );
        if (isCrapsFailureMessage(gameStateRef.current.message)) {
          throw new Error(gameStateRef.current.message);
        }
        results.push({ game: GameType.CRAPS, bet: betCase.label, ok: true });
        log('success', `Completed ${label}`);
      } catch (error: any) {
        const detail = error?.message ?? String(error);
        // No soft-pass: "INVALID MOVE" is a real failure indicating state desync
        results.push({ game: GameType.CRAPS, bet: betCase.label, ok: false, detail });
        log('error', `Failed ${label}: ${detail}`);
      }
    }
    return results;
  }, [clearTableBets, ensureChips, ensureCrapsPoint, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runSicBo = useCallback(async () => {
    const results: QABetResult[] = [];
    await ensureChips('sicbo');
    for (const betCase of SICBO_CASES) {
      const label = `sicbo:${betCase.label}`;
      try {
        log('info', `Starting ${label}`);
        await ensureGame(GameType.SIC_BO);
        clearTableBets(GameType.SIC_BO);
        setBetAmount();
        const sicBoState = {
          ...gameStateRef.current,
          bet: QA_BET_AMOUNT,
          sicBoBets: [],
          sicBoUndoStack: [],
          sicBoLastRoundBets: [],
        };
        actionsRef.current?.placeSicBoBet?.(betCase.type, betCase.target, sicBoState, statsRef.current);
        if (isFailureMessage(gameStateRef.current.message)) {
          throw new Error(gameStateRef.current.message);
        }
        if (String(gameStateRef.current.message ?? '').toUpperCase().startsWith('OUTCOME PENDING')) {
          log('info', `Roulette outcome pending for ${label} - session closed`);
        }
        const sicBoOverride = {
          ...gameStateRef.current,
          sicBoBets: [{ type: betCase.type, amount: QA_BET_AMOUNT, target: betCase.target }],
        };
        const prevHistoryLen = gameStateRef.current.sicBoHistory?.length ?? 0;
        const prevSig = lastTxSigRef.current;
        const prevMove = gameStateRef.current.moveNumber ?? 0;
        if (!actionsRef.current?.rollSicBo) {
          throw new Error('Missing rollSicBo action');
        }
        await actionsRef.current.rollSicBo(sicBoOverride);
        await waitFor(
          () => {
            const dice = gameStateRef.current.dice ?? [];
            const hasDice = dice.length >= 3 && dice[0] > 0 && dice[1] > 0 && dice[2] > 0;
            const nextSig = lastTxSigRef.current;
            const nextMove = gameStateRef.current.moveNumber ?? 0;
            const moved = Boolean((nextSig && nextSig !== prevSig) || nextMove !== prevMove);
            return hasDice ||
              moved ||
              (gameStateRef.current.sicBoHistory?.length ?? 0) > prevHistoryLen ||
              isFailureMessage(gameStateRef.current.message);
          },
          `sicbo roll ${betCase.label}`,
          QA_TIMEOUT_MS
        );
        if (isFailureMessage(gameStateRef.current.message)) {
          throw new Error(gameStateRef.current.message);
        }
        results.push({ game: GameType.SIC_BO, bet: betCase.label, ok: true });
        log('success', `Completed ${label}`);
      } catch (error: any) {
        const detail = error?.message ?? String(error);
        results.push({ game: GameType.SIC_BO, bet: betCase.label, ok: false, detail });
        log('error', `Failed ${label}: ${detail}`);
      }
    }
    return results;
  }, [clearTableBets, ensureChips, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runBaccarat = useCallback(async () => {
    const results: QABetResult[] = [];
    await ensureChips('baccarat');
    for (const betCase of BACCARAT_CASES) {
      const label = `baccarat:${betCase.label}`;
      try {
        log('info', `Starting ${label}`);
        await ensureGame(GameType.BACCARAT);
        clearTableBets(GameType.BACCARAT);
        setBetAmount();
        actionsRef.current?.baccaratActions?.toggleSelection?.(betCase.selection);
        if (betCase.sideBet) {
          actionsRef.current?.baccaratActions?.placeBet?.(betCase.sideBet);
        }
        await runTx(label, actionsRef.current?.deal);
        if (isFailureMessage(gameStateRef.current.message)) {
          throw new Error(gameStateRef.current.message);
        }
        results.push({ game: GameType.BACCARAT, bet: betCase.label, ok: true });
        log('success', `Completed ${label}`);
      } catch (error: any) {
        const detail = error?.message ?? String(error);
        results.push({ game: GameType.BACCARAT, bet: betCase.label, ok: false, detail });
        log('error', `Failed ${label}: ${detail}`);
      }
    }
    return results;
  }, [clearTableBets, ensureChips, ensureGame, log, runTx, setBetAmount]);

  const runBlackjack = useCallback(async () => {
    const results: QABetResult[] = [];
    const label = 'blackjack:21+3';
    try {
      log('info', `Starting ${label}`);
      await ensureChips('blackjack');
      await ensureGame(GameType.BLACKJACK);
      setBetAmount();
      actionsRef.current?.bjToggle21Plus3?.();
      await runTx(label, actionsRef.current?.deal);
      await waitFor(
        () => gameStateRef.current.stage === 'PLAYING' || gameStateRef.current.stage === 'RESULT',
        'blackjack playing'
      );
      if (gameStateRef.current.blackjackActions?.canStand) {
        await runTx(`${label}-stand`, actionsRef.current?.bjStand);
      }
      await waitFor(
        () => String(gameStateRef.current.message || '').toUpperCase().includes('REVEAL') ||
          gameStateRef.current.stage === 'RESULT',
        'blackjack reveal'
      );
      if (gameStateRef.current.stage !== 'RESULT') {
        await actionsRef.current?.deal?.();
        await waitFor(() => gameStateRef.current.stage === 'RESULT', 'blackjack result');
      }
      results.push({ game: GameType.BLACKJACK, bet: '21+3', ok: true });
      log('success', `Completed ${label}`);
    } catch (error: any) {
      const detail = error?.message ?? String(error);
      results.push({ game: GameType.BLACKJACK, bet: '21+3', ok: false, detail });
      log('error', `Failed ${label}: ${detail}`);
    }
    return results;
  }, [ensureChips, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runThreeCard = useCallback(async () => {
    const results: QABetResult[] = [];
    const label = 'three-card:side-bets';
    try {
      log('info', `Starting ${label}`);
      await ensureChips('three-card');
      await ensureGame(GameType.THREE_CARD);
      setBetAmount();
      actionsRef.current?.threeCardTogglePairPlus?.();
      actionsRef.current?.threeCardToggleSixCardBonus?.();
      actionsRef.current?.threeCardToggleProgressive?.();
      await runTx(label, actionsRef.current?.deal);
      await waitFor(
        () => gameStateRef.current.stage === 'PLAYING' || gameStateRef.current.stage === 'RESULT',
        'three-card playing'
      );
      await runTx(`${label}-fold`, actionsRef.current?.threeCardFold);
      await waitFor(
        () => String(gameStateRef.current.message || '').toUpperCase().includes('REVEAL') ||
          gameStateRef.current.stage === 'RESULT',
        'three-card reveal'
      );
      if (gameStateRef.current.stage !== 'RESULT') {
        await runTx(`${label}-reveal`, actionsRef.current?.deal);
        await waitFor(() => gameStateRef.current.stage === 'RESULT', 'three-card result');
      }
      results.push({ game: GameType.THREE_CARD, bet: 'Side bets', ok: true });
      log('success', `Completed ${label}`);
    } catch (error: any) {
      const detail = error?.message ?? String(error);
      results.push({ game: GameType.THREE_CARD, bet: 'Side bets', ok: false, detail });
      log('error', `Failed ${label}: ${detail}`);
    }
    return results;
  }, [ensureChips, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runUltimateHoldem = useCallback(async () => {
    const results: QABetResult[] = [];
    const label = 'uth:side-bets';
    try {
      log('info', `Starting ${label}`);
      await ensureChips('ultimate holdem');
      await ensureGame(GameType.ULTIMATE_HOLDEM);
      setBetAmount();
      actionsRef.current?.uthToggleTrips?.();
      actionsRef.current?.uthToggleSixCardBonus?.();
      actionsRef.current?.uthToggleProgressive?.();
      await runTx(label, actionsRef.current?.deal);
      await waitFor(() => gameStateRef.current.stage === 'PLAYING', 'uth playing');

      for (let step = 0; step < 3; step += 1) {
        const message = String(gameStateRef.current.message || '').toUpperCase();
        if (message.includes('CHECK')) {
          await runTx(`${label}-check`, actionsRef.current?.uhCheck);
          await waitFor(() => String(gameStateRef.current.message || '').toUpperCase() !== message, 'uth stage advance', 10_000);
        }
      }

      const message = String(gameStateRef.current.message || '').toUpperCase();
      if (message.includes('FOLD')) {
        await runTx(`${label}-fold`, actionsRef.current?.uhFold);
      } else if (message.includes('BET 1X')) {
        await runTx(`${label}-bet1x`, () => actionsRef.current?.uhBet?.(1));
      }

      const revealOrResult = () => {
        const nextMessage = String(gameStateRef.current.message || '').toUpperCase();
        return nextMessage.includes('REVEAL') || gameStateRef.current.stage === 'RESULT';
      };
      if (!revealOrResult()) {
        await waitFor(revealOrResult, 'uth reveal');
      }
      if (gameStateRef.current.stage !== 'RESULT') {
        await runTx(`${label}-reveal`, actionsRef.current?.deal);
      }

      await waitFor(() => gameStateRef.current.stage === 'RESULT', 'uth result');
      results.push({ game: GameType.ULTIMATE_HOLDEM, bet: 'Side bets', ok: true });
      log('success', `Completed ${label}`);
    } catch (error: any) {
      const detail = error?.message ?? String(error);
      results.push({ game: GameType.ULTIMATE_HOLDEM, bet: 'Side bets', ok: false, detail });
      log('error', `Failed ${label}: ${detail}`);
    }
    return results;
  }, [ensureChips, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runCasinoWar = useCallback(async () => {
    const results: QABetResult[] = [];
    const label = 'casino-war:tie-bet';
    try {
      log('info', `Starting ${label}`);
      await ensureChips('casino war');
      await ensureGame(GameType.CASINO_WAR);
      setBetAmount();
      await actionsRef.current?.casinoWarToggleTieBet?.();
      await runTx(label, actionsRef.current?.deal);
      const warMessage = String(gameStateRef.current.message || '').toUpperCase();
      if (warMessage.includes('WAR')) {
        await runTx(`${label}-war`, actionsRef.current?.casinoWarGoToWar);
      }
      try {
        await waitFor(
          () => !String(gameStateRef.current.message || '').toUpperCase().includes('DEALING'),
          'casino war settle',
          5_000
        );
      } catch {
        // Ignore: casino war can reset to betting quickly on-chain.
      }
      results.push({ game: GameType.CASINO_WAR, bet: 'Tie bet', ok: true });
      log('success', `Completed ${label}`);
    } catch (error: any) {
      const detail = error?.message ?? String(error);
      results.push({ game: GameType.CASINO_WAR, bet: 'Tie bet', ok: false, detail });
      log('error', `Failed ${label}: ${detail}`);
    }
    return results;
  }, [ensureChips, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runVideoPoker = useCallback(async () => {
    const results: QABetResult[] = [];
    const label = 'video-poker:base';
    try {
      log('info', `Starting ${label}`);
      await ensureChips('video poker');
      await ensureGame(GameType.VIDEO_POKER);
      setBetAmount();
      await runTx(
        label,
        actionsRef.current?.deal,
        () => String(gameStateRef.current.message || '').toUpperCase().includes('DRAW') || gameStateRef.current.stage === 'PLAYING'
      );
      await waitFor(() => String(gameStateRef.current.message || '').toUpperCase().includes('DRAW'), 'video poker draw');
      await runTx(`${label}-draw`, actionsRef.current?.drawVideoPoker, () => gameStateRef.current.stage === 'RESULT');
      await waitFor(() => gameStateRef.current.stage === 'RESULT', 'video poker result');
      results.push({ game: GameType.VIDEO_POKER, bet: 'Base', ok: true });
      log('success', `Completed ${label}`);
    } catch (error: any) {
      const detail = error?.message ?? String(error);
      results.push({ game: GameType.VIDEO_POKER, bet: 'Base', ok: false, detail });
      log('error', `Failed ${label}: ${detail}`);
    }
    return results;
  }, [ensureChips, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runHiLo = useCallback(async () => {
    const results: QABetResult[] = [];
    const label = 'hilo:base';
    try {
      log('info', `Starting ${label}`);
      await ensureChips('hi-lo');
      await ensureGame(GameType.HILO);
      setBetAmount();
      await runTx(label, actionsRef.current?.deal, () => gameStateRef.current.stage === 'PLAYING');
      await waitFor(() => gameStateRef.current.stage === 'PLAYING', 'hilo playing');
      const prevCardCount = gameStateRef.current.playerCards?.length ?? 0;
      await runTx(
        `${label}-guess`,
        () => actionsRef.current?.hiloPlay?.('HIGHER'),
        () => (gameStateRef.current.playerCards?.length ?? 0) > prevCardCount
      );
      await waitFor(
        () => (gameStateRef.current.playerCards?.length ?? 0) > prevCardCount,
        'hilo card advance'
      );
      await runTx(`${label}-cashout`, actionsRef.current?.hiloCashout, () => gameStateRef.current.stage === 'RESULT');
      await waitFor(() => gameStateRef.current.stage === 'RESULT', 'hilo result');
      results.push({ game: GameType.HILO, bet: 'Base', ok: true });
      log('success', `Completed ${label}`);
    } catch (error: any) {
      const detail = error?.message ?? String(error);
      results.push({ game: GameType.HILO, bet: 'Base', ok: false, detail });
      log('error', `Failed ${label}: ${detail}`);
    }
    return results;
  }, [ensureChips, ensureGame, log, runTx, setBetAmount, waitFor]);

  const runAll = useCallback(async () => {
    if (!isOnChain) {
      throw new Error('On-chain connection required for QA bet suite');
    }
    const results: QABetResult[] = [];
    if (actionsRef.current?.forceSyncNonce) {
      try {
        log('info', 'QA: force syncing nonce from chain');
        await actionsRef.current.forceSyncNonce();
      } catch (error: any) {
        log('warn', `QA: nonce sync failed: ${error?.message ?? String(error)}`);
      }
    }
    // Helper to re-sync nonce periodically to prevent drift during long suite runs
    const maybeResyncNonce = async () => {
      if (actionsRef.current?.forceSyncNonce) {
        try {
          await actionsRef.current.forceSyncNonce();
        } catch {
          // Non-fatal, continue with current nonce
        }
      }
    };

    log('info', `runAll: start chips=${statsRef.current.chips} session=${gameStateRef.current?.sessionId ?? 'null'}`);
    results.push(...await runRoulette());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runCraps());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runSicBo());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runBaccarat());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runBlackjack());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runThreeCard());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runCasinoWar());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runVideoPoker());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runHiLo());
    resultsRef.current = results;
    await maybeResyncNonce();
    results.push(...await runUltimateHoldem());
    resultsRef.current = results;
    log('success', `runAll: complete total=${results.length} failures=${results.filter(r => !r.ok).length}`);
    return results;
  }, [isOnChain, log, runBaccarat, runBlackjack, runCasinoWar, runCraps, runHiLo, runRoulette, runSicBo, runThreeCard, runUltimateHoldem, runVideoPoker]);

  const runAllWithState = useCallback(async () => {
    setRunning(true);
    try {
      const results = await withTimeout(runAll(), 'runAll');
      resultsRef.current = results;
      return results;
    } catch (error: any) {
      const errorMsg = error?.message ?? String(error);
      log('error', `runAll failed: ${errorMsg}`);
      if (errorMsg.includes('Timeout waiting for runAll')) {
        // On timeout, return partial results with a clear TIMEOUT marker at the end
        const partialResults = [...resultsRef.current];
        partialResults.push({
          game: 'TIMEOUT' as GameType,
          bet: 'runAll',
          ok: false,
          detail: `Suite timed out after partial completion. ${partialResults.length} tests ran before timeout.`,
        });
        log('error', `TIMEOUT: Suite did not complete. Partial results: ${partialResults.filter(r => r.ok).length}/${partialResults.length - 1} passed before timeout.`);
        return partialResults;
      }
      throw error;
    } finally {
      setRunning(false);
    }
  }, [log, runAll, withTimeout]);

  const runGame = useCallback(async (type: GameType) => {
    setRunning(true);
    try {
      if (actionsRef.current?.forceSyncNonce) {
        try {
          log('info', 'QA: force syncing nonce from chain');
          await actionsRef.current.forceSyncNonce();
        } catch (error: any) {
          log('warn', `QA: nonce sync failed: ${error?.message ?? String(error)}`);
        }
      }
      let results: QABetResult[] = [];
      if (type === GameType.ROULETTE) results = await runRoulette();
      else if (type === GameType.CRAPS) results = await runCraps();
      else if (type === GameType.SIC_BO) results = await runSicBo();
      else if (type === GameType.BACCARAT) results = await runBaccarat();
      else if (type === GameType.BLACKJACK) results = await runBlackjack();
      else if (type === GameType.THREE_CARD) results = await runThreeCard();
      else if (type === GameType.ULTIMATE_HOLDEM) results = await runUltimateHoldem();
      else if (type === GameType.CASINO_WAR) results = await runCasinoWar();
      else if (type === GameType.VIDEO_POKER) results = await runVideoPoker();
      else if (type === GameType.HILO) results = await runHiLo();
      const bounded = await withTimeout(Promise.resolve(results), `runGame:${type}`);
      resultsRef.current = bounded;
      return bounded;
    } catch (error: any) {
      log('error', `runGame failed: ${error?.message ?? String(error)}`);
      throw error;
    } finally {
      setRunning(false);
    }
  }, [log, runBaccarat, runBlackjack, runCasinoWar, runCraps, runHiLo, runRoulette, runSicBo, runThreeCard, runUltimateHoldem, runVideoPoker, withTimeout]);

  useEffect(() => {
    if (!enabled) return;
    const api = {
      runAllBets: runAllWithState,
      runGameBets: runGame,
      getResults: () => resultsRef.current,
      clearResults,
      getLogs: () => logs,
      isRunning: () => running,
      getStatus: () => ({
        isOnChain,
        gameType: gameStateRef.current?.type ?? null,
        stage: gameStateRef.current?.stage ?? null,
        message: gameStateRef.current?.message ?? null,
        sessionId: gameStateRef.current?.sessionId ?? null,
      }),
      getDebug: () => ({
        stats: statsRef.current,
        gameState: gameStateRef.current,
        lastTxSig: lastTxSigRef.current,
        running,
      }),
    } as any;
    (window as any).__qa = api;
    return () => {
      if ((window as any).__qa === api) {
        delete (window as any).__qa;
      }
    };
  }, [enabled, clearResults, logs, runAllWithState, runGame, running]);

  const summary = useMemo(() => {
    const results = resultsRef.current;
    const total = results.length;
    const failures = results.filter((r) => !r.ok).length;
    return { total, failures };
  }, [running, logs]);

  if (!enabled) return null;

  return (
    <div className={`fixed bottom-4 left-4 z-[120] w-[320px] rounded-2xl liquid-card liquid-sheen border border-ns p-4 shadow-float ${className ?? ''}`}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold tracking-[0.2em] text-ns-muted uppercase">QA Bets</div>
        <div className={`text-[10px] font-bold ${running ? 'text-mono-0 dark:text-mono-1000' : summary.failures ? 'text-mono-400 dark:text-mono-500' : 'text-mono-0 dark:text-mono-1000 font-bold'}`}>
          {running ? 'RUNNING' : summary.failures ? `${summary.failures} FAIL` : 'READY'}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="qa-run-bet-suite"
          className="flex-1 rounded-full border border-mono-0 bg-mono-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white"
          disabled={running}
          onClick={() => {
            clearResults();
            void runAllWithState();
          }}
        >
          Run All
        </button>
        <button
          type="button"
          data-testid="qa-clear-bet-suite"
          className="rounded-full border border-ns px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ns-muted"
          disabled={running}
          onClick={clearResults}
        >
          Clear
        </button>
      </div>
      <div className="mt-2 text-[10px] text-ns-muted">
        Total: {summary.total} {summary.failures ? `| Failures: ${summary.failures}` : ''}
      </div>
      <div className="mt-3 max-h-40 overflow-auto rounded-xl liquid-panel border border-ns">
        {logs.length === 0 ? (
          <div className="p-3 text-[10px] text-ns-muted">No QA logs yet.</div>
        ) : (
          logs.slice(-12).map((entry) => (
            <div
              key={entry.id}
              className={`px-3 py-1 text-[10px] ${entry.level === 'error' ? 'text-mono-400 dark:text-mono-500' : entry.level === 'success' ? 'text-mono-0 dark:text-mono-1000 font-bold' : 'text-ns-muted'}`}
            >
              {new Date(entry.ts).toLocaleTimeString()} {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
