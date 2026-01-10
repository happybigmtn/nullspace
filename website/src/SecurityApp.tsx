import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PlaySwapStakeTabs } from './components/PlaySwapStakeTabs';
import { PageHeader } from './components/PageHeader';
import { AuthStatusPill } from './components/AuthStatusPill';
import {
  createPasskeyVault,
  createPasswordVault,
  deleteVault,
  getVaultRecord,
  getVaultStatusSync,
  lockPasskeyVault,
  unlockPasskeyVault,
  unlockPasswordVault,
} from './security/keyVault';
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
  const [passkeySupported, setPasskeySupported] = useState<boolean>(false);
  const [passwordSupported, setPasswordSupported] = useState<boolean>(false);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [unlocked, setUnlocked] = useState<boolean>(!!getUnlockedVault());
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(getVaultStatusSync().nullspacePublicKeyHex);
  const [vaultKind, setVaultKind] = useState<'passkey' | 'password' | null>(getVaultStatusSync().kind);
  const [passwordCreate, setPasswordCreate] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordUnlock, setPasswordUnlock] = useState('');

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
    if (msg === 'password-too-short') {
      return 'Password too short (minimum 8 characters).';
    }
    if (msg === 'password-required') {
      return 'Enter your vault password.';
    }
    if (msg === 'password-invalid') {
      return 'Incorrect password or corrupted vault.';
    }
    if (msg === 'vault-kind-mismatch') {
      return 'Vault type mismatch. Delete the current vault before switching types.';
    }
    return msg;
  };

  const sync = async () => {
    setError(null);
    const s = getVaultStatusSync();
    setSupported(s.supported);
    setPasskeySupported(s.passkeySupported);
    setPasswordSupported(s.passwordSupported);
    setEnabled(s.enabled);
    setUnlocked(s.unlocked);
    setPublicKeyHex(s.nullspacePublicKeyHex);
    setVaultKind(s.kind);

    if (!s.supported) {
      setStatus('Vault unavailable on this device.');
      setHasVault(false);
      return;
    }

    try {
      const record = await getVaultRecord();
      setHasVault(!!record);
      let inferredKind = s.kind;
      if (!inferredKind && record) {
        inferredKind = record.version === 3 ? 'password' : 'passkey';
        setVaultKind(inferredKind);
      }
      if (record && inferredKind) {
        setStatus(`Vault found (${inferredKind})`);
      } else {
        setStatus(record ? 'Vault found' : 'No vault yet');
      }
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
      const status = getVaultStatusSync();
      setUnlocked(!!v);
      setPublicKeyHex(v?.nullspacePublicKeyHex ?? status.nullspacePublicKeyHex);
      setVaultKind(status.kind);
    });
  }, []);

  const vaultLabel = useMemo(() => {
    if (!supported) return 'UNSUPPORTED';
    if (!hasVault) return 'NONE';
    if (unlocked) return 'UNLOCKED';
    return 'LOCKED';
  }, [supported, hasVault, unlocked]);

  const passkeyActive = hasVault && vaultKind === 'passkey';
  const passwordActive = hasVault && vaultKind === 'password';
  const passkeyLabel = useMemo(() => {
    if (!passkeySupported) return 'UNSUPPORTED';
    if (!passkeyActive) return 'INACTIVE';
    return unlocked ? 'UNLOCKED' : 'LOCKED';
  }, [passkeyActive, passkeySupported, unlocked]);
  const passwordLabel = useMemo(() => {
    if (!passwordSupported) return 'UNSUPPORTED';
    if (!passwordActive) return 'INACTIVE';
    return unlocked ? 'UNLOCKED' : 'LOCKED';
  }, [passwordActive, passwordSupported, unlocked]);

  const pushBotLog = (msg: string) => {
    setBotLogs(prev => [`${new Date().toLocaleTimeString()} ${msg}`, ...prev].slice(0, 20));
  };

  const onCreatePasskeyVault = async () => {
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

  const onUnlockPasskeyVault = async () => {
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

  const onCreatePasswordVault = async () => {
    setError(null);
    if (passwordCreate.length < 8) {
      setError('Password too short (minimum 8 characters).');
      return;
    }
    if (passwordCreate !== passwordConfirm) {
      setError('Passwords do not match.');
      return;
    }
    setStatus('Creating password vault…');
    try {
      await createPasswordVault(passwordCreate, { migrateExistingCasinoKey: true });
      setPasswordCreate('');
      setPasswordConfirm('');
      setStatus('Password vault created and unlocked');
      await sync();
    } catch (e: any) {
      setStatus('Create failed');
      setError(formatError(e));
    }
  };

  const onUnlockPasswordVault = async () => {
    setError(null);
    setStatus('Unlocking…');
    try {
      await unlockPasswordVault(passwordUnlock);
      setPasswordUnlock('');
      setStatus('Unlocked');
      await sync();
    } catch (e: any) {
      setStatus('Unlock failed');
      setError(formatError(e));
    }
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
      // Use VITE_URL in production (no /api proxy), fall back to /api for dev
      const baseUrl = import.meta.env.VITE_URL || '/api';
      botRef.current = new VaultBetBot({
        baseUrl,
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
    <div className="min-h-screen text-ns font-sans space-y-6">
      <PageHeader
        title="Vaults"
        status={status}
        leading={<PlaySwapStakeTabs />}
        right={<AuthStatusPill publicKeyHex={publicKeyHex} />}
      />

      <div className="space-y-6">
        {error && (
          <div className="liquid-panel px-3 py-2 text-xs text-action-destructive">
            {error}
          </div>
        )}

        <div className="liquid-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-2">
              <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Primary</div>
              <div className="text-lg font-display tracking-tight text-ns">Passkey Vault</div>
              <div className="text-[11px] text-ns-muted">
                Recommended. Stored locally with device-backed security.
              </div>
              <div className="text-[10px] text-ns-muted">
                Vault: <span className="text-action-success">{passkeyLabel}</span>
                {passkeySupported ? (
                  <>
                    <span className="text-ns-muted"> · </span>
                    Active:{' '}
                    <span className={passkeyActive ? 'text-action-success' : 'text-ns-muted'}>
                      {passkeyActive ? 'YES' : 'NO'}
                    </span>
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
                <div className="text-[11px] text-action-destructive">Missing `VITE_IDENTITY` (required to verify chain state).</div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {!hasVault && passkeySupported && (
                <button
                  className="text-[10px] px-3 py-2 rounded-full liquid-chip text-action-success hover:shadow-soft"
                  onClick={onCreatePasskeyVault}
                >
                  Create passkey vault
                </button>
              )}

              {passkeyActive && !unlocked && (
                <button
                  className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
                  onClick={onUnlockPasskeyVault}
                >
                  Unlock with passkey
                </button>
              )}

              {passkeyActive && unlocked && (
                <button
                  className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
                  onClick={onLockVault}
                >
                  Lock vault
                </button>
              )}

              {passkeyActive && (
                <button
                  className="text-[10px] px-3 py-2 rounded-full liquid-chip text-action-destructive hover:shadow-soft"
                  onClick={onDeleteVault}
                >
                  Delete vault
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 text-[10px] text-ns-muted leading-relaxed">
            Passkeys unlock a local encrypted vault (stored in IndexedDB). The vault stores:
            <ul className="list-disc ml-5 mt-2 space-y-1 text-ns-muted">
              <li>Casino betting key (ed25519) for onchain transactions</li>
              <li>Chat key material (placeholder until XMTP integration)</li>
            </ul>
            <div className="mt-2">
              After unlocking, return to your game — the connection should refresh automatically.
              <button
                className="ml-2 text-[10px] px-2 py-1 rounded-full liquid-chip text-ns hover:shadow-soft"
                onClick={() => window.location.reload()}
              >
                RELOAD
              </button>
            </div>
          </div>
        </div>

        <div className="liquid-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-2">
              <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Fallback</div>
              <div className="text-lg font-display tracking-tight text-ns">Password Vault</div>
              <div className="text-[11px] text-ns-muted">
                Use only if passkeys are unavailable on this device.
              </div>
              <div className="text-[10px] text-ns-muted">
                Vault: <span className="text-action-success">{passwordLabel}</span>
                {passwordSupported ? (
                  <>
                    <span className="text-ns-muted"> · </span>
                    Active:{' '}
                    <span className={passwordActive ? 'text-action-success' : 'text-ns-muted'}>
                      {passwordActive ? 'YES' : 'NO'}
                    </span>
                  </>
                ) : null}
                {publicKeyHex ? (
                  <>
                    {' '}
                    · Casino pubkey: <span className="text-action-success">{publicKeyHex.slice(0, 12)}…</span>
                  </>
                ) : null}
              </div>
              {!passwordSupported && (
                <div className="text-[11px] text-ns-muted">Password vaults need WebCrypto + IndexedDB support.</div>
              )}
              {passkeyActive && (
                <div className="text-[11px] text-ns-muted">Passkey vault is active. Delete it to switch vault types.</div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {passwordActive && unlocked && (
                <button
                  className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
                  onClick={onLockVault}
                >
                  Lock vault
                </button>
              )}

              {passwordActive && (
                <button
                  className="text-[10px] px-3 py-2 rounded-full liquid-chip text-action-destructive hover:shadow-soft"
                  onClick={onDeleteVault}
                >
                  Delete vault
                </button>
              )}
            </div>
          </div>

          {!hasVault && passwordSupported && !passkeyActive && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="password"
                className="text-xs px-3 py-2 rounded liquid-input focus:outline-none"
                placeholder="Create password (min 8 chars)"
                value={passwordCreate}
                onChange={(e) => setPasswordCreate(e.target.value)}
              />
              <input
                type="password"
                className="text-xs px-3 py-2 rounded liquid-input focus:outline-none"
                placeholder="Confirm password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />
              <button
                className="text-[10px] px-3 py-2 rounded-full liquid-chip text-action-success hover:shadow-soft md:col-span-2"
                onClick={onCreatePasswordVault}
              >
                Create password vault
              </button>
            </div>
          )}

          {passwordActive && !unlocked && (
            <div className="mt-4 flex flex-col md:flex-row gap-3">
              <input
                type="password"
                className="text-xs px-3 py-2 rounded liquid-input focus:outline-none flex-1"
                placeholder="Enter password to unlock"
                value={passwordUnlock}
                onChange={(e) => setPasswordUnlock(e.target.value)}
              />
              <button
                className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
                onClick={onUnlockPasswordVault}
              >
                Unlock with password
              </button>
            </div>
          )}

          <div className="mt-4 text-[10px] text-ns-muted leading-relaxed">
            Password vaults encrypt keys locally with PBKDF2 + AES-GCM. Keep the password in a manager —
            if you lose it, the vault cannot be recovered. No keys leave the device.
          </div>
        </div>

        {showDevTools && (
          <div className="liquid-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] text-ns-muted tracking-widest">DEV</div>
                <div className="text-sm font-bold mt-1">Flags + Telemetry</div>
                <div className="text-xs text-ns-muted mt-1">
                  Feature flags switch between new and legacy pages. Telemetry is stored locally (dev-only by default).
                </div>
              </div>
              <button
                className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
                onClick={() => window.location.reload()}
              >
                RELOAD
              </button>
            </div>

            {devMessage ? (
              <div className="mt-3 text-[10px] text-ns liquid-panel px-3 py-2">
                {devMessage}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="liquid-panel p-3">
                <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-2">Feature Flags</div>
                <div className="space-y-2">
                  {(
                    [
                      { key: 'new_economy_ui' as const, label: 'New Economy UI (/swap, /borrow, /liquidity)' },
                      { key: 'new_staking_ui' as const, label: 'New Staking UI (/stake)' },
                    ] satisfies Array<{ key: FeatureFlag; label: string }>
                  ).map((f) => (
                    <div key={f.key} className="flex items-center justify-between gap-3">
                      <div className="text-[11px] text-ns-muted">{f.label}</div>
                      <button
                        type="button"
                        onClick={() => onToggleFlag(f.key)}
                        className={`text-[10px] px-2 py-1 rounded-full liquid-chip ${
                          flags[f.key] ? 'text-action-success' : 'text-ns-muted'
                        }`}
                      >
                        {flags[f.key] ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[10px] text-ns-muted">Tip: navigate away/back (or reload) to apply immediately.</div>
              </div>

              <div className="liquid-panel p-3">
                <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-2">Telemetry</div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] text-ns-muted">
                    Enabled:{' '}
                    <span className={telemetryEnabled ? 'text-action-success' : 'text-ns-muted'}>
                      {telemetryEnabled ? 'YES' : 'NO'}
                    </span>
                    <span className="text-ns-muted"> · </span>
                    Events: <span className="text-ns">{telemetryCount}</span>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleTelemetry}
                    className={`text-[10px] px-2 py-1 rounded-full liquid-chip ${
                      telemetryEnabled ? 'text-action-success' : 'text-ns-muted'
                    }`}
                  >
                    {telemetryEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onExportTelemetry}
                    className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
                  >
                    EXPORT JSON
                  </button>
                  <button
                    type="button"
                    onClick={onClearTelemetry}
                    className="text-[10px] px-3 py-2 rounded-full liquid-chip text-action-destructive hover:shadow-soft"
                  >
                    CLEAR
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-ns-muted">
                  Export copies to clipboard when available; otherwise downloads a file.
                </div>
              </div>

              <div className="liquid-panel p-3">
                <div className="text-[10px] text-ns-muted tracking-widest mb-2">ACTIVITY</div>
                <div className="text-[11px] text-ns-muted">
                  Total: <span className="text-ns">{activityCounts.total}</span>
                  <span className="text-ns-muted"> · </span>
                  Econ: <span className="text-ns">{activityCounts.economy}</span>
                  <span className="text-ns-muted"> · </span>
                  Stake: <span className="text-ns">{activityCounts.staking}</span>
                </div>
                <div className="text-[11px] text-ns-muted mt-1">
                  Casino: <span className="text-ns">{activityCounts.casino}</span>
                  <span className="text-ns-muted"> · </span>
                  Security: <span className="text-ns">{activityCounts.security}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onExportActivity}
                    className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
                  >
                    EXPORT JSON
                  </button>
                  <button
                    type="button"
                    onClick={onClearActivity}
                    className="text-[10px] px-3 py-2 rounded-full liquid-chip text-action-destructive hover:shadow-soft"
                  >
                    CLEAR
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-ns-muted">Tracks pending/confirmed actions and links to receipts.</div>
              </div>
            </div>
          </div>
        )}

        <div className="liquid-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">POC</div>
              <div className="text-sm font-bold mt-1">Vault Bot Bets</div>
              <div className="text-xs text-ns-muted mt-1">Uses the vault-held betting key to submit randomized casino games.</div>
            </div>
            <div className="flex items-center gap-2">
              {!botRunning ? (
                <button
                  className={`text-[10px] px-3 py-2 rounded-full liquid-chip ${
                    unlocked
                      ? 'text-action-success hover:shadow-soft'
                      : 'text-ns-muted opacity-60 cursor-not-allowed'
                  }`}
                  onClick={startBot}
                  disabled={!unlocked}
                >
                  START BOT
                </button>
              ) : (
                <button
                  className="text-[10px] px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
                  onClick={stopBot}
                >
                  STOP BOT
                </button>
              )}
            </div>
          </div>

          <div className="mt-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-2">Logs</div>
            <div className="liquid-panel p-2 h-40 overflow-y-auto text-xs text-ns">
              {botLogs.length === 0 ? (
                <div className="text-ns-muted">No bot activity yet.</div>
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
