import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { transformRoleVolumes } from '../../utils/chartHelpers';
import { CHART_THEME } from './chartTheme';

const RoleVolumeChart = ({ data }) => {
  const chartData = useMemo(() => transformRoleVolumes(data), [data]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="liquid-card p-5 h-96 lg:col-span-2">
        <h3 className="text-lg font-display tracking-tight text-ns mb-4">Cumulative volume by role (vUSD)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} stackOffset="expand">
            <CartesianGrid strokeDasharray="2 6" stroke={CHART_THEME.grid} />
            <XAxis
              dataKey="timestamp"
              stroke={CHART_THEME.axis}
              tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
              tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
            />
            <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip
              contentStyle={CHART_THEME.tooltip}
              itemStyle={CHART_THEME.itemStyle}
              labelStyle={CHART_THEME.labelStyle}
              labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
            />
            <Legend wrapperStyle={{ color: CHART_THEME.axis, fontSize: 11 }} />
            <Area type="monotone" dataKey="whale" name="Whales" stackId="1" stroke={CHART_THEME.series.amber} fill={CHART_THEME.series.amberSoft} />
            <Area type="monotone" dataKey="retail" name="Retail" stackId="1" stroke={CHART_THEME.series.aqua} fill={CHART_THEME.series.aquaSoft} />
            <Area type="monotone" dataKey="other" name="Other" stackId="1" stroke={CHART_THEME.series.violet} fill={CHART_THEME.series.violetSoft} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="liquid-card p-5 h-96">
        <h3 className="text-lg font-display tracking-tight text-ns mb-4">Activity signals</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData.slice(-200)}>
            <CartesianGrid strokeDasharray="2 6" stroke={CHART_THEME.grid} />
            <XAxis
              dataKey="timestamp"
              stroke={CHART_THEME.axis}
              tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
              tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
            />
            <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} />
            <Tooltip
              contentStyle={CHART_THEME.tooltip}
              itemStyle={CHART_THEME.itemStyle}
              labelStyle={CHART_THEME.labelStyle}
              labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
            />
            <Legend wrapperStyle={{ color: CHART_THEME.axis, fontSize: 11 }} />
            <Bar dataKey="grinder_joins" name="Grinder Joins" stackId="a" fill={CHART_THEME.series.mint} />
            <Bar dataKey="maximizer_bets" name="Maximizer Bets" stackId="a" fill={CHART_THEME.series.rose} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default RoleVolumeChart;
