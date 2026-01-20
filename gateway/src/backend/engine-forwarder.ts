/**
 * Engine Forwarder with Retries and Idempotency Keys (AC-3.5)
 *
 * Provides reliable forwarding of bet intents to the table engine with:
 * - Idempotency key generation and tracking to prevent duplicate submissions
 * - Retry logic with exponential backoff for transient failures
 * - Request deduplication for client retries
 */
import { SubmitClient, type SubmitResult, type SubmitOptions } from './http.js';
import { generateSecureId } from '../utils/crypto.js';
import { logDebug, logInfo, logWarn, logError } from '../logger.js';

/** Default configuration for engine forwarding */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 100;
const DEFAULT_MAX_BACKOFF_MS = 2000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

/** Result status for idempotency tracking */
export type IdempotencyStatus = 'pending' | 'completed' | 'failed';

/** Tracked idempotency entry */
export interface IdempotencyEntry {
  key: string;
  status: IdempotencyStatus;
  result?: SubmitResult;
  createdAt: number;
  completedAt?: number;
  requestHash: string;
}

/** Options for engine forwarding */
export interface EngineForwarderOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in ms (default: 100) */
  initialBackoffMs?: number;
  /** Maximum backoff delay in ms (default: 2000) */
  maxBackoffMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** How long to track idempotency keys in ms (default: 5 minutes) */
  idempotencyTtlMs?: number;
  /** Cleanup interval for expired entries in ms (default: 1 minute) */
  cleanupIntervalMs?: number;
}

/** Options for a single forward request */
export interface ForwardOptions extends SubmitOptions {
  /** Client-provided idempotency key (optional, will be generated if not provided) */
  idempotencyKey?: string;
  /** Session ID for scoping idempotency (required) */
  sessionId: string;
  /** Whether to skip retries for this request */
  skipRetries?: boolean;
}

/** Result of a forward operation */
export interface ForwardResult extends SubmitResult {
  /** Idempotency key used for this request */
  idempotencyKey: string;
  /** Whether this was a duplicate request */
  deduplicated: boolean;
  /** Number of retries attempted */
  retryCount: number;
}

/**
 * Engine Forwarder - Handles reliable bet intent forwarding with retries and idempotency
 */
export class EngineForwarder {
  private submitClient: SubmitClient;
  private options: Required<EngineForwarderOptions>;
  private idempotencyStore: Map<string, IdempotencyEntry>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(submitClient: SubmitClient, options: EngineForwarderOptions = {}) {
    this.submitClient = submitClient;
    this.options = {
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      initialBackoffMs: options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      backoffMultiplier: options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER,
      idempotencyTtlMs: options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS,
      cleanupIntervalMs: options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
    };
    this.idempotencyStore = new Map();
    this.startCleanupTimer();
  }

  /**
   * Forward a bet intent to the engine with retries and idempotency
   *
   * @param submission - The transaction bytes to submit
   * @param options - Forward options including idempotency key and session ID
   * @returns Forward result with idempotency info
   */
  async forward(submission: Uint8Array, options: ForwardOptions): Promise<ForwardResult> {
    const { sessionId, requestId, skipRetries } = options;

    // Generate request hash for duplicate detection
    const requestHash = this.hashRequest(sessionId, submission);

    // Generate or use provided idempotency key
    const idempotencyKey = options.idempotencyKey ?? this.generateIdempotencyKey(sessionId);
    const storeKey = this.buildStoreKey(sessionId, idempotencyKey);

    // Check for existing request with same idempotency key
    const existing = this.idempotencyStore.get(storeKey);
    if (existing) {
      // Same idempotency key - check if it's for the same request
      if (existing.requestHash === requestHash) {
        // Same request - return cached result or wait for pending
        if (existing.status === 'completed' && existing.result) {
          logDebug(`[EngineForwarder] Returning cached result for idempotency key ${idempotencyKey}`, {
            requestId,
            sessionId,
          });
          return {
            ...existing.result,
            idempotencyKey,
            deduplicated: true,
            retryCount: 0,
          };
        } else if (existing.status === 'pending') {
          // Request still in flight - this shouldn't normally happen with WebSockets
          // but we'll return a temporary error
          logWarn(`[EngineForwarder] Request still pending for idempotency key ${idempotencyKey}`, {
            requestId,
            sessionId,
          });
          return {
            accepted: false,
            error: 'Request in progress',
            idempotencyKey,
            deduplicated: true,
            retryCount: 0,
          };
        }
        // Status is 'failed' - fall through to retry
      } else {
        // Different request with same idempotency key - reject
        logWarn(`[EngineForwarder] Idempotency key reuse with different request`, {
          requestId,
          sessionId,
          idempotencyKey,
        });
        return {
          accepted: false,
          error: 'Idempotency key already used for a different request',
          idempotencyKey,
          deduplicated: false,
          retryCount: 0,
        };
      }
    }

    // Create pending entry
    const entry: IdempotencyEntry = {
      key: idempotencyKey,
      status: 'pending',
      createdAt: Date.now(),
      requestHash,
    };
    this.idempotencyStore.set(storeKey, entry);

    // Execute with retries
    const maxRetries = skipRetries ? 0 : this.options.maxRetries;
    let lastError: string | undefined;
    let retryCount = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = this.calculateBackoff(attempt);
        logDebug(`[EngineForwarder] Retry attempt ${attempt}/${maxRetries} after ${backoff}ms`, {
          requestId,
          sessionId,
          idempotencyKey,
        });
        await this.sleep(backoff);
        retryCount++;
      }

      try {
        const result = await this.submitClient.submit(submission, { requestId });

        if (result.accepted) {
          // Success - update entry
          entry.status = 'completed';
          entry.result = result;
          entry.completedAt = Date.now();
          logDebug(`[EngineForwarder] Request accepted on attempt ${attempt + 1}`, {
            requestId,
            sessionId,
            idempotencyKey,
          });
          return {
            ...result,
            idempotencyKey,
            deduplicated: false,
            retryCount,
          };
        }

        // Check if error is retryable
        if (!this.isRetryableError(result.error)) {
          // Non-retryable error - mark as failed and return
          entry.status = 'failed';
          entry.result = result;
          entry.completedAt = Date.now();
          logDebug(`[EngineForwarder] Non-retryable error: ${result.error}`, {
            requestId,
            sessionId,
            idempotencyKey,
          });
          return {
            ...result,
            idempotencyKey,
            deduplicated: false,
            retryCount,
          };
        }

        lastError = result.error;
      } catch (err) {
        // Network or unexpected error
        lastError = err instanceof Error ? err.message : 'Unknown error';
        logWarn(`[EngineForwarder] Attempt ${attempt + 1} failed: ${lastError}`, {
          requestId,
          sessionId,
          idempotencyKey,
        });
      }
    }

    // All retries exhausted
    entry.status = 'failed';
    entry.result = { accepted: false, error: lastError ?? 'Max retries exceeded' };
    entry.completedAt = Date.now();
    logWarn(`[EngineForwarder] Request failed after ${retryCount} retries`, {
      requestId,
      sessionId,
      idempotencyKey,
      lastError,
    });

    return {
      accepted: false,
      error: lastError ?? 'Max retries exceeded',
      idempotencyKey,
      deduplicated: false,
      retryCount,
    };
  }

  /**
   * Check if a request with the given idempotency key exists
   */
  hasIdempotencyKey(sessionId: string, idempotencyKey: string): boolean {
    return this.idempotencyStore.has(this.buildStoreKey(sessionId, idempotencyKey));
  }

  /**
   * Get the status of a request by idempotency key
   */
  getIdempotencyStatus(sessionId: string, idempotencyKey: string): IdempotencyEntry | undefined {
    return this.idempotencyStore.get(this.buildStoreKey(sessionId, idempotencyKey));
  }

  /**
   * Get metrics about the idempotency store
   */
  getMetrics(): {
    totalEntries: number;
    pendingEntries: number;
    completedEntries: number;
    failedEntries: number;
  } {
    let pending = 0;
    let completed = 0;
    let failed = 0;

    for (const entry of this.idempotencyStore.values()) {
      switch (entry.status) {
        case 'pending':
          pending++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    return {
      totalEntries: this.idempotencyStore.size,
      pendingEntries: pending,
      completedEntries: completed,
      failedEntries: failed,
    };
  }

  /**
   * Clear all idempotency entries for a session (e.g., on disconnect)
   */
  clearSession(sessionId: string): number {
    let cleared = 0;
    const prefix = `${sessionId}:`;
    for (const key of this.idempotencyStore.keys()) {
      if (key.startsWith(prefix)) {
        this.idempotencyStore.delete(key);
        cleared++;
      }
    }
    if (cleared > 0) {
      logDebug(`[EngineForwarder] Cleared ${cleared} idempotency entries for session ${sessionId}`);
    }
    return cleared;
  }

  /**
   * Stop the cleanup timer (call on shutdown)
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.idempotencyStore.clear();
  }

  // Private methods

  private generateIdempotencyKey(sessionId: string): string {
    // Generate a unique key with session context and timestamp for readability
    return generateSecureId(`idem-${sessionId.slice(0, 8)}`);
  }

  private buildStoreKey(sessionId: string, idempotencyKey: string): string {
    return `${sessionId}:${idempotencyKey}`;
  }

  private hashRequest(sessionId: string, submission: Uint8Array): string {
    // Simple hash using session ID and submission bytes
    // For production, consider using a proper hash function
    let hash = 0;
    for (let i = 0; i < submission.length; i++) {
      hash = ((hash << 5) - hash + submission[i]) | 0;
    }
    return `${sessionId}:${hash.toString(16)}:${submission.length}`;
  }

  private isRetryableError(error?: string): boolean {
    if (!error) return false;

    // Network/timeout errors are retryable
    const retryablePatterns = [
      'timeout',
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'network',
      'socket hang up',
      '502',
      '503',
      '504',
    ];

    const lowerError = error.toLowerCase();
    return retryablePatterns.some(pattern =>
      lowerError.includes(pattern.toLowerCase())
    );
  }

  private calculateBackoff(attempt: number): number {
    const backoff = this.options.initialBackoffMs * Math.pow(this.options.backoffMultiplier, attempt - 1);
    // Add jitter (±10%)
    const jitter = backoff * 0.1 * (Math.random() * 2 - 1);
    return Math.min(Math.floor(backoff + jitter), this.options.maxBackoffMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, this.options.cleanupIntervalMs);
    // Don't block process exit
    this.cleanupTimer.unref?.();
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.idempotencyStore.entries()) {
      const age = now - entry.createdAt;
      if (age > this.options.idempotencyTtlMs) {
        this.idempotencyStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logDebug(`[EngineForwarder] Cleaned up ${cleaned} expired idempotency entries`);
    }
  }
}
