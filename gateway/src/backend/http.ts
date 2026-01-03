/**
 * HTTP client for submitting transactions to the backend
 */
import { logDebug, logWarn } from '../logger.js';

export interface SubmitResult {
  accepted: boolean;
  error?: string;
}

export interface SubmitClientOptions {
  submitTimeoutMs?: number;
  healthTimeoutMs?: number;
  accountTimeoutMs?: number;
  origin?: string;
  maxSubmissionBytes?: number;
}

export class SubmitClient {
  private baseUrl: string;
  private submitTimeoutMs: number;
  private healthTimeoutMs: number;
  private accountTimeoutMs: number;
  private origin: string;
  private maxSubmissionBytes: number | null;

  constructor(baseUrl: string, options: SubmitClientOptions = {}) {
    // Remove trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.submitTimeoutMs = options.submitTimeoutMs ?? 10_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
    this.accountTimeoutMs = options.accountTimeoutMs ?? 5_000;
    // Default origin for server-to-server requests (must match ALLOWED_HTTP_ORIGINS)
    this.origin = options.origin || 'http://localhost:9010';
    this.maxSubmissionBytes =
      typeof options.maxSubmissionBytes === 'number' && options.maxSubmissionBytes > 0
        ? Math.floor(options.maxSubmissionBytes)
        : null;
  }

  /**
   * Submit a transaction to the backend
   */
  async submit(submission: Uint8Array): Promise<SubmitResult> {
    if (
      this.maxSubmissionBytes !== null &&
      submission.length > this.maxSubmissionBytes
    ) {
      const error = `Submission too large (${submission.length} > ${this.maxSubmissionBytes} bytes)`;
      logWarn(`[SubmitClient] ${error}`);
      return { accepted: false, error };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.submitTimeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Origin': this.origin,
        },
        body: Buffer.from(submission),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        logDebug('[SubmitClient] Transaction accepted');
        return { accepted: true };
      }

      // Try to get error message from response
      let error = `HTTP ${response.status}`;
      try {
        const text = await response.text();
        if (text) error = text;
      } catch {
        // Ignore parse errors
      }

      logWarn(`[SubmitClient] Transaction rejected: ${error}`);
      return { accepted: false, error };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        return { accepted: false, error: 'Request timeout' };
      }

      return {
        accepted: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if backend is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/healthz`, {
        method: 'GET',
        headers: {
          'Origin': this.origin,
        },
        signal: AbortSignal.timeout(this.healthTimeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Query account state
   */
  async getAccount(publicKeyHex: string): Promise<{
    nonce: bigint;
    balance: bigint;
  } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/account/${publicKeyHex}`, {
        headers: {
          'Origin': this.origin,
        },
        signal: AbortSignal.timeout(this.accountTimeoutMs),
      });

      if (!response.ok) return null;

      const data = await response.json();
      return {
        nonce: BigInt(data.nonce || 0),
        balance: BigInt(data.balance || 0),
      };
    } catch {
      return null;
    }
  }
}
