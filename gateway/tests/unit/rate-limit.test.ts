/**
 * Rate Limiting Unit Tests
 *
 * Tests for the ConnectionLimiter class that enforces
 * per-IP connection limits and global session caps.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionLimiter } from '../../src/session/limiter.js';

describe('ConnectionLimiter', () => {
  let limiter: ConnectionLimiter;

  beforeEach(() => {
    limiter = new ConnectionLimiter({
      maxConnectionsPerIp: 5,
      maxTotalSessions: 10,
    });
  });

  describe('Configuration', () => {
    it('should use default values when not configured', () => {
      const defaultLimiter = new ConnectionLimiter();
      const stats = defaultLimiter.getStats();

      expect(stats.config.maxConnectionsPerIp).toBe(5);
      expect(stats.config.maxTotalSessions).toBe(1000);
    });

    it('should accept custom configuration', () => {
      const customLimiter = new ConnectionLimiter({
        maxConnectionsPerIp: 10,
        maxTotalSessions: 500,
      });
      const stats = customLimiter.getStats();

      expect(stats.config.maxConnectionsPerIp).toBe(10);
      expect(stats.config.maxTotalSessions).toBe(500);
    });
  });

  describe('IP Normalization', () => {
    it('should normalize IPv4-mapped IPv6 addresses', () => {
      const ip = '::ffff:127.0.0.1';
      const connectionId = 'conn-1';

      limiter.registerConnection(ip, connectionId);

      // Should be stored as normalized IPv4
      expect(limiter.getConnectionsForIp('127.0.0.1')).toBe(1);
      expect(limiter.getConnectionsForIp(ip)).toBe(1);
    });

    it('should handle empty IP gracefully', () => {
      const result = limiter.canConnect('');
      expect(result.allowed).toBe(true);
    });

    it('should handle standard IPv4 addresses', () => {
      limiter.registerConnection('192.168.1.1', 'conn-1');
      expect(limiter.getConnectionsForIp('192.168.1.1')).toBe(1);
    });

    it('should handle IPv6 addresses', () => {
      limiter.registerConnection('2001:db8::1', 'conn-1');
      expect(limiter.getConnectionsForIp('2001:db8::1')).toBe(1);
    });
  });

  describe('Per-IP Limits', () => {
    it('should allow connections within IP limit', () => {
      const ip = '192.168.1.1';

      for (let i = 0; i < 5; i++) {
        const result = limiter.canConnect(ip);
        expect(result.allowed).toBe(true);
        limiter.registerConnection(ip, `conn-${i}`);
      }

      expect(limiter.getConnectionsForIp(ip)).toBe(5);
    });

    it('should block connections exceeding IP limit', () => {
      const ip = '192.168.1.1';

      // Register max connections
      for (let i = 0; i < 5; i++) {
        limiter.registerConnection(ip, `conn-${i}`);
      }

      // 6th connection should be blocked
      const result = limiter.canConnect(ip);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('IP_LIMIT_EXCEEDED');
      expect(result.reason).toContain('Too many connections');
    });

    it('should allow connections from different IPs independently', () => {
      // Fill up IP 1
      for (let i = 0; i < 5; i++) {
        limiter.registerConnection('192.168.1.1', `conn-1-${i}`);
      }

      // Different IP should still be allowed
      const result = limiter.canConnect('192.168.1.2');
      expect(result.allowed).toBe(true);
    });

    it('should allow new connections after disconnection', () => {
      const ip = '192.168.1.1';

      // Fill up IP
      for (let i = 0; i < 5; i++) {
        limiter.registerConnection(ip, `conn-${i}`);
      }

      // Verify blocked
      expect(limiter.canConnect(ip).allowed).toBe(false);

      // Disconnect one
      limiter.unregisterConnection(ip, 'conn-0');

      // Should now allow
      const result = limiter.canConnect(ip);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Global Session Cap', () => {
    it('should enforce global session limit', () => {
      // Register max sessions across different IPs
      for (let i = 0; i < 10; i++) {
        const ip = `192.168.1.${i}`;
        limiter.registerConnection(ip, `conn-${i}`);
      }

      // Any new connection should be blocked
      const result = limiter.canConnect('192.168.2.1');
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('SESSION_CAP_REACHED');
      expect(result.reason).toContain('at capacity');
    });

    it('should track total connections accurately', () => {
      const ips = ['1.1.1.1', '2.2.2.2', '3.3.3.3'];

      ips.forEach((ip, i) => {
        limiter.registerConnection(ip, `conn-${i}`);
      });

      expect(limiter.getTotalConnections()).toBe(3);
    });

    it('should decrement total on unregister', () => {
      limiter.registerConnection('1.1.1.1', 'conn-1');
      limiter.registerConnection('2.2.2.2', 'conn-2');

      expect(limiter.getTotalConnections()).toBe(2);

      limiter.unregisterConnection('1.1.1.1', 'conn-1');

      expect(limiter.getTotalConnections()).toBe(1);
    });
  });

  describe('Connection Registration', () => {
    it('should track unique connection IDs', () => {
      const ip = '192.168.1.1';

      limiter.registerConnection(ip, 'conn-1');
      limiter.registerConnection(ip, 'conn-2');
      limiter.registerConnection(ip, 'conn-3');

      expect(limiter.getConnectionsForIp(ip)).toBe(3);
    });

    it('should handle duplicate connection IDs correctly', () => {
      const ip = '192.168.1.1';

      limiter.registerConnection(ip, 'conn-1');
      limiter.registerConnection(ip, 'conn-1'); // Duplicate

      // Set doesn't allow duplicates, so count stays at 1
      expect(limiter.getConnectionsForIp(ip)).toBe(1);
    });

    it('should clean up empty IP entries', () => {
      const ip = '192.168.1.1';

      limiter.registerConnection(ip, 'conn-1');
      limiter.unregisterConnection(ip, 'conn-1');

      // Stats should show 0 unique IPs
      const stats = limiter.getStats();
      expect(stats.uniqueIps).toBe(0);
    });
  });

  describe('Unregistration Edge Cases', () => {
    it('should handle unregistering non-existent connection', () => {
      // Should not throw
      expect(() => {
        limiter.unregisterConnection('1.1.1.1', 'non-existent');
      }).not.toThrow();
    });

    it('should handle unregistering from non-existent IP', () => {
      expect(() => {
        limiter.unregisterConnection('1.1.1.1', 'conn-1');
      }).not.toThrow();
    });

    it('should not decrement total for non-existent connections', () => {
      limiter.registerConnection('1.1.1.1', 'conn-1');

      limiter.unregisterConnection('1.1.1.1', 'non-existent');

      expect(limiter.getTotalConnections()).toBe(1);
    });
  });

  describe('Statistics', () => {
    it('should return accurate statistics', () => {
      limiter.registerConnection('1.1.1.1', 'conn-1');
      limiter.registerConnection('1.1.1.1', 'conn-2');
      limiter.registerConnection('2.2.2.2', 'conn-3');

      const stats = limiter.getStats();

      expect(stats.totalConnections).toBe(3);
      expect(stats.uniqueIps).toBe(2);
      expect(stats.config.maxConnectionsPerIp).toBe(5);
      expect(stats.config.maxTotalSessions).toBe(10);
    });

    it('should return config copy not reference', () => {
      const stats1 = limiter.getStats();
      const stats2 = limiter.getStats();

      expect(stats1.config).not.toBe(stats2.config);
      expect(stats1.config).toEqual(stats2.config);
    });
  });
});

describe('Rate Limit Scenarios', () => {
  it('should handle high-volume connection attempts gracefully', () => {
    const limiter = new ConnectionLimiter({
      maxConnectionsPerIp: 100,
      maxTotalSessions: 1000,
    });

    // Simulate 500 connections from different IPs
    for (let i = 0; i < 500; i++) {
      const ip = `10.0.${Math.floor(i / 256)}.${i % 256}`;
      const result = limiter.canConnect(ip);
      expect(result.allowed).toBe(true);
      limiter.registerConnection(ip, `conn-${i}`);
    }

    expect(limiter.getTotalConnections()).toBe(500);
  });

  it('should handle rapid connect/disconnect cycles', () => {
    const limiter = new ConnectionLimiter({
      maxConnectionsPerIp: 5,
      maxTotalSessions: 10,
    });

    const ip = '192.168.1.1';

    for (let cycle = 0; cycle < 100; cycle++) {
      const connectionId = `conn-${cycle}`;
      limiter.registerConnection(ip, connectionId);
      limiter.unregisterConnection(ip, connectionId);
    }

    expect(limiter.getTotalConnections()).toBe(0);
    expect(limiter.getConnectionsForIp(ip)).toBe(0);
  });
});
