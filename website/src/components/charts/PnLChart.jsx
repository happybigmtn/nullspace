import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { CHART_THEME } from './chartTheme';

const PnLChart = ({ data }) => {
  // Find epoch changes
  const epochChanges = [];
  let currentEpoch = data[0]?.epoch;
  
  data.forEach((d, i) => {
    if (d.epoch !== currentEpoch) {
      epochChanges.push({ index: i, epoch: d.epoch, timestamp: d.timestamp });
      currentEpoch = d.epoch;
    }
  });

  return (
    <div className="liquid-card p-5 h-96">
      <h3 className="text-lg font-display tracking-tight text-ns mb-4">House PnL (epoch cycles)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
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
          <Line 
            type="stepAfter" 
            dataKey="house_pnl" 
            stroke={CHART_THEME.series.violet}
            strokeWidth={2} 
            dot={false} 
            name="Net PnL"
          />
          {epochChanges.map((e, i) => (
            <ReferenceLine 
              key={i} 
              x={e.timestamp} 
              stroke={CHART_THEME.series.amber}
              label={{ value: `Epoch ${e.epoch}`, fill: CHART_THEME.series.amber, position: 'insideTopLeft' }} 
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PnLChart;
