import type { ResolvedBet } from '../../types';

export type CrapsChainBetLog = {
  type: string;
  target?: number;
  wagered: number;
  odds: number;
  returnAmount: number;
  outcome: 'WIN' | 'LOSS' | 'PUSH';
};

export type CrapsChainRollLog = {
  dice: [number, number];
  total: number;
  point: number;
  bets: CrapsChainBetLog[];
  totalWagered: number;
  totalReturn: number;
};

const MAX_LOG_ENTRY_LENGTH = 10000;
const MAX_BETS_PER_LOG = 20;

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseCrapsLogEntry = (entry: string): CrapsChainRollLog | null => {
  if (entry.length > MAX_LOG_ENTRY_LENGTH) {
    console.warn('[crapsLogs] Log entry too large, skipping');
    return null;
  }

  let data: any;
  try {
    data = JSON.parse(entry);
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.dice) || data.dice.length < 2) return null;
  const d1 = toFiniteNumber(data.dice[0]);
  const d2 = toFiniteNumber(data.dice[1]);
  if (!Number.isFinite(d1) || !Number.isFinite(d2) || d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) {
    return null;
  }

  const total = toFiniteNumber(data.total, d1 + d2);
  const totalWagered = toFiniteNumber(data.totalWagered, 0);
  const totalReturn = toFiniteNumber(data.totalReturn, 0);
  const point = toFiniteNumber(data.point, 0);

  const rawBets = Array.isArray(data.bets) ? data.bets.slice(0, MAX_BETS_PER_LOG) : [];
  const bets: CrapsChainBetLog[] = rawBets
    .map((bet: any) => {
      const type = typeof bet?.type === 'string' ? bet.type : '';
      if (!type) return null;
      const target = typeof bet?.target === 'number' ? bet.target : undefined;
      const wagered = toFiniteNumber(bet?.wagered, 0);
      const odds = toFiniteNumber(bet?.odds, 0);
      const returnAmount = toFiniteNumber(bet?.return, 0);
      const rawOutcome = typeof bet?.outcome === 'string' ? bet.outcome : '';
      const outcome: CrapsChainBetLog['outcome'] =
        rawOutcome === 'WIN' || rawOutcome === 'LOSS' || rawOutcome === 'PUSH'
          ? rawOutcome
          : (returnAmount > wagered ? 'WIN' : returnAmount === wagered ? 'PUSH' : 'LOSS');
      return { type, target, wagered, odds, returnAmount, outcome };
    })
    .filter((bet): bet is CrapsChainBetLog => !!bet);

  return {
    dice: [d1, d2],
    total,
    point,
    bets,
    totalWagered,
    totalReturn,
  };
};

export const parseCrapsChainRollLog = (logs: string[]): CrapsChainRollLog | null => {
  if (!logs || logs.length === 0) return null;

  for (const entry of logs) {
    if (typeof entry !== 'string' || entry.trim().length === 0) continue;
    const parsed = parseCrapsLogEntry(entry);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const formatCrapsChainBetLabel = (type: string, target?: number): string => {
  if (type.startsWith('HARDWAY_')) {
    const hardTarget = Number(type.split('_')[1]);
    return Number.isFinite(hardTarget) ? `HARDWAY ${hardTarget}` : 'HARDWAY';
  }

  return target && target > 0 ? `${type} ${target}` : type;
};

export const formatCrapsChainResults = (roll: CrapsChainRollLog): string[] => (
  roll.bets.map((bet) => {
    const label = formatCrapsChainBetLabel(bet.type, bet.target);
    return `${label}: ${bet.outcome}`;
  })
);

export const formatCrapsChainResolvedBets = (roll: CrapsChainRollLog): ResolvedBet[] => (
  roll.bets.map((bet, idx) => {
    const label = formatCrapsChainBetLabel(bet.type, bet.target);
    return {
      id: `${label.replace(/\s+/g, '_').toLowerCase()}-${idx}`,
      label,
      pnl: Math.round(bet.returnAmount - bet.wagered - bet.odds),
    };
  })
);

export const adjustResolvedBetsForNetPnl = (resolvedBets: ResolvedBet[], netPnL: number): ResolvedBet[] => {
  if (!resolvedBets.length) return resolvedBets;
  if (!Number.isFinite(netPnL) || netPnL === 0) return resolvedBets;

  const sumBigInt = resolvedBets.reduce((acc, bet) => {
    const pnl = Number.isFinite(bet.pnl) ? Math.floor(bet.pnl) : 0;
    return acc + BigInt(pnl);
  }, 0n);

  if (sumBigInt === 0n) {
    if (resolvedBets.length === 1) {
      return [{ ...resolvedBets[0], pnl: Math.round(netPnL) }];
    }
    return resolvedBets;
  }

  if (sumBigInt > BigInt(Number.MAX_SAFE_INTEGER) || sumBigInt < BigInt(Number.MIN_SAFE_INTEGER)) {
    console.warn('[crapsLogs] Resolved bet sum exceeds safe integer range');
    return resolvedBets;
  }

  const sum = Number(sumBigInt);
  if (Math.sign(sum) !== Math.sign(netPnL)) {
    return resolvedBets;
  }

  const scale = netPnL / sum;
  if (!Number.isFinite(scale) || Math.abs(scale - 1) < 0.01) return resolvedBets;

  return resolvedBets.map((bet) => ({
    ...bet,
    pnl: Math.round((Number.isFinite(bet.pnl) ? bet.pnl : 0) * scale),
  }));
};
