/**
 * Protocol version handling for binary messages.
 *
 * All encoded messages include a 1-byte version header as the first byte.
 * This enables future protocol evolution without breaking existing clients.
 *
 * Version negotiation:
 * - Client sends messages with CURRENT_PROTOCOL_VERSION
 * - Server validates version is within SUPPORTED_PROTOCOL_VERSIONS
 * - Unknown versions result in UnsupportedProtocolVersionError
 */

import { ProtocolError } from './errors.js';

/** Current protocol version used for encoding messages */
export const CURRENT_PROTOCOL_VERSION = 1;

/** Minimum supported protocol version (for backward compatibility) */
export const MIN_PROTOCOL_VERSION = 1;

/** Maximum supported protocol version (current) */
export const MAX_PROTOCOL_VERSION = 1;

/** Error thrown when an unsupported protocol version is encountered */
export class UnsupportedProtocolVersionError extends ProtocolError {
  readonly version: number;

  constructor(version: number) {
    super(`Unsupported protocol version: ${version} (supported: ${MIN_PROTOCOL_VERSION}-${MAX_PROTOCOL_VERSION})`);
    this.name = 'UnsupportedProtocolVersionError';
    this.version = version;
  }
}

/**
 * Check if a protocol version is supported
 */
export function isVersionSupported(version: number): boolean {
  return version >= MIN_PROTOCOL_VERSION && version <= MAX_PROTOCOL_VERSION;
}

/**
 * Validate protocol version, throwing if unsupported
 */
export function validateVersion(version: number): void {
  if (!isVersionSupported(version)) {
    throw new UnsupportedProtocolVersionError(version);
  }
}

/**
 * Prepend version header to a payload
 */
export function withVersionHeader(payload: Uint8Array): Uint8Array {
  const versioned = new Uint8Array(1 + payload.length);
  versioned[0] = CURRENT_PROTOCOL_VERSION;
  versioned.set(payload, 1);
  return versioned;
}

/**
 * Extract and validate version from a versioned message
 * Returns the payload without the version header
 *
 * @throws UnsupportedProtocolVersionError if version is not supported
 */
export function stripVersionHeader(data: Uint8Array): { version: number; payload: Uint8Array } {
  if (data.length < 1) {
    throw new ProtocolError('Message too short: missing version header');
  }

  const version = data[0];
  validateVersion(version);

  return {
    version,
    payload: data.slice(1),
  };
}

/**
 * Peek at version without validating or stripping
 * Useful for debugging or logging
 */
export function peekVersion(data: Uint8Array): number | null {
  if (data.length < 1) {
    return null;
  }
  return data[0];
}
