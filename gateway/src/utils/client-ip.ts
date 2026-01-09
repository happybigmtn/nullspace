/**
 * Client IP Extraction
 *
 * Extracts the real client IP when running behind reverse proxies like Caddy.
 * Supports X-Forwarded-For (standard) and X-Real-IP (nginx convention) headers.
 *
 * US-248: Ensure rate limits and metrics use actual client IP, not proxy IP.
 *
 * Security considerations:
 * - Only trust proxy headers when explicitly configured via TRUSTED_PROXY_CIDRS
 * - In production, this should be set to the internal Docker network CIDR
 * - Falls back to socket.remoteAddress when not behind trusted proxy
 */

import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { logDebug, logWarn } from '../logger.js';

/**
 * Configuration for trusted proxy IPs.
 * Only requests from these IPs will have their forwarded headers trusted.
 *
 * Supports:
 * - Individual IPs: "10.0.0.1", "::ffff:172.18.0.1"
 * - CIDR notation: "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"
 * - "loopback" shorthand: matches 127.0.0.0/8 and ::1
 * - "private" shorthand: matches RFC 1918 private ranges
 */
let trustedProxyCidrs: string[] = [];
let proxyTrustEnabled = false;

/**
 * Parse CIDR notation into base IP and prefix length
 */
function parseCidr(cidr: string): { ip: bigint; prefixLen: number; isIpv6: boolean } | null {
  const parts = cidr.split('/');
  const ipStr = parts[0];
  const prefixLen = parts[1] ? parseInt(parts[1], 10) : (ipStr.includes(':') ? 128 : 32);

  if (isNaN(prefixLen) || prefixLen < 0) return null;

  const isIpv6 = ipStr.includes(':');

  if (isIpv6) {
    if (prefixLen > 128) return null;
    const expanded = expandIpv6(ipStr);
    if (!expanded) return null;
    return { ip: ipv6ToBigInt(expanded), prefixLen, isIpv6: true };
  } else {
    if (prefixLen > 32) return null;
    const ip = ipv4ToBigInt(ipStr);
    if (ip === null) return null;
    return { ip, prefixLen, isIpv6: false };
  }
}

/**
 * Convert IPv4 address string to BigInt
 */
function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0n;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8n) | BigInt(num);
  }
  return result;
}

/**
 * Expand IPv6 address to full form
 */
function expandIpv6(ip: string): string | null {
  // Handle IPv4-mapped IPv6
  if (ip.startsWith('::ffff:') && ip.split('.').length === 4) {
    const ipv4Part = ip.slice(7);
    const ipv4BigInt = ipv4ToBigInt(ipv4Part);
    if (ipv4BigInt === null) return null;
    // Convert to full IPv6 form
    const high = '0000:0000:0000:0000:0000:ffff';
    const low = ipv4BigInt.toString(16).padStart(8, '0');
    return `${high}:${low.slice(0, 4)}:${low.slice(4)}`;
  }

  const parts = ip.split('::');
  if (parts.length > 2) return null;

  let groups: string[] = [];
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    groups = ip.split(':');
  }

  if (groups.length !== 8) return null;

  return groups.map(g => g.padStart(4, '0')).join(':');
}

/**
 * Convert IPv6 address to BigInt
 */
function ipv6ToBigInt(expanded: string): bigint {
  const parts = expanded.split(':');
  let result = 0n;
  for (const part of parts) {
    result = (result << 16n) | BigInt(parseInt(part, 16));
  }
  return result;
}

/**
 * Check if IP matches CIDR range
 */
function ipMatchesCidr(ip: string, cidr: { ip: bigint; prefixLen: number; isIpv6: boolean }): boolean {
  const isIpv6 = ip.includes(':');

  // Handle IPv4-mapped IPv6 addresses
  const normalizedIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const testIsIpv6 = normalizedIp.includes(':');

  // Type mismatch
  if (testIsIpv6 !== cidr.isIpv6) {
    // But allow IPv4 to match IPv4-mapped IPv6 range if needed
    if (!testIsIpv6 && cidr.isIpv6) {
      return false; // Don't match IPv4 against IPv6 CIDR
    }
    return false;
  }

  let testIp: bigint;
  if (testIsIpv6) {
    const expanded = expandIpv6(normalizedIp);
    if (!expanded) return false;
    testIp = ipv6ToBigInt(expanded);
  } else {
    const parsed = ipv4ToBigInt(normalizedIp);
    if (parsed === null) return false;
    testIp = parsed;
  }

  const bits = cidr.isIpv6 ? 128 : 32;
  const mask = ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - cidr.prefixLen)) - 1n);

  return (testIp & mask) === (cidr.ip & mask);
}

/**
 * Parsed CIDR ranges for fast matching
 */
let parsedCidrs: Array<{ ip: bigint; prefixLen: number; isIpv6: boolean }> = [];

/**
 * Expand shorthand CIDR names
 */
function expandCidrShorthand(cidr: string): string[] {
  switch (cidr.toLowerCase()) {
    case 'loopback':
      return ['127.0.0.0/8', '::1/128'];
    case 'private':
      return [
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        'fc00::/7', // IPv6 unique local
      ];
    case 'docker':
      return [
        '172.16.0.0/12', // Docker default bridge range
      ];
    default:
      return [cidr];
  }
}

/**
 * Initialize trusted proxy configuration from environment.
 * Call this at startup.
 *
 * Environment variables:
 * - TRUSTED_PROXY_CIDRS: Comma-separated list of trusted proxy IPs/CIDRs
 *   Examples: "172.18.0.0/16", "private", "loopback,172.18.0.1"
 */
export function initializeTrustedProxies(config?: { trustedCidrs?: string[] }): void {
  const envCidrs = process.env.TRUSTED_PROXY_CIDRS;
  const cidrs = config?.trustedCidrs ?? (
    envCidrs ? envCidrs.split(',').map(s => s.trim()).filter(Boolean) : []
  );

  if (cidrs.length === 0) {
    trustedProxyCidrs = [];
    parsedCidrs = [];
    proxyTrustEnabled = false;
    logDebug('[ClientIP] No trusted proxies configured, using socket.remoteAddress directly');
    return;
  }

  // Expand shorthands and parse CIDRs
  const expanded = cidrs.flatMap(expandCidrShorthand);
  const parsed: Array<{ ip: bigint; prefixLen: number; isIpv6: boolean }> = [];

  for (const cidr of expanded) {
    const result = parseCidr(cidr);
    if (result) {
      parsed.push(result);
    } else {
      logWarn(`[ClientIP] Invalid CIDR: ${cidr}, skipping`);
    }
  }

  trustedProxyCidrs = expanded;
  parsedCidrs = parsed;
  proxyTrustEnabled = parsed.length > 0;

  logDebug(`[ClientIP] Trusted proxies configured: ${expanded.join(', ')}`);
}

/**
 * Check if an IP is a trusted proxy
 */
function isTrustedProxy(ip: string): boolean {
  if (!proxyTrustEnabled || parsedCidrs.length === 0) {
    return false;
  }

  for (const cidr of parsedCidrs) {
    if (ipMatchesCidr(ip, cidr)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize IP address
 * - Strips IPv4-mapped IPv6 prefix (::ffff:)
 * - Trims whitespace
 */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();

  // Handle IPv4-mapped IPv6 addresses
  if (trimmed.startsWith('::ffff:')) {
    const ipv4Part = trimmed.slice(7);
    // Only convert if it looks like IPv4
    if (ipv4Part.split('.').length === 4) {
      return ipv4Part;
    }
  }

  return trimmed;
}

/**
 * Extract the real client IP from a request.
 *
 * When the request comes from a trusted proxy:
 * 1. Check X-Forwarded-For header (standard, may contain chain)
 * 2. Check X-Real-IP header (nginx convention, single IP)
 * 3. Fall back to socket.remoteAddress
 *
 * When not from a trusted proxy:
 * - Always use socket.remoteAddress (ignore headers to prevent spoofing)
 *
 * @param req - HTTP request or WebSocket upgrade request
 * @returns Normalized client IP address
 */
export function getClientIp(req: IncomingMessage): string {
  const socket = req.socket as Socket;
  const socketIp = socket.remoteAddress ?? 'unknown';
  const normalizedSocketIp = normalizeIp(socketIp);

  // If socket IP is not from a trusted proxy, don't trust forwarded headers
  if (!isTrustedProxy(socketIp)) {
    return normalizedSocketIp;
  }

  // Check X-Forwarded-For first (may contain comma-separated chain)
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const xffValue = Array.isArray(xff) ? xff[0] : xff;
    // X-Forwarded-For format: "client, proxy1, proxy2, ..."
    // We want the leftmost (original client) IP
    const clientIp = xffValue.split(',')[0];
    if (clientIp) {
      const normalized = normalizeIp(clientIp);
      if (normalized && normalized !== 'unknown') {
        return normalized;
      }
    }
  }

  // Check X-Real-IP (nginx convention - single IP)
  const xri = req.headers['x-real-ip'];
  if (xri) {
    const xriValue = Array.isArray(xri) ? xri[0] : xri;
    const normalized = normalizeIp(xriValue);
    if (normalized && normalized !== 'unknown') {
      return normalized;
    }
  }

  // Fall back to socket.remoteAddress
  return normalizedSocketIp;
}

/**
 * Get configuration status for debugging
 */
export function getProxyTrustStatus(): {
  enabled: boolean;
  trustedCidrs: string[];
} {
  return {
    enabled: proxyTrustEnabled,
    trustedCidrs: [...trustedProxyCidrs],
  };
}
