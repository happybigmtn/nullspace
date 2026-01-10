import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { transformPoolHealthData } from '../../utils/chartHelpers';
import { CHART_THEME } from './chartTheme';

const PoolHealthChart = ({ data }) => {
  const chartData = useMemo(() => transformPoolHealthData(data), [data]);

  return (
    <div className="liquid-card p-5 h-96">
      <h3 className="text-lg font-display tracking-tight text-ns mb-4">Pool health (TVL / LP / price)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="2 6" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="timestamp"
            stroke={CHART_THEME.axis}
            tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
            tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
          />
          <YAxis yAxisId="left" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} />
          <YAxis yAxisId="right" orientation="right" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} />
          <Tooltip
            contentStyle={CHART_THEME.tooltip}
            itemStyle={CHART_THEME.itemStyle}
            labelStyle={CHART_THEME.labelStyle}
            formatter={(val, name) => {
              if (name === 'TVL') return [val.toLocaleString(undefined, { maximumFractionDigits: 0 }), name];
              if (name === 'LP Share Price') return [val.toFixed(4), name];
              if (name === 'RNG Price') return [val.toFixed(4), name];
              return [val, name];
            }}
            labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
          />
          <Legend wrapperStyle={{ color: CHART_THEME.axis, fontSize: 11 }} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="tvl"
            name="TVL"
            stroke={CHART_THEME.series.mint}
            fill={CHART_THEME.series.mintSoft}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="lp_price"
            name="LP Share Price"
            stroke={CHART_THEME.series.amber}
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="price"
            name="RNG Price"
            stroke={CHART_THEME.series.aqua}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PoolHealthChart;
