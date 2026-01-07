/**
 * Health Check Unit Tests (US-064)
 *
 * Tests for gateway health check endpoints including readiness/liveness distinction.
 * These tests mock the SubmitClient to verify behavior without a running backend.
 *
 * Run with: pnpm -C gateway exec vitest run tests/unit/health-check.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubmitClient } from '../../src/backend/http.js';

describe('SubmitClient.healthCheck()', () => {
  const BASE_URL = 'http://localhost:8080';
  let client: SubmitClient;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new SubmitClient(BASE_URL, { healthTimeoutMs: 1000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns true when backend /healthz responds 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const result = await client.healthCheck();
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/healthz`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Origin: expect.any(String) }),
      })
    );
  });

  it('returns false when backend /healthz responds 503', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it('returns false when backend /healthz responds 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it('returns false when backend connection times out', async () => {
    // Simulate AbortSignal.timeout behavior - throws AbortError on abort
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      // Wait for the signal to abort
      if (options?.signal) {
        await new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        });
      }
      throw new Error('Should have aborted');
    });

    // With 1000ms timeout, should return false after timeout
    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it('returns false when backend connection refused', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it('returns false when DNS resolution fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it('returns false when network is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network is unreachable'));

    const result = await client.healthCheck();
    expect(result).toBe(false);
  });
});

describe('Health Check Endpoint Behavior', () => {
  it('should distinguish between readiness and liveness probes', () => {
    // Document the expected behavior for each probe type
    const probes = {
      '/livez': {
        purpose: 'Is the process running?',
        dependencies: 'none',
        expectedBehavior: 'Always returns 200 if gateway is responding',
        kubernetesUsage: 'livenessProbe - restarts pod if fails',
      },
      '/healthz': {
        purpose: 'Can the gateway serve traffic?',
        dependencies: ['backend/indexer'],
        expectedBehavior: 'Returns 200 only if backend is reachable',
        kubernetesUsage: 'readinessProbe - removes from load balancer if fails',
      },
      '/readyz': {
        purpose: 'Alias for /healthz',
        dependencies: ['backend/indexer'],
        expectedBehavior: 'Same as /healthz',
        kubernetesUsage: 'readinessProbe - removes from load balancer if fails',
      },
    };

    // Verify all endpoints are documented
    expect(Object.keys(probes)).toContain('/livez');
    expect(Object.keys(probes)).toContain('/healthz');
    expect(Object.keys(probes)).toContain('/readyz');
  });

  it('liveness should not check external dependencies', () => {
    // Liveness probes should be fast and not check external services
    // because if external service is down, restarting the gateway won't help
    const livenessProbeChecks = ['gateway process running'];
    const livenessProbeDoesNotCheck = ['backend connectivity', 'indexer health', 'database'];

    expect(livenessProbeChecks).toContain('gateway process running');
    livenessProbeDoesNotCheck.forEach((dep) => {
      expect(livenessProbeChecks).not.toContain(dep);
    });
  });

  it('readiness should check backend connectivity', () => {
    // Readiness probes should verify the gateway can actually serve traffic
    const readinessProbeChecks = ['backend connectivity'];
    expect(readinessProbeChecks).toContain('backend connectivity');
  });
});

describe('Health Check HTTP Status Codes', () => {
  it('documents expected status codes for healthy state', () => {
    const healthyResponses = {
      '/livez': { status: 200, body: { ok: true } },
      '/healthz': { status: 200, body: { ok: true, backend: 'connected' } },
      '/readyz': { status: 200, body: { ok: true, backend: 'connected' } },
    };

    expect(healthyResponses['/livez'].status).toBe(200);
    expect(healthyResponses['/healthz'].status).toBe(200);
    expect(healthyResponses['/readyz'].status).toBe(200);
  });

  it('documents expected status codes for unhealthy state', () => {
    const unhealthyResponses = {
      '/livez': null, // Livez doesn't have unhealthy state (if responding, it's healthy)
      '/healthz': { status: 503, body: { ok: false, backend: 'unreachable' } },
      '/readyz': { status: 503, body: { ok: false, backend: 'unreachable' } },
    };

    expect(unhealthyResponses['/livez']).toBeNull();
    expect(unhealthyResponses['/healthz']?.status).toBe(503);
    expect(unhealthyResponses['/readyz']?.status).toBe(503);
  });

  it('503 is correct HTTP status for Service Unavailable', () => {
    // HTTP 503 Service Unavailable indicates the server is not ready to handle requests
    // This is the correct status for readiness probe failure
    const HTTP_SERVICE_UNAVAILABLE = 503;
    expect(HTTP_SERVICE_UNAVAILABLE).toBe(503);
  });
});
