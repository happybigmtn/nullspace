
import React from 'react';
import { PlayerStats, LeaderboardEntry } from '../../types';
import { formatTime } from '../../utils/gameUtils';
import { BotConfig } from '../../services/BotService';
import { usePasskeyAuth } from '../../hooks/usePasskeyAuth';
import { PlaySwapStakeTabs } from '../PlaySwapStakeTabs';

interface RegistrationViewProps {
  stats: PlayerStats;
  leaderboard: LeaderboardEntry[];
  isRegistered: boolean;
  statusMessage?: string;
  lastTxSig?: string;
  isSubmitting?: boolean;
  activeTournamentId: number | null;
  playerActiveTournamentId: number | null;
  activeTimeLeft: number;
  nextStartIn: number;
  nextTournamentId: number | null;
  isJoinedNext: boolean;
  tournamentsPlayedToday: number;
  dailyLimit: number;
  onRegister: () => void;
  onEnterTournament: () => void;
  botConfig: BotConfig;
  onBotConfigChange: (config: BotConfig) => void;
}

export const RegistrationView: React.FC<RegistrationViewProps> = ({
  stats,
  leaderboard,
  isRegistered,
  statusMessage,
  lastTxSig,
  isSubmitting = false,
  activeTournamentId,
  playerActiveTournamentId,
  activeTimeLeft,
  nextStartIn,
  nextTournamentId,
  isJoinedNext,
  tournamentsPlayedToday,
  dailyLimit,
  onRegister,
  onEnterTournament,
  botConfig,
  onBotConfigChange
}) => {
  const {
    enabled: passkeyEnabled,
    session: passkeySession,
    register: registerPasskey,
    loading: passkeyLoading,
    error: passkeyError
  } = usePasskeyAuth();
  const pnlData = stats.pnlHistory;
  const maxVal = Math.max(...pnlData, 100);
  const minVal = Math.min(...pnlData, -100);
  const range = maxVal - minVal;
  const height = 100;
  const width = 300;

  const points = pnlData.map((val, i) => {
       const x = (i / Math.max(pnlData.length - 1, 1)) * width;
       const y = height - ((val - minVal) / (range || 1)) * height;
       return `${x},${y}`;
  }).join(' ');

  const maxEntries = Number.isFinite(dailyLimit) ? Math.max(1, dailyLimit) : 1;
  const entriesRemaining = Math.max(0, maxEntries - tournamentsPlayedToday);
  const canEnterTournament =
    activeTournamentId !== null &&
    playerActiveTournamentId !== null &&
    playerActiveTournamentId === activeTournamentId;
  const showStatus = !!statusMessage && statusMessage !== 'PRESS / FOR COMMANDS';
  const normalizedStatus = (statusMessage ?? '').toLowerCase();
  const statusTone =
    normalizedStatus.includes('offline') ||
    normalizedStatus.includes('error') ||
    normalizedStatus.includes('failed')
      ? 'text-terminal-accent'
      : 'text-gray-300';

  return (
      <div className="flex flex-col min-h-screen w-screen bg-terminal-black text-white font-mono items-center justify-center p-4 sm:p-6 md:p-8 overflow-auto">
          <div className="max-w-4xl w-full mb-3 flex justify-center">
              <PlaySwapStakeTabs />
          </div>
          <div className="max-w-4xl w-full border border-terminal-green rounded-lg p-4 sm:p-6 md:p-8 shadow-2xl relative bg-black/80 backdrop-blur">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-center mb-2 tracking-[0.2em] sm:tracking-[0.3em] md:tracking-[0.5em] text-white">
                  FREEROLL LOBBY
              </h1>

              {/* STATUS MESSAGE */}
              <div className="text-center mb-4 sm:mb-6 md:mb-8">
                  <div className="flex flex-col items-center gap-4">
                      {activeTimeLeft > 0 && (
                          <div>
                              <div className="text-[10px] sm:text-xs text-gray-500 tracking-widest mb-1">TOURNAMENT IN PROGRESS · ENDS IN</div>
                              <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-terminal-accent animate-pulse font-mono">
                                  {formatTime(activeTimeLeft)}
                              </div>
                          </div>
                      )}

                      <div>
                          <div className="text-[10px] sm:text-xs text-gray-500 tracking-widest mb-1">
                              NEXT TOURNAMENT STARTS IN{nextTournamentId !== null ? ` · ID ${nextTournamentId}` : ''}
                          </div>
                          <div className="text-xl sm:text-2xl md:text-3xl font-bold text-terminal-green font-mono">
                              {formatTime(nextStartIn)}
                          </div>
                          <div className="mt-2 text-[10px] text-gray-600 tracking-widest">
                              ENTRIES LEFT TODAY: <span className={entriesRemaining > 0 ? 'text-terminal-green' : 'text-terminal-accent'}>{entriesRemaining}/{maxEntries}</span>
                          </div>
                      </div>
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12">
                  {/* STATS */}
                  <div className="space-y-4 sm:space-y-6">
                      <h2 className="text-base sm:text-lg md:text-xl font-bold text-gray-500 border-b border-gray-800 pb-2">YOUR PERFORMANCE</h2>
                      <div className="grid grid-cols-2 gap-2 sm:gap-4 text-sm">
                           <div className="bg-gray-900 p-2 sm:p-4 rounded border border-gray-800">
                               <div className="text-gray-500 text-[10px] sm:text-xs mb-1">FINAL CHIPS</div>
                               <div className="text-lg sm:text-xl md:text-2xl text-white font-bold">${stats.chips.toLocaleString()}</div>
                           </div>
                           <div className="bg-gray-900 p-2 sm:p-4 rounded border border-gray-800">
                               <div className="text-gray-500 text-[10px] sm:text-xs mb-1">FINAL RANK</div>
                               <div className="text-lg sm:text-xl md:text-2xl text-terminal-green font-bold">#{stats.rank}</div>
                           </div>
                      </div>
                      
                      <div className="space-y-2">
                          <div className="text-xs text-gray-500 uppercase tracking-widest">PNL BY GAME</div>
                          {Object.entries(stats.pnlByGame).map(([game, pnl]) => {
                              const val = pnl as number;
                              return (
                              <div key={game} className="flex justify-between text-xs border-b border-gray-800 pb-1">
                                  <span>{game}</span>
                                  <span className={val >= 0 ? 'text-terminal-green' : 'text-terminal-accent'}>
                                      {val >= 0 ? '+' : ''}{val}
                                  </span>
                              </div>
                              );
                          })}
                      </div>
                  </div>

                  {/* CHART & REGISTRATION */}
                  <div className="space-y-8 flex flex-col">
                       <div>
                           <h2 className="text-xl font-bold text-gray-500 border-b border-gray-800 pb-2 mb-4">PNL EVOLUTION</h2>
                           <div className="w-full h-32 bg-gray-900 border border-gray-800 rounded relative overflow-hidden">
                               <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                                    <polyline 
                                        points={points} 
                                        fill="none" 
                                        stroke="#00ff41" 
                                        strokeWidth="2" 
                                    />
                               </svg>
                           </div>
                       </div>

	                       <div className="flex-1 flex flex-col items-center justify-center gap-4">
	                           <button
	                              className={`px-8 py-4 font-bold text-lg rounded transition-colors shadow-[0_0_20px_rgba(0,255,65,0.35)] ${
	                                  !isRegistered || (!isJoinedNext && entriesRemaining > 0)
	                                      ? 'bg-terminal-green text-black hover:bg-green-400'
	                                      : 'bg-gray-800 text-gray-500 cursor-not-allowed'
	                              }`}
	                              onClick={onRegister}
	                              disabled={isSubmitting || (isRegistered && (isJoinedNext || entriesRemaining <= 0))}
	                           >
	                               {isSubmitting
	                                   ? 'SUBMITTING...'
	                                   : !isRegistered
	                                       ? 'PRESS [R] TO REGISTER'
	                                       : isJoinedNext
	                                           ? 'REGISTERED FOR NEXT TOURNAMENT'
	                                           : entriesRemaining <= 0
	                                               ? 'DAILY LIMIT REACHED'
	                                               : 'JOIN NEXT TOURNAMENT'}
	                           </button>
                           {canEnterTournament && (
                               <button
                                   className="px-8 py-3 font-bold text-sm rounded transition-colors border border-terminal-accent/60 text-terminal-accent bg-terminal-accent/10 hover:bg-terminal-accent/20"
                                   onClick={onEnterTournament}
                               >
                                   ENTER TOURNAMENT
                               </button>
                           )}
	                           <div className="text-xs text-gray-400 flex flex-col items-center gap-1">
	                               {showStatus && (
	                                   <div
                                         className={`text-[11px] tracking-widest text-center ${statusTone}`}
                                         role="status"
                                         aria-live="polite"
                                       >
	                                       {statusMessage}
	                                       {lastTxSig ? (
	                                           <span className="text-gray-600"> · TX {lastTxSig}</span>
	                                       ) : null}
	                                   </div>
	                               )}
                               {passkeyEnabled && (
                                   <>
                                       <button
                                           onClick={registerPasskey}
                                           disabled={passkeyLoading}
                                           className="text-terminal-green hover:underline disabled:opacity-50"
                                       >
                                           {passkeyLoading ? 'Pairing passkey...' : 'Use passkey (beta)'}
                                       </button>
                                       {passkeySession && (
                                           <span className="text-[10px] text-terminal-green">
                                               Passkey ready · {passkeySession.credentialId.slice(0, 8)}...
                                           </span>
                                       )}
                                       {passkeyError && (
                                           <span className="text-[10px] text-terminal-accent">{passkeyError}</span>
                                       )}
                                   </>
                               )}
                           </div>
                           
                           <div className="text-center">
                                <div className="text-[10px] text-gray-500 mb-1">REGISTERED PLAYERS</div>
                                <div className="text-xs text-gray-400 flex flex-wrap justify-center gap-2 max-w-xs">
                                    {leaderboard.slice(0, 8).map((p, i) => (
                                        <span key={i}>{p.name}</span>
                                    ))}
                                    <span>...</span>
                                </div>
                           </div>
                       </div>
                  </div>
              </div>

              {/* BOT CONFIGURATION */}
              <div className="mt-8 border-t border-gray-800 pt-6">
                  <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-bold text-gray-500 tracking-widest">BOT OPPONENTS</h2>
                      <button
                          className={`px-4 py-2 rounded text-xs font-bold transition-colors ${
                              botConfig.enabled
                                  ? 'bg-terminal-accent text-black'
                                  : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                          }`}
                          onClick={() => onBotConfigChange({ ...botConfig, enabled: !botConfig.enabled })}
                      >
                          {botConfig.enabled ? 'BOTS ENABLED' : 'ENABLE BOTS'}
                      </button>
                  </div>

                  {botConfig.enabled && (
                      <div className="grid grid-cols-3 gap-4 bg-gray-900/50 p-4 rounded border border-gray-800">
                          {/* Number of Bots */}
                          <div>
                              <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-2">
                                  NUMBER OF BOTS
                              </label>
                              <div className="flex items-center gap-2">
                                  <input
                                      type="range"
                                      min="10"
                                      max="300"
                                      step="10"
                                      value={botConfig.numBots}
                                      onChange={(e) => onBotConfigChange({ ...botConfig, numBots: parseInt(e.target.value) })}
                                      className="flex-1 accent-terminal-green bg-gray-800"
                                  />
                                  <span className="text-terminal-green font-mono w-12 text-right">{botConfig.numBots}</span>
                              </div>
                          </div>

                          {/* Bet Interval */}
                          <div>
                              <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-2">
                                  BET INTERVAL (SEC)
                              </label>
                              <div className="flex items-center gap-2">
                                  <input
                                      type="range"
                                      min="1000"
                                      max="10000"
                                      step="1000"
                                      value={botConfig.betIntervalMs}
                                      onChange={(e) => onBotConfigChange({ ...botConfig, betIntervalMs: parseInt(e.target.value) })}
                                      className="flex-1 accent-terminal-green bg-gray-800"
                                  />
                                  <span className="text-terminal-green font-mono w-12 text-right">{botConfig.betIntervalMs / 1000}s</span>
                              </div>
                          </div>

                          {/* Randomize */}
                          <div>
                              <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-2">
                                  RANDOMIZE TIMING
                              </label>
                              <button
                                  className={`w-full py-2 rounded text-xs font-bold transition-colors ${
                                      botConfig.randomizeInterval
                                          ? 'bg-terminal-green/20 text-terminal-green border border-terminal-green'
                                          : 'bg-gray-800 text-gray-500 border border-gray-700'
                                  }`}
                                  onClick={() => onBotConfigChange({ ...botConfig, randomizeInterval: !botConfig.randomizeInterval })}
                              >
                                  {botConfig.randomizeInterval ? 'RANDOM' : 'FIXED'}
                              </button>
                          </div>
                      </div>
                  )}

                  {botConfig.enabled && (
                      <div className="mt-2 text-[10px] text-gray-600 text-center">
                          {botConfig.numBots} bots will make random bets every ~{botConfig.betIntervalMs / 1000}s during the tournament
                      </div>
                  )}
              </div>
          </div>
      </div>
  );
};
