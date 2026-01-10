import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { transformIssuanceData } from '../../utils/chartHelpers';
import { CHART_THEME } from './chartTheme';

const IssuanceChart = ({ data }) => {
  const chartData = useMemo(() => transformIssuanceData(data), [data]);

  return (
    <div className="liquid-card p-5 h-96">
      <h3 className="text-lg font-display tracking-tight text-ns mb-4">Net issuance rate (RNG/s)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} stackOffset="sign">
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
            cursor={{ fill: CHART_THEME.grid, opacity: 0.2 }}
          />
          <ReferenceLine y={0} stroke={CHART_THEME.axis} strokeOpacity={0.5} />
          <Legend wrapperStyle={{ color: CHART_THEME.axis, fontSize: 11 }} />
          <Bar dataKey="rate_mint" fill={CHART_THEME.series.mint} name="Mint Rate" stackId="stack" />
          <Bar dataKey="rate_burn" fill={CHART_THEME.series.rose} name="Burn Rate" stackId="stack" />
          <Bar dataKey="net_rate" fill={CHART_THEME.series.amber} name="Net Change" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default IssuanceChart;
