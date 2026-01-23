/**
 * Nonce management with confirmation tracking
 * Per-player nonce tracking to prevent replay attacks and transaction ordering issues
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

export type NonceManagerOptions = {
  dataDir?: string;
  legacyPath?: string;
  origin?: string;
  minSyncIntervalMs?: number | string;
  confirmationTimeoutMs?: number;
  maxQueueDepth?: number;
};

export interface SubmitResult {
  accepted: boolean;
  error?: string;
}

interface PendingTransaction {
  nonce: bigint;
  submittedAt: number;
  timeoutMs: number;
  resolve: (confirmed: boolean) => void;
}

interface TransactionQueue {
  pending: PendingTransaction[];
  processing: boolean;
}

// Previously we used hardcoded nonce floors to bridge indexer lag in staging.
// They now drift far beyond live backend nonces and block submissions, so disable them.
const HARDCODED_FLOORS: Record<string, bigint> = {};

const DEFAULT_DATA_DIR = '.gateway-data';
const DEFAULT_NONCE_FILE = 'nonces.json';
const LEGACY_NONCE_FILE = '.gateway-nonces.json';
const DEFAULT_NONCE_SYNC_INTERVAL_MS = 5_000;
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_QUEUE_DEPTH = 10;

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

  // Confirmation tracking
  private confirmationTimeoutMs: number;
  private maxQueueDepth: number;
  private txQueues: Map<string, TransactionQueue> = new Map();
  private confirmationCallbacks: Map<string, Map<bigint, PendingTransaction>> = new Map();
  private timeoutCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: NonceManagerOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? process.env.GATEWAY_DATA_DIR ?? DEFAULT_DATA_DIR);
    this.persistPath = join(this.dataDir, DEFAULT_NONCE_FILE);
    this.legacyPath = resolve(options.legacyPath ?? LEGACY_NONCE_FILE);
    this.origin = options.origin ?? 'http://localhost:9010';
    const syncIntervalInput =
      options.minSyncIntervalMs ?? process.env.GATEWAY_NONCE_SYNC_INTERVAL_MS ?? null;
    this.minSyncIntervalMs = resolveSyncIntervalMs(syncIntervalInput);

    // Confirmation tracking config
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ??
      parsePositiveInt(process.env.GATEWAY_TX_CONFIRMATION_TIMEOUT_MS) ??
      DEFAULT_CONFIRMATION_TIMEOUT_MS;
    this.maxQueueDepth = options.maxQueueDepth ??
      parsePositiveInt(process.env.GATEWAY_TX_QUEUE_DEPTH) ??
      DEFAULT_MAX_QUEUE_DEPTH;

    this.ensureDataDir();
    this.migrateLegacyFile();
    this.startTimeoutChecker();
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

  private startTimeoutChecker(): void {
    // Check for timed out transactions every second
    this.timeoutCheckInterval = setInterval(() => {
      this.checkTimeouts();
    }, 1000);
  }

  /**
   * Stop the timeout checker (for cleanup)
   */
  stopTimeoutChecker(): void {
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
      this.timeoutCheckInterval = null;
    }
  }

  /**
   * Check and process timed-out transactions
   */
  checkTimeouts(): void {
    const now = Date.now();
    for (const [publicKeyHex, nonceMap] of this.confirmationCallbacks.entries()) {
      for (const [nonce, pending] of nonceMap.entries()) {
        if (now - pending.submittedAt > pending.timeoutMs) {
          console.warn(
            `Transaction timeout for ${publicKeyHex.slice(0, 8)} nonce=${nonce}, waited ${pending.timeoutMs}ms`
          );
          nonceMap.delete(nonce);
          pending.resolve(false); // Timeout = not confirmed
        }
      }
      if (nonceMap.size === 0) {
        this.confirmationCallbacks.delete(publicKeyHex);
      }
    }
  }

  /**
   * Submit a transaction and wait for confirmation before returning.
   * This ensures proper nonce ordering by blocking subsequent transactions.
   *
   * @param publicKeyHex - Account public key
   * @param submit - Function that submits the transaction
   * @param backendUrl - Backend URL for nonce sync on failure
   * @returns Submit result with confirmation status
   */
  async submitAndWaitForConfirmation(
    publicKeyHex: string,
    submit: (nonce: bigint) => Promise<SubmitResult>,
    backendUrl: string
  ): Promise<SubmitResult> {
    // Get or create queue for this account
    let queue = this.txQueues.get(publicKeyHex);
    if (!queue) {
      queue = { pending: [], processing: false };
      this.txQueues.set(publicKeyHex, queue);
    }

    // Check queue depth
    if (queue.pending.length >= this.maxQueueDepth) {
      return {
        accepted: false,
        error: `Transaction queue full (${this.maxQueueDepth} pending)`,
      };
    }

    // Create a promise that will be resolved when it's our turn
    return new Promise((resolve) => {
      const processThis = async () => {
        try {
          const result = await this.executeSubmission(publicKeyHex, submit, backendUrl);
          resolve(result);
        } finally {
          // Process next in queue
          this.processNextInQueue(publicKeyHex);
        }
      };

      // If no transactions are processing, start immediately
      if (!queue!.processing) {
        queue!.processing = true;
        processThis();
      } else {
        // Queue this transaction
        queue!.pending.push({
          nonce: 0n, // Will be set when processing
          submittedAt: Date.now(),
          timeoutMs: this.confirmationTimeoutMs,
          resolve: () => processThis(),
        });
      }
    });
  }

  private processNextInQueue(publicKeyHex: string): void {
    const queue = this.txQueues.get(publicKeyHex);
    if (!queue) return;

    const next = queue.pending.shift();
    if (next) {
      next.resolve(true);
    } else {
      queue.processing = false;
    }
  }

  private async executeSubmission(
    publicKeyHex: string,
    submit: (nonce: bigint) => Promise<SubmitResult>,
    backendUrl: string
  ): Promise<SubmitResult> {
    // Sync nonce before submission
    await this.maybeSync(publicKeyHex, backendUrl);

    const nonceBefore = this.getCurrentNonce(publicKeyHex);
    const nonce = this.getAndIncrement(publicKeyHex);
    console.log(`[NonceManager] executeSubmission for ${publicKeyHex.slice(0, 8)}: nonce=${nonce} (was ${nonceBefore})`);

    // Set up confirmation callback BEFORE submitting to avoid race condition
    // where ConfirmationWatcher confirms before callback exists
    const confirmationPromise = this.setupConfirmationCallback(publicKeyHex, nonce);

    const result = await submit(nonce);

    if (!result.accepted) {
      // Cancel the confirmation callback since tx wasn't accepted
      this.cancelConfirmationCallback(publicKeyHex, nonce);

      // On rejection, check if it's a nonce error and resync
      if (result.error && this.handleRejection(publicKeyHex, result.error)) {
        // Resync and retry once
        const synced = await this.syncFromBackend(publicKeyHex, backendUrl);
        if (synced) {
          const retryNonce = this.getAndIncrement(publicKeyHex);
          // Set up callback for retry
          const retryConfirmationPromise = this.setupConfirmationCallback(publicKeyHex, retryNonce);
          const retryResult = await submit(retryNonce);
          if (retryResult.accepted) {
            // Wait for confirmation
            const confirmed = await retryConfirmationPromise;
            return { accepted: true, error: confirmed ? undefined : 'Confirmation timeout' };
          }
          // Cancel retry callback if not accepted
          this.cancelConfirmationCallback(publicKeyHex, retryNonce);
          return retryResult;
        }
      }
      return result;
    }

    // Wait for confirmation (callback already set up before submit)
    const confirmed = await confirmationPromise;
    if (!confirmed) {
      // Confirmation timed out, but transaction was accepted
      // The transaction might still be pending in mempool
      console.warn(
        `Confirmation timeout for ${publicKeyHex.slice(0, 8)} nonce=${nonce}, proceeding anyway`
      );
    }

    return { accepted: true };
  }

  /**
   * Set up a confirmation callback for a nonce BEFORE submitting.
   * Returns a promise that resolves when the nonce is confirmed.
   */
  private setupConfirmationCallback(publicKeyHex: string, nonce: bigint): Promise<boolean> {
    return new Promise((resolve) => {
      let nonceMap = this.confirmationCallbacks.get(publicKeyHex);
      if (!nonceMap) {
        nonceMap = new Map();
        this.confirmationCallbacks.set(publicKeyHex, nonceMap);
      }

      const pending: PendingTransaction = {
        nonce,
        submittedAt: Date.now(),
        timeoutMs: this.confirmationTimeoutMs,
        resolve,
      };

      nonceMap.set(nonce, pending);
    });
  }

  /**
   * Cancel a confirmation callback (e.g., if transaction was rejected).
   */
  private cancelConfirmationCallback(publicKeyHex: string, nonce: bigint): void {
    const nonceMap = this.confirmationCallbacks.get(publicKeyHex);
    if (nonceMap) {
      const pending = nonceMap.get(nonce);
      if (pending) {
        nonceMap.delete(nonce);
        pending.resolve(false); // Resolve as not confirmed
      }
      if (nonceMap.size === 0) {
        this.confirmationCallbacks.delete(publicKeyHex);
      }
    }
  }

  /**
   * Wait for a specific nonce to be confirmed.
   * @deprecated Use setupConfirmationCallback before submitting instead.
   */
  private waitForConfirmation(publicKeyHex: string, nonce: bigint): Promise<boolean> {
    // Check if callback was already set up (preferred flow)
    const existingMap = this.confirmationCallbacks.get(publicKeyHex);
    if (existingMap?.has(nonce)) {
      // Callback already exists, return a promise that waits for it
      const pending = existingMap.get(nonce)!;
      return new Promise((resolve) => {
        // Replace the resolve function to capture the result
        const originalResolve = pending.resolve;
        pending.resolve = (confirmed: boolean) => {
          originalResolve(confirmed);
          resolve(confirmed);
        };
      });
    }
    // Fallback: set up callback now (but this has race condition risk)
    return this.setupConfirmationCallback(publicKeyHex, nonce);
  }

  /**
   * Notify that a nonce was confirmed (called from updates watcher or polling)
   * This unblocks any transaction waiting for this nonce.
   */
  onNonceConfirmed(publicKeyHex: string, confirmedNonce: bigint): void {
    const nonceMap = this.confirmationCallbacks.get(publicKeyHex);
    if (!nonceMap) return;

    // Confirm this nonce and all lower nonces (in case we missed some)
    for (const [nonce, pending] of nonceMap.entries()) {
      if (nonce <= confirmedNonce) {
        nonceMap.delete(nonce);
        pending.resolve(true);
        this.confirmNonce(publicKeyHex, nonce);
      }
    }

    if (nonceMap.size === 0) {
      this.confirmationCallbacks.delete(publicKeyHex);
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
   * Serialize nonce usage per public key to avoid concurrent nonce races.
   * Also waits for any pending confirmation from submitAndWaitForConfirmation.
   */
  async withLock<T>(
    publicKeyHex: string,
    fn: (nonce: bigint) => Promise<T>
  ): Promise<T> {
    // Wait for any pending confirmations first
    // This ensures the nonce we use is actually the next expected one on-chain
    await this.waitForPendingConfirmations(publicKeyHex);

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
   * Wait for any pending confirmations before proceeding.
   * This ensures that withLock properly coordinates with submitAndWaitForConfirmation.
   */
  private async waitForPendingConfirmations(publicKeyHex: string): Promise<void> {
    // Check if there are pending confirmations (transactions submitted but not confirmed)
    const nonceMap = this.confirmationCallbacks.get(publicKeyHex);
    if (!nonceMap || nonceMap.size === 0) {
      // Also check the queue
      const queue = this.txQueues.get(publicKeyHex);
      if (!queue || !queue.processing) {
        return;
      }
    }

    // Wait until all pending confirmations are resolved
    const startTime = Date.now();
    const maxWaitMs = this.confirmationTimeoutMs + 5000;

    while (Date.now() - startTime < maxWaitMs) {
      const nonceMapCheck = this.confirmationCallbacks.get(publicKeyHex);
      const queueCheck = this.txQueues.get(publicKeyHex);

      const hasPendingConfirmations = nonceMapCheck && nonceMapCheck.size > 0;
      const hasProcessingQueue = queueCheck && queueCheck.processing;

      if (!hasPendingConfirmations && !hasProcessingQueue) {
        return; // All clear
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.warn(
      `[NonceManager] Timeout waiting for pending confirmations for ${publicKeyHex.slice(0, 8)}`
    );
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
        // Always trust on-chain nonce - it's the source of truth
        // Previous logic that kept local nonce when ahead caused nonce_too_high errors
        // because registration tx hadn't confirmed yet but local was incremented
        if (current !== undefined && current !== onChainNonce) {
          console.log(
            `Nonce sync for ${publicKeyHex.slice(0, 8)}: local=${current} -> on-chain=${onChainNonce}`
          );
        }
        this.nonces.set(publicKeyHex, onChainNonce);

        // Confirm all nonces up to on-chain nonce
        this.onNonceConfirmed(publicKeyHex, onChainNonce - 1n);

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
    this.txQueues.delete(publicKeyHex);

    // Resolve any pending confirmations
    const nonceMap = this.confirmationCallbacks.get(publicKeyHex);
    if (nonceMap) {
      for (const pending of nonceMap.values()) {
        pending.resolve(false);
      }
      this.confirmationCallbacks.delete(publicKeyHex);
    }
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
  getStats(): {
    totalKeys: number;
    totalPending: number;
    totalQueued: number;
    totalWaitingConfirmation: number;
  } {
    let totalPending = 0;
    for (const pendingSet of this.pending.values()) {
      totalPending += pendingSet.size;
    }

    let totalQueued = 0;
    for (const queue of this.txQueues.values()) {
      totalQueued += queue.pending.length;
    }

    let totalWaitingConfirmation = 0;
    for (const nonceMap of this.confirmationCallbacks.values()) {
      totalWaitingConfirmation += nonceMap.size;
    }

    return {
      totalKeys: this.nonces.size,
      totalPending,
      totalQueued,
      totalWaitingConfirmation,
    };
  }
}
