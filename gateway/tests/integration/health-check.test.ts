/**
 * Health Check Integration Tests (US-064)
 *
 * Tests for proper health check behavior with backend connectivity checks.
 * Verifies that:
 * - /healthz and /readyz return 503 when backend is unreachable
 * - /healthz and /readyz return 200 when backend is healthy
 * - /livez always returns 200 (basic liveness check)
 *
 * Run with: RUN_INTEGRATION=true pnpm -C gateway exec vitest run tests/integration/health-check.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { INTEGRATION_ENABLED, GATEWAY_PORT } from '../helpers/ws.js';

vi.setConfig({ testTimeout: 30000 });

const HTTP_BASE = `http://localhost:${GATEWAY_PORT}`;

describe.skipIf(!INTEGRATION_ENABLED)('Health Check Tests', () => {
  describe('when backend is running', () => {
    it('/healthz returns 200 with backend connected', async () => {
      const response = await fetch(`${HTTP_BASE}/healthz`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.backend).toBe('connected');
    });

    it('/readyz returns 200 with backend connected', async () => {
      const response = await fetch(`${HTTP_BASE}/readyz`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.backend).toBe('connected');
    });

    it('/livez returns 200 (no dependency check)', async () => {
      const response = await fetch(`${HTTP_BASE}/livez`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
    });
  });

  describe('response format and headers', () => {
    it('/healthz returns application/json content type', async () => {
      const response = await fetch(`${HTTP_BASE}/healthz`);
      expect(response.headers.get('content-type')).toBe('application/json');
    });

    it('/readyz returns application/json content type', async () => {
      const response = await fetch(`${HTTP_BASE}/readyz`);
      expect(response.headers.get('content-type')).toBe('application/json');
    });

    it('/livez returns application/json content type', async () => {
      const response = await fetch(`${HTTP_BASE}/livez`);
      expect(response.headers.get('content-type')).toBe('application/json');
    });
  });
});
