import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { transformErrorSeries } from '../../utils/chartHelpers';

const ErrorChart = ({ data }) => {
  const chartData = useMemo(() => transformErrorSeries(data).slice(-200), [data]);

  return (
    <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl h-96">
        <h3 className="text-xl font-bold text-gray-100 mb-4 font-mono">Error Radar (last 200 blocks)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} stackOffset="expand">
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="timestamp"
              stroke="#9ca3af"
              tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
            />
            <YAxis stroke="#9ca3af" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', borderColor: '#374151' }}
              labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
            />
            <Legend />
            <Bar dataKey="invalid" name="Invalid Move" stackId="a" fill="#f97316" />
            <Bar dataKey="invalid_bet" name="Invalid Bet" stackId="a" fill="#f59e0b" />
            <Bar dataKey="insufficient" name="Insufficient Funds" stackId="a" fill="#ef4444" />
            <Bar dataKey="session_not_found" name="Session Not Found" stackId="a" fill="#3b82f6" />
            <Bar dataKey="session_complete" name="Session Complete" stackId="a" fill="#22d3ee" />
            <Bar dataKey="tournament_not_registering" name="Tournament Closed" stackId="a" fill="#a855f7" />
            <Bar dataKey="rate_limited" name="Rate Limited" stackId="a" fill="#10b981" />
            <Bar dataKey="other" name="Other" stackId="a" fill="#9ca3af" />
          </BarChart>
        </ResponsiveContainer>
    </div>
  );
};

export default ErrorChart;
