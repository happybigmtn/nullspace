import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area } from 'recharts';

const EconomyDashboard = () => {
  const [data, setData] = useState([]);
  const [metrics, setMetrics] = useState({
    currentPrice: 0,
    totalBurned: 0,
    housePnl: 0,
    liquidity: 0
  });

  useEffect(() => {
    // In a real app, this would fetch from an API endpoint serving the JSON log
    // For this demo, we'll try to fetch the local file if served, or use mock data if failing
    fetch('/economy_log.json')
      .then(res => res.json())
      .then(jsonData => {
        setData(jsonData);
        if (jsonData.length > 0) {
          const last = jsonData[jsonData.length - 1];
          setMetrics({
            currentPrice: last.rng_price,
            totalBurned: last.total_burned,
            housePnl: last.house_pnl,
            liquidity: last.amm_rng + last.amm_vusdt
          });
        }
      })
      .catch(err => console.warn("Failed to load economy log", err));
  }, []);

  if (data.length === 0) return <div className="p-10 text-center text-white">Loading Economy Data... (Ensure simulation has run)</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 font-mono">
      <h1 className="text-3xl font-bold mb-8 text-green-400 border-b border-gray-700 pb-4">
        🏦 Sovereign House & Island Economy
      </h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card title="RNG Price (vUSDT)" value={`$${metrics.currentPrice.toFixed(4)}`} color="text-blue-400" />
        <Card title="Total RNG Burned" value={metrics.totalBurned.toLocaleString()} color="text-red-500" />
        <Card title="House Net PnL" value={metrics.housePnl.toLocaleString()} color={metrics.housePnl >= 0 ? "text-green-500" : "text-red-500"} />
        <Card title="AMM Liquidity" value={metrics.liquidity.toLocaleString()} color="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Chart 1: Price Action */}
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg">
          <h2 className="text-xl font-bold mb-4 text-blue-300">RNG/vUSDT Price Action</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="block" stroke="#9CA3AF" />
                <YAxis domain={['auto', 'auto']} stroke="#9CA3AF" />
                <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                <Legend />
                <Line type="monotone" dataKey="rng_price" stroke="#60A5FA" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: House Solvency */}
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg">
          <h2 className="text-xl font-bold mb-4 text-green-300">House Solvency (Net PnL)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="block" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                <Legend />
                <Bar dataKey="house_pnl" fill="#34D399" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Supply Dynamics (Burn vs Liquidity) */}
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg col-span-1 lg:col-span-2">
          <h2 className="text-xl font-bold mb-4 text-red-300">Supply Dynamics: Burn vs Liquidity</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="block" stroke="#9CA3AF" />
                <YAxis yAxisId="left" stroke="#F87171" label={{ value: 'Burned', angle: -90, position: 'insideLeft', fill: '#F87171' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#A78BFA" label={{ value: 'Liquidity', angle: 90, position: 'insideRight', fill: '#A78BFA' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="total_burned" fill="#F87171" stroke="#F87171" fillOpacity={0.3} />
                <Line yAxisId="right" type="monotone" dataKey="amm_rng" name="AMM RNG Reserve" stroke="#A78BFA" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
};

const Card = ({ title, value, color }) => (
  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 shadow-md">
    <div className="text-gray-400 text-sm uppercase tracking-wider mb-1">{title}</div>
    <div className={`text-2xl font-bold ${color}`}>{value}</div>
  </div>
);

export default EconomyDashboard;
