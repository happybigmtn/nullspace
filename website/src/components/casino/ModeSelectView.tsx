import React from 'react';
import { Link } from 'react-router-dom';
import { PlaySwapStakeTabs } from '../PlaySwapStakeTabs';

export type PlayMode = 'CASH' | 'FREEROLL';

interface ModeSelectViewProps {
  onSelect: (mode: PlayMode) => void;
}

export const ModeSelectView: React.FC<ModeSelectViewProps> = ({ onSelect }) => {
  return (
    <div className="flex flex-col min-h-screen w-screen bg-titanium-50 text-titanium-900 font-sans items-center justify-center p-6 md:p-12 overflow-auto">
      <div className="max-w-4xl w-full mb-8 flex justify-center scale-90 sm:scale-100">
        <PlaySwapStakeTabs />
      </div>
      
      <div className="max-w-4xl w-full bg-white rounded-[48px] p-8 sm:p-12 md:p-16 shadow-float border border-titanium-200 relative overflow-hidden animate-scale-in">
        {/* Subtle Background Accent */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-action-primary/5 rounded-full -mr-32 -mt-32 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-action-success/5 rounded-full -ml-32 -mb-32 blur-3xl" />

        <div className="text-center mb-12 relative z-10">
          <div className="text-[10px] font-bold text-titanium-400 tracking-[0.4em] mb-4 uppercase">Experience Nullspace</div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tight text-titanium-900">
            Select your mode.
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
          <button
            className="group text-left p-8 rounded-[32px] bg-titanium-50 border border-titanium-100 hover:bg-white hover:shadow-float hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
            onClick={() => onSelect('CASH')}
          >
            <div className="w-12 h-12 rounded-2xl bg-action-success flex items-center justify-center text-white mb-6 shadow-lg shadow-green-500/20 group-hover:rotate-3 transition-transform">
                <span className="text-xl font-bold">$</span>
            </div>
            <div className="text-lg font-bold text-titanium-900 mb-2">Cash Game</div>
            <div className="text-sm text-titanium-400 leading-relaxed font-medium">
              Bet RNG tokens on live casino outcomes. Includes a daily faucet for continuous exploration.
            </div>
            <div className="inline-flex items-center gap-2 mt-6 px-3 py-1 rounded-full bg-white border border-titanium-200 text-[9px] font-bold text-titanium-400 tracking-widest uppercase">
              Unlimited • Faucet
            </div>
          </button>

          <button
            className="group text-left p-8 rounded-[32px] bg-titanium-50 border border-titanium-100 hover:bg-white hover:shadow-float hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
            onClick={() => onSelect('FREEROLL')}
          >
            <div className="w-12 h-12 rounded-2xl bg-action-primary flex items-center justify-center text-white mb-6 shadow-lg shadow-blue-500/20 group-hover:-rotate-3 transition-transform">
                <span className="text-xl font-bold">★</span>
            </div>
            <div className="text-lg font-bold text-titanium-900 mb-2">Tournament</div>
            <div className="text-sm text-titanium-400 leading-relaxed font-medium">
              Join 5-minute sprints. Compete for a share of the daily RNG emission with provided chips.
            </div>
            <div className="inline-flex items-center gap-2 mt-6 px-3 py-1 rounded-full bg-white border border-titanium-200 text-[9px] font-bold text-titanium-400 tracking-widest uppercase">
              Tourneys • Top 15% Paid
            </div>
          </button>
        </div>

        <div className="mt-16 flex flex-wrap justify-center gap-x-8 gap-y-4 relative z-10">
          <Link to="/swap" className="text-[11px] font-bold text-titanium-400 hover:text-action-primary transition-colors tracking-widest uppercase">Swap</Link>
          <Link to="/stake" className="text-[11px] font-bold text-titanium-400 hover:text-action-primary transition-colors tracking-widest uppercase">Stake</Link>
          <Link to="/security" className="text-[11px] font-bold text-titanium-400 hover:text-action-primary transition-colors tracking-widest uppercase">Vault</Link>
          <Link to="/explorer" className="text-[11px] font-bold text-titanium-400 hover:text-action-primary transition-colors tracking-widest uppercase">Blocks</Link>
        </div>
      </div>
    </div>
  );
};
