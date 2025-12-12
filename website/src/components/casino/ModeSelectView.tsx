import React from 'react';
import { Link } from 'react-router-dom';
import { PlaySwapStakeTabs } from '../PlaySwapStakeTabs';

export type PlayMode = 'CASH' | 'FREEROLL';

interface ModeSelectViewProps {
  onSelect: (mode: PlayMode) => void;
}

export const ModeSelectView: React.FC<ModeSelectViewProps> = ({ onSelect }) => {
  return (
    <div className="flex flex-col min-h-screen w-screen bg-terminal-black text-white font-mono items-center justify-center p-4 sm:p-6 md:p-8 overflow-auto">
      <div className="max-w-3xl w-full mb-3 flex justify-center">
        <PlaySwapStakeTabs />
      </div>
      <div className="max-w-3xl w-full border border-terminal-green rounded-lg p-4 sm:p-6 md:p-8 shadow-2xl relative bg-black/80 backdrop-blur">
        <div className="text-center mb-6">
          <div className="text-xs text-gray-500 tracking-[0.4em] mb-2">WELCOME TO</div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-[0.2em] text-white">
            null<span className="text-terminal-green">/</span>space
          </h1>
          <div className="text-[10px] sm:text-xs text-gray-500 mt-3">
            SELECT A MODE TO BEGIN
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <button
            className="text-left border border-gray-800 rounded p-4 sm:p-5 bg-gray-900/40 hover:bg-gray-900/70 transition-colors"
            onClick={() => onSelect('CASH')}
          >
            <div className="text-terminal-green font-bold tracking-widest mb-2">CASH GAME</div>
            <div className="text-xs text-gray-400 leading-relaxed">
              Bet any amount of RNG you have on any casino bet.
              Includes a daily faucet (dev/testing) so you can always play.
            </div>
            <div className="text-[10px] text-gray-600 mt-3 tracking-widest">
              UNLIMITED PLAY • FAUCET ENABLED
            </div>
          </button>

          <button
            className="text-left border border-gray-800 rounded p-4 sm:p-5 bg-gray-900/40 hover:bg-gray-900/70 transition-colors"
            onClick={() => onSelect('FREEROLL')}
          >
            <div className="text-terminal-accent font-bold tracking-widest mb-2">FREEROLL</div>
            <div className="text-xs text-gray-400 leading-relaxed">
              Join 5-minute tournaments (up to 5 entries/day). Start with 1,000 chips.
              Top 15% share the RNG daily emission.
            </div>
            <div className="text-[10px] text-gray-600 mt-3 tracking-widest">
              TOURNAMENTS • TOP 15% PAID
            </div>
          </button>
        </div>

        <div className="mt-6 text-center text-[10px] text-gray-600 tracking-widest">
          <Link to="/swap" className="text-terminal-green hover:underline">
            SWAP / LIQUIDITY
          </Link>
          <span className="mx-2">·</span>
          <Link to="/stake" className="text-terminal-green hover:underline">
            STAKING
          </Link>
          <span className="mx-2">·</span>
          <Link to="/explorer" className="text-gray-400 hover:underline">
            BLOCK EXPLORER
          </Link>
        </div>
      </div>
    </div>
  );
};
