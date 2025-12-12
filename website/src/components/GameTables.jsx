import React from 'react';

const GameTables = ({ data }) => {
  if (!data.length) return null;
  const last = data[data.length - 1];
  const liveGameStats = (last.game_stats || []).slice().sort((a, b) => b.bet_volume - a.bet_volume);
  const liveTopPlayers = (last.top_players || []).slice().sort((a, b) => b.game_pnl - a.game_pnl);
  const freerollGameStats = (last.freeroll_game_stats || []).slice().sort((a, b) => b.bet_volume - a.bet_volume);
  const freerollTopPlayers = (last.freeroll_top_players || []).slice().sort((a, b) => b.game_pnl - a.game_pnl);

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl">
          <h3 className="text-xl font-bold text-gray-100 mb-3 font-mono">Live RNG Play (Cash) – House Edge</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-200">
              <thead className="text-left text-gray-400">
                <tr>
                  <th className="py-2 pr-4">Game</th>
                  <th className="py-2 pr-4">Bet Volume (vUSD)</th>
                  <th className="py-2 pr-4">House Edge (vUSD)</th>
                  <th className="py-2 pr-4">Net Payout</th>
                </tr>
              </thead>
              <tbody>
                {liveGameStats.map((g) => (
                  <tr key={`live-${g.game_type}`} className="border-t border-gray-800">
                    <td className="py-2 pr-4 font-mono">{g.game_type}</td>
                    <td className="py-2 pr-4">{g.bet_volume.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-emerald-400">{g.house_edge.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-indigo-200">{g.net_payout.toLocaleString()}</td>
                  </tr>
                ))}
                {!liveGameStats.length && (
                  <tr><td colSpan={4} className="py-2 text-center text-gray-500">No cash game data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl">
          <h3 className="text-xl font-bold text-gray-100 mb-3 font-mono">Top Players (Cash PnL)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-200">
              <thead className="text-left text-gray-400">
                <tr>
                  <th className="py-2 pr-4">Player</th>
                  <th className="py-2 pr-4">Game PnL</th>
                  <th className="py-2 pr-4">Bet Volume</th>
                  <th className="py-2 pr-4">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {liveTopPlayers.map((p) => (
                  <tr key={`live-player-${p.player}`} className="border-t border-gray-800">
                    <td className="py-2 pr-4 font-mono truncate max-w-xs">{p.player}</td>
                    <td className="py-2 pr-4 text-emerald-400">{p.game_pnl.toLocaleString()}</td>
                    <td className="py-2 pr-4">{p.bet_volume.toLocaleString()}</td>
                    <td className="py-2 pr-4">{p.sessions}</td>
                  </tr>
                ))}
                {!liveTopPlayers.length && (
                  <tr><td colSpan={4} className="py-2 text-center text-gray-500">No player data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl">
          <h3 className="text-xl font-bold text-gray-100 mb-3 font-mono">Freeroll / Tournament Play</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-200">
              <thead className="text-left text-gray-400">
                <tr>
                  <th className="py-2 pr-4">Game</th>
                  <th className="py-2 pr-4">Bet Volume (vUSD)</th>
                  <th className="py-2 pr-4">Net Payout</th>
                </tr>
              </thead>
              <tbody>
                {freerollGameStats.map((g) => (
                  <tr key={`freeroll-${g.game_type}`} className="border-t border-gray-800">
                    <td className="py-2 pr-4 font-mono">{g.game_type}</td>
                    <td className="py-2 pr-4">{g.bet_volume.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-indigo-200">{g.net_payout.toLocaleString()}</td>
                  </tr>
                ))}
                {!freerollGameStats.length && (
                  <tr><td colSpan={3} className="py-2 text-center text-gray-500">No freeroll data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 shadow-xl">
          <h3 className="text-xl font-bold text-gray-100 mb-3 font-mono">Top Players (Freeroll)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-200">
              <thead className="text-left text-gray-400">
                <tr>
                  <th className="py-2 pr-4">Player</th>
                  <th className="py-2 pr-4">Game PnL</th>
                  <th className="py-2 pr-4">Bet Volume</th>
                  <th className="py-2 pr-4">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {freerollTopPlayers.map((p) => (
                  <tr key={`freeroll-player-${p.player}`} className="border-t border-gray-800">
                    <td className="py-2 pr-4 font-mono truncate max-w-xs">{p.player}</td>
                    <td className="py-2 pr-4 text-emerald-400">{p.game_pnl.toLocaleString()}</td>
                    <td className="py-2 pr-4">{p.bet_volume.toLocaleString()}</td>
                    <td className="py-2 pr-4">{p.sessions}</td>
                  </tr>
                ))}
                {!freerollTopPlayers.length && (
                  <tr><td colSpan={4} className="py-2 text-center text-gray-500">No player data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameTables;
