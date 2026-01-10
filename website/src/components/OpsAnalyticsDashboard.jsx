import React, { useCallback, useEffect, useState } from 'react';
import StatsCard from './StatsCard';

const opsBase = (import.meta.env.VITE_OPS_URL || import.meta.env.VITE_ANALYTICS_URL || '').replace(/\/$/, '');

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`;
const formatCurrency = (value) => `$${Number(value || 0).toFixed(2)}`;

const OpsAnalyticsDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchKpis = useCallback(async () => {
    if (!opsBase) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${opsBase}/analytics/kpis`);
      if (!res.ok) throw new Error(`KPI fetch failed (${res.status})`);
      const payload = await res.json();
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load KPIs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKpis();
  }, [fetchKpis]);

  if (!opsBase) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ns">
        <div className="liquid-card p-6 text-center">
          Missing VITE_OPS_URL / VITE_ANALYTICS_URL — ops analytics unavailable.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ns">
        <div className="liquid-card p-6 text-center">Loading KPIs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ns">
        <div className="liquid-card p-6 text-center space-y-4">
          <div>{error}</div>
          <button
            className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
            onClick={fetchKpis}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ns">
        <div className="liquid-card p-6 text-center">No KPI data yet.</div>
      </div>
    );
  }

  const d7 = data.d7 ?? { cohort: 0, retained: 0, rate: 0 };
  const d30 = data.d30 ?? { cohort: 0, retained: 0, rate: 0 };
  const conversion = data.conversion ?? { converted: 0, rate: 0 };

  return (
    <div className="min-h-screen text-ns font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="liquid-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Analytics</div>
              <div className="text-lg font-display tracking-tight text-ns">Product KPIs</div>
              <div className="text-[11px] text-ns-muted">Live signals from ops telemetry.</div>
            </div>
            <button
              className="text-[10px] px-4 py-2 rounded-full liquid-chip text-ns uppercase tracking-[0.28em] hover:shadow-soft"
              onClick={fetchKpis}
            >
              Refresh
            </button>
          </div>
        </header>

        <section className="liquid-card p-5">
          <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Key metrics</div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatsCard title="DAU" value={Number(data.dau ?? 0).toLocaleString()} subtext="Today" />
            <StatsCard title="WAU" value={Number(data.wau ?? 0).toLocaleString()} subtext="7d" />
            <StatsCard title="MAU" value={Number(data.mau ?? 0).toLocaleString()} subtext="30d" />
            <StatsCard title="Active Users" value={Number(data.activeUsers ?? 0).toLocaleString()} subtext="Range" />
            <StatsCard title="New Users" value={Number(data.newUsers ?? 0).toLocaleString()} subtext="Range" />
            <StatsCard title="D7 Retention" value={formatPercent(d7.rate ?? 0)} subtext={`${d7.retained}/${d7.cohort}`} />
            <StatsCard title="D30 Retention" value={formatPercent(d30.rate ?? 0)} subtext={`${d30.retained}/${d30.cohort}`} />
            <StatsCard title="Conversion" value={formatPercent(conversion.rate ?? 0)} subtext={`${conversion.converted} users`} />
            <StatsCard title="Revenue" value={formatCurrency(data.revenue ?? 0)} subtext="Range" />
            <StatsCard title="ARPDAU" value={formatCurrency(data.arpDau ?? 0)} subtext="Avg" />
          </div>
        </section>
      </div>
    </div>
  );
};

export default OpsAnalyticsDashboard;
