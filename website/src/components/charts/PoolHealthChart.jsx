import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
} from 'recharts';
import { transformPoolHealthData } from '../../utils/chartHelpers';

const PoolHealthChart = ({ data }) => {
  const chartData = useMemo(() => transformPoolHealthData(data), [data]);

  return (
    <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl h-96">
      <h3 className="text-xl font-bold text-gray-100 mb-4 font-mono">Pool Health (TVL / LP Share / Price)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="timestamp"
            stroke="#9ca3af"
            tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
          />
          <YAxis yAxisId="left" stroke="#9ca3af" />
          <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', borderColor: '#374151' }}
            formatter={(val, name) => {
              if (name === 'TVL') return [val.toLocaleString(undefined, { maximumFractionDigits: 0 }), name];
              if (name === 'LP Share Price') return [val.toFixed(4), name];
              if (name === 'RNG Price') return [val.toFixed(4), name];
              return [val, name];
            }}
            labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
          />
          <Legend />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="tvl"
            name="TVL"
            stroke="#10b981"
            fill="#10b98133"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="lp_price"
            name="LP Share Price"
            stroke="#f59e0b"
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="price"
            name="RNG Price"
            stroke="#60a5fa"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PoolHealthChart;
