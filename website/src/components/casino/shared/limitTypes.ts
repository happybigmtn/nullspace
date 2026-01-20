/**
 * Limit Types - AC-7.5: TypeScript types for exposure and responsible gaming errors
 *
 * These types mirror the Rust backend types:
 * - ExposureLimitError: Errors from house bankroll/exposure limit checks
 * - ResponsibleGamingError: Errors from player responsible gaming limit checks
 */

// =============================================================================
// Exposure Limit Errors (mirrors types/src/casino/economy.rs)
// =============================================================================

/**
 * Error codes for exposure limit violations
 */
export type ExposureLimitErrorCode =
  | 'SINGLE_BET_EXCEEDED'
  | 'PLAYER_EXPOSURE_EXCEEDED'
  | 'HOUSE_EXPOSURE_EXCEEDED';

/**
 * Structured error when single bet amount exceeds maximum
 */
export interface SingleBetExceededError {
  code: 'SINGLE_BET_EXCEEDED';
  betAmount: number;
  maxAllowed: number;
}

/**
 * Structured error when player's total exposure would exceed limit
 */
export interface PlayerExposureExceededError {
  code: 'PLAYER_EXPOSURE_EXCEEDED';
  currentExposure: number;
  newExposure: number;
  maxAllowed: number;
}

/**
 * Structured error when house's total exposure would exceed capacity
 */
export interface HouseExposureExceededError {
  code: 'HOUSE_EXPOSURE_EXCEEDED';
  currentExposure: number;
  newExposure: number;
  maxAllowed: number;
}

export type ExposureLimitError =
  | SingleBetExceededError
  | PlayerExposureExceededError
  | HouseExposureExceededError;

// =============================================================================
// Responsible Gaming Errors (mirrors types/src/casino/economy.rs)
// =============================================================================

/**
 * Error codes for responsible gaming limit violations
 */
export type ResponsibleGamingErrorCode =
  | 'SELF_EXCLUDED'
  | 'IN_COOLDOWN'
  | 'DAILY_WAGER_CAP_EXCEEDED'
  | 'WEEKLY_WAGER_CAP_EXCEEDED'
  | 'MONTHLY_WAGER_CAP_EXCEEDED'
  | 'DAILY_LOSS_CAP_REACHED'
  | 'WEEKLY_LOSS_CAP_REACHED'
  | 'MONTHLY_LOSS_CAP_REACHED';

/**
 * Player is currently self-excluded
 */
export interface SelfExcludedError {
  code: 'SELF_EXCLUDED';
  untilTs: number;
}

/**
 * Player is in cooldown period after self-exclusion ended
 */
export interface InCooldownError {
  code: 'IN_COOLDOWN';
  untilTs: number;
}

/**
 * Daily wager cap would be exceeded by this bet
 */
export interface DailyWagerCapExceededError {
  code: 'DAILY_WAGER_CAP_EXCEEDED';
  current: number;
  cap: number;
  betAmount: number;
}

/**
 * Weekly wager cap would be exceeded by this bet
 */
export interface WeeklyWagerCapExceededError {
  code: 'WEEKLY_WAGER_CAP_EXCEEDED';
  current: number;
  cap: number;
  betAmount: number;
}

/**
 * Monthly wager cap would be exceeded by this bet
 */
export interface MonthlyWagerCapExceededError {
  code: 'MONTHLY_WAGER_CAP_EXCEEDED';
  current: number;
  cap: number;
  betAmount: number;
}

/**
 * Daily loss cap has been reached
 */
export interface DailyLossCapReachedError {
  code: 'DAILY_LOSS_CAP_REACHED';
  currentLoss: number;
  cap: number;
}

/**
 * Weekly loss cap has been reached
 */
export interface WeeklyLossCapReachedError {
  code: 'WEEKLY_LOSS_CAP_REACHED';
  currentLoss: number;
  cap: number;
}

/**
 * Monthly loss cap has been reached
 */
export interface MonthlyLossCapReachedError {
  code: 'MONTHLY_LOSS_CAP_REACHED';
  currentLoss: number;
  cap: number;
}

export type ResponsibleGamingError =
  | SelfExcludedError
  | InCooldownError
  | DailyWagerCapExceededError
  | WeeklyWagerCapExceededError
  | MonthlyWagerCapExceededError
  | DailyLossCapReachedError
  | WeeklyLossCapReachedError
  | MonthlyLossCapReachedError;

// =============================================================================
// Extended Bet Validation Error
// =============================================================================

/**
 * Extended error codes including all limit-related errors
 */
export type ExtendedBetErrorCode =
  // Existing codes
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_AMOUNT'
  | 'PHASE_LOCKED'
  | 'CONNECTION_ERROR'
  | 'SUBMISSION_FAILED'
  | 'VALIDATION_FAILED'
  // Exposure limit codes
  | ExposureLimitErrorCode
  // Responsible gaming codes
  | ResponsibleGamingErrorCode;

/**
 * Extended bet validation error with rich structured data
 */
export interface ExtendedBetValidationError {
  code: ExtendedBetErrorCode;
  message: string;
  retryable: boolean;
  /** Additional structured data for limit errors */
  details?: ExposureLimitError | ResponsibleGamingError;
}

// =============================================================================
// Player Exposure Warning State (for proactive warnings)
// =============================================================================

/**
 * Warning levels for approaching limits
 */
export type WarningLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Current player exposure state for displaying warnings
 */
export interface PlayerExposureState {
  /** Current pending bet exposure (total of unfinalised bets) */
  currentExposure: number;
  /** Maximum allowed player exposure */
  maxExposure: number;
  /** Percentage of exposure used (0-100) */
  exposurePercentage: number;
  /** Warning level based on proximity to limit */
  warningLevel: WarningLevel;
}

/**
 * Current player responsible gaming state for displaying warnings
 */
export interface PlayerGamingLimitsState {
  /** Daily wager tracking */
  daily: {
    wagered: number;
    cap: number;
    percentage: number;
    warningLevel: WarningLevel;
  };
  /** Weekly wager tracking */
  weekly: {
    wagered: number;
    cap: number;
    percentage: number;
    warningLevel: WarningLevel;
  };
  /** Monthly wager tracking */
  monthly: {
    wagered: number;
    cap: number;
    percentage: number;
    warningLevel: WarningLevel;
  };
  /** Daily loss tracking */
  dailyLoss: {
    currentLoss: number;
    cap: number;
    percentage: number;
    warningLevel: WarningLevel;
  };
  /** Weekly loss tracking */
  weeklyLoss: {
    currentLoss: number;
    cap: number;
    percentage: number;
    warningLevel: WarningLevel;
  };
  /** Monthly loss tracking */
  monthlyLoss: {
    currentLoss: number;
    cap: number;
    percentage: number;
    warningLevel: WarningLevel;
  };
  /** Self-exclusion status */
  selfExcluded: boolean;
  selfExclusionEndsAt?: number;
  /** Cooldown status */
  inCooldown: boolean;
  cooldownEndsAt?: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate warning level based on percentage of limit used
 */
export function calculateWarningLevel(percentage: number): WarningLevel {
  if (percentage >= 100) return 'critical';
  if (percentage >= 90) return 'high';
  if (percentage >= 75) return 'medium';
  if (percentage >= 50) return 'low';
  return 'none';
}

/**
 * Format a monetary amount for display
 */
export function formatLimitAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '$0';
  return `$${Math.floor(amount).toLocaleString()}`;
}

/**
 * Format a timestamp as a human-readable "time until" string
 */
export function formatTimeUntil(timestampMs: number): string {
  const now = Date.now();
  const diff = timestampMs - now;

  if (diff <= 0) return 'now';

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days === 1 ? '' : 's'}`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

/**
 * Check if an error code is an exposure limit error
 */
export function isExposureLimitError(code: string): code is ExposureLimitErrorCode {
  return (
    code === 'SINGLE_BET_EXCEEDED' ||
    code === 'PLAYER_EXPOSURE_EXCEEDED' ||
    code === 'HOUSE_EXPOSURE_EXCEEDED'
  );
}

/**
 * Check if an error code is a responsible gaming error
 */
export function isResponsibleGamingError(code: string): code is ResponsibleGamingErrorCode {
  return (
    code === 'SELF_EXCLUDED' ||
    code === 'IN_COOLDOWN' ||
    code === 'DAILY_WAGER_CAP_EXCEEDED' ||
    code === 'WEEKLY_WAGER_CAP_EXCEEDED' ||
    code === 'MONTHLY_WAGER_CAP_EXCEEDED' ||
    code === 'DAILY_LOSS_CAP_REACHED' ||
    code === 'WEEKLY_LOSS_CAP_REACHED' ||
    code === 'MONTHLY_LOSS_CAP_REACHED'
  );
}

/**
 * Check if an error is retryable (exposure/gaming limits are NOT retryable)
 */
export function isLimitErrorRetryable(code: ExtendedBetErrorCode): boolean {
  // Limit errors are not retryable - player must change their bet
  if (isExposureLimitError(code)) return false;
  if (isResponsibleGamingError(code)) return false;

  // These specific errors are not retryable
  if (code === 'INSUFFICIENT_FUNDS') return false;
  if (code === 'INVALID_AMOUNT') return false;
  if (code === 'PHASE_LOCKED') return false;

  // Connection and submission errors may be retryable
  return code === 'CONNECTION_ERROR' || code === 'SUBMISSION_FAILED';
}

/**
 * Generate a user-friendly message for limit errors
 */
export function getLimitErrorMessage(error: ExposureLimitError | ResponsibleGamingError): string {
  switch (error.code) {
    case 'SINGLE_BET_EXCEEDED':
      return `Bet of ${formatLimitAmount(error.betAmount)} exceeds the maximum single bet of ${formatLimitAmount(error.maxAllowed)}. Please reduce your bet.`;

    case 'PLAYER_EXPOSURE_EXCEEDED':
      return `This bet would bring your total exposure to ${formatLimitAmount(error.newExposure)}, exceeding your ${formatLimitAmount(error.maxAllowed)} limit. Please wait for pending bets to settle or reduce your bet.`;

    case 'HOUSE_EXPOSURE_EXCEEDED':
      return `The house cannot accept this bet at this time due to exposure limits. Please try a smaller bet or wait for other bets to settle.`;

    case 'SELF_EXCLUDED':
      return `Your account is self-excluded until ${new Date(error.untilTs).toLocaleDateString()}. Please wait for the exclusion period to end.`;

    case 'IN_COOLDOWN':
      return `Your account is in a cooldown period until ${new Date(error.untilTs).toLocaleDateString()}. Please wait before placing bets.`;

    case 'DAILY_WAGER_CAP_EXCEEDED':
      return `This bet of ${formatLimitAmount(error.betAmount)} would exceed your daily wager limit. You've wagered ${formatLimitAmount(error.current)} of your ${formatLimitAmount(error.cap)} daily cap.`;

    case 'WEEKLY_WAGER_CAP_EXCEEDED':
      return `This bet of ${formatLimitAmount(error.betAmount)} would exceed your weekly wager limit. You've wagered ${formatLimitAmount(error.current)} of your ${formatLimitAmount(error.cap)} weekly cap.`;

    case 'MONTHLY_WAGER_CAP_EXCEEDED':
      return `This bet of ${formatLimitAmount(error.betAmount)} would exceed your monthly wager limit. You've wagered ${formatLimitAmount(error.current)} of your ${formatLimitAmount(error.cap)} monthly cap.`;

    case 'DAILY_LOSS_CAP_REACHED':
      return `You've reached your daily loss limit of ${formatLimitAmount(error.cap)}. Please wait until tomorrow to continue playing.`;

    case 'WEEKLY_LOSS_CAP_REACHED':
      return `You've reached your weekly loss limit of ${formatLimitAmount(error.cap)}. Please wait until next week to continue playing.`;

    case 'MONTHLY_LOSS_CAP_REACHED':
      return `You've reached your monthly loss limit of ${formatLimitAmount(error.cap)}. Please wait until next month to continue playing.`;

    default:
      return 'A limit error occurred. Please try again later.';
  }
}
