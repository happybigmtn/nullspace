import React, { useEffect, useState, useRef } from 'react';
import { GameType, PlayerStats } from '../../types';
import { Label } from './ui/Label';
import { formatCountdownShort, useWeeklyEvent } from '../../hooks/useWeeklyEvent';
import { useScrollReveal } from '../../hooks/useScrollReveal';

type RewardsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  playMode: 'CASH' | 'FREEROLL' | null;
  isFaucetClaiming: boolean;
  onClaimFaucet: () => void;
  faucetMessage?: string;
  stats: PlayerStats;
  gameType: GameType;
};

type LeagueEntry = {
  publicKey: string;
  points: number;
  games: number;
  wager?: number;
  netPnl?: number;
};

type ReferralSummary = {
  code: string | null;
  referrals: number;
  qualified: number;
};

const STORAGE_KEYS = {
  lastClaim: 'ns_rewards_last_claim',
  streak: 'ns_rewards_streak',
  handsDate: 'ns_rewards_hands_date',
  handsBaseline: 'ns_rewards_hands_baseline',
  gamesDate: 'ns_rewards_games_date',
  gamesList: 'ns_rewards_games_list',
  clubJoined: 'ns_rewards_club_joined',
  clubWeek: 'ns_rewards_club_week',
  clubBaseline: 'ns_rewards_club_baseline',
};

const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekKey = () => {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const thursday = new Date(now);
  thursday.setDate(now.getDate() - day + 3);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

const parseDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const readString = (key: string, fallback = '') => {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(key);
  return value ?? fallback;
};

const readNumber = (key: string, fallback = 0) => {
  const raw = readString(key);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readArray = (key: string) => {
  const raw = readString(key);
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStorage = (key: string, value: string | number | boolean) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, String(value));
};

const writeArray = (key: string, value: string[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const formatAmount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return Math.floor(value).toLocaleString();
};

const opsBase =
  (import.meta as any)?.env?.VITE_OPS_URL?.replace(/\/$/, '') ??
  (import.meta as any)?.env?.VITE_ANALYTICS_URL?.replace(/\/$/, '') ??
  '';

const readLocalPublicKey = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('casino_public_key_hex')?.toLowerCase() ?? null;
  } catch {
    return null;
  }
};

const formatKey = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

/** Leaderboard entry with scroll reveal animation */
function LeaderboardEntry({
  entry,
  index,
  isYou,
  staggerDelay,
}: {
  entry: LeagueEntry;
  index: number;
  isYou: boolean;
  staggerDelay: number;
}) {
  const [ref, isRevealed] = useScrollReveal<HTMLDivElement>({ threshold: 0.2, delay: staggerDelay });

  return (
    <div
      ref={ref}
      className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
        isRevealed ? 'scroll-revealed' : 'scroll-hidden'
      } ${isYou ? 'border-mono-0/40 bg-mono-0/10 text-mono-0 dark:text-mono-1000' : 'border-ns bg-ns-surface text-ns'}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-ns-muted">#{index + 1}</span>
        <span className="font-mono">{formatKey(entry.publicKey)}</span>
        {isYou ? <span className="text-[9px] font-bold uppercase">You</span> : null}
      </div>
      <div className="text-xs font-bold">{formatAmount(entry.points)}</div>
    </div>
  );
}

/** Leaderboard section with staggered scroll reveal */
function LeaderboardSection({
  leaderboard,
  publicKeyHex,
  leaderboardUpdatedAt,
}: {
  leaderboard: LeagueEntry[];
  publicKeyHex: string | null;
  leaderboardUpdatedAt: number | null;
}) {
  const [containerRef, isContainerRevealed] = useScrollReveal<HTMLDivElement>({ threshold: 0.1 });

  return (
    <div
      ref={containerRef}
      className={`rounded-3xl liquid-card liquid-sheen p-5 shadow-soft ${
        isContainerRevealed ? 'scroll-revealed' : 'scroll-hidden'
      }`}
    >
      <Label size="micro" variant="primary" className="mb-2 block">Weekly league</Label>
      <div className="text-sm font-bold text-ns">Top players</div>
      <div className="mt-3 space-y-2 text-[11px]">
        {leaderboard.slice(0, 5).map((entry, index) => {
          const isYou = publicKeyHex != null && entry.publicKey?.toLowerCase() === publicKeyHex;
          return (
            <LeaderboardEntry
              key={entry.publicKey}
              entry={entry}
              index={index}
              isYou={isYou}
              staggerDelay={index * 50}
            />
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-ns-muted">
        {leaderboardUpdatedAt ? `Updated ${new Date(leaderboardUpdatedAt).toLocaleTimeString()}` : 'Updated recently'}
      </div>
    </div>
  );
}

export const RewardsDrawer: React.FC<RewardsDrawerProps> = ({
  isOpen,
  onClose,
  playMode,
  isFaucetClaiming,
  onClaimFaucet,
  faucetMessage,
  stats,
  gameType,
}) => {
  const todayKey = getLocalDateKey();
  const weekKey = getWeekKey();
  const { event, timeLeftMs } = useWeeklyEvent();

  const [lastClaim, setLastClaim] = useState(() => readString(STORAGE_KEYS.lastClaim));
  const [streak, setStreak] = useState(() => readNumber(STORAGE_KEYS.streak, 0));
  const [handsDate, setHandsDate] = useState(() => readString(STORAGE_KEYS.handsDate, todayKey));
  const [handsBaseline, setHandsBaseline] = useState(() => readNumber(STORAGE_KEYS.handsBaseline, stats.history.length));
  const [gamesDate, setGamesDate] = useState(() => readString(STORAGE_KEYS.gamesDate, todayKey));
  const [gamesToday, setGamesToday] = useState(() => readArray(STORAGE_KEYS.gamesList));
  const [clubJoined, setClubJoined] = useState(() => readString(STORAGE_KEYS.clubJoined, 'false') === 'true');
  const [clubWeek, setClubWeek] = useState(() => readString(STORAGE_KEYS.clubWeek, weekKey));
  const [clubBaseline, setClubBaseline] = useState(() => readNumber(STORAGE_KEYS.clubBaseline, stats.history.length));
  const [pendingClaim, setPendingClaim] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeagueEntry[]>([]);
  const [leaderboardUpdatedAt, setLeaderboardUpdatedAt] = useState<number | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [referralSummary, setReferralSummary] = useState<ReferralSummary | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const publicKeyHex = readLocalPublicKey();

  useEffect(() => {
    if (handsDate !== todayKey) {
      setHandsDate(todayKey);
      setHandsBaseline(stats.history.length);
      writeStorage(STORAGE_KEYS.handsDate, todayKey);
      writeStorage(STORAGE_KEYS.handsBaseline, stats.history.length);
    }
  }, [handsDate, todayKey, stats.history.length]);

  useEffect(() => {
    if (gamesDate !== todayKey) {
      setGamesDate(todayKey);
      setGamesToday([]);
      writeStorage(STORAGE_KEYS.gamesDate, todayKey);
      writeArray(STORAGE_KEYS.gamesList, []);
    }
  }, [gamesDate, todayKey]);

  useEffect(() => {
    if (clubWeek !== weekKey) {
      setClubWeek(weekKey);
      setClubBaseline(stats.history.length);
      writeStorage(STORAGE_KEYS.clubWeek, weekKey);
      writeStorage(STORAGE_KEYS.clubBaseline, stats.history.length);
    }
  }, [clubWeek, weekKey, stats.history.length]);

  useEffect(() => {
    if (!isOpen) return;
    if (!opsBase) return;
    const controller = new AbortController();
    setLeaderboardError(null);
    fetch(`${opsBase}/league/leaderboard?week=${encodeURIComponent(weekKey)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Leaderboard fetch failed (${res.status})`);
        return res.json() as Promise<{ entries?: LeagueEntry[]; updatedAt?: number }>;
      })
      .then((data) => {
        setLeaderboard(Array.isArray(data.entries) ? data.entries.slice(0, 10) : []);
        setLeaderboardUpdatedAt(typeof data.updatedAt === 'number' ? data.updatedAt : null);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setLeaderboard([]);
        setLeaderboardError(err instanceof Error ? err.message : 'Leaderboard unavailable');
      });
    return () => controller.abort();
  }, [isOpen, weekKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (!opsBase) return;
    if (!publicKeyHex) return;
    const controller = new AbortController();
    setReferralLoading(true);
    setReferralError(null);

    const fetchReferral = async () => {
      try {
        const codeRes = await fetch(`${opsBase}/referrals/code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey: publicKeyHex }),
          signal: controller.signal,
        });
        if (!codeRes.ok) throw new Error(`Referral code failed (${codeRes.status})`);
        const codeData = await codeRes.json();
        const summaryRes = await fetch(`${opsBase}/referrals/summary?publicKey=${encodeURIComponent(publicKeyHex)}`, {
          signal: controller.signal,
        });
        if (!summaryRes.ok) throw new Error(`Referral summary failed (${summaryRes.status})`);
        const summaryData = await summaryRes.json();
        setReferralSummary({
          code: codeData?.code ?? summaryData?.code ?? null,
          referrals: Number(summaryData?.referrals ?? 0),
          qualified: Number(summaryData?.qualified ?? 0),
        });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setReferralSummary(null);
        setReferralError(err instanceof Error ? err.message : 'Referral unavailable');
      } finally {
        setReferralLoading(false);
      }
    };

    void fetchReferral();
    return () => controller.abort();
  }, [isOpen, publicKeyHex]);

  useEffect(() => {
    if (gameType === GameType.NONE) return;
    setGamesToday((prev) => {
      if (prev.includes(gameType)) return prev;
      const next = [...prev, gameType];
      writeArray(STORAGE_KEYS.gamesList, next);
      return next;
    });
  }, [gameType]);

  useEffect(() => {
    if (!pendingClaim) return;
    if (faucetMessage?.includes('FAUCET CLAIMED')) {
      const today = parseDateKey(todayKey);
      const last = lastClaim ? parseDateKey(lastClaim) : null;
      const diffDays = last ? Math.floor((today.getTime() - last.getTime()) / 86400000) : null;
      const nextStreak = diffDays === 1 ? streak + 1 : 1;
      setLastClaim(todayKey);
      setStreak(nextStreak);
      writeStorage(STORAGE_KEYS.lastClaim, todayKey);
      writeStorage(STORAGE_KEYS.streak, nextStreak);
      setPendingClaim(false);
    }
    if (faucetMessage?.includes('FAUCET FAILED')) {
      setPendingClaim(false);
    }
  }, [pendingClaim, faucetMessage, lastClaim, streak, todayKey]);

  const handsToday = Math.max(0, stats.history.length - handsBaseline);
  const gamesCount = gamesToday.length;
  const claimedToday = lastClaim === todayKey;
  const canClaim = playMode === 'CASH' && !claimedToday && !isFaucetClaiming;

  const nextResetMs = (() => {
    const next = new Date();
    next.setHours(24, 0, 0, 0);
    return next.getTime() - Date.now();
  })();

  const clubGoal = 25;
  const clubProgress = Math.min(clubGoal, Math.max(0, stats.history.length - clubBaseline));

  const missions = [
    { id: 'daily-claim', label: 'Claim daily bonus', progress: claimedToday ? 1 : 0, target: 1 },
    { id: 'hands', label: 'Play 3 hands', progress: handsToday, target: 3 },
    { id: 'games', label: 'Try 2 tables', progress: gamesCount, target: 2 },
  ];

  return (
    <div className={`fixed inset-0 z-[120] ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden={!isOpen}>
      <div
        className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity motion-state ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-ns-surface border-l border-ns shadow-float transition-transform motion-state ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-ns px-6 py-5">
            <div>
              <Label size="micro" className="opacity-70">Rewards</Label>
              <div className="text-xl font-extrabold text-ns">Your rewards</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-10 w-10 rounded-full border border-ns text-ns-muted transition-all hover:text-ns hover:border-ns"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            {event ? (
              <div className="rounded-3xl liquid-card liquid-sheen p-5">
                <Label size="micro" variant="primary" className="mb-2 block">Weekly focus</Label>
                <div className="text-lg font-bold text-ns">{event.label}</div>
                <div className="text-xs text-ns-muted mt-1">{event.focus}</div>
                <div className="mt-3 text-[10px] font-mono text-ns-muted">
                  Ends in {formatCountdownShort(timeLeftMs)}
                </div>
              </div>
            ) : null}

            {leaderboard.length > 0 ? (
              <LeaderboardSection
                leaderboard={leaderboard}
                publicKeyHex={publicKeyHex}
                leaderboardUpdatedAt={leaderboardUpdatedAt}
              />
            ) : leaderboardError ? (
              <div className="rounded-2xl liquid-panel p-4 text-[11px] text-ns-muted">
                {leaderboardError}
              </div>
            ) : null}

            {opsBase && publicKeyHex ? (
              <div className="rounded-3xl liquid-card liquid-sheen p-5 shadow-soft">
                <Label size="micro" variant="gold" className="mb-2 block">Invite friends</Label>
                {referralLoading ? (
                  <div className="text-[11px] text-ns-muted">Loading referral stats…</div>
                ) : referralSummary ? (
                  <>
                    <div className="text-lg font-bold text-ns">
                      Code: {referralSummary.code ?? '—'}
                    </div>
                    <div className="mt-2 text-[11px] text-ns-muted">
                      Referrals: {referralSummary.referrals} · Qualified: {referralSummary.qualified}
                    </div>
                    {referralSummary.code ? (
                      <button
                        type="button"
                        className="mt-3 liquid-chip text-[10px] px-3 py-2 border-ns-border/80 text-ns hover:border-ns-border"
                        onClick={() => {
                          const url = `${window.location.origin}/?ref=${referralSummary.code}`;
                          navigator.clipboard.writeText(url).catch(() => {
                            // ignore clipboard errors
                          });
                        }}
                      >
                        Copy invite link
                      </button>
                    ) : null}
                  </>
                ) : referralError ? (
                  <div className="text-[11px] text-ns-muted">{referralError}</div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-3xl liquid-card liquid-sheen p-5 shadow-soft">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <Label size="micro" variant="gold" className="mb-1 block">Daily bonus</Label>
                  <div className="text-lg font-bold text-ns">+1,000 RNG</div>
                  <div className="text-[11px] text-ns-muted">
                    {claimedToday ? `Next drop in ${formatCountdownShort(nextResetMs)}` : 'Ready to claim'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-[10px] font-bold text-ns-muted uppercase tracking-widest">Streak</div>
                  <div className="text-lg font-black text-mono-0 dark:text-mono-1000 font-bold">{streak}x</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!canClaim) return;
                  setPendingClaim(true);
                  onClaimFaucet();
                }}
                disabled={!canClaim}
                className={`w-full rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-widest transition-all motion-interaction ${
                  canClaim
                    ? 'bg-mono-0 text-white shadow-soft hover:scale-[1.02]'
                    : 'bg-ns-surface text-ns-muted'
                }`}
              >
                {playMode !== 'CASH' ? 'Available in Cash Mode' : claimedToday ? 'Claimed' : isFaucetClaiming ? 'Claiming…' : 'Claim now'}
              </button>
            </div>

            <div className="rounded-3xl liquid-card liquid-sheen p-5 shadow-soft">
              <Label size="micro" variant="primary" className="mb-2 block">Wallet</Label>
              <div className="text-sm font-semibold text-ns">
                Testnet deposits and withdrawals are coming soon.
              </div>
              <div className="text-[11px] text-ns-muted mt-2">
                Use the daily faucet to top up RNG while the bridge flow is finalized.
              </div>
            </div>

            <div className="rounded-3xl liquid-card liquid-sheen p-5 shadow-soft">
              <Label size="micro" variant="primary" className="mb-3 block">Missions</Label>
              <div className="space-y-4">
                {missions.map((mission) => {
                  const progress = Math.min(mission.target, mission.progress);
                  const pct = Math.round((progress / mission.target) * 100);
                  return (
                    <div key={mission.id} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-ns">
                        <span>{mission.label}</span>
                        <span className="tabular-nums text-ns-muted">
                          {progress}/{mission.target}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-ns-border/60 overflow-hidden">
                        <div
                          className="h-full bg-mono-0 transition-all motion-state"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl liquid-card liquid-sheen p-5 shadow-soft">
              <Label size="micro" variant="success" className="mb-3 block">Clubs</Label>
              {!clubJoined ? (
                <div className="flex flex-col gap-3">
                  <div className="text-sm font-semibold text-ns">
                    Join a club for weekly goals and lightweight social play.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setClubJoined(true);
                      writeStorage(STORAGE_KEYS.clubJoined, true);
                      setClubBaseline(stats.history.length);
                      writeStorage(STORAGE_KEYS.clubBaseline, stats.history.length);
                      writeStorage(STORAGE_KEYS.clubWeek, weekKey);
                    }}
                    className="rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-widest bg-mono-0 text-white shadow-soft hover:scale-[1.02] transition-all"
                  >
                    Join Club
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-ns">Orion Table</div>
                      <div className="text-[11px] text-ns-muted">Weekly goal: 25 hands</div>
                    </div>
                    <div className="text-xs font-bold text-mono-0 dark:text-mono-1000 font-bold">{clubProgress}/{clubGoal}</div>
                  </div>
                  <div className="h-2 rounded-full bg-ns-border/60 overflow-hidden">
                    <div
                      className="h-full bg-mono-0 transition-all motion-state"
                      style={{ width: `${Math.round((clubProgress / clubGoal) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-ns px-6 py-4 text-[10px] text-ns-muted">
            Balance today: ${formatAmount(stats.chips)} • Rewards stay calm, no popups.
          </div>
        </div>
      </aside>
    </div>
  );
};
