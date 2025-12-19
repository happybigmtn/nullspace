import { useCallback, useEffect, useRef, useState } from 'react';
import { WasmWrapper } from '../api/wasm.js';
import { CasinoClient } from '../api/client.js';

export type ConnectionStatus = 'missing_identity' | 'vault_locked' | 'connecting' | 'connected' | 'error';

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
};

export function useCasinoConnection(baseUrl = '/api'): CasinoConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [client, setClient] = useState<CasinoClient | null>(null);
  const [wasm, setWasm] = useState<WasmWrapper | null>(null);
  const [keypair, setKeypair] = useState<{ publicKey: Uint8Array; publicKeyHex: string } | null>(null);
  const [currentView, setCurrentView] = useState<number | null>(null);

  const clientRef = useRef<CasinoClient | null>(null);

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
          setStatusDetail('Missing VITE_IDENTITY (see website/README.md).');
          return;
        }

        setStatus('connecting');

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
          setStatus('vault_locked');
          setStatusDetail('Unlock passkey vault (Vault tab).');
          return;
        }

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
        setStatusDetail('Failed to connect. Check simulator + dev-executor.');
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
  }, [baseUrl]);

  const refreshOnce = useCallback(async () => undefined, []);

  const onEvent = useCallback((name: string, handler: (evt: any) => void) => {
    const c: any = clientRef.current;
    if (!c?.onEvent) return () => undefined;
    return c.onEvent(name, handler);
  }, []);

  return { status, statusDetail, error, client, wasm, keypair, currentView, refreshOnce, onEvent };
}
