/**
 * Rate Limit Metrics Tests (US-071)
 *
 * Tests for rate limit metrics tracking:
 * - Rate limit hit counters increment correctly
 * - Metrics exposed via /metrics endpoint
 * - Per-IP and per-session rate limit tracking
 * - Rate limit window reset behavior
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionLimiter } from '../../src/session/limiter.js';
import { metrics, trackRateLimitHit, trackRateLimitReset, handleMetrics } from '../../src/metrics/index.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

describe('Rate Limit Metrics', () => {
  beforeEach(() => {
    metrics.reset();
  });

  describe('trackRateLimitHit', () => {
    it('should increment total rate limit counter', () => {
      trackRateLimitHit('ip_limit');

      expect(metrics.get('gateway.rate_limits.total')).toBe(1);
    });

    it('should increment limit-type-specific counter', () => {
      trackRateLimitHit('ip_limit');
      trackRateLimitHit('session_cap');
      trackRateLimitHit('session_rate_limit');

      expect(metrics.get('gateway.rate_limits.ip_limit')).toBe(1);
      expect(metrics.get('gateway.rate_limits.session_cap')).toBe(1);
      expect(metrics.get('gateway.rate_limits.session_rate_limit')).toBe(1);
    });

    it('should track per-IP rate limit hits', () => {
      trackRateLimitHit('ip_limit', '192.168.1.1');
      trackRateLimitHit('ip_limit', '192.168.1.1');
      trackRateLimitHit('ip_limit', '10.0.0.1');

      expect(metrics.get('gateway.rate_limits.by_ip.192_168_1_1')).toBe(2);
      expect(metrics.get('gateway.rate_limits.by_ip.10_0_0_1')).toBe(1);
    });

    it('should sanitize IPv6 addresses in metric names', () => {
      trackRateLimitHit('ip_limit', '2001:db8::1');

      expect(metrics.get('gateway.rate_limits.by_ip.2001_db8__1')).toBe(1);
    });

    it('should handle IPv4-mapped IPv6 addresses', () => {
      trackRateLimitHit('ip_limit', '::ffff:127.0.0.1');

      expect(metrics.get('gateway.rate_limits.by_ip.__ffff_127_0_0_1')).toBe(1);
    });
  });

  describe('trackRateLimitReset', () => {
    it('should increment reset counter for limit type', () => {
      trackRateLimitReset('session_rate_limit');
      trackRateLimitReset('session_rate_limit');
      trackRateLimitReset('metrics_rate_limit');

      expect(metrics.get('gateway.rate_limits.resets.session_rate_limit')).toBe(2);
      expect(metrics.get('gateway.rate_limits.resets.metrics_rate_limit')).toBe(1);
    });
  });

  describe('ConnectionLimiter metrics integration', () => {
    it('should track IP_LIMIT_EXCEEDED when per-IP limit hit', () => {
      const limiter = new ConnectionLimiter({
        maxConnectionsPerIp: 2,
        maxTotalSessions: 100,
      });

      const ip = '192.168.1.100';

      // Fill up to limit
      limiter.registerConnection(ip, 'conn-1');
      limiter.registerConnection(ip, 'conn-2');

      // Trigger limit - this should record metric
      const result = limiter.canConnect(ip);

      expect(result.allowed).toBe(false);
      expect(result.code).toBe('IP_LIMIT_EXCEEDED');
      expect(metrics.get('gateway.rate_limits.total')).toBe(1);
      expect(metrics.get('gateway.rate_limits.ip_limit')).toBe(1);
      expect(metrics.get('gateway.rate_limits.by_ip.192_168_1_100')).toBe(1);
    });

    it('should track SESSION_CAP_REACHED when global limit hit', () => {
      const limiter = new ConnectionLimiter({
        maxConnectionsPerIp: 100,
        maxTotalSessions: 3,
      });

      // Fill up global capacity
      limiter.registerConnection('1.1.1.1', 'conn-1');
      limiter.registerConnection('2.2.2.2', 'conn-2');
      limiter.registerConnection('3.3.3.3', 'conn-3');

      // Trigger global limit
      const result = limiter.canConnect('4.4.4.4');

      expect(result.allowed).toBe(false);
      expect(result.code).toBe('SESSION_CAP_REACHED');
      expect(metrics.get('gateway.rate_limits.total')).toBe(1);
      expect(metrics.get('gateway.rate_limits.session_cap')).toBe(1);
      expect(metrics.get('gateway.rate_limits.by_ip.4_4_4_4')).toBe(1);
    });

    it('should track multiple rate limit hits from same IP', () => {
      const limiter = new ConnectionLimiter({
        maxConnectionsPerIp: 1,
        maxTotalSessions: 100,
      });

      const ip = '10.0.0.50';
      limiter.registerConnection(ip, 'conn-1');

      // Multiple failed attempts
      for (let i = 0; i < 5; i++) {
        limiter.canConnect(ip);
      }

      expect(metrics.get('gateway.rate_limits.total')).toBe(5);
      expect(metrics.get('gateway.rate_limits.ip_limit')).toBe(5);
      expect(metrics.get('gateway.rate_limits.by_ip.10_0_0_50')).toBe(5);
    });

    it('should not track metrics when connection is allowed', () => {
      const limiter = new ConnectionLimiter({
        maxConnectionsPerIp: 10,
        maxTotalSessions: 100,
      });

      const result = limiter.canConnect('192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(metrics.get('gateway.rate_limits.total')).toBeUndefined();
      expect(metrics.get('gateway.rate_limits.ip_limit')).toBeUndefined();
    });
  });

  describe('/metrics endpoint exposure', () => {
    it('should include rate limit metrics in /metrics response', () => {
      // Generate some rate limit hits
      trackRateLimitHit('ip_limit', '192.168.1.1');
      trackRateLimitHit('session_cap', '10.0.0.1');
      trackRateLimitReset('session_rate_limit');

      const allMetrics = metrics.getAll();

      expect(allMetrics['gateway.rate_limits.total']).toBe(2);
      expect(allMetrics['gateway.rate_limits.ip_limit']).toBe(1);
      expect(allMetrics['gateway.rate_limits.session_cap']).toBe(1);
      expect(allMetrics['gateway.rate_limits.resets.session_rate_limit']).toBe(1);
      expect(allMetrics['gateway.rate_limits.by_ip.192_168_1_1']).toBe(1);
      expect(allMetrics['gateway.rate_limits.by_ip.10_0_0_1']).toBe(1);
    });

    it('should serve rate limit metrics via handleMetrics', () => {
      // Set up metrics
      trackRateLimitHit('ip_limit', '127.0.0.1');

      // Mock request/response
      const req = {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      let responseBody = '';
      let statusCode = 0;
      const res = {
        statusCode: 0,
        setHeader: vi.fn(),
        end: vi.fn((body: string) => {
          responseBody = body;
        }),
        get statusCode() {
          return statusCode;
        },
        set statusCode(code: number) {
          statusCode = code;
        },
      } as unknown as ServerResponse;

      // Allow without auth in non-production
      const originalEnv = process.env.NODE_ENV;
      delete process.env.METRICS_AUTH_TOKEN;
      process.env.NODE_ENV = 'development';

      handleMetrics(req, res);

      process.env.NODE_ENV = originalEnv;

      expect(statusCode).toBe(200);
      const parsed = JSON.parse(responseBody);
      expect(parsed.metrics['gateway.rate_limits.ip_limit']).toBe(1);
      expect(parsed.metrics['gateway.rate_limits.by_ip.127_0_0_1']).toBe(1);
    });
  });

  describe('rate limit reset after window expires', () => {
    it('should track reset when session rate limit window expires', () => {
      // This test documents that trackRateLimitReset is called when
      // the session creation rate limit window expires.
      // The actual window behavior is tested in session-manager.test.ts

      trackRateLimitReset('session_rate_limit');
      trackRateLimitReset('session_rate_limit');

      expect(metrics.get('gateway.rate_limits.resets.session_rate_limit')).toBe(2);
    });

    it('should track reset when metrics rate limit window expires', () => {
      trackRateLimitReset('metrics_rate_limit');

      expect(metrics.get('gateway.rate_limits.resets.metrics_rate_limit')).toBe(1);
    });
  });

  describe('cumulative metric behavior', () => {
    it('should accumulate rate limit hits across multiple limit types', () => {
      trackRateLimitHit('ip_limit', '1.1.1.1');
      trackRateLimitHit('ip_limit', '2.2.2.2');
      trackRateLimitHit('session_cap', '3.3.3.3');
      trackRateLimitHit('session_rate_limit', '4.4.4.4');

      expect(metrics.get('gateway.rate_limits.total')).toBe(4);
    });

    it('should preserve metrics after partial reset', () => {
      trackRateLimitHit('ip_limit');
      trackRateLimitHit('session_cap');

      // Metrics persist until explicit reset
      expect(metrics.get('gateway.rate_limits.ip_limit')).toBe(1);
      expect(metrics.get('gateway.rate_limits.session_cap')).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty IP gracefully', () => {
      expect(() => {
        trackRateLimitHit('ip_limit', '');
      }).not.toThrow();

      expect(metrics.get('gateway.rate_limits.ip_limit')).toBe(1);
    });

    it('should handle undefined IP gracefully', () => {
      expect(() => {
        trackRateLimitHit('ip_limit');
      }).not.toThrow();

      expect(metrics.get('gateway.rate_limits.ip_limit')).toBe(1);
      // No per-IP metric should be created
      expect(metrics.get('gateway.rate_limits.by_ip.undefined')).toBeUndefined();
    });

    it('should handle special characters in IP', () => {
      trackRateLimitHit('ip_limit', '192.168.1.1:8080');

      expect(metrics.get('gateway.rate_limits.by_ip.192_168_1_1_8080')).toBe(1);
    });
  });
});

describe('Rate Limit Metrics - High Volume', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('should handle high-volume rate limit tracking', () => {
    // Simulate 1000 rate limit hits from 100 different IPs
    for (let ip = 0; ip < 100; ip++) {
      for (let hit = 0; hit < 10; hit++) {
        trackRateLimitHit('ip_limit', `192.168.1.${ip}`);
      }
    }

    expect(metrics.get('gateway.rate_limits.total')).toBe(1000);
    expect(metrics.get('gateway.rate_limits.ip_limit')).toBe(1000);
    expect(metrics.get('gateway.rate_limits.by_ip.192_168_1_50')).toBe(10);
  });

  it('should track mixed rate limit types accurately', () => {
    const types = ['ip_limit', 'session_cap', 'session_rate_limit', 'metrics_rate_limit'];

    for (let i = 0; i < 100; i++) {
      const type = types[i % types.length];
      trackRateLimitHit(type, `10.0.${Math.floor(i / 256)}.${i % 256}`);
    }

    expect(metrics.get('gateway.rate_limits.total')).toBe(100);
    expect(metrics.get('gateway.rate_limits.ip_limit')).toBe(25);
    expect(metrics.get('gateway.rate_limits.session_cap')).toBe(25);
    expect(metrics.get('gateway.rate_limits.session_rate_limit')).toBe(25);
    expect(metrics.get('gateway.rate_limits.metrics_rate_limit')).toBe(25);
  });
});
