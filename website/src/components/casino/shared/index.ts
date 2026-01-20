export { BetItem } from './BetItem';
export { BetsSidebar } from './BetsSidebar';
export { BetSlip } from './BetSlip';
export { BetSlipWithConfirmation, validateBetSlip } from './BetSlipWithConfirmation';
export type {
  BetSlipBet,
  BetSlipStatus,
  BetSlipWithConfirmationProps,
  BetValidationError,
} from './BetSlipWithConfirmation';

// AC-7.5: Limit error and exposure warning components
export { LimitErrorDisplay } from './LimitErrorDisplay';
export type { LimitErrorDisplayProps } from './LimitErrorDisplay';
export { ExposureWarningBanner } from './ExposureWarningBanner';
export type { ExposureWarningBannerProps } from './ExposureWarningBanner';

// AC-7.5: Limit types and helpers
export {
  // Error type guards
  isExposureLimitError,
  isResponsibleGamingError,
  isLimitErrorRetryable,
  // Helper functions
  calculateWarningLevel,
  formatLimitAmount,
  formatTimeUntil,
  getLimitErrorMessage,
} from './limitTypes';
export type {
  // Exposure limit errors
  ExposureLimitError,
  ExposureLimitErrorCode,
  SingleBetExceededError,
  PlayerExposureExceededError,
  HouseExposureExceededError,
  // Responsible gaming errors
  ResponsibleGamingError,
  ResponsibleGamingErrorCode,
  SelfExcludedError,
  InCooldownError,
  DailyWagerCapExceededError,
  WeeklyWagerCapExceededError,
  MonthlyWagerCapExceededError,
  DailyLossCapReachedError,
  WeeklyLossCapReachedError,
  MonthlyLossCapReachedError,
  // Extended error types
  ExtendedBetErrorCode,
  ExtendedBetValidationError,
  // Warning state types
  WarningLevel,
  PlayerExposureState,
  PlayerGamingLimitsState,
} from './limitTypes';
