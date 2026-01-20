/**
 * Error code taxonomy for gateway responses
 */

export const ErrorCodes = {
  // Client errors (4xx equivalent)
  INVALID_MESSAGE: 'INVALID_MESSAGE',           // Malformed JSON or unknown type
  UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL', // Protocol version not supported
  INVALID_GAME_TYPE: 'INVALID_GAME_TYPE',       // Unknown game type
  INVALID_BET: 'INVALID_BET',                   // Bet amount out of range
  NO_ACTIVE_GAME: 'NO_ACTIVE_GAME',             // Move without active game
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE', // Not enough chips
  NOT_REGISTERED: 'NOT_REGISTERED',             // Player not registered

  // Backend errors (5xx equivalent)
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',   // Can't reach simulator
  TRANSACTION_REJECTED: 'TRANSACTION_REJECTED', // Backend rejected tx
  NONCE_MISMATCH: 'NONCE_MISMATCH',             // Nonce out of sync
  INTERNAL_ERROR: 'INTERNAL_ERROR',             // Unexpected error

  // Session errors
  SESSION_EXPIRED: 'SESSION_EXPIRED',           // Session timed out
  GAME_IN_PROGRESS: 'GAME_IN_PROGRESS',         // Can't start new game
  REGISTRATION_FAILED: 'REGISTRATION_FAILED',   // Failed to register player

  // Rate limiting errors
  RATE_LIMITED: 'RATE_LIMITED',                 // Message rate limit exceeded

  // Feature deferment errors (M0b)
  FEATURE_DISABLED: 'FEATURE_DISABLED',         // Feature is disabled/deferred
  LIVE_MODE_DISABLED: 'LIVE_MODE_DISABLED',     // Live table mode disabled
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Structured error response
 */
export interface ErrorResponse {
  type: 'error';
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Create error response
 */
export function createError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): ErrorResponse {
  return {
    type: 'error',
    code,
    message,
    ...(details && { details }),
  };
}
