
import React, { useState } from 'react';
import { PlayerStats, LeaderboardEntry } from '../../types';
import { formatTime } from '../../utils/gameUtils';
import { BotConfig } from '../../services/BotService';
import { usePasskeyAuth } from '../../hooks/usePasskeyAuth';
import { PlaySwapStakeTabs } from '../PlaySwapStakeTabs';
import { ChevronDown, Settings } from 'lucide-react';

/**
 * LUX-014: Redesigned RegistrationView with luxury aesthetic
 *
 * Design principles:
 * - Light titanium background, not terminal-black
 * - Countdown as hero visual element
 * - Clean typography hierarchy (no excessive monospace)
 * - Stats as clean cards, not bordered grids
 * - Bot config hidden in settings drawer
 */

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const {
    enabled: passkeyEnabled,
    session: passkeySession,
    register: registerPasskey,
    loading: passkeyLoading,
    error: passkeyError
  } = usePasskeyAuth();

  const maxEntries = Number.isFinite(dailyLimit) ? Math.max(1, dailyLimit) : 1;
  const entriesRemaining = Math.max(0, maxEntries - tournamentsPlayedToday);
  const canEnterTournament =
    activeTournamentId !== null &&
    playerActiveTournamentId !== null &&
    playerActiveTournamentId === activeTournamentId;
  const showStatus = !!statusMessage && statusMessage !== 'PRESS / FOR COMMANDS';
  const normalizedStatus = (statusMessage ?? '').toLowerCase();
  const isErrorStatus =
    normalizedStatus.includes('offline') ||
    normalizedStatus.includes('error') ||
    normalizedStatus.includes('failed');

  // Determine button state and text
  const getButtonConfig = () => {
    if (isSubmitting) {
      return { text: 'Joining...', disabled: true, variant: 'loading' as const };
    }
    if (!isRegistered) {
      return { text: 'Register to Play', disabled: false, variant: 'primary' as const };
    }
    if (isJoinedNext) {
      return { text: 'Registered', disabled: true, variant: 'success' as const };
    }
    if (entriesRemaining <= 0) {
      return { text: 'Daily Limit Reached', disabled: true, variant: 'disabled' as const };
    }
    return { text: 'Join Next Tournament', disabled: false, variant: 'primary' as const };
  };

  const buttonConfig = getButtonConfig();

  return (
    <div className="min-h-screen w-screen bg-titanium-50 flex flex-col items-center justify-start p-4 sm:p-6 md:p-8 overflow-auto">
      {/* Mode Tabs */}
      <div className="max-w-2xl w-full mb-6 flex justify-center">
        <PlaySwapStakeTabs />
      </div>

      {/* Main Content Card */}
      <div className="max-w-2xl w-full bg-white rounded-3xl shadow-float p-6 sm:p-8 md:p-10 space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-headline font-semibold text-titanium-900 tracking-tight">
            Freeroll Tournament
          </h1>
          <p className="text-caption text-titanium-600 mt-1">
            Play free, win real rewards
          </p>
        </div>

        {/* Hero Countdown Section */}
        <div className="text-center py-6">
          {activeTimeLeft > 0 ? (
            <div className="space-y-2">
              <div className="text-caption text-titanium-500 uppercase tracking-widest">
                Tournament Ends In
              </div>
              <div className="text-hero text-mono-400 dark:text-mono-500 font-semibold tracking-tight font-display">
                {formatTime(activeTimeLeft)}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-caption text-titanium-500 uppercase tracking-widest">
                Next Tournament In
              </div>
              <div className="text-hero text-titanium-900 font-semibold tracking-tight font-display">
                {formatTime(nextStartIn)}
              </div>
              {nextTournamentId !== null && (
                <div className="text-micro text-titanium-400">
                  Tournament #{nextTournamentId}
                </div>
              )}
            </div>
          )}

          {/* Entries Badge */}
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-titanium-100 rounded-full">
            <span className="text-micro text-titanium-500 uppercase tracking-wider">
              Entries Today
            </span>
            <span className={`text-micro font-semibold ${entriesRemaining > 0 ? 'text-titanium-900' : 'text-mono-400 dark:text-mono-500'}`}>
              {tournamentsPlayedToday}/{maxEntries}
            </span>
          </div>
        </div>

        {/* Register Button */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onRegister}
            disabled={buttonConfig.disabled}
            className={`w-full max-w-xs px-8 py-4 rounded-2xl font-semibold text-body transition-all motion-interaction ${
              buttonConfig.variant === 'primary'
                ? 'bg-titanium-900 text-white hover:bg-titanium-800 active:scale-[0.98]'
                : buttonConfig.variant === 'success'
                  ? 'bg-mono-0/10 text-mono-0 dark:text-mono-1000 font-bold border border-mono-0/30'
                  : buttonConfig.variant === 'loading'
                    ? 'bg-titanium-200 text-titanium-500'
                    : 'bg-titanium-100 text-titanium-400'
            }`}
          >
            {buttonConfig.text}
            {!isRegistered && (
              <span className="ml-2 text-titanium-500 text-caption">[R]</span>
            )}
          </button>

          {canEnterTournament && (
            <button
              onClick={onEnterTournament}
              className="px-6 py-2 rounded-xl text-caption font-medium text-mono-0 dark:text-mono-1000 hover:bg-mono-0/5 transition-colors"
            >
              Enter Active Tournament →
            </button>
          )}

          {/* Status Message */}
          {showStatus && (
            <p className={`text-caption text-center ${isErrorStatus ? 'text-mono-400 dark:text-mono-500' : 'text-titanium-500'}`}>
              {statusMessage}
              {lastTxSig && (
                <span className="text-titanium-400"> · {lastTxSig.slice(0, 8)}...</span>
              )}
            </p>
          )}

          {/* Passkey Section - Simplified */}
          {passkeyEnabled && (
            <div className="text-center">
              {passkeySession ? (
                <div className="flex items-center gap-2 text-micro text-mono-0 dark:text-mono-1000 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-mono-0" />
                  Signed in securely
                </div>
              ) : (
                <button
                  onClick={registerPasskey}
                  disabled={passkeyLoading}
                  className="text-caption text-mono-0 dark:text-mono-1000 hover:underline disabled:opacity-50"
                >
                  {passkeyLoading ? 'Connecting...' : 'Sign in securely'}
                </button>
              )}
              {passkeyError && (
                <p className="text-micro text-mono-400 dark:text-mono-500 mt-1">{passkeyError}</p>
              )}
            </div>
          )}
        </div>

        {/* Stats Section - Clean Typography */}
        <div className="pt-6 border-t border-titanium-100">
          <div className="grid grid-cols-2 gap-6">
            <div className="text-center">
              <div className="text-micro text-titanium-500 uppercase tracking-wider mb-1">
                Your Balance
              </div>
              <div className="text-headline text-titanium-900 font-semibold font-display">
                ${stats.chips.toLocaleString()}
              </div>
            </div>
            <div className="text-center">
              <div className="text-micro text-titanium-500 uppercase tracking-wider mb-1">
                Current Rank
              </div>
              <div className="text-headline text-titanium-900 font-semibold font-display">
                #{stats.rank}
              </div>
            </div>
          </div>

          {/* PNL by Game - Subtle List */}
          {Object.keys(stats.pnlByGame).length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="text-micro text-titanium-500 uppercase tracking-wider">
                Performance by Game
              </div>
              <div className="space-y-1">
                {Object.entries(stats.pnlByGame).map(([game, pnl]) => {
                  const val = pnl as number;
                  return (
                    <div key={game} className="flex justify-between text-caption">
                      <span className="text-titanium-600">{game}</span>
                      <span className={val >= 0 ? 'text-mono-0 dark:text-mono-1000 font-bold' : 'text-mono-400 dark:text-mono-500'}>
                        {val >= 0 ? '+' : ''}{val}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Registered Players */}
        {leaderboard.length > 0 && (
          <div className="pt-4 border-t border-titanium-100">
            <div className="text-micro text-titanium-500 uppercase tracking-wider mb-2">
              Players ({leaderboard.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {leaderboard.slice(0, 8).map((p, i) => (
                <span
                  key={i}
                  className="px-2 py-1 bg-titanium-100 rounded-lg text-micro text-titanium-700"
                >
                  {p.name}
                </span>
              ))}
              {leaderboard.length > 8 && (
                <span className="px-2 py-1 text-micro text-titanium-400">
                  +{leaderboard.length - 8} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Advanced Settings Toggle */}
        <div className="pt-4 border-t border-titanium-100">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between py-2 text-caption text-titanium-500 hover:text-titanium-700 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span>Advanced Settings</span>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {showAdvanced && (
            <div className="mt-4 p-4 bg-titanium-50 rounded-2xl space-y-4">
              {/* Bot Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-caption text-titanium-700 font-medium">Bot Opponents</div>
                  <div className="text-micro text-titanium-500">Add AI players to the tournament</div>
                </div>
                <button
                  onClick={() => onBotConfigChange({ ...botConfig, enabled: !botConfig.enabled })}
                  className={`w-12 h-7 rounded-full transition-colors relative ${
                    botConfig.enabled ? 'bg-mono-0' : 'bg-titanium-200'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      botConfig.enabled ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {botConfig.enabled && (
                <div className="space-y-3 pt-3 border-t border-titanium-200">
                  {/* Number of Bots */}
                  <div>
                    <div className="flex justify-between text-micro text-titanium-600 mb-1">
                      <span>Number of Bots</span>
                      <span className="font-medium">{botConfig.numBots}</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="300"
                      step="10"
                      value={botConfig.numBots}
                      onChange={(e) => onBotConfigChange({ ...botConfig, numBots: parseInt(e.target.value) })}
                      className="w-full accent-mono-0"
                    />
                  </div>

                  {/* Bet Interval */}
                  <div>
                    <div className="flex justify-between text-micro text-titanium-600 mb-1">
                      <span>Bet Interval</span>
                      <span className="font-medium">{botConfig.betIntervalMs / 1000}s</span>
                    </div>
                    <input
                      type="range"
                      min="1000"
                      max="10000"
                      step="1000"
                      value={botConfig.betIntervalMs}
                      onChange={(e) => onBotConfigChange({ ...botConfig, betIntervalMs: parseInt(e.target.value) })}
                      className="w-full accent-mono-0"
                    />
                  </div>

                  {/* Randomize Toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-micro text-titanium-600">Randomize Timing</span>
                    <button
                      onClick={() => onBotConfigChange({ ...botConfig, randomizeInterval: !botConfig.randomizeInterval })}
                      className={`px-3 py-1 rounded-lg text-micro font-medium transition-colors ${
                        botConfig.randomizeInterval
                          ? 'bg-mono-0/10 text-mono-0 dark:text-mono-1000'
                          : 'bg-titanium-200 text-titanium-500'
                      }`}
                    >
                      {botConfig.randomizeInterval ? 'Random' : 'Fixed'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
