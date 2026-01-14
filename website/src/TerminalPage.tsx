import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GameType, RouletteBet, SicBoBet, CrapsBet } from './types';
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
  video_poker: GameType.VIDEO_POKER,
  vp: GameType.VIDEO_POKER,
  threecard: GameType.THREE_CARD,
  three_card: GameType.THREE_CARD,
  holdem: GameType.ULTIMATE_HOLDEM,
  war: GameType.CASINO_WAR,
};

const rouletteAlias = (raw?: string): RouletteBet['type'] | null => {
  if (!raw) return null;
  const t = raw.toUpperCase();
  const map: Record<string, RouletteBet['type']> = {
    STRAIGHT: 'STRAIGHT',
    NUMBER: 'STRAIGHT',
    ZERO: 'ZERO',
    RED: 'RED',
    BLACK: 'BLACK',
    ODD: 'ODD',
    EVEN: 'EVEN',
    LOW: 'LOW',
    HIGH: 'HIGH',
    DOZEN1: 'DOZEN_1',
    DOZEN2: 'DOZEN_2',
    DOZEN3: 'DOZEN_3',
    COL1: 'COL_1',
    COL2: 'COL_2',
    COL3: 'COL_3',
    SPLIT: 'SPLIT_H',
    SPLITV: 'SPLIT_V',
    STREET: 'STREET',
    CORNER: 'CORNER',
    SIX: 'SIX_LINE',
    SIXLINE: 'SIX_LINE',
  };
  return map[t] ?? null;
};

const sicboAlias = (raw?: string): SicBoBet['type'] | null => {
  if (!raw) return null;
  const t = raw.toUpperCase();
  const map: Record<string, SicBoBet['type']> = {
    BIG: 'BIG',
    SMALL: 'SMALL',
    ODD: 'ODD',
    EVEN: 'EVEN',
    ANYTRIPLE: 'TRIPLE_ANY',
    TRIPLE: 'TRIPLE_ANY',
    TRIPLE_SPECIFIC: 'TRIPLE_SPECIFIC',
    DOUBLE: 'DOUBLE_SPECIFIC',
    SUM: 'SUM',
    SINGLE: 'SINGLE_DIE',
    DOMINO: 'DOMINO',
    HOP3E: 'HOP3_EASY',
    HOP3H: 'HOP3_HARD',
    HOP4E: 'HOP4_EASY',
  };
  return map[t] ?? null;
};

const crapsAlias = (raw?: string): CrapsBet['type'] | null => {
  if (!raw) return null;
  const t = raw.toUpperCase();
  const map: Record<string, CrapsBet['type']> = {
    PASS: 'PASS',
    DP: 'DONT_PASS',
    DONT_PASS: 'DONT_PASS',
    COME: 'COME',
    DC: 'DONT_COME',
    DONT_COME: 'DONT_COME',
    FIELD: 'FIELD',
    YES: 'YES',
    NO: 'NO',
    NEXT: 'NEXT',
    HARDWAY: 'HARDWAY',
    FIRE: 'FIRE',
    ATS_SMALL: 'ATS_SMALL',
    ATS_TALL: 'ATS_TALL',
    ATS_ALL: 'ATS_ALL',
    MUGGSY: 'MUGGSY',
    DIFF_DOUBLES: 'DIFF_DOUBLES',
    RIDE_LINE: 'RIDE_LINE',
    REPLAY: 'REPLAY',
    HOT_ROLLER: 'HOT_ROLLER',
  };
  return map[t] ?? null;
};

const commandTable = [
  ['/help', 'Show commands'],
  ['/status', 'Connection, vault, balance'],
  ['/games', 'List games'],
  ['/game <name>', 'Switch game'],
  ['/bet <amt>', 'Set base bet'],
  ['/deal', 'Submit / spin / roll'],
  ['/rebet', 'Reuse last bet'],
  ['/undo', 'Undo last table bet (roulette/sicbo/craps)'],
  ['/roulette <type> [n]', 'Bet roulette (type, optional target)'],
  ['/craps <type> [n]', 'Bet craps (type, optional point/yes/no num)'],
  ['/sicbo <type> [n]', 'Bet Sic Bo (type, optional target)'],
  ['/odds [idx]', 'Add odds to pass/come (craps)'],
  ['/hit|/stand|/double|/split', 'Blackjack moves'],
  ['/side <21p3|ll|pp|bi|rm>', 'Toggle BJ side bet'],
  ['/spin', 'Spin roulette wheel'],
  ['/roll', 'Roll craps dice'],
  ['/zero', 'Cycle roulette zero rule'],
];

const headerLine = (pieces: string[]) => {
  const body = pieces.join(' ─ ');
  return `┌ ${body} ─${'─'.repeat(Math.max(0, 78 - body.length))}`;
};

export default function TerminalPage() {
  const { status, statusDetail, vaultMode } = useSharedCasinoConnection();
  const { stats, gameState, isOnChain, actions } = useTerminalGame('CASH');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<string | null>(null);

  const append = (text: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((l) => [...l.slice(-199), { ts, text }]);
  };

  useEffect(() => {
    append('Nullspace text terminal ready. Type /help');
    actions.startGame(GameType.BLACKJACK);
  }, []);

  useEffect(() => {
    append(`Conn ${status}${statusDetail ? ` — ${statusDetail}` : ''} | Vault ${vaultMode}`);
  }, [status, statusDetail, vaultMode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [logs]);

  // Surface latest game message into the terminal log so classic UI users see errors (e.g., insufficient funds)
  useEffect(() => {
    const msg = gameState.message;
    if (!msg || msg === lastMessageRef.current) return;
    lastMessageRef.current = msg;
    append(msg);
  }, [gameState.message]);

  const setBet = (amt: number) => {
    actions.setBetAmount(amt);
    append(`BET ${amt}`);
  };

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
        case 'help': {
          commandTable.forEach(([c, d]) => append(`${c.padEnd(18)} ${d}`));
          break;
        }
        case 'status': {
          append(`Conn=${status}${statusDetail ? ` (${statusDetail})` : ''} | Vault=${vaultMode} | OnChain=${String(isOnChain)}`);
          append(
            `Game=${gameState.type} Stage=${gameState.stage} Bet=${gameState.bet} Chips=${stats.chips ?? 0} Session=${gameState.sessionWager ?? 0}`,
          );
          break;
        }
        case 'games': {
          append(`Games: ${Object.keys(gameAliases).join(', ')}`);
          break;
        }
        case 'game': {
          const name = args[0]?.toLowerCase();
          const gt = name ? gameAliases[name] : undefined;
          if (!gt) {
            append('Unknown game. Try /games');
            break;
          }
          await actions.startGame(gt);
          append(`Game set to ${gt}`);
          break;
        }
        case 'bet': {
          const amt = Number(args[0]);
          if (!Number.isFinite(amt) || amt <= 0) {
            append('Usage: /bet <amount>');
            break;
          }
          setBet(amt);
          break;
        }
        case 'deal':
          await actions.deal();
          append('DEAL');
          break;
        case 'hit':
          actions.bjHit?.();
          append('HIT');
          break;
        case 'stand':
          actions.bjStand?.();
          append('STAND');
          break;
        case 'double':
          actions.bjDouble?.();
          append('DOUBLE');
          break;
        case 'split':
          actions.bjSplit?.();
          append('SPLIT');
          break;
        case 'insure':
          actions.bjInsurance?.();
          append('INSURANCE');
          break;
        case 'side': {
          const k = args[0]?.toLowerCase();
          const map: Record<string, (() => void) | undefined> = {
            '21p3': actions.bjToggle21Plus3,
            ll: actions.bjToggleLuckyLadies,
            pp: actions.bjTogglePerfectPairs,
            bi: actions.bjToggleBustIt,
            rm: actions.bjToggleRoyalMatch,
          };
          const fn = k ? map[k] : undefined;
          if (!fn) {
            append('Usage: /side <21p3|ll|pp|bi|rm>');
            break;
          }
          fn();
          append(`SIDE ${k} toggled`);
          break;
        }
        case 'spin':
          await actions.spinRoulette?.();
          append('SPIN');
          break;
        case 'zero':
          actions.cycleRouletteZeroRule?.();
          append('ZERO RULE CYCLED');
          break;
        case 'roll':
          await actions.rollCraps?.();
          append('ROLL');
          break;
        case 'odds': {
          const idx = args[0] ? Number(args[0]) - 1 : undefined;
          actions.addCrapsOdds?.(Number.isFinite(idx ?? 0) ? idx : undefined);
          append('ODDS');
          break;
        }
        case 'roulette': {
          const type = rouletteAlias(args[0]);
          const target = args[1] !== undefined ? Number(args[1]) : undefined;
          if (!type) {
            append('Usage: /roulette <type> [target]');
            break;
          }
          const ok = actions.placeRouletteBet?.(type, target);
          append(ok === false ? 'INSUFFICIENT FUNDS' : `ROULETTE ${type}${target !== undefined ? ` ${target}` : ''}`);
          break;
        }
        case 'craps': {
          const type = crapsAlias(args[0]);
          const target = args[1] !== undefined ? Number(args[1]) : undefined;
          if (!type) {
            append('Usage: /craps <type> [target]');
            break;
          }
          actions.placeCrapsBet?.(type, target);
          append(`CRAPS ${type}${target !== undefined ? ` ${target}` : ''}`);
          break;
        }
        case 'sicbo': {
          const type = sicboAlias(args[0]);
          const target = args[1] !== undefined ? Number(args[1]) : undefined;
          if (!type) {
            append('Usage: /sicbo <type> [target]');
            break;
          }
          const ok = actions.placeSicBoBet?.(type, target);
          append(ok === false ? 'INSUFFICIENT FUNDS' : `SICBO ${type}${target !== undefined ? ` ${target}` : ''}`);
          break;
        }
        case 'undo': {
          if (gameState.type === GameType.ROULETTE) actions.undoRouletteBet?.();
          else if (gameState.type === GameType.SIC_BO) actions.undoSicBoBet?.();
          else if (gameState.type === GameType.CRAPS) actions.undoCrapsBet?.();
          append('UNDO');
          break;
        }
        case 'rebet':
          if (gameState.type === GameType.ROULETTE) actions.rebetRoulette?.();
          else if (gameState.type === GameType.SIC_BO) actions.rebetSicBo?.();
          else if (gameState.type === GameType.CRAPS) actions.rebetCraps?.();
          else actions.setToLastBet?.();
          append('REBET');
          break;
        default:
          append(`Unknown command: /${cmd}`);
      }
    } catch (e: any) {
      append(`Error: ${e?.message ?? String(e)}`);
    }
  };

  const header = useMemo(
    () =>
      headerLine([
        'Nullspace Terminal',
        'testnet.regenesis.dev',
        `Vault ${vaultMode}`,
        `Conn ${status}`,
      ]),
    [status, vaultMode],
  );

  const statusLine = useMemo(
    () =>
      `│ Game ${gameState.type} | Stage ${gameState.stage} | Bet ${gameState.bet} | Chips ${stats.chips ?? 0} | Session ${gameState.sessionWager ?? 0}`.padEnd(90, ' ') + '│',
    [gameState.type, gameState.stage, gameState.bet, gameState.sessionWager, stats.chips],
  );

  return (
    <div className="min-h-screen bg-[#050505] text-[#e5e7eb] font-mono flex flex-col">
      <div className="px-3 pt-3 text-xs text-[#9ca3af] whitespace-pre">
        {header}
        {'\n'}
        {statusLine}
      </div>

      <div className="mt-2 grid md:grid-cols-[320px_1fr] gap-2 px-3 pb-2">
        <div className="border border-[#1f2937] rounded-sm bg-[#0b0b0f]">
          <div className="px-3 py-2 text-xs text-[#9ca3af] flex justify-between">
            <span>Commands</span>
            <span>?</span>
          </div>
          <div className="border-t border-[#1f2937] divide-y divide-[#1f2937] text-sm">
            {commandTable.map(([cmd, desc]) => (
              <div key={cmd} className="px-3 py-1 flex justify-between">
                <span className="text-[#e5e7eb]">{cmd}</span>
                <span className="text-[#6b7280] text-xs">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-[#1f2937] rounded-sm bg-[#0b0b0f] flex flex-col">
          <div className="px-3 py-2 text-xs text-[#9ca3af] flex justify-between">
            <span>Log</span>
            <span>
              {status}{statusDetail ? ` / ${statusDetail}` : ''} · Vault {vaultMode}
            </span>
          </div>
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto px-3 py-2 space-y-1 text-sm leading-5"
            style={{ minHeight: '320px' }}
          >
            {logs.map((l, idx) => (
              <div key={`${idx}-${l.ts}`} className="whitespace-pre-wrap">
                <span className="text-[#6b7280] mr-2">{l.ts}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <form
        className="border-t border-[#1f2937] bg-[#0b0b0f] px-3 py-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input;
          setInput('');
          void handleCommand(text);
        }}
      >
        <span className="text-[#6b7280] text-sm">casino $</span>
        <input
          className="flex-1 bg-transparent border-none outline-none text-sm text-[#e5e7eb] placeholder-[#4b5563]"
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
