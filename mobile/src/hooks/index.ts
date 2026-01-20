/**
 * Hooks - Barrel Export
 */

export { useKeyboardControls, useGameKeyboard, KEY_ACTIONS } from './useKeyboardControls';
export type { KeyAction } from './useKeyboardControls';

export { useAppState } from './useAppState';

export { useGameConnection } from './useGameConnection';
export { useChipBetting } from './useChipBetting';
export { useBetSubmission } from './useBetSubmission';
export { useGatewaySession } from './useGatewaySession';
export { useEntitlements } from './useEntitlements';
export { useModalBackHandler } from './useModalBackHandler';
export { useWebSocketReconnectOnForeground } from './useWebSocketReconnectOnForeground';
export { useThemedColors, useGlow } from './useThemedColors';
export { useCelebration } from './useCelebration';
export type { CelebrationState, CelebrationIntensity, CelebrationConfig } from './useCelebration';
export { useWinCelebration } from './useWinCelebration';
export { useBetConfirmation } from './useBetConfirmation';
export { useReducedMotion, getAccessibleAnimationConfig, getAccessibleSpringConfig } from './useReducedMotion';
export { useScreenShake } from './useScreenShake';
export type { ShakeIntensity } from './useScreenShake';
export {
  useLayoutAnimation,
  useListItemAnimation,
  useEnterAnimation,
  useExitAnimation,
  useSharedElementTransition,
} from './useLayoutAnimation';
export { useParallaxTilt } from './useParallaxTilt';
export type { ParallaxTiltOptions, ParallaxTiltResult } from './useParallaxTilt';
// Bet history (US-165)
export { useBetHistory } from './useBetHistory';
// Wallet connection (AC-8.1)
export { useWalletConnection } from './useWalletConnection';
export type {
  WalletConnectionStatus,
  WalletConnectionState,
  WalletConnectionActions,
} from './useWalletConnection';
