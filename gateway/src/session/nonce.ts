/**
 * Nonce management with recovery mechanism
 * Per-player nonce tracking to prevent replay attacks
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

export class NonceManager {
  private nonces: Map<string, bigint> = new Map();
  private pending: Map<string, Set<bigint>> = new Map();
  private locks: Map<string, Promise<void>> = new Map();
  private persistPath: string;

  constructor(persistPath: string = '.gateway-nonces.json') {
    this.persistPath = persistPath;
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
    try {
      const response = await fetch(`${backendUrl}/account/${publicKeyHex}`);
      if (response.ok) {
        const account = await response.json();
        const onChainNonce = BigInt(account.nonce);

        // Set to on-chain nonce (transactions will use this + 1)
        this.nonces.set(publicKeyHex, onChainNonce);
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
   * Check if error indicates nonce mismatch
   */
  isNonceMismatch(error: string): boolean {
    const lowerError = error.toLowerCase();
    return lowerError.includes('nonce') ||
           lowerError.includes('invalidnonce') ||
           lowerError.includes('replay');
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
      const data: Record<string, string> = {};
      for (const [k, v] of this.nonces.entries()) {
        data[k] = v.toString();
      }
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
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
