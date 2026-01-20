/**
 * useWalletConnection - Unified wallet connection and session persistence hook (AC-8.1)
 *
 * Combines vault status, gateway session, and network state into a single interface.
 * Provides session persistence across app restarts via secure storage.
 *
 * ## Session Persistence Strategy
 *
 * The mobile wallet connection uses a layered persistence model:
 *
 * 1. **Vault Layer** (Long-term): Ed25519 keypair encrypted with user password
 *    - Survives app reinstalls (if user imports recovery key)
 *    - Requires explicit unlock after app restart
 *
 * 2. **Session Layer** (Medium-term): Active session state
 *    - Persisted to MMKV/SecureStore
 *    - Auto-restored on app restart if vault is unlocked
 *    - Expires after 24 hours (configured in AuthContext)
 *
 * 3. **Connection Layer** (Short-term): WebSocket connection state
 *    - Reconnects automatically on network recovery
 *    - Lost on app termination (reconnects on restart)
 *
 * ## State Machine
 *
 * ```
 * DISCONNECTED -> VAULT_LOCKED -> CONNECTING -> CONNECTED
 *       ^              |               |            |
 *       |              v               v            v
 *       +-------- VAULT_MISSING <----- ERROR ------+
 * ```
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useGameStore } from '../stores/gameStore';
import {
  getVaultStatus,
  unlockPasswordVault,
  isVaultEnabled,
  lockVault,
  getVaultCorruptionGuidance,
  type VaultCorruptionReason,
} from '../services/vault';
import {
  getString,
  setString,
  deleteKey,
  STORAGE_KEYS,
  initializeStorage,
} from '../services/storage';

/**
 * Connection status for the wallet.
 * Derived from vault state, auth state, and WebSocket connection.
 */
export type WalletConnectionStatus =
  | 'disconnected'      // No active session
  | 'vault_missing'     // No vault created yet
  | 'vault_locked'      // Vault exists but needs password
  | 'vault_corrupted'   // Vault data is corrupted
  | 'connecting'        // WebSocket connecting
  | 'connected'         // Fully connected and ready
  | 'offline'           // Network unavailable
  | 'error';            // Connection error

/**
 * Wallet connection state returned by the hook.
 */
export interface WalletConnectionState {
  /** Current connection status */
  status: WalletConnectionStatus;
  /** Public key hex string (null if vault not unlocked) */
  publicKey: string | null;
  /** Current balance (0 if not connected) */
  balance: number;
  /** True if balance has been fetched from server */
  balanceReady: boolean;
  /** True if user is registered on the server */
  registered: boolean;
  /** Error message if status is 'error' or 'vault_corrupted' */
  errorMessage: string | null;
  /** Vault corruption reason if applicable */
  vaultCorruptionReason: VaultCorruptionReason;
  /** True if session was restored from storage */
  sessionRestored: boolean;
  /** Session ID from gateway (null if not connected) */
  sessionId: string | null;
}

/**
 * Wallet connection actions returned by the hook.
 */
export interface WalletConnectionActions {
  /** Unlock the vault with password and connect */
  unlockAndConnect: (password: string) => Promise<void>;
  /** Disconnect and lock the vault */
  disconnectAndLock: () => Promise<void>;
  /** Reconnect to the gateway (after network recovery) */
  reconnect: () => void;
  /** Refresh balance from server */
  refreshBalance: () => void;
}

// Storage key for persisted session data
const SESSION_PUBLIC_KEY = 'wallet.public_key';

/**
 * Hook for managing wallet connection and session persistence.
 *
 * @example
 * ```tsx
 * function WalletScreen() {
 *   const { state, actions } = useWalletConnection();
 *
 *   if (state.status === 'vault_locked') {
 *     return <UnlockVaultScreen onUnlock={actions.unlockAndConnect} />;
 *   }
 *
 *   if (state.status === 'connected') {
 *     return <WalletBalance balance={state.balance} />;
 *   }
 *
 *   return <LoadingScreen />;
 * }
 * ```
 */
export function useWalletConnection(): {
  state: WalletConnectionState;
  actions: WalletConnectionActions;
} {
  const { isAuthenticated, logout } = useAuth();
  const {
    connectionState: wsConnectionState,
    send,
    reconnect: wsReconnect,
    disconnect: wsDisconnect,
    isConnected: wsIsConnected,
  } = useWebSocketContext();

  // Game store state
  const balance = useGameStore((s) => s.balance);
  const balanceReady = useGameStore((s) => s.balanceReady);
  const sessionId = useGameStore((s) => s.sessionId);
  const publicKey = useGameStore((s) => s.publicKey);
  const registered = useGameStore((s) => s.registered);
  const clearSession = useGameStore((s) => s.clearSession);

  // Local state for vault and session
  const [vaultStatus, setVaultStatus] = useState<{
    enabled: boolean;
    unlocked: boolean;
    publicKeyHex: string | null;
    corrupted: VaultCorruptionReason;
  }>({ enabled: false, unlocked: false, publicKeyHex: null, corrupted: null });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize vault status and check for persisted session
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await initializeStorage();
        const status = await getVaultStatus();
        if (mounted) {
          setVaultStatus(status);

          // Check if we have a persisted session to restore
          const persistedPublicKey = getString(SESSION_PUBLIC_KEY, '');
          if (persistedPublicKey && status.unlocked && status.publicKeyHex === persistedPublicKey) {
            setSessionRestored(true);
          }

          setIsInitialized(true);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to initialize wallet'
          );
          setIsInitialized(true);
        }
      }
    }

    void init();

    return () => {
      mounted = false;
    };
  }, []);

  // Refresh vault status when app returns to foreground
  useEffect(() => {
    function handleAppStateChange(nextState: AppStateStatus) {
      if (nextState === 'active') {
        void getVaultStatus().then(setVaultStatus);
      }
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  // Derive connection status from all state sources
  const status = useMemo((): WalletConnectionStatus => {
    if (!isInitialized) {
      return 'disconnected';
    }

    // Check vault state first
    if (vaultStatus.corrupted) {
      return 'vault_corrupted';
    }

    if (!vaultStatus.enabled) {
      return 'vault_missing';
    }

    if (!vaultStatus.unlocked) {
      return 'vault_locked';
    }

    // Vault is unlocked, check connection state
    if (!isAuthenticated) {
      return 'disconnected';
    }

    if (errorMessage) {
      return 'error';
    }

    // Map WebSocket state
    switch (wsConnectionState) {
      case 'connecting':
        return 'connecting';
      case 'connected':
        return 'connected';
      case 'failed':
        return 'error';
      case 'disconnected':
      default:
        return 'offline';
    }
  }, [isInitialized, vaultStatus, isAuthenticated, errorMessage, wsConnectionState]);

  // Build error message from various sources
  const displayError = useMemo(() => {
    if (vaultStatus.corrupted) {
      return getVaultCorruptionGuidance(vaultStatus.corrupted);
    }
    return errorMessage;
  }, [vaultStatus.corrupted, errorMessage]);

  // Actions
  const unlockAndConnect = useCallback(async (password: string) => {
    setErrorMessage(null);

    try {
      // Unlock vault
      const unlockedPublicKey = await unlockPasswordVault(password);

      // Persist session for restoration on restart
      setString(SESSION_PUBLIC_KEY, unlockedPublicKey);

      // Update vault status
      const newStatus = await getVaultStatus();
      setVaultStatus(newStatus);

      // The WebSocket connection will start automatically via WebSocketProvider
      // and useGatewaySession will handle session_ready message
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to unlock vault';
      setErrorMessage(message);
      throw error;
    }
  }, []);

  const disconnectAndLock = useCallback(async () => {
    // Clear persisted session
    deleteKey(SESSION_PUBLIC_KEY);

    // Disconnect WebSocket
    wsDisconnect();

    // Clear game store state
    clearSession();

    // Lock vault
    lockVault();

    // Update vault status
    const newStatus = await getVaultStatus();
    setVaultStatus(newStatus);

    // Logout from auth context
    await logout();

    setErrorMessage(null);
    setSessionRestored(false);
  }, [wsDisconnect, clearSession, logout]);

  const reconnect = useCallback(() => {
    setErrorMessage(null);
    wsReconnect();
  }, [wsReconnect]);

  const refreshBalance = useCallback(() => {
    if (wsIsConnected) {
      send({ type: 'get_balance' });
    }
  }, [wsIsConnected, send]);

  // Build state object
  const state: WalletConnectionState = useMemo(
    () => ({
      status,
      publicKey: vaultStatus.publicKeyHex ?? publicKey,
      balance,
      balanceReady,
      registered,
      errorMessage: displayError,
      vaultCorruptionReason: vaultStatus.corrupted,
      sessionRestored,
      sessionId,
    }),
    [
      status,
      vaultStatus.publicKeyHex,
      publicKey,
      balance,
      balanceReady,
      registered,
      displayError,
      vaultStatus.corrupted,
      sessionRestored,
      sessionId,
    ]
  );

  // Build actions object
  const actions: WalletConnectionActions = useMemo(
    () => ({
      unlockAndConnect,
      disconnectAndLock,
      reconnect,
      refreshBalance,
    }),
    [unlockAndConnect, disconnectAndLock, reconnect, refreshBalance]
  );

  return { state, actions };
}
