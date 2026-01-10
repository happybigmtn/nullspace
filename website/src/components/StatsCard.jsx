import React from 'react';

const StatsCard = ({ title, value, subtext, trend }) => {
  const trendColor = trend === 'up' ? 'text-action-success' : trend === 'down' ? 'text-action-destructive' : 'text-ns-muted';
  
  return (
    <div className="liquid-panel p-4">
      <div className="text-[10px] uppercase tracking-[0.32em] text-ns-muted">{title}</div>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-2xl font-mono text-ns font-semibold tabular-nums">{value}</span>
        {subtext ? (
          <span className={`text-[10px] uppercase tracking-[0.28em] ${trendColor}`}>{subtext}</span>
        ) : null}
      </div>
    </div>
  );
};

export default StatsCard;
