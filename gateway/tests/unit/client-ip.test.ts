/**
 * Client IP Extraction Tests (US-248)
 *
 * Tests for getClientIp() utility when running behind reverse proxies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getClientIp, initializeTrustedProxies, getProxyTrustStatus } from '../../src/utils/client-ip.js';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

/**
 * Create a mock IncomingMessage with configurable headers and socket IP
 */
function createMockRequest(
  socketRemoteAddress: string,
  headers: Record<string, string | string[]> = {}
): IncomingMessage {
  const normalizedHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value;
  }

  return {
    headers: normalizedHeaders,
    socket: {
      remoteAddress: socketRemoteAddress,
    } as Socket,
  } as IncomingMessage;
}

describe('Client IP Extraction (US-248)', () => {
  // Store original env to restore after tests
  const originalEnv = process.env.TRUSTED_PROXY_CIDRS;

  beforeEach(() => {
    // Reset to no trusted proxies before each test
    delete process.env.TRUSTED_PROXY_CIDRS;
    initializeTrustedProxies();
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.TRUSTED_PROXY_CIDRS = originalEnv;
    } else {
      delete process.env.TRUSTED_PROXY_CIDRS;
    }
  });

  describe('without trusted proxies', () => {
    it('should use socket.remoteAddress directly', () => {
      const req = createMockRequest('192.168.1.100', {
        'X-Forwarded-For': '10.0.0.1, 172.18.0.2',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('192.168.1.100');
    });

    it('should ignore X-Forwarded-For header', () => {
      const req = createMockRequest('203.0.113.1', {
        'X-Forwarded-For': '192.168.1.1',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.1');
    });

    it('should ignore X-Real-IP header', () => {
      const req = createMockRequest('203.0.113.1', {
        'X-Real-IP': '192.168.1.1',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.1');
    });

    it('should return "unknown" when socket.remoteAddress is undefined', () => {
      const req = createMockRequest(undefined as unknown as string);

      const ip = getClientIp(req);
      expect(ip).toBe('unknown');
    });

    it('should normalize IPv4-mapped IPv6 addresses', () => {
      const req = createMockRequest('::ffff:192.168.1.1');

      const ip = getClientIp(req);
      expect(ip).toBe('192.168.1.1');
    });
  });

  describe('with trusted proxies configured', () => {
    beforeEach(() => {
      // Configure trusted proxy range (typical Docker bridge network)
      initializeTrustedProxies({ trustedCidrs: ['172.18.0.0/16'] });
    });

    it('should extract IP from X-Forwarded-For when request from trusted proxy', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': '203.0.113.50',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should use leftmost IP in X-Forwarded-For chain', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': '203.0.113.50, 172.18.0.3, 172.18.0.2',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should fallback to X-Real-IP when X-Forwarded-For is missing', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Real-IP': '203.0.113.50',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should prefer X-Forwarded-For over X-Real-IP', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': '198.51.100.1',
        'X-Real-IP': '203.0.113.50',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('198.51.100.1');
    });

    it('should fallback to socket.remoteAddress when headers are empty', () => {
      const req = createMockRequest('172.18.0.2');

      const ip = getClientIp(req);
      expect(ip).toBe('172.18.0.2');
    });

    it('should NOT trust headers from non-trusted proxy IPs', () => {
      const req = createMockRequest('192.168.1.1', {
        'X-Forwarded-For': '10.0.0.1',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('192.168.1.1');
    });

    it('should normalize IPv4-mapped IPv6 in forwarded headers', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': '::ffff:203.0.113.50',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should handle IPv4-mapped IPv6 socket addresses from trusted proxies', () => {
      const req = createMockRequest('::ffff:172.18.0.2', {
        'X-Forwarded-For': '203.0.113.50',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.50');
    });
  });

  describe('CIDR matching', () => {
    it('should match exact IP', () => {
      initializeTrustedProxies({ trustedCidrs: ['172.18.0.2/32'] });

      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': '10.0.0.1',
      });

      expect(getClientIp(req)).toBe('10.0.0.1');
    });

    it('should match /24 subnet', () => {
      initializeTrustedProxies({ trustedCidrs: ['172.18.5.0/24'] });

      const req1 = createMockRequest('172.18.5.1', { 'X-Forwarded-For': '10.0.0.1' });
      const req2 = createMockRequest('172.18.5.255', { 'X-Forwarded-For': '10.0.0.2' });
      const req3 = createMockRequest('172.18.6.1', { 'X-Forwarded-For': '10.0.0.3' });

      expect(getClientIp(req1)).toBe('10.0.0.1');
      expect(getClientIp(req2)).toBe('10.0.0.2');
      expect(getClientIp(req3)).toBe('172.18.6.1'); // Outside /24 range
    });

    it('should match /8 subnet', () => {
      initializeTrustedProxies({ trustedCidrs: ['10.0.0.0/8'] });

      const req1 = createMockRequest('10.0.0.1', { 'X-Forwarded-For': '1.2.3.4' });
      const req2 = createMockRequest('10.255.255.255', { 'X-Forwarded-For': '5.6.7.8' });
      const req3 = createMockRequest('11.0.0.1', { 'X-Forwarded-For': '9.10.11.12' });

      expect(getClientIp(req1)).toBe('1.2.3.4');
      expect(getClientIp(req2)).toBe('5.6.7.8');
      expect(getClientIp(req3)).toBe('11.0.0.1'); // Outside /8 range
    });
  });

  describe('shorthand CIDR names', () => {
    it('should expand "loopback" to 127.0.0.0/8 and ::1/128', () => {
      initializeTrustedProxies({ trustedCidrs: ['loopback'] });

      const req1 = createMockRequest('127.0.0.1', { 'X-Forwarded-For': '10.0.0.1' });
      const req2 = createMockRequest('127.255.255.255', { 'X-Forwarded-For': '10.0.0.2' });

      expect(getClientIp(req1)).toBe('10.0.0.1');
      expect(getClientIp(req2)).toBe('10.0.0.2');
    });

    it('should expand "private" to RFC 1918 ranges', () => {
      initializeTrustedProxies({ trustedCidrs: ['private'] });

      const req1 = createMockRequest('10.5.5.5', { 'X-Forwarded-For': '1.1.1.1' });
      const req2 = createMockRequest('172.16.0.1', { 'X-Forwarded-For': '2.2.2.2' });
      const req3 = createMockRequest('192.168.1.1', { 'X-Forwarded-For': '3.3.3.3' });
      const req4 = createMockRequest('8.8.8.8', { 'X-Forwarded-For': '4.4.4.4' });

      expect(getClientIp(req1)).toBe('1.1.1.1');
      expect(getClientIp(req2)).toBe('2.2.2.2');
      expect(getClientIp(req3)).toBe('3.3.3.3');
      expect(getClientIp(req4)).toBe('8.8.8.8'); // Public IP, not trusted
    });

    it('should expand "docker" to Docker bridge network range', () => {
      initializeTrustedProxies({ trustedCidrs: ['docker'] });

      const req1 = createMockRequest('172.17.0.2', { 'X-Forwarded-For': '1.1.1.1' });
      const req2 = createMockRequest('172.31.255.255', { 'X-Forwarded-For': '2.2.2.2' });

      expect(getClientIp(req1)).toBe('1.1.1.1');
      expect(getClientIp(req2)).toBe('2.2.2.2');
    });
  });

  describe('environment variable configuration', () => {
    it('should read trusted proxies from TRUSTED_PROXY_CIDRS env var', () => {
      process.env.TRUSTED_PROXY_CIDRS = '172.18.0.0/16,192.168.0.0/16';
      initializeTrustedProxies();

      const req1 = createMockRequest('172.18.0.2', { 'X-Forwarded-For': '1.1.1.1' });
      const req2 = createMockRequest('192.168.1.1', { 'X-Forwarded-For': '2.2.2.2' });
      const req3 = createMockRequest('10.0.0.1', { 'X-Forwarded-For': '3.3.3.3' });

      expect(getClientIp(req1)).toBe('1.1.1.1');
      expect(getClientIp(req2)).toBe('2.2.2.2');
      expect(getClientIp(req3)).toBe('10.0.0.1'); // Not in trusted ranges
    });

    it('should handle empty TRUSTED_PROXY_CIDRS', () => {
      process.env.TRUSTED_PROXY_CIDRS = '';
      initializeTrustedProxies();

      const status = getProxyTrustStatus();
      expect(status.enabled).toBe(false);
    });

    it('should handle whitespace in TRUSTED_PROXY_CIDRS', () => {
      process.env.TRUSTED_PROXY_CIDRS = '  172.18.0.0/16 , 192.168.0.0/16  ';
      initializeTrustedProxies();

      const status = getProxyTrustStatus();
      expect(status.enabled).toBe(true);
      expect(status.trustedCidrs).toContain('172.18.0.0/16');
      expect(status.trustedCidrs).toContain('192.168.0.0/16');
    });
  });

  describe('getProxyTrustStatus', () => {
    it('should return enabled=false when no proxies configured', () => {
      initializeTrustedProxies({ trustedCidrs: [] });

      const status = getProxyTrustStatus();
      expect(status.enabled).toBe(false);
      expect(status.trustedCidrs).toEqual([]);
    });

    it('should return enabled=true with configured CIDRs', () => {
      initializeTrustedProxies({ trustedCidrs: ['172.18.0.0/16'] });

      const status = getProxyTrustStatus();
      expect(status.enabled).toBe(true);
      expect(status.trustedCidrs).toContain('172.18.0.0/16');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      initializeTrustedProxies({ trustedCidrs: ['172.18.0.0/16'] });
    });

    it('should handle array header values', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': ['203.0.113.50', '10.0.0.1'] as unknown as string,
      });

      // Should use first value in array
      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should handle empty X-Forwarded-For and fallback to X-Real-IP', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': '',
        'X-Real-IP': '203.0.113.50',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should handle empty both headers and fallback to socket', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': '',
        'X-Real-IP': '',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('172.18.0.2');
    });

    it('should trim whitespace from IP addresses', () => {
      const req = createMockRequest('172.18.0.2', {
        'X-Forwarded-For': '  203.0.113.50  ',
      });

      const ip = getClientIp(req);
      expect(ip).toBe('203.0.113.50');
    });
  });
});
