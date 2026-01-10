import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthStatusPill } from './components/AuthStatusPill';
import { ConnectionStatus } from './components/ConnectionStatus';
import { PageHeader } from './components/PageHeader';
import { PlaySwapStakeTabs } from './components/PlaySwapStakeTabs';
import { WalletPill } from './components/WalletPill';
import { useSharedCasinoConnection } from './chain/CasinoConnectionContext';
import { useActivityFeed } from './hooks/useActivityFeed';
import { parseAmount } from './utils/amounts.js';
import { logActivity, trackTxConfirmed, trackTxFailed, trackTxSubmitted } from './services/txTracker';
import { pushToast } from './services/toasts';
import { connectEvmWallet, hasEvmProvider } from './services/evmWallet';

const APPROVE_SELECTOR = '0x095ea7b3';
const DEPOSIT_SELECTOR = '0xc9630cb0';
const RNG_DECIMALS = 18n;
const U64_MAX = 18_446_744_073_709_551_615n;

const EVM_CHAIN_ID = Number(import.meta.env.VITE_EVM_CHAIN_ID ?? 0);
const EVM_LOCKBOX_ADDRESS = String(import.meta.env.VITE_EVM_LOCKBOX_ADDRESS ?? '').trim();
const EVM_RNG_ADDRESS = String(import.meta.env.VITE_EVM_RNG_ADDRESS ?? '').trim();

const normalizeHex = (value: string) => value.trim().toLowerCase().replace(/^0x/, '');
const isHexString = (value: string) => /^[0-9a-f]+$/.test(value);
const isEvmAddress = (value: string) => {
  const clean = normalizeHex(value);
  return clean.length === 40 && isHexString(clean);
};
const EVM_LOCKBOX_HEX = normalizeHex(EVM_LOCKBOX_ADDRESS);

const hexToBytes = (value: string): Uint8Array | null => {
  const clean = normalizeHex(value);
  if (!clean || clean.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
};

const pad32 = (hex: string) => hex.padStart(64, '0');

const formatInteger = (value: number | bigint | string | null | undefined) => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '-';
    return Math.floor(value).toLocaleString();
  }
  const raw = typeof value === 'bigint' ? value.toString() : value.trim();
  if (!raw) return '-';
  if (/^\d+$/.test(raw)) return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return raw;
};

const shortHex = (hex: string, start = 10, end = 6) => {
  const clean = hex.trim();
  if (clean.length <= start + end + 1) return clean;
  return `${clean.slice(0, start)}...${clean.slice(-end)}`;
};

type WithdrawalStatus = 'pending' | 'finalized';
type WithdrawalItem = {
  id: number;
  amount: bigint;
  destination: string;
  requestedTs: number;
  availableTs: number;
  status: WithdrawalStatus;
  source?: string;
};

export default function BridgeApp() {
  const connection = useSharedCasinoConnection();
  const activity = useActivityFeed('bridge', 12);

  const [player, setPlayer] = useState<any | null>(null);
  const [policy, setPolicy] = useState<any | null>(null);
  const [bridge, setBridge] = useState<any | null>(null);
  const [pendingWithdrawals, setPendingWithdrawals] = useState<WithdrawalItem[]>([]);

  const [withdrawAmount, setWithdrawAmount] = useState('0');
  const [withdrawDestination, setWithdrawDestination] = useState('');

  const [depositAmount, setDepositAmount] = useState('0');
  const [depositDestination, setDepositDestination] = useState('');
  const [evmInfo, setEvmInfo] = useState<{ address: string; chainId: number } | null>(null);
  const [evmBusy, setEvmBusy] = useState(false);
  const [evmError, setEvmError] = useState<string | null>(null);

  const pushActivity = (message: string, level: 'info' | 'success' | 'error' = 'info') => {
    logActivity('bridge', message, level);
  };

  useEffect(() => {
    if (connection.status === 'connected') {
      pushActivity('Connected');
    } else if (connection.status === 'offline') {
      pushActivity('Offline - check your connection', 'error');
    } else if (connection.status === 'vault_locked') {
      pushActivity('Vault locked — unlock to continue', 'error');
    } else if (connection.status === 'missing_identity') {
      pushActivity('Missing VITE_IDENTITY (see website/README.md).', 'error');
    } else if (connection.status === 'error') {
      pushActivity(connection.error ?? 'Failed to connect', 'error');
    }
  }, [connection.error, connection.status]);

  const applyPlayerBalances = (balances: any) => {
    if (!balances) return;
    setPlayer((prev: any) =>
      prev
        ? {
          ...prev,
          chips: Number(balances.chips ?? prev.chips ?? 0),
          vusdtBalance: Number(balances.vusdtBalance ?? prev.vusdtBalance ?? 0),
          shields: Number(balances.shields ?? prev.shields ?? 0),
          doubles: Number(balances.doubles ?? prev.doubles ?? 0),
          tournamentChips: Number(balances.tournamentChips ?? prev.tournamentChips ?? 0),
          tournamentShields: Number(balances.tournamentShields ?? prev.tournamentShields ?? 0),
          tournamentDoubles: Number(balances.tournamentDoubles ?? prev.tournamentDoubles ?? 0),
          activeTournament: balances.activeTournament ?? prev.activeTournament ?? null,
        }
        : prev
    );
  };

  useEffect(() => {
    if (connection.status !== 'connected' || !connection.client || !connection.keypair) return;
    const client = connection.client;
    const pk = connection.keypair.publicKey;
    const load = async () => {
      try {
        const [playerRes, policyRes, bridgeRes] = await Promise.all([
          client.getCasinoPlayer(pk),
          client.getPolicy(),
          client.getBridgeState(),
        ]);
        if (playerRes) setPlayer(playerRes);
        if (policyRes) setPolicy(policyRes);
        if (bridgeRes) setBridge(bridgeRes);
      } catch (err: any) {
        pushActivity(`Failed to load bridge state: ${err?.message ?? String(err)}`, 'error');
      }
    };
    void load();
    const interval = window.setInterval(load, 8000);
    return () => window.clearInterval(interval);
  }, [connection.client, connection.keypair, connection.status]);

  useEffect(() => {
    if (connection.status !== 'connected' || !connection.keypair) return;
    const pkHex = connection.keypair.publicKeyHex;
    const pkHexLower = pkHex.toLowerCase();

    const unsubError = connection.onEvent('CasinoError', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      const msg = e?.message ?? 'Unknown error';
      trackTxFailed({ surface: 'bridge', finalMessage: msg, pubkeyHex: pkHex, error: msg });
      pushToast('error', msg);
      pushActivity(msg, 'error');
    });

    const unsubWithdraw = connection.onEvent('BridgeWithdrawalRequested', (e: any) => {
      if (e?.player?.toLowerCase?.() !== pkHexLower) return;
      trackTxConfirmed({
        surface: 'bridge',
        kind: 'bridge_withdraw',
        finalMessage: `Bridge withdrawal requested (#${e.id})`,
        pubkeyHex: pkHex,
      });
      pushToast('success', `Bridge withdrawal requested (#${e.id})`);
      applyPlayerBalances(e?.playerBalances);
      if (e?.bridge) setBridge(e.bridge);
      setPendingWithdrawals((prev) => {
        const existing = prev.find((w) => w.id === Number(e.id));
        if (existing) return prev;
        const item: WithdrawalItem = {
          id: Number(e.id),
          amount: BigInt(e.amount ?? 0),
          destination: e.destination ?? '',
          requestedTs: Number(e.requestedTs ?? 0),
          availableTs: Number(e.availableTs ?? 0),
          status: 'pending',
        };
        return [item, ...prev].slice(0, 20);
      });
    });

    const unsubFinalized = connection.onEvent('BridgeWithdrawalFinalized', (e: any) => {
      setPendingWithdrawals((prev) =>
        prev.map((item) =>
          item.id === Number(e.id)
            ? { ...item, status: 'finalized', source: e.source ?? item.source }
            : item
        )
      );
      if (e?.bridge) setBridge(e.bridge);
      if (e?.id !== undefined) {
        pushToast('success', `Bridge withdrawal finalized (#${e.id})`);
        pushActivity(`Bridge withdrawal finalized (#${e.id})`, 'success');
      }
    });

    const unsubDeposit = connection.onEvent('BridgeDepositCredited', (e: any) => {
      if (e?.recipient?.toLowerCase?.() !== pkHexLower) return;
      pushToast('success', `Bridge deposit credited (+${formatInteger(e.amount)} RNG)`);
      pushActivity(`Bridge deposit credited (+${formatInteger(e.amount)} RNG)`, 'success');
      applyPlayerBalances(e?.playerBalances);
      if (e?.bridge) setBridge(e.bridge);
    });

    return () => {
      unsubError?.();
      unsubWithdraw?.();
      unsubFinalized?.();
      unsubDeposit?.();
    };
  }, [connection, connection.keypair]);

  useEffect(() => {
    if (connection.keypair?.publicKeyHex && !depositDestination) {
      setDepositDestination(connection.keypair.publicKeyHex);
    }
  }, [connection.keypair?.publicKeyHex, depositDestination]);

  useEffect(() => {
    if (evmInfo?.address && !withdrawDestination) {
      setWithdrawDestination(evmInfo.address);
    }
  }, [evmInfo?.address, withdrawDestination]);

  const nowDay = Math.floor(Date.now() / 1000 / 86400);
  const bridgeDailyWithdrawn = useMemo(() => {
    if (!bridge) return 0n;
    if (Number(bridge.dailyDay ?? 0) !== nowDay) return 0n;
    return BigInt(bridge.dailyWithdrawn ?? 0);
  }, [bridge, nowDay]);
  const accountDailyWithdrawn = useMemo(() => {
    if (!player) return 0n;
    if (Number(player.bridgeDailyDay ?? 0) !== nowDay) return 0n;
    return BigInt(player.bridgeDailyWithdrawn ?? 0);
  }, [nowDay, player]);

  const policyLimits = useMemo(() => {
    const daily = BigInt(policy?.bridgeDailyLimit ?? 0);
    const perAccount = BigInt(policy?.bridgeDailyLimitPerAccount ?? 0);
    const minWithdraw = BigInt(policy?.bridgeMinWithdraw ?? 0);
    const maxWithdraw = BigInt(policy?.bridgeMaxWithdraw ?? 0);
    const delaySecs = Number(policy?.bridgeDelaySecs ?? 0);
    const paused = !!policy?.bridgePaused;
    const remainingDaily = daily > bridgeDailyWithdrawn ? daily - bridgeDailyWithdrawn : 0n;
    const remainingAccount = perAccount > accountDailyWithdrawn ? perAccount - accountDailyWithdrawn : 0n;
    const remaining = remainingDaily < remainingAccount ? remainingDaily : remainingAccount;
    return { daily, perAccount, minWithdraw, maxWithdraw, delaySecs, paused, remaining };
  }, [accountDailyWithdrawn, bridgeDailyWithdrawn, policy]);

  const withdrawParsed = useMemo(() => parseAmount(withdrawAmount), [withdrawAmount]);
  const withdrawDestinationBytes = useMemo(() => {
    if (!withdrawDestination) return null;
    const bytes = hexToBytes(withdrawDestination);
    if (!bytes) return null;
    if (!(bytes.length === 20 || bytes.length === 32)) return null;
    return bytes;
  }, [withdrawDestination]);

  const withdrawValidation = useMemo(() => {
    if (!player) return 'Register to bridge';
    if (!policy) return 'Policy unavailable';
    if (policyLimits.paused) return 'Bridge paused';
    if (policyLimits.daily === 0n || policyLimits.perAccount === 0n) return 'Bridge limits not configured';
    if (!withdrawDestinationBytes) return 'Enter a valid EVM address';
    if (withdrawParsed === null) return 'Enter a whole number amount';
    if (withdrawParsed <= 0n) return 'Enter an amount';
    if (withdrawParsed > U64_MAX) return 'Amount too large';
    if (withdrawParsed > BigInt(player.chips ?? 0)) return 'Insufficient RNG balance';
    if (policyLimits.minWithdraw > 0n && withdrawParsed < policyLimits.minWithdraw) {
      return `Minimum withdraw is ${formatInteger(policyLimits.minWithdraw)}`;
    }
    if (policyLimits.maxWithdraw > 0n && withdrawParsed > policyLimits.maxWithdraw) {
      return `Maximum withdraw is ${formatInteger(policyLimits.maxWithdraw)}`;
    }
    const capConfigured = policyLimits.daily > 0n && policyLimits.perAccount > 0n;
    if (capConfigured && withdrawParsed > policyLimits.remaining) {
      return 'Exceeds daily bridge cap';
    }
    return null;
  }, [player, policy, policyLimits, withdrawDestinationBytes, withdrawParsed]);

  const canWithdraw = withdrawValidation === null && connection.status === 'connected';

  const onWithdraw = async () => {
    if (!connection.client?.nonceManager || !connection.keypair) return;
    if (!withdrawDestinationBytes || withdrawParsed === null) return;
    try {
      const result = await connection.client.nonceManager.submitBridgeWithdraw(
        withdrawParsed,
        withdrawDestinationBytes
      );
      trackTxSubmitted({
        surface: 'bridge',
        kind: 'bridge_withdraw',
        message: 'Bridge withdraw submitted',
        pubkeyHex: connection.keypair.publicKeyHex,
        nonce: typeof result?.nonce === 'number' ? result.nonce : undefined,
        txHash: result?.txHash,
        txDigest: result?.txDigest,
      });
      pushActivity('Bridge withdrawal submitted');
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      trackTxFailed({
        surface: 'bridge',
        finalMessage: msg,
        pubkeyHex: connection.keypair.publicKeyHex,
        kind: 'bridge_withdraw',
        error: msg,
      });
      pushToast('error', msg);
    }
  };

  const evmConfigOk = isEvmAddress(EVM_LOCKBOX_ADDRESS) && isEvmAddress(EVM_RNG_ADDRESS);
  const evmChainMismatch = evmInfo && EVM_CHAIN_ID && evmInfo.chainId !== EVM_CHAIN_ID;

  const onConnectEvm = async () => {
    setEvmError(null);
    try {
      const info = await connectEvmWallet();
      setEvmInfo(info);
      pushActivity(`EVM wallet connected (${shortHex(info.address)})`, 'success');
    } catch (err: any) {
      setEvmError(err?.message ?? String(err));
    }
  };

  const depositParsed = useMemo(() => parseAmount(depositAmount), [depositAmount]);
  const depositDestinationBytes32 = useMemo(() => {
    if (!depositDestination) return null;
    const clean = normalizeHex(depositDestination);
    if (clean.length !== 64) return null;
    if (!isHexString(clean)) return null;
    return `0x${clean}`;
  }, [depositDestination]);

  const depositValidation = useMemo(() => {
    if (!evmConfigOk) return 'Bridge not configured';
    if (!hasEvmProvider()) return 'EVM wallet not detected';
    if (!evmInfo) return 'Connect EVM wallet';
    if (evmChainMismatch) return `Switch wallet to chain ${EVM_CHAIN_ID}`;
    if (depositParsed === null) return 'Enter a whole number amount';
    if (depositParsed <= 0n) return 'Enter an amount';
    if (depositParsed > U64_MAX) return 'Amount too large';
    if (!depositDestinationBytes32) return 'Enter a 32-byte destination key';
    return null;
  }, [depositDestinationBytes32, depositParsed, evmChainMismatch, evmConfigOk, evmInfo]);

  const canDeposit = depositValidation === null && !evmBusy;

  const sendEvmTransaction = async (to: string, data: string, from: string) => {
    const ethereum = (window as any).ethereum;
    if (!ethereum?.request) {
      throw new Error('No EVM wallet detected');
    }
    const txHash = await ethereum.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from,
          to,
          data,
        },
      ],
    });
    return txHash as string;
  };

  const onDeposit = async () => {
    if (!evmInfo || !depositDestinationBytes32 || depositParsed === null) return;
    if (!evmConfigOk) return;
    setEvmError(null);
    setEvmBusy(true);
    try {
      const amountWei = depositParsed * 10n ** RNG_DECIMALS;
      const amountHex = pad32(amountWei.toString(16));
      const spenderHex = pad32(EVM_LOCKBOX_HEX);
      const approveData = `${APPROVE_SELECTOR}${spenderHex}${amountHex}`;
      const depositData = `${DEPOSIT_SELECTOR}${amountHex}${normalizeHex(depositDestinationBytes32)}`;

      await sendEvmTransaction(EVM_RNG_ADDRESS, approveData, evmInfo.address);
      await sendEvmTransaction(EVM_LOCKBOX_ADDRESS, depositData, evmInfo.address);

      pushToast('success', 'EVM deposit submitted');
      pushActivity(`EVM deposit submitted (${formatInteger(depositParsed)} RNG)`, 'success');
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setEvmError(msg);
      pushToast('error', msg);
      pushActivity(msg, 'error');
    } finally {
      setEvmBusy(false);
    }
  };

  const withdrawCapLabel = policyLimits.daily > 0n && policyLimits.perAccount > 0n
    ? formatInteger(policyLimits.remaining)
    : '-';

  return (
    <div className="min-h-screen text-ns font-sans space-y-6">
      <PageHeader
        title="Bridge"
        status={<ConnectionStatus />}
        leading={<PlaySwapStakeTabs />}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <WalletPill
              rng={player?.chips}
              vusdt={player?.vusdtBalance}
              credits={player?.freerollCredits}
              creditsLocked={player?.freerollCreditsLocked}
              pubkeyHex={connection.keypair?.publicKeyHex}
            />
            <AuthStatusPill publicKeyHex={connection.keypair?.publicKeyHex} />
          </div>
        }
      />

      <div className="space-y-6">
        <div className="liquid-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Bridge</div>
              <div className="text-lg font-display tracking-tight text-ns">Move RNG between networks</div>
              <div className="text-[11px] text-ns-muted">
                Choose a direction, submit the transaction, then track confirmations below.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] tracking-[0.28em] uppercase">
              <div className="liquid-chip px-3 py-1 text-ns-muted">Commonware → EVM</div>
              <div className="liquid-chip px-3 py-1 text-ns-muted">EVM → Commonware</div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="liquid-card p-5 space-y-4">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Commonware → EVM</div>
            <div className="text-[11px] text-ns-muted">
              Withdraw RNG to Ethereum (lock/mint). Withdrawals respect daily caps and delay windows.
            </div>
            <div className="grid gap-3">
              <label className="text-[11px] text-ns-muted">
                Amount (RNG)
                <input
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="mt-1 w-full liquid-input px-3 py-2 text-sm"
                  placeholder="0"
                  inputMode="numeric"
                />
              </label>
              <label className="text-[11px] text-ns-muted">
                EVM destination (0x...)
                <input
                  value={withdrawDestination}
                  onChange={(e) => setWithdrawDestination(e.target.value)}
                  className="mt-1 w-full liquid-input px-3 py-2 text-sm"
                  placeholder="0xEvmAddress"
                />
              </label>
            </div>
            <div className="text-[11px] text-ns-muted grid gap-1">
              <div>Daily cap remaining: <span className="text-ns">{withdrawCapLabel}</span></div>
              <div>Delay: <span className="text-ns">{policyLimits.delaySecs ? `${policyLimits.delaySecs}s` : '-'}</span></div>
            </div>
            {withdrawValidation ? (
              <div className="text-[11px] text-action-destructive">{withdrawValidation}</div>
            ) : null}
            <button
              onClick={onWithdraw}
              disabled={!canWithdraw}
              className={`w-full rounded-full px-3 py-2 text-xs font-bold tracking-[0.28em] uppercase liquid-chip ${
                canWithdraw
                  ? 'text-action-success hover:shadow-soft'
                  : 'text-ns-muted opacity-60 cursor-not-allowed'
              }`}
            >
              Request Withdrawal
            </button>
          </section>

          <section className="liquid-card p-5 space-y-4">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">EVM → Commonware</div>
            <div className="text-[11px] text-ns-muted">
              Deposit RNG on Ethereum and receive credited RNG once the relayer confirms the lockbox event.
            </div>
            {!hasEvmProvider() ? (
              <div className="text-[11px] text-action-destructive">Install an EVM wallet to deposit.</div>
            ) : (
              <div className="flex items-center justify-between text-[11px] text-ns-muted">
                <div>
                  Wallet: {evmInfo ? (
                    <span className="text-ns">{shortHex(evmInfo.address)}</span>
                  ) : (
                    <span className="text-ns-muted">Not connected</span>
                  )}
                </div>
                <button
                  onClick={onConnectEvm}
                  className="rounded-full liquid-chip px-3 py-1 text-[10px] tracking-[0.28em] uppercase text-ns hover:shadow-soft"
                >
                  {evmInfo ? 'Refresh' : 'Connect'}
                </button>
              </div>
            )}
            <div className="grid gap-3">
              <label className="text-[11px] text-ns-muted">
                Amount (RNG)
                <input
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="mt-1 w-full liquid-input px-3 py-2 text-sm"
                  placeholder="0"
                  inputMode="numeric"
                />
              </label>
              <label className="text-[11px] text-ns-muted">
                Destination (Commonware public key)
                <input
                  value={depositDestination}
                  onChange={(e) => setDepositDestination(e.target.value)}
                  className="mt-1 w-full liquid-input px-3 py-2 text-sm"
                  placeholder="0xPublicKey"
                />
              </label>
            </div>
            {evmChainMismatch ? (
              <div className="text-[11px] text-action-destructive">
                Wrong network. Expected chain ID {EVM_CHAIN_ID}.
              </div>
            ) : null}
            {depositValidation ? (
              <div className="text-[11px] text-action-destructive">{depositValidation}</div>
            ) : null}
            {evmError ? <div className="text-[11px] text-action-destructive">{evmError}</div> : null}
            <button
              onClick={onDeposit}
              disabled={!canDeposit}
              className={`w-full rounded-full px-3 py-2 text-xs font-bold tracking-[0.28em] uppercase liquid-chip ${
                canDeposit
                  ? 'text-action-success hover:shadow-soft'
                  : 'text-ns-muted opacity-60 cursor-not-allowed'
              }`}
            >
              {evmBusy ? 'Submitting...' : 'Approve + Deposit'}
            </button>
            {evmConfigOk ? (
              <div className="text-[10px] text-ns-muted">
                Lockbox: <span className="text-ns-muted">{shortHex(EVM_LOCKBOX_ADDRESS)}</span>{' '}
                | RNG: <span className="text-ns-muted">{shortHex(EVM_RNG_ADDRESS)}</span>
              </div>
            ) : (
              <div className="text-[10px] text-ns-muted">
                Configure `VITE_EVM_CHAIN_ID`, `VITE_EVM_LOCKBOX_ADDRESS`, and `VITE_EVM_RNG_ADDRESS` to enable deposits.
              </div>
            )}
          </section>
        </div>

        <section className="liquid-card p-5">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-3">Pending Withdrawals</div>
          {pendingWithdrawals.length === 0 ? (
            <div className="text-[11px] text-ns-muted">No bridge withdrawals yet.</div>
          ) : (
            <div className="space-y-2 text-[11px]">
              {pendingWithdrawals.map((item) => (
                <div key={item.id} className="liquid-panel px-3 py-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="text-ns-muted">#{item.id} → {shortHex(item.destination)}</div>
                    <div className="text-ns">{formatInteger(item.amount)} RNG</div>
                  </div>
                  <div className="text-right text-ns-muted">
                    <div className="text-[10px] tracking-widest">
                      {item.status === 'finalized' ? 'FINALIZED' : 'PENDING'}
                    </div>
                    <div className="text-[10px]">
                      Available: {item.availableTs ? new Date(item.availableTs * 1000).toLocaleTimeString() : '-'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="liquid-card p-5">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-3">Activity</div>
          {activity.length === 0 ? (
            <div className="text-[11px] text-ns-muted">No activity yet.</div>
          ) : (
            <div className="space-y-2 text-[11px] text-ns-muted">
              {activity.map((item) => {
                const isTx = item.type === 'tx';
                const message = isTx ? item.finalMessage ?? item.message : item.message;
                const when = new Date(isTx ? item.updatedTs : item.ts).toLocaleTimeString();
                const label = isTx
                  ? item.status === 'submitted'
                    ? 'PENDING'
                    : item.status === 'confirmed'
                      ? 'OK'
                      : 'FAIL'
                  : item.level === 'error'
                    ? 'ERROR'
                    : item.level === 'success'
                      ? 'OK'
                      : 'INFO';
                const labelClass = isTx
                  ? item.status === 'confirmed'
                    ? 'text-action-success'
                    : item.status === 'failed'
                      ? 'text-action-destructive'
                      : 'text-ns-muted'
                  : item.level === 'error'
                    ? 'text-action-destructive'
                    : item.level === 'success'
                      ? 'text-action-success'
                      : 'text-ns-muted';

                const messageNode =
                  isTx && item.txDigest ? (
                    <Link to={`/explorer/tx/${item.txDigest}`} className="truncate hover:underline" title={item.txDigest}>
                      {message}
                    </Link>
                  ) : (
                    <div className="truncate">{message}</div>
                  );

                return (
                  <div key={item.id} className="liquid-panel px-3 py-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`text-[10px] tracking-widest ${labelClass}`}>{label}</div>
                      <div className="min-w-0 flex-1 text-ns">{messageNode}</div>
                    </div>
                    <div className="text-[10px] text-ns-muted">{when}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
