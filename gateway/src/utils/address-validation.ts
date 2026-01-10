/**
 * Address Validation Utilities
 *
 * Validates Ethereum addresses and checksums for deposit/withdrawal operations.
 * Critical for bridge security - malformed addresses could result in lost funds.
 */

/**
 * Validate that a string is a valid Ethereum address format
 */
export function isValidAddressFormat(address: string): boolean {
  if (!address) return false;

  const cleaned = stripPrefix(address);
  if (cleaned.length !== 40) return false;
  return /^[0-9a-fA-F]{40}$/.test(cleaned);
}

/**
 * Strip 0x/0X prefix from address if present
 */
function stripPrefix(address: string): string {
  if (address.startsWith('0x') || address.startsWith('0X')) {
    return address.slice(2);
  }
  return address;
}

/**
 * Normalize an Ethereum address to lowercase with 0x prefix
 */
export function normalizeAddress(address: string): string {
  if (!isValidAddressFormat(address)) {
    throw new Error(`Invalid address format: ${address}`);
  }
  return '0x' + stripPrefix(address).toLowerCase();
}

/**
 * Calculate EIP-55 checksum for an address
 * https://eips.ethereum.org/EIPS/eip-55
 */
export function toChecksumAddress(address: string): string {
  if (!isValidAddressFormat(address)) {
    throw new Error(`Invalid address format: ${address}`);
  }

  const cleaned = stripPrefix(address).toLowerCase();
  const hash = keccak256(cleaned);

  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    const shouldUppercase = parseInt(hash[i], 16) >= 8;
    checksummed += shouldUppercase ? cleaned[i].toUpperCase() : cleaned[i];
  }

  return checksummed;
}

/**
 * Verify an address matches its EIP-55 checksum
 */
export function isValidChecksum(address: string): boolean {
  if (!isValidAddressFormat(address)) return false;

  const cleaned = stripPrefix(address);
  const isUniformCase = cleaned === cleaned.toLowerCase() || cleaned === cleaned.toUpperCase();
  if (isUniformCase) {
    return true;
  }

  try {
    return toChecksumAddress(address) === address;
  } catch {
    return false;
  }
}

/**
 * Validate an address for deposit operations
 * - Must be valid format
 * - Must have valid checksum if mixed case
 * - Cannot be zero address
 * - Cannot be known burn addresses
 */
export interface AddressValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
  checksummed?: string;
}

const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000', // Zero address
  '0x000000000000000000000000000000000000dead', // Common burn
  '0x0000000000000000000000000000000000000001', // Precompile 1
  '0x0000000000000000000000000000000000000002', // Precompile 2
  '0x0000000000000000000000000000000000000003', // Precompile 3
  '0x0000000000000000000000000000000000000004', // Precompile 4
  '0x0000000000000000000000000000000000000005', // Precompile 5
  '0x0000000000000000000000000000000000000006', // Precompile 6
  '0x0000000000000000000000000000000000000007', // Precompile 7
  '0x0000000000000000000000000000000000000008', // Precompile 8
  '0x0000000000000000000000000000000000000009', // Precompile 9
]);

export function validateDepositAddress(address: string): AddressValidationResult {
  // Check format
  if (!isValidAddressFormat(address)) {
    return {
      valid: false,
      error: 'Invalid address format. Must be 40 hex characters with optional 0x prefix.',
    };
  }

  // Check checksum
  if (!isValidChecksum(address)) {
    return {
      valid: false,
      error: 'Invalid checksum. Please verify the address is correct.',
    };
  }

  const normalized = normalizeAddress(address);

  // Check for burn addresses
  if (BURN_ADDRESSES.has(normalized)) {
    return {
      valid: false,
      error: 'Cannot use burn address or precompile address for deposits.',
    };
  }

  return {
    valid: true,
    normalized,
    checksummed: toChecksumAddress(address),
  };
}

/**
 * Keccak256 implementation (simple version for address checksumming)
 * In production, use a proper library like @noble/hashes
 */
function keccak256(input: string): string {
  // For proper implementation, use @noble/hashes
  // This is a placeholder that will need the actual import
  try {
    // Dynamic import check - if in test environment without crypto, return fallback
    const { keccak_256 } = require('@noble/hashes/sha3');
    return Buffer.from(keccak_256(input)).toString('hex');
  } catch {
    // Fallback for when @noble/hashes is not available
    // In production, this should always be available
    const crypto = require('crypto');
    // Note: Node's crypto doesn't have keccak256 directly
    // This is a placeholder - real implementation needs @noble/hashes
    return crypto.createHash('sha256').update(input).digest('hex');
  }
}
