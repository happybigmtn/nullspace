import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PlaySwapStakeTabs } from './components/PlaySwapStakeTabs';
import { PageHeader } from './components/PageHeader';
import { AuthStatusPill } from './components/AuthStatusPill';
import { createPasskeyVault, deleteVault, getVaultRecord, getVaultStatusSync, lockPasskeyVault, unlockPasskeyVault } from './security/keyVault';
import { getUnlockedVault, subscribeVault } from './security/vaultRuntime';
import { VaultBetBot } from './security/VaultBetBot';
import { getAllFeatureFlags, setFeatureEnabled, type FeatureFlag } from './services/featureFlags';
import {
  clearTelemetry,
  exportTelemetryJson,
  getTelemetryEvents,
  isTelemetryEnabled,
  setTelemetryEnabled as setTelemetryEnabledStorage,
} from './services/telemetry';
import { clearActivity, exportActivityJson, getActivityItems, subscribeActivity } from './services/txTracker';

export default function SecurityApp() {
  const [status, setStatus] = useState<string>('Loading…');
  const [error, setError] = useState<string | null>(null);
  const [hasVault, setHasVault] = useState<boolean>(false);
  const [supported, setSupported] = useState<boolean>(false);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [unlocked, setUnlocked] = useState<boolean>(!!getUnlockedVault());
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(getVaultStatusSync().nullspacePublicKeyHex);

  const [botRunning, setBotRunning] = useState(false);
  const [botLogs, setBotLogs] = useState<string[]>([]);
  const botRef = useRef<VaultBetBot | null>(null);

  const showDevTools = (() => {
    try {
      return !!(import.meta as any)?.env?.DEV;
    } catch {
      return false;
    }
  })();

  const [flags, setFlags] = useState(() => getAllFeatureFlags());
  const [telemetryEnabled, setTelemetryEnabled] = useState(() => isTelemetryEnabled());
  const [telemetryCount, setTelemetryCount] = useState(() => getTelemetryEvents().length);
  const [devMessage, setDevMessage] = useState<string | null>(null);
  const readActivityCounts = () => {
    try {
      const all = getActivityItems();
      const counts = { total: all.length, economy: 0, staking: 0, bridge: 0, casino: 0, security: 0, system: 0 };
      for (const item of all as any[]) {
        const s = item?.surface;
        if (s === 'economy') counts.economy += 1;
        else if (s === 'staking') counts.staking += 1;
        else if (s === 'bridge') counts.bridge += 1;
        else if (s === 'casino') counts.casino += 1;
        else if (s === 'security') counts.security += 1;
        else counts.system += 1;
      }
      return counts;
    } catch {
      return { total: 0, economy: 0, staking: 0, bridge: 0, casino: 0, security: 0, system: 0 };
    }
  };
  const [activityCounts, setActivityCounts] = useState(() => readActivityCounts());

  const identityHex = import.meta.env.VITE_IDENTITY as string | undefined;
  const identityOk = !!identityHex;

  const formatError = (e: any): string => {
    const msg = e?.message ?? String(e);
    if (msg === 'passkey-prf-unsupported') {
      return 'This passkey/authenticator does not support the PRF/hmac-secret/largeBlob extensions required to derive a local vault key. Try creating the passkey on this device (platform passkey), or use a different authenticator (Android Chrome / hardware security key).';
    }
    return msg;
  };

  const sync = async () => {
    setError(null);
    const s = getVaultStatusSync();
    setSupported(s.supported);
    setEnabled(s.enabled);
    setUnlocked(s.unlocked);
    setPublicKeyHex(s.nullspacePublicKeyHex);

    if (!s.supported) {
      setStatus('Passkeys unavailable (requires secure context + WebAuthn).');
      setHasVault(false);
      return;
    }

    try {
      const record = await getVaultRecord();
      setHasVault(!!record);
      setStatus(record ? 'Vault found' : 'No vault yet');
    } catch (e: any) {
      setHasVault(false);
      setStatus('Failed to read vault');
      setError(formatError(e));
    }
  };

  useEffect(() => {
    void sync();
  }, []);

  useEffect(() => {
    return subscribeVault((v) => {
      setUnlocked(!!v);
      setPublicKeyHex(v?.nullspacePublicKeyHex ?? getVaultStatusSync().nullspacePublicKeyHex);
    });
  }, []);

  const vaultLabel = useMemo(() => {
    if (!supported) return 'UNSUPPORTED';
    if (!hasVault) return 'NONE';
    if (unlocked) return 'UNLOCKED';
    return 'LOCKED';
  }, [supported, hasVault, unlocked]);

  const pushBotLog = (msg: string) => {
    setBotLogs(prev => [`${new Date().toLocaleTimeString()} ${msg}`, ...prev].slice(0, 20));
  };

  const onCreateVault = async () => {
    setError(null);
    setStatus('Creating passkey + vault…');
    try {
      await createPasskeyVault({ migrateExistingCasinoKey: true });
      setStatus('Vault created and unlocked');
      await sync();
    } catch (e: any) {
      setStatus('Create failed');
      setError(formatError(e));
    }
  };

  const onUnlockVault = async () => {
    setError(null);
    setStatus('Unlocking…');
    try {
      await unlockPasskeyVault();
      setStatus('Unlocked');
      await sync();
    } catch (e: any) {
      setStatus('Unlock failed');
      setError(formatError(e));
    }
  };

  const onLockVault = () => {
    lockPasskeyVault();
    setStatus('Locked');
  };

  const onDeleteVault = async () => {
    setError(null);
    setStatus('Deleting vault…');
    try {
      await deleteVault();
      setStatus('Vault deleted');
      setHasVault(false);
      setUnlocked(false);
      setEnabled(false);
      setPublicKeyHex(null);
      botRef.current?.stop();
      botRef.current = null;
      setBotRunning(false);
    } catch (e: any) {
      setStatus('Delete failed');
      setError(formatError(e));
    }
  };

  const startBot = async () => {
    setError(null);
    if (!identityHex) {
      setError('Missing VITE_IDENTITY (see website/README.md).');
      return;
    }
    const vault = getUnlockedVault();
    if (!vault) {
      setError('Unlock your vault before starting the bot.');
      return;
    }

    if (!botRef.current) {
      botRef.current = new VaultBetBot({
        baseUrl: '/api',
        identityHex,
        privateKeyBytes: vault.nullspaceEd25519PrivateKey,
        onLog: pushBotLog,
      });
    }

    botRef.current.start();
    setBotRunning(true);
    pushBotLog('Vault bot started');
  };

  const stopBot = () => {
    botRef.current?.stop();
    setBotRunning(false);
    pushBotLog('Vault bot stopped');
  };

  const onToggleFlag = (flag: FeatureFlag) => {
    const next = !flags[flag];
    setFeatureEnabled(flag, next);
    setFlags((prev) => ({ ...prev, [flag]: next }));
    setDevMessage(`Flag updated: ${flag} = ${next ? 'ON' : 'OFF'}`);
  };

  const onToggleTelemetry = () => {
    const next = !telemetryEnabled;
    setTelemetryEnabledStorage(next);
    setTelemetryEnabled(next);
    setDevMessage(`Telemetry ${next ? 'enabled' : 'disabled'}`);
  };

  const onExportTelemetry = async () => {
    const json = exportTelemetryJson(true);
    try {
      await navigator.clipboard.writeText(json);
      setDevMessage('Telemetry copied to clipboard');
    } catch {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nullspace-telemetry-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setDevMessage('Telemetry downloaded');
      } catch {
        setDevMessage('Failed to export telemetry');
      }
    } finally {
      setTelemetryCount(getTelemetryEvents().length);
    }
  };

  useEffect(() => {
    if (!showDevTools) return;
    setActivityCounts(readActivityCounts());
    return subscribeActivity(() => setActivityCounts(readActivityCounts()));
  }, [showDevTools]);

  const onExportActivity = async () => {
    const json = exportActivityJson(true);
    try {
      await navigator.clipboard.writeText(json);
      setDevMessage('Activity copied to clipboard');
    } catch {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nullspace-activity-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setDevMessage('Activity downloaded');
      } catch {
        setDevMessage('Failed to export activity');
      }
    } finally {
      setActivityCounts(readActivityCounts());
    }
  };

  const onClearActivity = () => {
    clearActivity();
    setActivityCounts(readActivityCounts());
    setDevMessage('Activity cleared');
  };

  const onClearTelemetry = () => {
    clearTelemetry();
    setTelemetryCount(0);
    setDevMessage('Telemetry cleared');
  };

  return (
    <div className="min-h-screen w-screen bg-titanium-900 text-white font-mono">
      <PageHeader
        title="Passkey Vault"
        status={status}
        leading={<PlaySwapStakeTabs />}
        right={<AuthStatusPill publicKeyHex={publicKeyHex} />}
      />

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="border border-gray-800 rounded bg-gray-900/30 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] text-gray-500 tracking-widest">SECURITY</div>
              <div className="text-lg font-bold mt-1">Passkey Vault</div>
              <div className="text-xs text-gray-500 mt-2">
                Vault: <span className="text-action-success">{vaultLabel}</span>
                {supported ? (
                  <>
                    <span className="text-gray-700"> · </span>
                    Enabled:{' '}
                    <span className={enabled ? 'text-action-success' : 'text-gray-500'}>{enabled ? 'YES' : 'NO'}</span>
                  </>
                ) : null}
                {publicKeyHex ? (
                  <>
                    {' '}
                    · Casino pubkey: <span className="text-action-success">{publicKeyHex.slice(0, 12)}…</span>
                  </>
                ) : null}
              </div>
              {!identityOk && (
                <div className="text-xs text-action-destructive mt-2">Missing `VITE_IDENTITY` (required to verify chain state).</div>
              )}
            </div>

            <div className="flex flex-col gap-2 items-end">
              {!hasVault && supported && (
                <button
                  className="text-[10px] border px-3 py-2 rounded bg-action-success/20 border-action-success text-action-success hover:bg-action-success/30"
                  onClick={onCreateVault}
                >
                  CREATE PASSKEY VAULT
                </button>
              )}

              {hasVault && !unlocked && (
                <button
                  className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-700 text-gray-200 hover:border-gray-500"
                  onClick={onUnlockVault}
                >
                  UNLOCK WITH PASSKEY
                </button>
              )}

              {hasVault && unlocked && (
                <button
                  className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-700 text-gray-200 hover:border-gray-500"
                  onClick={onLockVault}
                >
                  LOCK VAULT
                </button>
              )}

              {hasVault && (
                <button
                  className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-800 text-gray-400 hover:border-action-destructive hover:text-action-destructive"
                  onClick={onDeleteVault}
                >
                  DELETE VAULT
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-3 text-xs text-action-destructive border border-action-destructive/40 rounded bg-action-destructive/10 p-2">
              {error}
            </div>
          )}

          <div className="mt-4 text-[10px] text-gray-500 leading-relaxed">
            Passkeys unlock a local encrypted vault (stored in IndexedDB). The vault stores:
            <ul className="list-disc ml-5 mt-2 space-y-1 text-gray-500">
              <li>Casino betting key (ed25519) for onchain transactions</li>
              <li>Chat key material (placeholder until XMTP integration)</li>
            </ul>
            <div className="mt-2">
              After unlocking, reload the app to ensure all pages pick up the vault-held keys.
              <button
                className="ml-2 text-[10px] border px-2 py-1 rounded bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600"
                onClick={() => window.location.reload()}
              >
                RELOAD
              </button>
            </div>
          </div>
        </div>

        {showDevTools && (
          <div className="border border-gray-800 rounded bg-gray-900/30 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] text-gray-500 tracking-widest">DEV</div>
                <div className="text-sm font-bold mt-1">Flags + Telemetry</div>
                <div className="text-xs text-gray-400 mt-1">
                  Feature flags switch between new and legacy pages. Telemetry is stored locally (dev-only by default).
                </div>
              </div>
              <button
                className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-700 text-gray-200 hover:border-gray-500"
                onClick={() => window.location.reload()}
              >
                RELOAD
              </button>
            </div>

            {devMessage ? (
              <div className="mt-3 text-[10px] text-gray-300 border border-gray-800 rounded bg-black/40 px-3 py-2">
                {devMessage}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="border border-gray-800 rounded bg-black/30 p-3">
                <div className="text-[10px] text-gray-500 tracking-widest mb-2">FEATURE FLAGS</div>
                <div className="space-y-2">
                  {(
                    [
                      { key: 'new_economy_ui' as const, label: 'New Economy UI (/swap, /borrow, /liquidity)' },
                      { key: 'new_staking_ui' as const, label: 'New Staking UI (/stake)' },
                    ] satisfies Array<{ key: FeatureFlag; label: string }>
                  ).map((f) => (
                    <div key={f.key} className="flex items-center justify-between gap-3">
                      <div className="text-[11px] text-gray-400">{f.label}</div>
                      <button
                        type="button"
                        onClick={() => onToggleFlag(f.key)}
                        className={`text-[10px] px-2 py-1 rounded border ${
                          flags[f.key] ? 'border-action-success text-action-success' : 'border-gray-800 text-gray-500'
                        }`}
                      >
                        {flags[f.key] ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[10px] text-gray-600">Tip: navigate away/back (or reload) to apply immediately.</div>
              </div>

              <div className="border border-gray-800 rounded bg-black/30 p-3">
                <div className="text-[10px] text-gray-500 tracking-widest mb-2">TELEMETRY</div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] text-gray-400">
                    Enabled:{' '}
                    <span className={telemetryEnabled ? 'text-action-success' : 'text-gray-500'}>
                      {telemetryEnabled ? 'YES' : 'NO'}
                    </span>
                    <span className="text-gray-700"> · </span>
                    Events: <span className="text-white">{telemetryCount}</span>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleTelemetry}
                    className={`text-[10px] px-2 py-1 rounded border ${
                      telemetryEnabled ? 'border-action-success text-action-success' : 'border-gray-800 text-gray-500'
                    }`}
                  >
                    {telemetryEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onExportTelemetry}
                    className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-700 text-gray-200 hover:border-gray-500"
                  >
                    EXPORT JSON
                  </button>
                  <button
                    type="button"
                    onClick={onClearTelemetry}
                    className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-800 text-gray-400 hover:border-action-destructive hover:text-action-destructive"
                  >
                    CLEAR
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-gray-600">
                  Export copies to clipboard when available; otherwise downloads a file.
                </div>
              </div>

              <div className="border border-gray-800 rounded bg-black/30 p-3">
                <div className="text-[10px] text-gray-500 tracking-widest mb-2">ACTIVITY</div>
                <div className="text-[11px] text-gray-400">
                  Total: <span className="text-white">{activityCounts.total}</span>
                  <span className="text-gray-700"> · </span>
                  Econ: <span className="text-white">{activityCounts.economy}</span>
                  <span className="text-gray-700"> · </span>
                  Stake: <span className="text-white">{activityCounts.staking}</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">
                  Casino: <span className="text-gray-300">{activityCounts.casino}</span>
                  <span className="text-gray-700"> · </span>
                  Security: <span className="text-gray-300">{activityCounts.security}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onExportActivity}
                    className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-700 text-gray-200 hover:border-gray-500"
                  >
                    EXPORT JSON
                  </button>
                  <button
                    type="button"
                    onClick={onClearActivity}
                    className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-800 text-gray-400 hover:border-action-destructive hover:text-action-destructive"
                  >
                    CLEAR
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-gray-600">Tracks pending/confirmed actions and links to receipts.</div>
              </div>
            </div>
          </div>
        )}

        <div className="border border-gray-800 rounded bg-gray-900/30 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] text-gray-500 tracking-widest">POC</div>
              <div className="text-sm font-bold mt-1">Vault Bot Bets</div>
              <div className="text-xs text-gray-400 mt-1">Uses the vault-held betting key to submit randomized casino games.</div>
            </div>
            <div className="flex items-center gap-2">
              {!botRunning ? (
                <button
                  className={`text-[10px] border px-3 py-2 rounded ${
                    unlocked
                      ? 'bg-action-success/20 border-action-success text-action-success hover:bg-action-success/30'
                      : 'bg-gray-900 border-gray-800 text-gray-500 cursor-not-allowed'
                  }`}
                  onClick={startBot}
                  disabled={!unlocked}
                >
                  START BOT
                </button>
              ) : (
                <button
                  className="text-[10px] border px-3 py-2 rounded bg-gray-900 border-gray-700 text-gray-200 hover:border-gray-500"
                  onClick={stopBot}
                >
                  STOP BOT
                </button>
              )}
            </div>
          </div>

          <div className="mt-3">
            <div className="text-[10px] text-gray-500 tracking-widest mb-2">LOGS</div>
            <div className="border border-gray-800 rounded bg-titanium-900/60 p-2 h-40 overflow-y-auto text-xs text-gray-300">
              {botLogs.length === 0 ? (
                <div className="text-gray-600">No bot activity yet.</div>
              ) : (
                botLogs.map((l, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-words">
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
