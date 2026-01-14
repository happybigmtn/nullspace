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
import { CHART_THEME } from './chartTheme';

const ErrorChart = ({ data }) => {
  const chartData = useMemo(() => transformErrorSeries(data).slice(-200), [data]);

  return (
    <div className="liquid-card p-5 h-96">
      <h3 className="text-lg font-display tracking-tight text-ns mb-4">Error radar (last 200 blocks)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} stackOffset="expand">
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
          <Bar dataKey="invalid" name="Invalid Move" stackId="a" fill={CHART_THEME.series.rose} />
          <Bar dataKey="invalid_bet" name="Invalid Bet" stackId="a" fill={CHART_THEME.series.amber} />
          <Bar dataKey="insufficient" name="Insufficient Funds" stackId="a" fill={CHART_THEME.series.violet} />
          <Bar dataKey="session_not_found" name="Session Not Found" stackId="a" fill={CHART_THEME.series.aqua} />
          <Bar dataKey="session_complete" name="Session Complete" stackId="a" fill={CHART_THEME.series.mint} />
          <Bar dataKey="tournament_not_registering" name="Tournament Closed" stackId="a" fill={CHART_THEME.series.aquaSoft} />
          <Bar dataKey="rate_limited" name="Rate Limited" stackId="a" fill={CHART_THEME.series.mintSoft} />
          <Bar dataKey="other" name="Other" stackId="a" fill={CHART_THEME.series.neutral} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ErrorChart;
