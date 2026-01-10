import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GameType, RouletteBet, SicBoBet, CrapsBet } from './types';
import { useTerminalGame } from './hooks/useTerminalGame';
import { useSharedCasinoConnection } from './chain/CasinoConnectionContext';
import { getVaultStatusSync, unlockPasskeyVault, unlockPasswordVault } from './security/keyVault';
import { subscribeVault } from './security/vaultRuntime';

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
  ['/unlock [password]', 'Unlock vault (passkey prompt or password)'],
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

  const accent = '#7cf0c5';
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [vaultStatus, setVaultStatus] = useState(() => getVaultStatusSync());
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultPassword, setVaultPassword] = useState('');
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

  useEffect(() => {
    // Keep vault state in sync with unlock events + occasional refresh for metadata changes.
    const unsubscribe = subscribeVault(() => setVaultStatus(getVaultStatusSync()));
    const interval = window.setInterval(() => setVaultStatus(getVaultStatusSync()), 15000);
    return () => {
      unsubscribe?.();
      window.clearInterval(interval);
    };
  }, []);

  // Surface latest game message into the terminal log so classic UI users see errors (e.g., insufficient funds)
  useEffect(() => {
    const msg = gameState.message;
    if (!msg || msg === lastMessageRef.current) return;
    lastMessageRef.current = msg;
    append(msg);
  }, [gameState.message]);

  const formatVaultError = (e: any): string => {
    const msg = e?.message ?? String(e);
    if (msg === 'passkey-prf-unsupported') {
      return 'Passkey lacks required extensions. Try a platform passkey or different authenticator.';
    }
    if (msg === 'password-too-short') return 'Password too short (min 8 chars).';
    if (msg === 'password-required') return 'Enter your vault password.';
    if (msg === 'password-invalid') return 'Incorrect password or corrupted vault.';
    if (msg === 'vault-kind-mismatch') return 'Vault type mismatch — recreate or switch in Security.';
    if (msg === 'vault-not-found') return 'No vault found. Create one in Security.';
    return msg;
  };

  const unlockWithPasskey = async () => {
    setVaultError(null);
    setVaultBusy(true);
    append('Unlocking vault with passkey…');
    try {
      await unlockPasskeyVault();
      setVaultStatus(getVaultStatusSync());
      append('Vault unlocked.');
    } catch (e: any) {
      const msg = formatVaultError(e);
      setVaultError(msg);
      append(`Vault unlock failed: ${msg}`);
    } finally {
      setVaultBusy(false);
    }
  };

  const unlockWithPassword = async (password: string) => {
    setVaultError(null);
    setVaultBusy(true);
    append('Unlocking vault with password…');
    try {
      await unlockPasswordVault(password);
      setVaultStatus(getVaultStatusSync());
      setVaultPassword('');
      append('Vault unlocked.');
    } catch (e: any) {
      const msg = formatVaultError(e);
      setVaultError(msg);
      append(`Vault unlock failed: ${msg}`);
    } finally {
      setVaultBusy(false);
    }
  };

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
        case 'unlock': {
          const snapshot = getVaultStatusSync();
          if (!snapshot.supported) {
            append('Vaults not supported in this browser.');
            break;
          }
          if (!snapshot.enabled) {
            append('No vault found. Open Security to create one.');
            break;
          }
          if (snapshot.unlocked) {
            append('Vault already unlocked.');
            break;
          }
          if (vaultBusy) {
            append('Vault unlock already in progress…');
            break;
          }
          if (snapshot.kind === 'password') {
            const supplied = args.join(' ');
            const pwd = supplied || window.prompt('Enter vault password') || '';
            if (!pwd) {
              append('Password required to unlock vault.');
              break;
            }
            await unlockWithPassword(pwd);
          } else {
            await unlockWithPasskey();
          }
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

  const vaultBadge = useMemo(() => {
    if (!vaultStatus.supported) return 'unsupported';
    if (!vaultStatus.enabled) return 'missing';
    return vaultStatus.unlocked ? 'unlocked' : 'locked';
  }, [vaultStatus.enabled, vaultStatus.supported, vaultStatus.unlocked]);

  const vaultHint = useMemo(() => {
    if (!vaultStatus.supported) return 'Vaults require WebCrypto + IndexedDB (use a modern browser).';
    if (!vaultStatus.enabled) return 'No vault found. Open Security to create one.';
    if (vaultStatus.unlocked) return `Vault ready (${vaultStatus.kind ?? 'unknown'}).`;
    if (vaultStatus.kind === 'password') return 'Enter password to unlock.';
    if (vaultStatus.kind === 'passkey') return 'Use your passkey to unlock.';
    return 'Unlock required to play.';
  }, [vaultStatus]);

  const Pill = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="uppercase tracking-[0.08em] text-[#9ca3af]">{label}</span>
      <span className="px-2 py-1 rounded bg-[#0b0f1a] border border-[#1f2937] text-[#e5e7eb]">{value}</span>
    </div>
  );

  const Key = ({ k }: { k: string }) => (
    <span className="px-2 py-1 rounded border border-[#1f2937] bg-[#0b0f1a] text-xs text-[#e5e7eb]">{k}</span>
  );

  return (
    <div className="min-h-screen bg-[#05070f] text-[#e5e7eb] font-mono flex flex-col">
      <div className="bg-gradient-to-r from-[#0b1325] via-[#0c152c] to-[#0b1325] border-b border-[#111827] px-4 py-4">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="text-[10px] tracking-[0.2em] uppercase text-[#8b95a5]">Nullspace · Terminal</div>
            <div className="inline-flex items-center gap-2 text-lg font-semibold">
              <span className="text-[#e5e7eb]">Codex‑style TUI</span>
              <span className="h-1 w-6 rounded-full" style={{ background: accent }} />
            </div>
            <div className="flex flex-wrap gap-4">
              <Pill label="Conn" value={statusDetail ? `${status} / ${statusDetail}` : status} />
              <Pill label="Vault" value={vaultBadge.toUpperCase()} />
              <Pill label="Game" value={`${gameState.type} @ ${gameState.stage}`} />
              <Pill label="Bet" value={String(gameState.bet)} />
              <Pill label="Chips" value={String(stats.chips ?? 0)} />
              <Pill label="On-chain" value={String(isOnChain)} />
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs text-[#9ca3af]">
            <Key k="↑↓" />
            <span>scroll</span>
            <Key k="/status" />
            <span>session info</span>
            <Key k="/unlock" />
            <span>unlock vault</span>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="border border-[#1f2937] rounded bg-[#0a0f1a] p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
          <div className="space-y-1">
            <div className="text-[11px] tracking-[0.15em] text-[#9ca3af] uppercase">Vault state</div>
            <div className="text-sm flex items-center gap-2">
              <span className="text-[#e5e7eb] font-semibold">{vaultBadge.toUpperCase()}</span>
              <span className="text-[#6b7280]">{vaultHint}</span>
            </div>
            {vaultError && <div className="text-xs text-red-400">{vaultError}</div>}
          </div>
          <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-end w-full md:w-auto">
            {!vaultStatus.enabled && (
              <a
                className="px-3 py-2 text-xs border border-[#1f2937] rounded bg-[#0e1625] hover:bg-[#111c2e] transition"
                href="/security"
              >
                Open Security
              </a>
            )}
            {vaultStatus.enabled && vaultStatus.kind === 'passkey' && (
              <button
                type="button"
                disabled={vaultBusy}
                onClick={unlockWithPasskey}
                className="px-3 py-2 text-xs border border-[#1f2937] rounded bg-[#0e1625] hover:bg-[#111c2e] disabled:opacity-50 transition"
              >
                {vaultBusy ? 'Unlocking…' : 'Unlock with passkey'}
              </button>
            )}
            {vaultStatus.enabled && vaultStatus.kind === 'password' && (
              <div className="flex gap-2 items-center w-full md:w-auto">
                <input
                  type="password"
                  className="bg-[#0b0f1a] border border-[#1f2937] rounded px-2 py-1 text-sm w-full md:w-44"
                  placeholder="Vault password"
                  value={vaultPassword}
                  onChange={(e) => setVaultPassword(e.target.value)}
                  disabled={vaultBusy}
                />
                <button
                  type="button"
                  disabled={vaultBusy || !vaultPassword}
                  onClick={() => unlockWithPassword(vaultPassword)}
                  className="px-3 py-2 text-xs border border-[#1f2937] rounded bg-[#0e1625] hover:bg-[#111c2e] disabled:opacity-50 transition"
                >
                  {vaultBusy ? 'Unlocking…' : 'Unlock vault'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 grid md:grid-cols-[320px_1fr] gap-3 px-4 pb-3">
        <div className="border border-[#1f2937] rounded bg-[#0b0f1a] shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
          <div className="px-3 py-2 text-xs text-[#9ca3af] flex justify-between items-center border-b border-[#1f2937]">
            <span>Commands</span>
            <span className="text-[#6b7280]">⌘</span>
          </div>
          <div className="divide-y divide-[#1f2937] text-sm">
            {commandTable.map(([cmd, desc]) => (
              <div key={cmd} className="px-3 py-1.5 flex justify-between">
                <span className="text-[#e5e7eb]">{cmd}</span>
                <span className="text-[#6b7280] text-xs">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-[#1f2937] rounded bg-[#0b0f1a] flex flex-col shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
          <div className="px-3 py-2 text-xs text-[#9ca3af] flex justify-between border-b border-[#1f2937]">
            <span>Session Log</span>
            <span>
              {status}{statusDetail ? ` / ${statusDetail}` : ''} · Vault {vaultMode}
            </span>
          </div>
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto px-3 py-3 space-y-2 text-sm leading-5 bg-gradient-to-b from-[#0b0f1a] via-[#0b0f1a] to-[#0c1524]"
            style={{ minHeight: '360px' }}
          >
            {logs.map((l, idx) => (
              <div key={`${idx}-${l.ts}`} className="whitespace-pre-wrap flex gap-2">
                <span className="text-[#6b7280] min-w-[64px]">{l.ts}</span>
                <span className="text-[#e5e7eb]">{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <form
        className="border-t border-[#111827] bg-[#0a0f1a] px-4 py-3 flex items-center gap-3 shadow-[0_-6px_30px_rgba(0,0,0,0.35)]"
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
        <div className="hidden md:flex items-center gap-2 text-xs text-[#6b7280]">
          <Key k="Enter" />
          <span>send</span>
        </div>
      </form>
    </div>
  );
}
