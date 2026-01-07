import { timingSafeEqual } from 'node:crypto';

export const AUTH_CHALLENGE_PREFIX = 'nullspace-auth:';
export const EVM_LINK_PREFIX = 'nullspace-evm-link';

export const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export const normalizeHex = (value: string): string =>
  value.trim().toLowerCase().replace(/^0x/, '');

export const isHex = (value: string, length?: number): boolean => {
  if (!/^[0-9a-f]+$/.test(value)) return false;
  if (length !== undefined && value.length !== length) return false;
  return true;
};

export const parseChainId = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

export const buildAuthMessage = (challengeHex: string): Buffer => {
  return Buffer.concat([
    Buffer.from(AUTH_CHALLENGE_PREFIX, 'utf8'),
    Buffer.from(challengeHex, 'hex'),
  ]);
};

export const buildEvmLinkMessage = (params: {
  origin: string;
  address: string;
  chainId: number;
  userId: string;
  challenge: string;
}): string => {
  const { origin, address, chainId, userId, challenge } = params;
  return [
    EVM_LINK_PREFIX,
    `origin:${origin}`,
    `address:${address}`,
    `chainId:${chainId}`,
    `userId:${userId}`,
    `nonce:${challenge}`,
  ].join('\n');
};

export const buildAiPrompt = (payload: {
  gameType: string;
  playerCards: unknown[];
  dealerUpCard: unknown | null;
  history: unknown[];
}): string => {
  const { gameType, playerCards, dealerUpCard, history } = payload;
  return [
    'You are a casino strategy assistant. Reply with one short sentence.',
    `Game: ${gameType}`,
    `Player cards: ${JSON.stringify(playerCards)}`,
    `Dealer up card: ${JSON.stringify(dealerUpCard)}`,
    `History: ${JSON.stringify(history)}`,
  ].join('\n');
};

export const extractSecretValue = (payload: string): string | null => {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, any>;
      const candidates = [
        parsed.CASINO_ADMIN_PRIVATE_KEY_HEX,
        parsed.adminKeyHex,
        parsed.admin_key_hex,
        parsed.key,
        parsed.value,
        parsed.secret,
        parsed?.data?.key,
        parsed?.data?.value,
        parsed?.data?.secret,
        parsed?.data?.data?.key,
        parsed?.data?.data?.value,
        parsed?.data?.data?.secret,
      ];
      const found = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
      return found ? String(found).trim() : null;
    } catch {
      return null;
    }
  }
  return trimmed;
};

export const parseLimit = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(255, Math.floor(parsed));
};

export const getMemberTiers = (raw: string): string[] => {
  return raw
    .split(',')
    .map((tier) => tier.trim())
    .filter(Boolean);
};

export type Entitlement = {
  tier?: string;
  status?: string;
  source?: string;
};

export const hasActiveEntitlement = (entitlements: Entitlement[], tiers: string[]): boolean => {
  return entitlements.some((entitlement) => {
    if (!ACTIVE_STATUSES.has(entitlement.status ?? '')) return false;
    if (tiers.length === 0) return true;
    return tiers.includes(entitlement.tier ?? '');
  });
};

export const hexToBytes = (hex: string): Uint8Array => {
  const normalized = normalizeHex(hex);
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
};

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Constant-time string comparison to prevent timing attacks (US-139)
 *
 * Uses crypto.timingSafeEqual() which always compares all bytes regardless
 * of where the first mismatch occurs. This prevents attackers from measuring
 * response time to deduce the correct value byte-by-byte.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 */
export const timingSafeStringEqual = (a: string | undefined | null, b: string | undefined | null): boolean => {
  // Handle null/undefined cases - timing doesn't matter for null checks
  if (a == null || b == null) {
    return false;
  }

  // Convert to buffers for comparison
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Different byte lengths cannot be equal - this is safe to leak
  // because timing attacks need the ability to guess byte-by-byte
  // Note: We check byte length, not string length, due to multi-byte UTF-8 characters
  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
};
