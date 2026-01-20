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

export interface SubmitOptions {
  requestId?: string;
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
   * @param submission - The transaction bytes to submit
   * @param options - Optional submit options including requestId for correlation
   */
  async submit(submission: Uint8Array, options?: SubmitOptions): Promise<SubmitResult> {
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

    // Build headers with optional correlation ID
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Origin': this.origin,
    };
    if (options?.requestId) {
      headers['x-request-id'] = options.requestId;
    }

    try {
      const response = await fetch(`${this.baseUrl}/submit`, {
        method: 'POST',
        headers,
        body: Buffer.from(submission),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        if (options?.requestId) {
          logDebug('[SubmitClient] Transaction accepted', { requestId: options.requestId });
        } else {
          logDebug('[SubmitClient] Transaction accepted');
        }
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

      if (options?.requestId) {
        logWarn(`[SubmitClient] Transaction rejected: ${error}`, { requestId: options.requestId });
      } else {
        logWarn(`[SubmitClient] Transaction rejected: ${error}`);
      }
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
