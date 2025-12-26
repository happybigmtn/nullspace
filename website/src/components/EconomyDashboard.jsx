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

  if (connection.status !== 'connected') {
    return (
      <div className="text-gray-100 p-8 text-center bg-gray-950 min-h-screen">
        {connection.status === 'missing_identity'
          ? 'Missing VITE_IDENTITY — set identity to enable live analytics.'
          : 'Connecting to live economy...'}
      </div>
    );
  }
  if (loading) return <div className="text-gray-100 p-8 text-center bg-gray-950 min-h-screen">Loading Analytics...</div>;
  if (!data.length) return <div className="text-gray-100 p-8 text-center bg-gray-950 min-h-screen">No Data Available</div>;

  const last = data[data.length - 1];
  const first = data[0];
  const elapsedSeconds = Math.max(1, (last.timestamp - first.timestamp) / 1000);
  const burnRate = ((last.total_burned - first.total_burned) / elapsedSeconds).toFixed(2);
  const supply = 1_000_000_000 + (last.total_issuance || 0) - (last.total_burned || 0);
  const tvl = last.pool_tvl_vusdt || 0;
  const lpPrice = last.lp_share_price_vusdt || 0;
  const top1Share = distribution.top1Share !== null ? `${(distribution.top1Share * 100).toFixed(2)}%` : '—';
  const gini = distribution.gini !== null ? distribution.gini.toFixed(3) : '—';

  return (
    <div className="bg-gray-950 min-h-screen text-gray-100 p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-4xl font-bold mb-2">Nullspace Analytics</h1>
          <p className="text-gray-400">Real-time economic monitoring (Live)</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          <StatsCard title="Gini" value={gini} subtext={`Players ${distribution.players}`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <SupplyChart data={data} />
          <IssuanceChart data={data} />
        </div>

        <PoolHealthChart data={data} />
        <PnLChart data={data} />
      </div>
    </div>
  );
};

export default EconomyDashboard;
