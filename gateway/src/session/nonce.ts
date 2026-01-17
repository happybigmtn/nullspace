/**
 * Nonce management with recovery mechanism
 * Per-player nonce tracking to prevent replay attacks
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';

type NonceManagerOptions = {
  dataDir?: string;
  legacyPath?: string;
  origin?: string;
  minSyncIntervalMs?: number | string;
};

// Previously we used hardcoded nonce floors to bridge indexer lag in staging.
// They now drift far beyond live backend nonces and block submissions, so disable them.
const HARDCODED_FLOORS: Record<string, bigint> = {};

const DEFAULT_DATA_DIR = '.gateway-data';
const DEFAULT_NONCE_FILE = 'nonces.json';
const LEGACY_NONCE_FILE = '.gateway-nonces.json';
const DEFAULT_NONCE_SYNC_INTERVAL_MS = 5_000;

function parsePositiveInt(input: number | string | null | undefined): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? Math.floor(input) : null;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function resolveSyncIntervalMs(input?: number | string | null): number {
  const parsed = parsePositiveInt(input);
  return parsed ?? DEFAULT_NONCE_SYNC_INTERVAL_MS;
}

export class NonceManager {
  private nonces: Map<string, bigint> = new Map();
  private pending: Map<string, Set<bigint>> = new Map();
  private locks: Map<string, Promise<void>> = new Map();
  private persistPath: string;
  private dataDir: string;
  private legacyPath: string;
  private origin: string;
  private minSyncIntervalMs: number;
  private lastSync: Map<string, number> = new Map();

  constructor(options: NonceManagerOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? process.env.GATEWAY_DATA_DIR ?? DEFAULT_DATA_DIR);
    this.persistPath = join(this.dataDir, DEFAULT_NONCE_FILE);
    this.legacyPath = resolve(options.legacyPath ?? LEGACY_NONCE_FILE);
    this.origin = options.origin ?? 'http://localhost:9010';
    const syncIntervalInput =
      options.minSyncIntervalMs ?? process.env.GATEWAY_NONCE_SYNC_INTERVAL_MS ?? null;
    this.minSyncIntervalMs = resolveSyncIntervalMs(syncIntervalInput);
    this.ensureDataDir();
    this.migrateLegacyFile();
  }

  private ensureDataDir(): void {
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      }
      chmodSync(this.dataDir, 0o700);
    } catch (err) {
      console.error('Failed to prepare nonce data directory:', err);
    }
  }

  private migrateLegacyFile(): void {
    if (!existsSync(this.legacyPath) || existsSync(this.persistPath)) {
      return;
    }
    try {
      const legacyData = readFileSync(this.legacyPath, 'utf8');
      writeFileSync(this.persistPath, legacyData, { mode: 0o600 });
      chmodSync(this.persistPath, 0o600);
      unlinkSync(this.legacyPath);
    } catch (err) {
      console.warn('Failed to migrate legacy nonce file:', err);
    }
  }

  /**
   * Get current nonce and increment for next use
   * Marks nonce as pending until confirmed
   */
  getAndIncrement(publicKeyHex: string): bigint {
    const current = this.nonces.get(publicKeyHex) ?? 0n;
    this.nonces.set(publicKeyHex, current + 1n);

    // Track as pending until confirmed
    if (!this.pending.has(publicKeyHex)) {
      this.pending.set(publicKeyHex, new Set());
    }
    this.pending.get(publicKeyHex)!.add(current);

    return current;
  }

  /**
   * Get current nonce without incrementing
   */
  getCurrentNonce(publicKeyHex: string): bigint {
    return this.nonces.get(publicKeyHex) ?? 0n;
  }

  /**
   * Set current nonce explicitly (e.g., after sync or successful submission)
   */
  setCurrentNonce(publicKeyHex: string, nonce: bigint): void {
    this.nonces.set(publicKeyHex, nonce);
  }

  /**
   * Serialize nonce usage per public key to avoid concurrent nonce races
   */
  async withLock<T>(
    publicKeyHex: string,
    fn: (nonce: bigint) => Promise<T>
  ): Promise<T> {
    const pendingLock = this.locks.get(publicKeyHex);
    if (pendingLock) {
      await pendingLock;
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(publicKeyHex, lockPromise);

    try {
      return await fn(this.getCurrentNonce(publicKeyHex));
    } finally {
      this.locks.delete(publicKeyHex);
      releaseLock!();
    }
  }

  /**
   * Mark nonce as confirmed (received in block)
   */
  confirmNonce(publicKeyHex: string, nonce: bigint): void {
    const pendingSet = this.pending.get(publicKeyHex);
    if (pendingSet) {
      pendingSet.delete(nonce);
      if (pendingSet.size === 0) {
        this.pending.delete(publicKeyHex);
      }
    }
  }

  /**
   * Check if there are pending transactions for a key
   */
  hasPending(publicKeyHex: string): boolean {
    const pendingSet = this.pending.get(publicKeyHex);
    return pendingSet !== undefined && pendingSet.size > 0;
  }

  /**
   * Get all pending nonces for a key
   */
  getPendingNonces(publicKeyHex: string): bigint[] {
    const pendingSet = this.pending.get(publicKeyHex);
    return pendingSet ? Array.from(pendingSet) : [];
  }

  /**
   * Sync nonce from backend account state
   * Call this when nonce mismatch is detected
   */
  async syncFromBackend(publicKeyHex: string, backendUrl: string): Promise<boolean> {
    const floor = HARDCODED_FLOORS[publicKeyHex];
    try {
      const response = await fetch(`${backendUrl}/account/${publicKeyHex}`, {
        headers: {
          Origin: this.origin,
        },
      });
      if (response.ok) {
        const account = await response.json();
        let onChainNonce = BigInt(account.nonce);
        if (floor !== undefined && floor > onChainNonce) {
          onChainNonce = floor;
        }

        const current = this.nonces.get(publicKeyHex);
        if (current !== undefined) {
          const drift = current > onChainNonce ? current - onChainNonce : onChainNonce - current;
          // Large backwards drift (local >> onChain) indicates chain reset - prefer on-chain
          const CHAIN_RESET_THRESHOLD = 100n;
          if (current > onChainNonce && drift >= CHAIN_RESET_THRESHOLD) {
            console.warn(
              `Large nonce drift detected for ${publicKeyHex.slice(0, 8)}; resetting to on-chain nonce ${onChainNonce} (local was ${current}, drift=${drift})`
            );
            this.nonces.set(publicKeyHex, onChainNonce);
          } else if (current > onChainNonce) {
            // Small drift - likely indexer lag, keep local
            console.warn(
              `Backend nonce behind local for ${publicKeyHex.slice(0, 8)}; keeping local nonce ${current} (drift=${drift})`
            );
            this.nonces.set(publicKeyHex, current);
          } else {
            this.nonces.set(publicKeyHex, onChainNonce);
          }
        } else {
          // Set to on-chain nonce (transactions will use this + 1)
          this.nonces.set(publicKeyHex, onChainNonce);
        }
        // Clear pending - if tx was accepted, it's confirmed; if not, retry with new nonce
        this.pending.delete(publicKeyHex);

        return true;
      }
    } catch (err) {
      console.error(`Failed to sync nonce for ${publicKeyHex.slice(0, 8)}:`, err);
    }
    return false;
  }

  /**
   * Sync nonce from backend at a limited interval per public key.
   */
  async maybeSync(publicKeyHex: string, backendUrl: string): Promise<boolean> {
    const now = Date.now();
    const last = this.lastSync.get(publicKeyHex) ?? 0;
    if (now - last < this.minSyncIntervalMs) {
      return false;
    }
    this.lastSync.set(publicKeyHex, now);
    return this.syncFromBackend(publicKeyHex, backendUrl);
  }

  /**
   * Check if error indicates nonce mismatch
   */
  isNonceMismatch(error: string): boolean {
    const lowerError = error.toLowerCase();
    return ['nonce', 'invalidnonce', 'replay'].some(keyword => lowerError.includes(keyword));
  }

  /**
   * Handle transaction rejection
   * Returns true if nonce resync is needed
   */
  handleRejection(publicKeyHex: string, error: string): boolean {
    if (this.isNonceMismatch(error)) {
      // Clear pending for this key - need to resync
      this.pending.delete(publicKeyHex);
      return true;
    }
    return false;
  }

  /**
   * Reset nonce for a key (e.g., new player)
   */
  reset(publicKeyHex: string): void {
    this.nonces.delete(publicKeyHex);
    this.pending.delete(publicKeyHex);
  }

  /**
   * Persist nonces to disk for restart recovery
   */
  persist(): void {
    try {
      this.ensureDataDir();
      const data: Record<string, string> = {};
      for (const [k, v] of this.nonces.entries()) {
        data[k] = v.toString();
      }
      const tmpPath = `${this.persistPath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
      chmodSync(tmpPath, 0o600);
      renameSync(tmpPath, this.persistPath);
      chmodSync(this.persistPath, 0o600);
    } catch (err) {
      console.error('Failed to persist nonces:', err);
    }
  }

  /**
   * Restore nonces from disk
   */
  restore(): void {
    try {
      if (!existsSync(this.persistPath)) {
        return;
      }
      const data = JSON.parse(readFileSync(this.persistPath, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') {
          this.nonces.set(k, BigInt(v));
        }
      }
    } catch (err) {
      console.error('Failed to restore nonces:', err);
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { totalKeys: number; totalPending: number } {
    let totalPending = 0;
    for (const pendingSet of this.pending.values()) {
      totalPending += pendingSet.size;
    }
    return {
      totalKeys: this.nonces.size,
      totalPending,
    };
  }
}
