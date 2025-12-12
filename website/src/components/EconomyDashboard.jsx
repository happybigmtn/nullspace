import React, { useEffect, useState } from 'react';
import SupplyChart from './charts/SupplyChart';
import PnLChart from './charts/PnLChart';
import IssuanceChart from './charts/IssuanceChart';
import PoolHealthChart from './charts/PoolHealthChart';
import RoleVolumeChart from './charts/RoleVolumeChart';
import ErrorChart from './charts/ErrorChart';
import CollateralChart from './charts/CollateralChart';
import StatsCard from './StatsCard';

const EconomyDashboard = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/economy_log.json')
      .then(res => res.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-100 p-8 text-center bg-gray-950 min-h-screen">Loading Analytics...</div>;
  if (!data.length) return <div className="text-gray-100 p-8 text-center bg-gray-950 min-h-screen">No Data Available</div>;

  const last = data[data.length - 1];
  const first = data[0];
  const burnRate = ((last.total_burned - first.total_burned) / (data.length * 0.5)).toFixed(2); // RNG/s (approx 500ms intervals)
  const supply = 1_000_000_000 + (last.total_issuance || 0) - last.total_burned;
  const tvl = last.pool_tvl_vusdt || 0;
  const lpPrice = last.lp_share_price_vusdt || 0;
  const maxNw = last.maximizer_nw || 0;

  return (
    <div className="bg-gray-950 min-h-screen text-gray-100 p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-4xl font-bold mb-2">Nullspace Analytics</h1>
          <p className="text-gray-400">Real-time economic monitoring (Simulated)</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatsCard title="RNG Price" value={`$${last.rng_price.toFixed(4)}`} trend={last.rng_price > first.rng_price ? 'up' : 'down'} subtext="vUSDT" />
          <StatsCard title="Circulating Supply" value={supply.toLocaleString()} subtext="RNG" />
          <StatsCard title="Total Burned" value={last.total_burned.toLocaleString()} subtext="🔥 RNG" trend="down" />
          <StatsCard title="Burn Rate" value={`${burnRate}/s`} subtext="Avg" trend="down" />
          <StatsCard title="Pool TVL" value={`$${tvl.toLocaleString()}`} subtext="vUSDT" trend="up" />
          <StatsCard title="LP Share Price" value={`$${lpPrice.toFixed(4)}`} subtext="vUSDT / LP" trend="up" />
          <StatsCard title="AMM k" value={Number(last.amm_invariant_k || 0).toLocaleString()} subtext="Invariant" />
          <StatsCard title="Maximizer NW" value={`$${maxNw.toLocaleString()}`} subtext="vUSDT eq." trend="up" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <SupplyChart data={data} />
          <IssuanceChart data={data} />
        </div>

        <PoolHealthChart data={data} />
        <RoleVolumeChart data={data} />
        <CollateralChart data={data} />
        <ErrorChart data={data} />
        <PnLChart data={data} />
      </div>
    </div>
  );
};

export default EconomyDashboard;
