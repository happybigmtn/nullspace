import React from 'react';
import { useStartupHealth, getStageMessage, isErrorStage, isLoadingStage } from '../hooks/useStartupHealth';

const LoadingScreen = () => {
  const health = useStartupHealth();
  const stageMessage = getStageMessage(health.stage);
  const isError = isErrorStage(health.stage);
  const isLoading = isLoadingStage(health.stage);

  // Calculate progress based on stage completion
  const getProgress = () => {
    const stages = [
      'main_jsx_loaded',
      'app_mounted',
      'wasm_loading',
      'wasm_loaded',
      'websocket_connecting',
      'websocket_connected',
      'seed_waiting',
      'seed_received',
      'ready',
    ];
    const idx = stages.indexOf(health.stage);
    if (idx === -1) return 0;
    return Math.round(((idx + 1) / stages.length) * 100);
  };

  const progress = getProgress();

  return (
    <div className="min-h-screen loading-bg-shift liquid-shell flex flex-col items-center justify-center p-6 gap-10 animate-scale-in">
      {/* Premium Multi-layer Spinner */}
      <div className="relative">
        {/* Outer glow ring */}
        <div className={`absolute inset-[-8px] rounded-full loading-spinner-glow opacity-50 ${isError ? 'opacity-0' : ''}`} />

        {/* Background ring */}
        <div className={`w-28 h-28 rounded-full border-[3px] ${isError ? 'border-red-500/30' : 'border-black/10 dark:border-white/10'}`} />

        {/* Gradient stroke spinner - outer layer */}
        {!isError && (
          <div
            className="absolute inset-0 w-28 h-28 rounded-full loading-spinner-premium"
            style={{
              background: 'conic-gradient(from 0deg, transparent 0deg, var(--action-primary) 90deg, transparent 180deg)',
              WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
            }}
          />
        )}

        {/* Inner gradient layer - opposite direction */}
        {!isError && (
          <div
            className="absolute inset-2 w-24 h-24 rounded-full"
            style={{
              animation: 'spinnerRotate 2s linear infinite reverse',
              background: 'conic-gradient(from 180deg, transparent 0deg, var(--action-success) 60deg, transparent 120deg)',
              WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 2px))',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 2px))',
            }}
          />
        )}

        {/* Center hub with pulse */}
        <div className="absolute inset-0 flex items-center justify-center">
          {isError ? (
            <div className="w-8 h-8 flex items-center justify-center text-red-500 text-2xl">!</div>
          ) : (
            <div className="w-4 h-4 bg-gradient-to-br from-action-primary to-action-success rounded-full animate-pulse shadow-lg shadow-action-primary/30" />
          )}
        </div>
      </div>

      {/* Premium Typography */}
      <div className="flex flex-col items-center gap-3">
        <span className="text-[9px] font-black text-ns-muted tracking-[0.5em] uppercase">
          {isError ? 'Error' : 'Initialising'}
        </span>
        <h2 className="text-2xl font-bold text-ns tracking-tight font-display">
          Nullspace
        </h2>
      </div>

      {/* Stage-aware status message */}
      <div className="flex flex-col items-center gap-2">
        <div className={`text-[11px] tracking-widest font-medium ${isError ? 'text-red-400' : 'text-ns-muted'}`}>
          {stageMessage}
        </div>

        {/* Error details if present */}
        {isError && health.error && (
          <div className="mt-2 max-w-md text-center">
            <p className="text-[10px] text-red-400/70 font-mono break-all px-4">
              {health.error}
            </p>
            <div className="mt-4 flex gap-2 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-ns-surface border border-ns-border rounded text-[10px] text-ns hover:bg-ns-surface-hover transition-colors"
              >
                Retry
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }}
                className="px-4 py-2 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Clear Storage & Retry
              </button>
            </div>
          </div>
        )}

        {/* Progress indicator when loading */}
        {isLoading && !isError && (
          <div className="w-48 mt-2">
            <div className="h-1 bg-ns-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-action-primary to-action-success transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Animated Dot Trail Progress */}
      {!isError && (
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
      )}

      {/* Subtle tagline */}
      <div className="text-[10px] text-ns-muted tracking-widest font-medium">
        Provably Fair Gaming
      </div>
    </div>
  );
};

export default LoadingScreen;
