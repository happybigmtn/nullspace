import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { transformSupplyData } from '../../utils/chartHelpers';
import { CHART_THEME } from './chartTheme';

const SupplyChart = ({ data }) => {
  const chartData = useMemo(() => transformSupplyData(data), [data]);

  return (
    <div className="liquid-card p-5 h-96">
      <h3 className="text-lg font-display tracking-tight text-ns mb-4">Supply evolution</h3>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="lc-supply-burn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_THEME.series.rose} stopOpacity={0.35}/>
              <stop offset="95%" stopColor={CHART_THEME.series.rose} stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="lc-supply-mint" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_THEME.series.mint} stopOpacity={0.35}/>
              <stop offset="95%" stopColor={CHART_THEME.series.mint} stopOpacity={0}/>
            </linearGradient>
          </defs>
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
          />
          <Legend wrapperStyle={{ color: CHART_THEME.axis, fontSize: 11 }} />
          <Area 
            type="monotone" 
            dataKey="issuance" 
            stackId="1" 
            stroke={CHART_THEME.series.mint}
            fill="url(#lc-supply-mint)" 
            name="Total Minted"
          />
          <Area 
            type="monotone" 
            dataKey="burned" 
            stackId="2" 
            stroke={CHART_THEME.series.rose}
            fill="url(#lc-supply-burn)" 
            name="Total Burned"
          />
          <Area 
            type="monotone" 
            dataKey="circulating" 
            stroke={CHART_THEME.series.aqua}
            fill="none" 
            strokeWidth={2}
            name="Circulating Supply"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SupplyChart;
