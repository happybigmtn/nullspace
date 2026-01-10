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
import { CHART_THEME } from './chartTheme';

const CollateralChart = ({ data }) => {
  const chartData = useMemo(() => transformCollateralSeries(data), [data]);

  return (
    <div className="liquid-card p-5 h-96">
      <h3 className="text-lg font-display tracking-tight text-ns mb-4">Collateral vs debt (agg.)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="2 6" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="timestamp"
            stroke={CHART_THEME.axis}
            tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
            tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
          />
          <YAxis yAxisId="left" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} />
          <YAxis yAxisId="right" orientation="right" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
          <Tooltip
            contentStyle={CHART_THEME.tooltip}
            itemStyle={CHART_THEME.itemStyle}
            labelStyle={CHART_THEME.labelStyle}
            labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
          />
          <Legend wrapperStyle={{ color: CHART_THEME.axis, fontSize: 11 }} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="collateral_vusd"
            name="Collateral (vUSD)"
            stroke={CHART_THEME.series.aqua}
            fill={CHART_THEME.series.aquaSoft}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="debt"
            name="Debt (vUSD)"
            stroke={CHART_THEME.series.rose}
            fill={CHART_THEME.series.roseSoft}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="ltv"
            name="LTV"
            stroke={CHART_THEME.series.amber}
            dot={false}
          />
          <ReferenceLine yAxisId="right" y={0.6} stroke={CHART_THEME.series.rose} strokeDasharray="4 4" label={{ value: '60% Liq. Threshold', fill: CHART_THEME.series.rose, position: 'insideTopRight' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CollateralChart;
