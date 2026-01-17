import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PlaySwapStakeTabs } from '../PlaySwapStakeTabs';
import { useTheme } from '../../hooks/useTheme';

export type PlayMode = 'CASH' | 'FREEROLL';

/** Generate floating particle elements with staggered timing */
function FloatingParticles({ isDark }: { isDark: boolean }) {
  const particles = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      id: i,
      left: `${10 + (i * 7) % 80}%`,
      bottom: `${5 + (i * 11) % 30}%`,
      duration: `${5 + (i % 4) * 1.5}s`,
      delay: `${(i * 0.5) % 3}s`,
      driftX: `${(i % 2 === 0 ? 1 : -1) * (10 + (i % 5) * 8)}px`,
      // US-261: Monochrome particles
      color: isDark ? (i % 2 === 0 ? '#FFFFFF' : '#737373') : (i % 2 === 0 ? '#000000' : '#737373'),
    }));
  }, [isDark]);

  return (
    <div className="hero-particles">
      {particles.map((p) => (
        <div
          key={p.id}
          className="hero-particle"
          style={{
            left: p.left,
            bottom: p.bottom,
            color: p.color,
            ['--particle-duration' as string]: p.duration,
            ['--particle-delay' as string]: p.delay,
            ['--drift-x' as string]: p.driftX,
          }}
        />
      ))}
    </div>
  );
}

interface ModeSelectViewProps {
  onSelect: (mode: PlayMode) => void;
}

export const ModeSelectView: React.FC<ModeSelectViewProps> = ({ onSelect }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const palette = isDark
    ? {
        surface: '#0f0f12',
        panel: '#1c1c1e',
        border: '#3a3a3c',
        text: '#f2f2f7',
        muted: '#d1d1d6',
        subtle: '#a2a2a7',
        chip: '#2c2c2e',
      }
    : {
        surface: '#f2f2f7',
        panel: '#ffffff',
        border: '#7c7c80',
        text: '#1c1c1e',
        muted: '#4a4a4d',
        subtle: '#636366',
        chip: '#f2f2f7',
      };

  return (
    <div
      className="mode-select flex flex-col min-h-dvh w-screen font-sans items-center justify-center p-6 md:p-12 overflow-auto"
      style={{ backgroundColor: palette.surface, color: palette.text }}
    >
      {/* Full-width animated banner */}
      <div className="hero-banner fixed top-0 left-0 right-0 h-1 z-50" />

      <div className="max-w-4xl w-full mb-8 flex justify-center scale-90 sm:scale-100">
        <PlaySwapStakeTabs className="mode-tabs" tone="mode" palette={palette} />
      </div>
      
      <div
        className="mode-panel max-w-4xl w-full rounded-[48px] p-8 sm:p-12 md:p-16 shadow-float border relative overflow-hidden animate-scale-in"
        style={{ backgroundColor: palette.panel, borderColor: palette.border }}
      >
        {/* Animated Background Gradients */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-mono-0 rounded-full -mr-40 -mt-40 hero-glow-pulse hero-gradient-drift" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-mono-0 rounded-full -ml-40 -mb-40 hero-glow-pulse-alt hero-gradient-drift-alt" />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 -translate-x-1/2 -translate-y-1/2 bg-gradient-radial from-mono-0/5 to-transparent rounded-full hero-gradient-drift" />

        {/* Floating Particles */}
        <FloatingParticles isDark={isDark} />

        <div className="text-center mb-12 relative z-10">
          <div className="text-[10px] font-bold tracking-[0.4em] mb-4 uppercase mode-muted" style={{ color: palette.muted }}>
            Experience Nullspace
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-medium tracking-tight text-balance">
            Select your mode.
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
          <button
            className="group text-left p-8 rounded-[32px] border card-premium hover-glow-success hover-gradient-overlay mode-panel"
            style={{ backgroundColor: palette.panel, borderColor: palette.border }}
            onClick={() => onSelect('CASH')}
          >
            <div className="w-12 h-12 rounded-2xl bg-mono-0 flex items-center justify-center text-white mb-6 shadow-lg shadow-green-500/20 group-hover:rotate-6 group-hover:scale-110 transition-transform">
                <span className="text-xl font-bold">$</span>
            </div>
            <div className="text-lg font-bold mb-2">Cash Game</div>
            <div className="text-sm leading-relaxed font-medium mode-muted" style={{ color: palette.muted }}>
              Bet RNG tokens on live casino outcomes. Includes a daily faucet for continuous exploration.
            </div>
            <div
              className="mode-pill inline-flex items-center gap-2 mt-6 px-3 py-1 rounded-full border text-[9px] font-bold tracking-widest uppercase"
              style={{ backgroundColor: palette.chip, borderColor: palette.border, color: palette.muted }}
            >
              Unlimited • Faucet
            </div>
          </button>

          <button
            className="group text-left p-8 rounded-[32px] border card-premium hover-glow hover-gradient-overlay mode-panel"
            style={{ backgroundColor: palette.panel, borderColor: palette.border }}
            onClick={() => onSelect('FREEROLL')}
          >
            <div className="w-12 h-12 rounded-2xl bg-mono-0 flex items-center justify-center text-white mb-6 shadow-lg shadow-blue-500/20 group-hover:-rotate-6 group-hover:scale-110 transition-transform">
                <span className="text-xl font-bold">★</span>
            </div>
            <div className="text-lg font-bold mb-2">Tournament</div>
            <div className="text-sm leading-relaxed font-medium mode-muted" style={{ color: palette.muted }}>
              Join 5-minute sprints. Compete for a share of the daily RNG emission with provided chips.
            </div>
            <div
              className="mode-pill inline-flex items-center gap-2 mt-6 px-3 py-1 rounded-full border text-[9px] font-bold tracking-widest uppercase"
              style={{ backgroundColor: palette.chip, borderColor: palette.border, color: palette.muted }}
            >
              Tourneys • Top 15% Paid
            </div>
          </button>
        </div>

        <div className="mt-16 flex flex-wrap justify-center gap-x-8 gap-y-4 relative z-10">
          <Link to="/swap" className="text-[11px] font-bold mode-subtle hover:text-mono-0 dark:text-mono-1000 transition-colors tracking-widest uppercase" style={{ color: palette.subtle }}>Swap</Link>
          <Link to="/stake" className="text-[11px] font-bold mode-subtle hover:text-mono-0 dark:text-mono-1000 transition-colors tracking-widest uppercase" style={{ color: palette.subtle }}>Stake</Link>
          <Link to="/security" className="text-[11px] font-bold mode-subtle hover:text-mono-0 dark:text-mono-1000 transition-colors tracking-widest uppercase" style={{ color: palette.subtle }}>Vault</Link>
          <Link to="/explorer" className="text-[11px] font-bold mode-subtle hover:text-mono-0 dark:text-mono-1000 transition-colors tracking-widest uppercase" style={{ color: palette.subtle }}>Blocks</Link>
        </div>
      </div>
    </div>
  );
};
