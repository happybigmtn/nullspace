import type { CrapsBet, GameState, ResolvedBet } from '../../../types';
import { GameType } from '../../../types';
import { MAX_GRAPH_POINTS } from '../constants';
import type { Ref } from '../refs';
import { adjustResolvedBetsForNetPnl, formatCrapsChainResolvedBets, formatCrapsChainResults } from '../crapsLogs';
import type { CrapsChainRollLog } from '../crapsLogs';
import { parseCrapsState as parseCrapsStateBlob } from '@nullspace/game-state';
import type { GameStateRef, SetGameState } from './types';

type CrapsChainRollRef = Ref<{ sessionId: bigint; roll: CrapsChainRollLog } | null>;
type BoolRef = Ref<boolean>;

type CrapsStateArgs = {
  stateBlob: Uint8Array;
  gameType: GameType;
  fallbackState: GameState;
  setGameState: SetGameState;
  gameStateRef: GameStateRef;
  isPendingRef: BoolRef;
  crapsChainRollLogRef: CrapsChainRollRef;
};

const VALID_CRAPS_BETS = new Set<CrapsBet['type']>([
  'PASS',
  'DONT_PASS',
  'COME',
  'DONT_COME',
  'FIELD',
  'YES',
  'NO',
  'NEXT',
  'HARDWAY',
  'FIRE',
  'ATS_SMALL',
  'ATS_TALL',
  'ATS_ALL',
  'MUGGSY',
  'DIFF_DOUBLES',
  'RIDE_LINE',
  'REPLAY',
  'HOT_ROLLER',
]);

const isValidCrapsBet = (bet: CrapsBet): boolean => {
  if (!VALID_CRAPS_BETS.has(bet.type)) return false;
  if (!Number.isFinite(bet.amount) || bet.amount <= 0 || bet.amount > Number.MAX_SAFE_INTEGER) {
    return false;
  }
  if (bet.target !== undefined) {
    if (!Number.isFinite(bet.target) || bet.target < 0 || bet.target > 12) return false;
    if (bet.type === 'HARDWAY' && ![4, 6, 8, 10].includes(bet.target)) {
      return false;
    }
  }
  return true;
};

export const applyCrapsState = ({
  stateBlob,
  gameType,
  fallbackState,
  setGameState,
  gameStateRef,
  isPendingRef,
  crapsChainRollLogRef,
}: CrapsStateArgs): void => {
  const parsed = parseCrapsStateBlob(stateBlob);
  if (!parsed) {
    console.error('[parseGameState] Invalid Craps state blob');
    return;
  }

  const [d1, d2] = parsed.dice;
  const mainPoint = parsed.mainPoint;
  const epochPointEstablished = parsed.epochPointEstablished;
  const madePointsMask = parsed.madePointsMask;
  const BET_TYPE_REVERSE: Record<number, CrapsBet['type']> = {
    0: 'PASS',
    1: 'DONT_PASS',
    2: 'COME',
    3: 'DONT_COME',
    4: 'FIELD',
    5: 'YES',
    6: 'NO',
    7: 'NEXT',
    8: 'HARDWAY',
    9: 'HARDWAY',
    10: 'HARDWAY',
    11: 'HARDWAY',
    12: 'FIRE',
    15: 'ATS_SMALL',
    16: 'ATS_TALL',
    17: 'ATS_ALL',
    18: 'MUGGSY',
    19: 'DIFF_DOUBLES',
    20: 'RIDE_LINE',
    21: 'REPLAY',
    22: 'HOT_ROLLER',
  };

  const parsedBets: CrapsBet[] = [];
  for (const bet of parsed.bets) {
    const betTypeVal = bet.betType;
    const target = bet.target;
    const statusVal = bet.status;
    const amount = bet.amount;
    const oddsAmount = bet.oddsAmount;

    const betType = BET_TYPE_REVERSE[betTypeVal] || 'PASS';
    const isHardway = betTypeVal >= 8 && betTypeVal <= 11;
    const isAts = betTypeVal >= 15 && betTypeVal <= 17;
    const isFire = betTypeVal === 12;
    const isSideBetWithProgress = isFire || isAts || (betTypeVal >= 18 && betTypeVal <= 22);

    let parsedTarget: number | undefined = target > 0 ? target : undefined;
    if (isHardway) {
      const hardwayTargetMap: Record<number, number> = { 8: 4, 9: 6, 10: 8, 11: 10 };
      parsedTarget = hardwayTargetMap[betTypeVal];
    } else if (isSideBetWithProgress) {
      parsedTarget = undefined;
    }

    parsedBets.push({
      type: betType,
      target: parsedTarget,
      status: statusVal === 1 ? 'PENDING' : 'ON',
      amount,
      oddsAmount: (!isHardway && !isSideBetWithProgress && oddsAmount > 0) ? oddsAmount : undefined,
      progressMask: isSideBetWithProgress ? oddsAmount : undefined,
    });
  }

  if (gameStateRef.current) {
    gameStateRef.current = {
      ...gameStateRef.current,
      dice: [d1, d2],
      crapsPoint: mainPoint > 0 ? mainPoint : null,
      crapsEpochPointEstablished: epochPointEstablished,
      crapsMadePointsMask: madePointsMask,
    };
  }

  const hasDice = d1 > 0 && d2 > 0;
  const total = d1 + d2;

  setGameState((prev) => {
    const prevDice = prev.dice;
    const diceChanged =
      prevDice.length !== 2 || prevDice[0] !== d1 || prevDice[1] !== d2;
    const chainRollLogEntry = crapsChainRollLogRef.current;
    const hasChainRollLog = !!chainRollLogEntry
      && chainRollLogEntry.roll.dice[0] === d1
      && chainRollLogEntry.roll.dice[1] === d2;
    if (chainRollLogEntry && !hasChainRollLog) {
      crapsChainRollLogRef.current = null;
    }
    const rollChanged = diceChanged || hasChainRollLog;

    const sevenOut = hasDice && rollChanged && total === 7 && (
      prev.crapsPoint !== null || (prev.crapsEpochPointEstablished && !epochPointEstablished)
    );

    let newHistory = prev.crapsRollHistory;
    if (hasDice && rollChanged) {
      newHistory = sevenOut
        ? [total]
        : [...prev.crapsRollHistory, total].slice(-MAX_GRAPH_POINTS);
    }

    let newEventLog = prev.crapsEventLog;
    let newResolvedBets = prev.resolvedBets;
    let newResolvedBetsKey = prev.resolvedBetsKey;
    if (hasDice && rollChanged) {
      if (hasChainRollLog && chainRollLogEntry) {
        const chainRoll = chainRollLogEntry.roll;
        const chainPnl = Math.floor(chainRoll.totalReturn - chainRoll.totalWagered);
        const newEvent = {
          dice: [d1, d2] as [number, number],
          total,
          pnl: chainPnl,
          point: prev.crapsPoint,
          isSevenOut: sevenOut,
          results: formatCrapsChainResults(chainRoll),
        };
        newEventLog = sevenOut
          ? []
          : [...prev.crapsEventLog, newEvent].slice(-MAX_GRAPH_POINTS);
        crapsChainRollLogRef.current = null;
        newResolvedBets = adjustResolvedBetsForNetPnl(
          formatCrapsChainResolvedBets(chainRoll),
          chainPnl,
        );
        if (newResolvedBets.length > 0) {
          newResolvedBetsKey = prev.resolvedBetsKey + 1;
        }
      } else {
        const newEvent = {
          dice: [d1, d2] as [number, number],
          total,
          pnl: 0,
          point: prev.crapsPoint,
          isSevenOut: sevenOut,
          results: [] as string[],
        };
        newEventLog = sevenOut
          ? []
          : [...prev.crapsEventLog, newEvent].slice(-MAX_GRAPH_POINTS);
      }
    }

    const hasRolledDice = hasDice && (d1 > 0 || d2 > 0);
    const localStagedBets = hasRolledDice
      ? []
      : prev.crapsBets.filter((b) => b.local === true);

    const betKeyLoose = (b: CrapsBet) => `${b.type}|${b.target ?? ''}|${b.amount}`;
    const mergedBets: CrapsBet[] = [...parsedBets];
    const seen = new Set<string>(parsedBets.map(betKeyLoose));
    for (const bet of localStagedBets) {
      const key = betKeyLoose(bet);
      if (seen.has(key)) continue;
      if (!isValidCrapsBet(bet)) {
        console.warn('[parseGameState] Ignoring invalid local craps bet', bet);
        continue;
      }
      seen.add(key);
      mergedBets.push(bet);
    }

    const savedBetsForRebet = sevenOut
      ? prev.crapsBets.filter(
          (b) => !['FIRE', 'ATS_SMALL', 'ATS_TALL', 'ATS_ALL', 'MUGGSY', 'DIFF_DOUBLES', 'RIDE_LINE', 'REPLAY', 'HOT_ROLLER'].includes(b.type),
        )
      : prev.crapsLastRoundBets;

    const newState: GameState = {
      ...prev,
      type: gameType,
      dice: [d1, d2],
      crapsPoint: mainPoint > 0 ? mainPoint : null,
      crapsEpochPointEstablished: epochPointEstablished,
      crapsMadePointsMask: madePointsMask,
      crapsBets: mergedBets,
      crapsRollHistory: newHistory,
      crapsEventLog: newEventLog,
      crapsLastRoundBets: savedBetsForRebet,
      resolvedBets: newResolvedBets,
      resolvedBetsKey: newResolvedBetsKey,
      stage: 'PLAYING',
      message: hasDice
        ? (rollChanged ? (sevenOut ? '7-OUT! SHOOTER LOSES' : `ROLLED ${total}`) : prev.message)
        : (isPendingRef.current
          ? prev.message
          : (mergedBets.length > 0 ? 'BETS PLACED - SPACE TO ROLL' : 'PLACE BETS - SPACE TO ROLL')),
    };
    gameStateRef.current = newState;
    return newState;
  });
};
