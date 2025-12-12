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
  BarChart,
  Bar,
} from 'recharts';
import { transformRoleVolumes } from '../../utils/chartHelpers';

const RoleVolumeChart = ({ data }) => {
  const chartData = useMemo(() => transformRoleVolumes(data), [data]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl h-96 lg:col-span-2">
        <h3 className="text-xl font-bold text-gray-100 mb-4 font-mono">Cumulative Volume by Role (vUSD)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} stackOffset="expand">
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
            <Area type="monotone" dataKey="whale" name="Whales" stackId="1" stroke="#f97316" fill="#f9731633" />
            <Area type="monotone" dataKey="retail" name="Retail" stackId="1" stroke="#22d3ee" fill="#22d3ee33" />
            <Area type="monotone" dataKey="other" name="Other" stackId="1" stroke="#a78bfa" fill="#a78bfa33" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl h-96">
        <h3 className="text-xl font-bold text-gray-100 mb-4 font-mono">Activity Signals</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData.slice(-200)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="timestamp"
              stroke="#9ca3af"
              tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
            />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', borderColor: '#374151' }}
              labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
            />
            <Legend />
            <Bar dataKey="grinder_joins" name="Grinder Joins" stackId="a" fill="#34d399" />
            <Bar dataKey="maximizer_bets" name="Maximizer Bets" stackId="a" fill="#fb7185" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default RoleVolumeChart;
