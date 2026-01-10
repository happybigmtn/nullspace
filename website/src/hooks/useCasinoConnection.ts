import { useCallback, useEffect, useRef, useState } from 'react';
import { WasmWrapper } from '../api/wasm.js';
import { CasinoClient } from '../api/client.js';
import { getVaultRecord } from '../security/keyVault';
import { subscribeVault } from '../security/vaultRuntime';

export type ConnectionStatus =
  | 'missing_identity'
  | 'vault_locked'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'error';

export type VaultMode = 'unknown' | 'missing' | 'locked' | 'unlocked';

export type CasinoConnection = {
  status: ConnectionStatus;
  statusDetail?: string;
  error?: string;
  client: CasinoClient | null;
  wasm: WasmWrapper | null;
  keypair: { publicKey: Uint8Array; publicKeyHex: string } | null;
  currentView: number | null;
  refreshOnce: () => Promise<void>;
  onEvent: (name: string, handler: (evt: any) => void) => () => void;
  vaultMode: VaultMode;
};

const IS_DEV = Boolean(import.meta.env?.DEV);
const MISSING_IDENTITY_DETAIL = IS_DEV
  ? 'Missing VITE_IDENTITY (see website/README.md).'
  : 'Identity not configured. Refresh the page or contact support.';
const OFFLINE_DETAIL = 'Offline - check your connection and retry.';
const VAULT_LOCKED_DETAIL = 'Vault locked. Open Security to unlock.';
const VAULT_MISSING_DETAIL = 'No vault found. Open Security to create one.';
const ERROR_DETAIL = IS_DEV
  ? 'Failed to connect. Check simulator + validators.'
  : 'Failed to connect. Check your connection and retry.';

export function useCasinoConnection(baseUrl = '/api'): CasinoConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [client, setClient] = useState<CasinoClient | null>(null);
  const [wasm, setWasm] = useState<WasmWrapper | null>(null);
  const [keypair, setKeypair] = useState<{ publicKey: Uint8Array; publicKeyHex: string } | null>(null);
  const [currentView, setCurrentView] = useState<number | null>(null);
  const [vaultMode, setVaultMode] = useState<VaultMode>('unknown');
  const [refreshToken, setRefreshToken] = useState(0);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  const clientRef = useRef<CasinoClient | null>(null);
  const statusRef = useRef<ConnectionStatus>(status);
  const vaultModeRef = useRef<VaultMode>(vaultMode);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    vaultModeRef.current = vaultMode;
  }, [vaultMode]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeSeed: (() => void) | null = null;
    let localClient: CasinoClient | null = null;

    const init = async () => {
      try {
        setError(undefined);
        setStatusDetail(undefined);

        const identityHex = import.meta.env.VITE_IDENTITY as string | undefined;
        if (!identityHex) {
          setStatus('missing_identity');
          setStatusDetail(MISSING_IDENTITY_DETAIL);
          return;
        }

        if (!online) {
          setStatus('offline');
          setStatusDetail(OFFLINE_DETAIL);
          return;
        }

        setStatus('connecting');
        setVaultMode('unknown');

        const wasmWrapper = new WasmWrapper(identityHex);
        const casinoClient = new CasinoClient(baseUrl, wasmWrapper);
        localClient = casinoClient;
        await casinoClient.init();

        const kp = casinoClient.getOrCreateKeypair();
        if (!kp) {
          try {
            casinoClient.destroy?.();
          } catch {
            // ignore
          }
          let detail = VAULT_LOCKED_DETAIL;
          let nextVaultMode: VaultMode = 'locked';
          try {
            const record = await getVaultRecord();
            if (!record) {
              detail = VAULT_MISSING_DETAIL;
              nextVaultMode = 'missing';
            }
          } catch {
            // ignore vault record lookup failures
          }
          if (cancelled) return;
          setVaultMode(nextVaultMode);
          setStatus('vault_locked');
          setStatusDetail(detail);
          return;
        }

        setVaultMode('unlocked');
        await casinoClient.switchUpdates(kp.publicKey);
        await casinoClient.waitForFirstSeed?.().catch(() => undefined);

        const account = await casinoClient.getAccount(kp.publicKey);
        await casinoClient.initNonceManager(kp.publicKeyHex, kp.publicKey, account);

        if (cancelled) {
          try {
            casinoClient.destroy?.();
          } catch {
            // ignore
          }
          return;
        }

        clientRef.current = casinoClient;
        setWasm(wasmWrapper);
        setClient(casinoClient);
        setKeypair(kp);
        setCurrentView(casinoClient.getCurrentView?.() ?? null);
        setStatus('connected');

        unsubscribeSeed = (casinoClient.onEvent?.('Seed', () => {
          setCurrentView(casinoClient.getCurrentView?.() ?? null);
        }) ?? null) as (() => void) | null;
      } catch (e: any) {
        if (cancelled) return;
        try {
          localClient?.destroy?.();
        } catch {
          // ignore
        }
        console.error('[useCasinoConnection] init failed:', e);
        setStatus('error');
        setError(e?.message ?? String(e));
        setStatusDetail(ERROR_DETAIL);
      }
    };

    void init();

    return () => {
      cancelled = true;
      try {
        unsubscribeSeed?.();
      } catch {
        // ignore
      }
      unsubscribeSeed = null;
      try {
        clientRef.current?.destroy?.();
      } catch {
        // ignore
      }
      clientRef.current = null;
      setClient(null);
      setWasm(null);
      setKeypair(null);
      setCurrentView(null);
    };
  }, [baseUrl, online, refreshToken]);

  useEffect(() => {
    const unsubscribe = subscribeVault((vault) => {
      const unlocked = !!vault;
      if (!unlocked && vaultModeRef.current === 'missing') {
        return;
      }
      setVaultMode(unlocked ? 'unlocked' : 'locked');
      if (unlocked && statusRef.current === 'vault_locked') {
        setRefreshToken((token) => token + 1);
      }
    });
    return unsubscribe;
  }, []);

  const refreshOnce = useCallback(async () => {
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const onEvent = useCallback((name: string, handler: (evt: any) => void) => {
    const c: any = clientRef.current;
    if (!c?.onEvent) return () => undefined;
    return c.onEvent(name, handler);
  }, []);

  return { status, statusDetail, error, client, wasm, keypair, currentView, refreshOnce, onEvent, vaultMode };
}
