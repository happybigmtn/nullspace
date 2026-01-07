/**
 * Player Name Validation Utilities
 *
 * Validates and sanitizes player names to prevent:
 * - XSS/injection attacks
 * - Invalid or malicious names
 * - Names that could cause display issues
 */

/**
 * Player name length constraints
 */
export const PLAYER_NAME_MIN_LENGTH = 2;
export const PLAYER_NAME_MAX_LENGTH = 32;

/**
 * Allowed characters: alphanumeric, underscore, hyphen, space
 * No special characters that could be used for XSS or injection
 */
const ALLOWED_CHARS_REGEX = /^[a-zA-Z0-9_\-\s]+$/;

/**
 * Characters that should be stripped for sanitization
 */
const DANGEROUS_CHARS_REGEX = /[<>'"&\/\\`\x00-\x1f\x7f-\x9f]/g;

/**
 * Result of player name validation
 */
export interface PlayerNameValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Validate a player name
 *
 * @param name - The player name to validate
 * @returns Validation result with error message if invalid
 */
export function validatePlayerName(name: unknown): PlayerNameValidationResult {
  // Type check
  if (typeof name !== 'string') {
    return {
      valid: false,
      error: 'Player name must be a string',
    };
  }

  // Empty check
  if (!name || name.length === 0) {
    return {
      valid: false,
      error: 'Player name cannot be empty',
    };
  }

  // Whitespace-only check
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: 'Player name cannot be whitespace only',
    };
  }

  // Minimum length check
  if (trimmed.length < PLAYER_NAME_MIN_LENGTH) {
    return {
      valid: false,
      error: `Player name must be at least ${PLAYER_NAME_MIN_LENGTH} characters`,
    };
  }

  // Maximum length check
  if (trimmed.length > PLAYER_NAME_MAX_LENGTH) {
    return {
      valid: false,
      error: `Player name cannot exceed ${PLAYER_NAME_MAX_LENGTH} characters`,
    };
  }

  // Character restriction check
  if (!ALLOWED_CHARS_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'Player name can only contain letters, numbers, underscores, hyphens, and spaces',
    };
  }

  // Check for consecutive spaces
  if (/\s{2,}/.test(trimmed)) {
    return {
      valid: false,
      error: 'Player name cannot contain consecutive spaces',
    };
  }

  // Check for leading/trailing hyphens or underscores
  if (/^[-_]|[-_]$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Player name cannot start or end with hyphen or underscore',
    };
  }

  return {
    valid: true,
    sanitized: trimmed,
  };
}

/**
 * Sanitize a player name by removing dangerous characters
 * Used as a fallback when validation fails but we need a safe value
 *
 * @param name - The player name to sanitize
 * @returns Sanitized name (may be empty if all characters were dangerous)
 */
export function sanitizePlayerName(name: string): string {
  if (typeof name !== 'string') {
    return '';
  }

  return name
    // Remove dangerous characters (XSS/injection vectors)
    .replace(DANGEROUS_CHARS_REGEX, '')
    // Remove non-allowed characters
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    // Trim leading/trailing whitespace
    .trim()
    // Truncate to max length
    .slice(0, PLAYER_NAME_MAX_LENGTH);
}

/**
 * Generate a safe default player name from a public key
 *
 * @param publicKeyHex - The hex-encoded public key
 * @returns A safe default player name
 */
export function generateDefaultPlayerName(publicKeyHex: string): string {
  const prefix = 'Player_';
  // Use first 8 chars of public key, ensuring they're alphanumeric
  const suffix = publicKeyHex.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return prefix + suffix;
}

/**
 * Validate and optionally sanitize a player name
 * Returns sanitized version if input is invalid but salvageable
 *
 * @param name - The player name to validate
 * @param fallbackPublicKey - Optional public key for generating fallback name
 * @returns Object with validated/sanitized name or fallback
 */
export function getValidPlayerName(
  name: string | undefined | null,
  fallbackPublicKey?: string
): { name: string; wasModified: boolean } {
  // If no name provided, use default
  if (!name || typeof name !== 'string') {
    return {
      name: fallbackPublicKey
        ? generateDefaultPlayerName(fallbackPublicKey)
        : 'Player',
      wasModified: true,
    };
  }

  // Try validation first
  const validation = validatePlayerName(name);
  if (validation.valid && validation.sanitized) {
    return {
      name: validation.sanitized,
      wasModified: name !== validation.sanitized,
    };
  }

  // Try sanitization
  const sanitized = sanitizePlayerName(name);
  const sanitizedValidation = validatePlayerName(sanitized);

  if (sanitizedValidation.valid && sanitizedValidation.sanitized) {
    return {
      name: sanitizedValidation.sanitized,
      wasModified: true,
    };
  }

  // Fall back to generated name
  return {
    name: fallbackPublicKey
      ? generateDefaultPlayerName(fallbackPublicKey)
      : 'Player',
    wasModified: true,
  };
}
