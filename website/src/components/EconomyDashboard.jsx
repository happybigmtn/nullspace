import React, { useEffect, useState } from 'react';
import { useSharedCasinoConnection } from '../chain/CasinoConnectionContext';
import SupplyChart from './charts/SupplyChart';
import PnLChart from './charts/PnLChart';
import IssuanceChart from './charts/IssuanceChart';
import PoolHealthChart from './charts/PoolHealthChart';
import StatsCard from './StatsCard';

const EconomyDashboard = () => {
  const connection = useSharedCasinoConnection();
  const [data, setData] = useState([]);
  const [distribution, setDistribution] = useState({
    gini: null,
    top1Share: null,
    players: 0,
    updatedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [publicData, setPublicData] = useState([]);
  const [publicDistribution, setPublicDistribution] = useState({
    gini: null,
    top1Share: null,
    players: 0,
    updatedAt: null,
  });
  const [publicError, setPublicError] = useState(null);
  const [publicLoading, setPublicLoading] = useState(false);

  const opsBase =
    (import.meta.env.VITE_OPS_URL || import.meta.env.VITE_ANALYTICS_URL || '').replace(/\/$/, '');
  const snapshotUrl = (import.meta.env.VITE_PUBLIC_ECONOMY_SNAPSHOT_URL || '').trim() ||
    (opsBase ? `${opsBase}/economy/snapshot` : '');

  useEffect(() => {
    if (connection.status !== 'connected' || !connection.client) return;

    let cancelled = false;
    const POLL_MS = 5000;
    const MAX_SNAPSHOTS = 360;

    const poll = async () => {
      try {
        const client = connection.client;
        const [house, amm] = await Promise.all([client.getHouse(), client.getAmmPool()]);
        if (!house || !amm || cancelled) return;

        const reserveRng = Number(amm.reserveRng ?? 0);
        const reserveVusdt = Number(amm.reserveVusdt ?? 0);
        const totalShares = Number(amm.totalShares ?? 0);
        const bootstrapPrice =
          Number(amm.bootstrapPriceVusdtNumerator ?? 0) /
          Math.max(1, Number(amm.bootstrapPriceRngDenominator ?? 1));
        const price = reserveRng > 0 ? reserveVusdt / reserveRng : bootstrapPrice;
        const tvl = reserveVusdt + reserveRng * price;
        const lpPrice = totalShares > 0 ? tvl / totalShares : 0;

        const next = {
          timestamp: Date.now(),
          epoch: Number(house.currentEpoch ?? 0),
          total_issuance: Number(house.totalIssuance ?? 0),
          total_burned: Number(house.totalBurned ?? 0),
          accumulated_fees: Number(house.accumulatedFees ?? 0),
          house_pnl: Number(house.netPnl ?? 0),
          total_vusdt_debt: Number(house.totalVusdtDebt ?? 0),
          stability_fees_accrued: Number(house.stabilityFeesAccrued ?? 0),
          recovery_pool_vusdt: Number(house.recoveryPoolVusdt ?? 0),
          rng_price: price,
          pool_tvl_vusdt: tvl,
          lp_share_price_vusdt: lpPrice,
          amm_invariant_k: reserveRng * reserveVusdt,
        };

        setData((prev) => {
          const merged = [...prev, next];
          return merged.slice(-MAX_SNAPSHOTS);
        });
        setLoading(false);
      } catch (err) {
        console.error('Failed to poll economy snapshot:', err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection.client, connection.status]);

  useEffect(() => {
    if (connection.status !== 'connected' || !connection.client) return;

    let cancelled = false;
    const POLL_MS = 60000;

    const giniCoefficient = (values) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      if (!sum) return 0;
      let cumulative = 0;
      let weighted = 0;
      sorted.forEach((v, i) => {
        cumulative += v;
        weighted += cumulative;
      });
      return (sorted.length + 1 - (2 * weighted) / sum) / sorted.length;
    };

    const poll = async () => {
      try {
        const client = connection.client;
        const registry = await client.getPlayerRegistry();
        const players = registry?.players ?? [];
        if (!players.length || cancelled) {
          setDistribution((prev) => ({ ...prev, players: 0 }));
          return;
        }

        const balances = [];
        for (const keyHex of players) {
          if (cancelled) return;
          try {
            const bytes = client.wasm.hexToBytes(keyHex);
            const player = await client.getCasinoPlayer(bytes);
            if (player) {
              balances.push(Number(player.chips ?? 0));
            }
          } catch (err) {
            console.warn('Failed to load player for distribution:', err);
          }
        }

        const total = balances.reduce((acc, v) => acc + v, 0);
        const sortedDesc = [...balances].sort((a, b) => b - a);
        const topCount = Math.max(1, Math.ceil(sortedDesc.length * 0.01));
        const topSum = sortedDesc.slice(0, topCount).reduce((acc, v) => acc + v, 0);

        setDistribution({
          gini: giniCoefficient(balances),
          top1Share: total > 0 ? topSum / total : 0,
          players: balances.length,
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.error('Failed to refresh distribution metrics:', err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection.client, connection.status]);

  useEffect(() => {
    if (!snapshotUrl) return;
    if (connection.status === 'connected') return;
    let cancelled = false;
    setPublicLoading(true);
    fetch(snapshotUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Snapshot fetch failed (${res.status})`);
        return res.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const snapshots = payload?.data ?? payload?.snapshots ?? [];
        const dist = payload?.distribution ?? {};
        setPublicData(Array.isArray(snapshots) ? snapshots : []);
        setPublicDistribution({
          gini: dist.gini ?? null,
          top1Share: dist.top1Share ?? null,
          players: dist.players ?? 0,
          updatedAt: dist.updatedAt ?? payload?.updatedAt ?? null,
        });
        setPublicError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setPublicError(err instanceof Error ? err.message : 'Snapshot unavailable');
      })
      .finally(() => {
        if (!cancelled) setPublicLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshotUrl, connection.status]);

  const usingPublic = connection.status !== 'connected';
  const effectiveData = usingPublic ? publicData : data;
  const effectiveDistribution = usingPublic ? publicDistribution : distribution;

  if (usingPublic) {
    if (publicLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center text-ns">
          <div className="liquid-card p-6 text-center">Loading Public Snapshot...</div>
        </div>
      );
    }
    if (!effectiveData.length) {
      return (
        <div className="min-h-screen flex items-center justify-center text-ns">
          <div className="liquid-card p-6 text-center">
            {publicError ?? 'Public snapshot unavailable.'}
          </div>
        </div>
      );
    }
  } else {
    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center text-ns">
          <div className="liquid-card p-6 text-center">Loading Analytics...</div>
        </div>
      );
    }
    if (!data.length) {
      return (
        <div className="min-h-screen flex items-center justify-center text-ns">
          <div className="liquid-card p-6 text-center">No Data Available</div>
        </div>
      );
    }
  }

  const last = effectiveData[effectiveData.length - 1];
  const first = effectiveData[0];
  const elapsedSeconds = Math.max(1, (last.timestamp - first.timestamp) / 1000);
  const burnRate = ((last.total_burned - first.total_burned) / elapsedSeconds).toFixed(2);
  const supply = 1_000_000_000 + (last.total_issuance || 0) - (last.total_burned || 0);
  const tvl = last.pool_tvl_vusdt || 0;
  const lpPrice = last.lp_share_price_vusdt || 0;
  const top1Share = effectiveDistribution.top1Share !== null ? `${(effectiveDistribution.top1Share * 100).toFixed(2)}%` : '—';
  const gini = effectiveDistribution.gini !== null ? effectiveDistribution.gini.toFixed(3) : '—';
  const sourceLabel = usingPublic ? 'Public Snapshot' : 'Live';

  return (
    <div className="min-h-screen text-ns font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="liquid-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Analytics</div>
              <div className="text-lg font-display tracking-tight text-ns">Economy overview</div>
              <div className="text-[11px] text-ns-muted">
                Real-time economic monitoring.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="liquid-chip px-3 py-1 text-[10px] tracking-[0.28em] uppercase text-ns-muted">
                {sourceLabel}
              </div>
              <div className="text-[10px] text-ns-muted">
                Updated {new Date(last.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </header>

        <section className="liquid-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Key metrics</div>
            <div className="text-[10px] text-ns-muted">Source {sourceLabel}</div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatsCard
              title="RNG Price"
              value={`$${(last.rng_price || 0).toFixed(4)}`}
              trend={last.rng_price > first.rng_price ? 'up' : 'down'}
              subtext="vUSDT"
            />
            <StatsCard title="Circulating Supply" value={supply.toLocaleString()} subtext="RNG" />
            <StatsCard title="Total Issuance" value={Number(last.total_issuance || 0).toLocaleString()} subtext="RNG" />
            <StatsCard title="Total Burned" value={Number(last.total_burned || 0).toLocaleString()} subtext="RNG" trend="down" />
            <StatsCard title="Burn Rate" value={`${burnRate}/s`} subtext="Avg" trend="down" />
            <StatsCard title="Accumulated Fees" value={Number(last.accumulated_fees || 0).toLocaleString()} subtext="RNG" />
            <StatsCard title="House PnL" value={Number(last.house_pnl || 0).toLocaleString()} subtext="RNG" />
            <StatsCard title="vUSDT Debt" value={Number(last.total_vusdt_debt || 0).toLocaleString()} subtext="vUSDT" />
            <StatsCard title="Stability Fees" value={Number(last.stability_fees_accrued || 0).toLocaleString()} subtext="vUSDT" />
            <StatsCard title="Pool TVL" value={`$${tvl.toLocaleString()}`} subtext="vUSDT" trend="up" />
            <StatsCard title="LP Share Price" value={`$${lpPrice.toFixed(4)}`} subtext="vUSDT / LP" trend="up" />
            <StatsCard title="Top 1% Share" value={top1Share} subtext="Supply" />
            <StatsCard title="Gini" value={gini} subtext={`Players ${effectiveDistribution.players}`} />
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SupplyChart data={effectiveData} />
          <IssuanceChart data={effectiveData} />
        </div>

        <PoolHealthChart data={effectiveData} />
        <PnLChart data={effectiveData} />
      </div>
    </div>
  );
};

export default EconomyDashboard;
