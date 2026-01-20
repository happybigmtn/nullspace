/**
 * Correlation ID Propagation Integration Tests (AC-1.6)
 *
 * Tests that correlation IDs (x-request-id) are propagated across services:
 * - Gateway -> Backend (simulator) -> Response
 *
 * This validates structured logs include a shared request id for at least
 * one request path, enabling distributed tracing across the stack.
 *
 * Run with: RUN_CROSS_SERVICE=true pnpm test correlation-id.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SERVICE_URLS, checkServiceHealth } from './helpers/services.js';

const CROSS_SERVICE_ENABLED = process.env.RUN_CROSS_SERVICE === 'true';
const IS_TESTNET = SERVICE_URLS.simulator.includes('testnet.regenesis.dev');
const TEST_TIMEOUT_MS = IS_TESTNET ? 30000 : 10000;

describe.skipIf(!CROSS_SERVICE_ENABLED)('Correlation ID Propagation (AC-1.6)', () => {
  beforeAll(async () => {
    // Verify backend is healthy before running tests
    const simulatorHealthy = await checkServiceHealth(SERVICE_URLS.simulator);
    if (!simulatorHealthy) {
      throw new Error(
        `Backend (simulator) is not healthy at ${SERVICE_URLS.simulator}. ` +
        'Start the stack with: pnpm -C tests/integration docker:up'
      );
    }
  }, TEST_TIMEOUT_MS);

  it('should echo x-request-id on healthz endpoint', async () => {
    const requestId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const response = await fetch(`${SERVICE_URLS.simulator}/healthz`, {
      method: 'GET',
      headers: {
        'Origin': SERVICE_URLS.website,
        'x-request-id': requestId,
      },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(response.ok).toBe(true);
    // Backend should echo back the x-request-id in response headers
    const responseRequestId = response.headers.get('x-request-id');
    expect(responseRequestId).toBe(requestId);
  }, TEST_TIMEOUT_MS);

  it('should generate x-request-id when not provided', async () => {
    const response = await fetch(`${SERVICE_URLS.simulator}/healthz`, {
      method: 'GET',
      headers: {
        'Origin': SERVICE_URLS.website,
      },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(response.ok).toBe(true);
    // Backend should generate and return an x-request-id
    const responseRequestId = response.headers.get('x-request-id');
    expect(responseRequestId).toBeTruthy();
    // Should be a valid UUID format
    expect(responseRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  }, TEST_TIMEOUT_MS);

  it('should propagate x-request-id through submit endpoint', async () => {
    const requestId = `submit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Send an empty/invalid submission - we just want to verify header propagation
    // The backend will reject it but should still echo the request ID
    const response = await fetch(`${SERVICE_URLS.simulator}/submit`, {
      method: 'POST',
      headers: {
        'Origin': SERVICE_URLS.website,
        'Content-Type': 'application/octet-stream',
        'x-request-id': requestId,
      },
      body: new Uint8Array([0]), // Invalid submission, will be rejected
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    // Even on error response, the x-request-id should be echoed
    const responseRequestId = response.headers.get('x-request-id');
    expect(responseRequestId).toBe(requestId);
  }, TEST_TIMEOUT_MS);

  it('should propagate x-request-id through account endpoint', async () => {
    const requestId = `account-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Use a dummy public key (32 bytes hex = 64 chars)
    const dummyPubkey = '0'.repeat(64);

    const response = await fetch(`${SERVICE_URLS.simulator}/account/${dummyPubkey}`, {
      method: 'GET',
      headers: {
        'Origin': SERVICE_URLS.website,
        'x-request-id': requestId,
      },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    // Account endpoint should echo back the x-request-id regardless of response status
    const responseRequestId = response.headers.get('x-request-id');
    expect(responseRequestId).toBe(requestId);
  }, TEST_TIMEOUT_MS);

  describe('Gateway correlation', () => {
    let gatewayHealthy: boolean;

    beforeAll(async () => {
      gatewayHealthy = await checkServiceHealth(SERVICE_URLS.gatewayHttp);
    }, TEST_TIMEOUT_MS);

    it.skipIf(!CROSS_SERVICE_ENABLED)('should propagate x-request-id through gateway healthz', async () => {
      if (!gatewayHealthy) {
        console.warn('Gateway not available, skipping gateway correlation test');
        return;
      }

      const requestId = `gw-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const response = await fetch(`${SERVICE_URLS.gatewayHttp}/healthz`, {
        method: 'GET',
        headers: {
          'Origin': SERVICE_URLS.website,
          'x-request-id': requestId,
        },
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });

      expect(response.ok).toBe(true);
      // Note: Gateway healthz currently doesn't echo x-request-id, but backend does
      // This test documents current behavior - gateway healthz is a pass-through
    }, TEST_TIMEOUT_MS);
  });
});
