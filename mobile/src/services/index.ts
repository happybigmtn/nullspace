/**
 * Services - Barrel Export
 */

export { getPublicKey, signMessage, bytesToHex, hexToBytes } from './crypto';
export { HapticsService, haptics } from './haptics';
export { useWebSocket, getWebSocketUrl } from './websocket';
export {
  authenticateWithBiometrics,
  initializeAuth,
  getBiometricType,
  getSupportedAuthTypes,
  hasBiometricHardware,
  isBiometricEnrolled,
} from './auth';
export {
  initializeStorage,
  getStorage,
  STORAGE_KEYS,
  isTutorialCompleted,
  markTutorialCompleted,
  isOnboardingCompleted,
  markOnboardingCompleted,
  hasPlayedFirstGame,
  markFirstGamePlayed,
  getBoolean,
  setBoolean,
  getString,
  setString,
  getNumber,
  setNumber,
} from './storage';
export { initializeNotifications } from './notifications';
