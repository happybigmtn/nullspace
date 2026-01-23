/**
 * ConfirmationWatcher - Polls backend for nonce confirmation
 *
 * Monitors pending transactions and confirms them when the on-chain
 * nonce advances past the expected value.
 */
import type { NonceManager } from './nonce.js';
import { logDebug, logWarn } from '../logger.js';

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_ENABLED = true;

function parsePositiveInt(input: string | undefined): number | null {
  if (!input) return null;
  const parsed = Number.parseInt(input.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface ConfirmationWatcherOptions {
  pollIntervalMs?: number;
  origin?: string;
  enabled?: boolean;
}

interface WatchedAccount {
  publicKeyHex: string;
  expectedNonce: bigint;
  lastPollAt: number;
}

export class ConfirmationWatcher {
  private nonceManager: NonceManager;
  private backendUrl: string;
  private origin: string;
  private pollIntervalMs: number;
  private enabled: boolean;
  private watching: Map<string, WatchedAccount> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    nonceManager: NonceManager,
    backendUrl: string,
    options: ConfirmationWatcherOptions = {}
  ) {
    this.nonceManager = nonceManager;
    this.backendUrl = backendUrl.replace(/\/$/, '');
    this.origin = options.origin ?? 'http://localhost:9010';
    this.pollIntervalMs = options.pollIntervalMs ??
      parsePositiveInt(process.env.GATEWAY_CONFIRMATION_POLL_INTERVAL_MS) ??
      DEFAULT_POLL_INTERVAL_MS;
    this.enabled = options.enabled ??
      (process.env.GATEWAY_MEMPOOL_AWARE_NONCE !== 'false') &&
      DEFAULT_ENABLED;

    if (this.enabled) {
      this.startPolling();
    }
  }

  /**
   * Watch for a specific nonce to be confirmed for an account
   */
  watchForConfirmation(publicKeyHex: string, expectedNonce: bigint): void {
    if (!this.enabled) return;

    const existing = this.watching.get(publicKeyHex);
    if (!existing || expectedNonce > existing.expectedNonce) {
      this.watching.set(publicKeyHex, {
        publicKeyHex,
        expectedNonce,
        lastPollAt: 0,
      });
      logDebug(`[ConfirmationWatcher] Watching ${publicKeyHex.slice(0, 8)} for nonce ${expectedNonce}`);
    }
  }

  /**
   * Stop watching an account
   */
  unwatchAccount(publicKeyHex: string): void {
    this.watching.delete(publicKeyHex);
  }

  /**
   * Start the polling loop
   */
  private startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => {
      this.pollAll();
    }, this.pollIntervalMs);

    logDebug(`[ConfirmationWatcher] Started polling every ${this.pollIntervalMs}ms`);
  }

  /**
   * Stop the polling loop
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.watching.clear();
  }

  /**
   * Poll all watched accounts
   */
  private async pollAll(): Promise<void> {
    const now = Date.now();

    for (const [publicKeyHex, watched] of this.watching.entries()) {
      // Skip if polled recently
      if (now - watched.lastPollAt < this.pollIntervalMs) {
        continue;
      }

      watched.lastPollAt = now;

      try {
        const onChainNonce = await this.fetchAccountNonce(publicKeyHex);
        if (onChainNonce !== null && onChainNonce >= watched.expectedNonce) {
          logDebug(
            `[ConfirmationWatcher] Confirmed nonce ${watched.expectedNonce} for ${publicKeyHex.slice(0, 8)} (on-chain: ${onChainNonce})`
          );
          // Notify the nonce manager
          this.nonceManager.onNonceConfirmed(publicKeyHex, watched.expectedNonce);
          // Update watched nonce in case there are more pending
          const pendingNonces = this.nonceManager.getPendingNonces(publicKeyHex);
          if (pendingNonces.length > 0) {
            const maxPending = pendingNonces.reduce((a, b) => a > b ? a : b);
            watched.expectedNonce = maxPending + 1n;
          } else {
            this.watching.delete(publicKeyHex);
          }
        }
      } catch (err) {
        logWarn(`[ConfirmationWatcher] Failed to poll ${publicKeyHex.slice(0, 8)}:`, err);
      }
    }
  }

  /**
   * Fetch the current nonce for an account from the backend
   */
  private async fetchAccountNonce(publicKeyHex: string): Promise<bigint | null> {
    try {
      const response = await fetch(`${this.backendUrl}/account/${publicKeyHex}`, {
        headers: {
          Origin: this.origin,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const account = await response.json();
      return BigInt(account.nonce ?? 0);
    } catch {
      return null;
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { watchedAccounts: number; enabled: boolean } {
    return {
      watchedAccounts: this.watching.size,
      enabled: this.enabled,
    };
  }
}
