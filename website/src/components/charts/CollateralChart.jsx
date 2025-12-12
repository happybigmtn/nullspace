import React, { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { transformCollateralSeries } from '../../utils/chartHelpers';

const CollateralChart = ({ data }) => {
  const chartData = useMemo(() => transformCollateralSeries(data), [data]);

  return (
    <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl h-96">
      <h3 className="text-xl font-bold text-gray-100 mb-4 font-mono">Collateral vs Debt (Agg.)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="timestamp"
            stroke="#9ca3af"
            tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
          />
          <YAxis yAxisId="left" stroke="#9ca3af" />
          <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', borderColor: '#374151' }}
            labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
          />
          <Legend />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="collateral_vusd"
            name="Collateral (vUSD)"
            stroke="#22d3ee"
            fill="#22d3ee33"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="debt"
            name="Debt (vUSD)"
            stroke="#fb7185"
            fill="#fb718533"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="ltv"
            name="LTV"
            stroke="#f59e0b"
            dot={false}
          />
          <ReferenceLine yAxisId="right" y={0.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '50% LTV', fill: '#ef4444', position: 'insideTopRight' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CollateralChart;
