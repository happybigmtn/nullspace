import React from 'react';

const LoadingScreen = () => {
  return (
    <div className="min-h-screen loading-bg-shift liquid-shell flex flex-col items-center justify-center p-6 gap-10 animate-scale-in">
      {/* Premium Multi-layer Spinner */}
      <div className="relative">
        {/* Outer glow ring */}
        <div className="absolute inset-[-8px] rounded-full loading-spinner-glow opacity-50" />

        {/* Background ring */}
        <div className="w-28 h-28 rounded-full border-[3px] border-black/10 dark:border-white/10" />

        {/* Gradient stroke spinner - outer layer */}
        <div
          className="absolute inset-0 w-28 h-28 rounded-full loading-spinner-premium"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0deg, var(--action-primary) 90deg, transparent 180deg)',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
          }}
        />

        {/* Inner gradient layer - opposite direction */}
        <div
          className="absolute inset-2 w-24 h-24 rounded-full"
          style={{
            animation: 'spinnerRotate 2s linear infinite reverse',
            background: 'conic-gradient(from 180deg, transparent 0deg, var(--action-success) 60deg, transparent 120deg)',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 2px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 2px))',
          }}
        />

        {/* Center hub with pulse */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 bg-gradient-to-br from-action-primary to-action-success rounded-full animate-pulse shadow-lg shadow-action-primary/30" />
        </div>
      </div>

      {/* Premium Typography */}
      <div className="flex flex-col items-center gap-3">
        <span className="text-[9px] font-black text-ns-muted tracking-[0.5em] uppercase">
          Initialising
        </span>
        <h2 className="text-2xl font-bold text-ns tracking-tight font-display">
          Nullspace
        </h2>
      </div>

      {/* Animated Dot Trail Progress */}
      <div className="flex items-center gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="loading-dot w-2 h-2 rounded-full"
            style={{
              background: i % 2 === 0 ? 'var(--action-primary)' : 'var(--action-success)',
            }}
          />
        ))}
      </div>

      {/* Subtle tagline */}
      <div className="text-[10px] text-ns-muted tracking-widest font-medium">
        Provably Fair Gaming
      </div>
    </div>
  );
};

export default LoadingScreen;
