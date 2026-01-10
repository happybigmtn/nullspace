import React, { useEffect, useMemo, useState } from 'react';
import { GameType } from './types';
import { useTerminalGame } from './hooks/useTerminalGame';
import { useSharedCasinoConnection } from './chain/CasinoConnectionContext';

type LogEntry = { ts: string; text: string };

const gameAliases: Record<string, GameType> = {
  blackjack: GameType.BLACKJACK,
  bj: GameType.BLACKJACK,
  craps: GameType.CRAPS,
  roulette: GameType.ROULETTE,
  sicbo: GameType.SIC_BO,
  sic_bo: GameType.SIC_BO,
  baccarat: GameType.BACCARAT,
  hilo: GameType.HILO,
  hilo_: GameType.HILO,
  video_poker: GameType.VIDEO_POKER,
  vp: GameType.VIDEO_POKER,
  threecard: GameType.THREE_CARD,
  three_card: GameType.THREE_CARD,
  holdem: GameType.ULTIMATE_HOLDEM,
  war: GameType.CASINO_WAR,
};

const helpText = `
/help                  Show commands
/status                Show connection + balance
/games                 List games
/game <name>           Set game (blackjack, craps, roulette, sicbo, baccarat, hilo, video_poker, threecard, holdem, war)
/bet <amount>          Set bet amount
/deal                  Deal / submit bet (uses current game & bet)
Blackjack shortcuts: /hit /stand /double /split /insure
Roulette: /spin        (uses current bets from UI state)
Craps: /roll           (uses current bets from UI state)
Reset: /rebet          Re-use last bet (where supported)
`;

export default function TerminalPage() {
  const { status, statusDetail, vaultMode } = useSharedCasinoConnection();
  const { stats, gameState, actions } = useTerminalGame('CASH');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');

  const append = (text: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((l) => [...l.slice(-199), { ts, text }]);
  };

  useEffect(() => {
    append('Text casino ready. Type /help');
    actions.startGame(GameType.BLACKJACK);
  }, []);

  useEffect(() => {
    append(`Connection: ${status}${statusDetail ? ` — ${statusDetail}` : ''} (vault: ${vaultMode})`);
  }, [status, statusDetail, vaultMode]);

  const handleCommand = async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    if (!line.startsWith('/')) {
      append(`Echo: ${line}`);
      return;
    }

    const [cmd, ...args] = line.slice(1).split(/\s+/);
    const lower = cmd.toLowerCase();

    try {
      switch (lower) {
        case 'help':
          append(helpText.trim());
          break;
        case 'status':
          append(`Conn=${status}${statusDetail ? ` (${statusDetail})` : ''} | Vault=${vaultMode}`);
          append(`Game=${gameState.type} | Bet=${gameState.bet} | Chips=${stats.chips ?? 0}`);
          break;
        case 'games':
          append(`Games: ${Object.keys(gameAliases).join(', ')}`);
          break;
        case 'game': {
          const name = args[0]?.toLowerCase();
          const gt = name ? gameAliases[name] : undefined;
          if (!gt) {
            append('Unknown game. Try /games');
            break;
          }
          actions.startGame(gt);
          append(`Game set to ${gt}`);
          break;
        }
        case 'bet': {
          const amt = Number(args[0]);
          if (!Number.isFinite(amt) || amt <= 0) {
            append('Usage: /bet <amount>');
            break;
          }
          actions.setBetAmount(amt);
          append(`Bet set to ${amt}`);
          break;
        }
        case 'deal':
          await actions.deal();
          append('Dealt');
          break;
        case 'hit':
          actions.bjHit?.();
          append('Hit');
          break;
        case 'stand':
          actions.bjStand?.();
          append('Stand');
          break;
        case 'double':
          actions.bjDouble?.();
          append('Double');
          break;
        case 'split':
          actions.bjSplit?.();
          append('Split');
          break;
        case 'insure':
          actions.bjInsurance?.();
          append('Insurance toggled');
          break;
        case 'spin':
          await actions.spinRoulette?.();
          append('Spin');
          break;
        case 'roll':
          await actions.rollCraps?.();
          append('Roll');
          break;
        case 'rebet':
          actions.setToLastBet?.();
          append('Rebet');
          break;
        default:
          append(`Unknown command: /${cmd}`);
      }
    } catch (e: any) {
      append(`Error: ${e?.message ?? String(e)}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e7eb] font-mono flex flex-col">
      <div className="p-3 border-b border-[#1f2937] text-xs flex justify-between">
        <span>Text Casino (beta)</span>
        <span>Conn: {status}{statusDetail ? ` / ${statusDetail}` : ''}</span>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-1">
        {logs.map((l, idx) => (
          <div key={`${idx}-${l.ts}`} className="whitespace-pre-wrap text-sm">
            <span className="text-[#6b7280] mr-2">{l.ts}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
      <form
        className="border-t border-[#1f2937] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input;
          setInput('');
          void handleCommand(text);
        }}
      >
        <input
          className="w-full bg-[#0f172a] border border-[#1f2937] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]"
          autoFocus
          spellCheck="false"
          placeholder="/help"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </form>
    </div>
  );
}
