/**
 * Color tokens for Nullspace design system
 * Consumed by Tailwind (web) and StyleSheet (mobile)
 *
 * NO platform-specific code - raw values only
 */

/**
 * Titanium color palette - Jony Ive inspired neutral scale
 * Used for backgrounds, text, and UI chrome
 */
export const TITANIUM = {
  50: '#FAFAFA',
  100: '#F5F5F5',
  200: '#E5E5E5',
  300: '#D4D4D4',
  400: '#A3A3A3',
  500: '#737373',
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  950: '#0A0A0A',
} as const;

/**
 * Action colors for interactive elements and states
 * Indigo is the Nullspace brand color
 */
export const ACTION = {
  indigo: '#5E5CE6',
  indigoHover: '#4B4ACE',
  indigoMuted: 'rgba(94, 92, 230, 0.15)',
  success: '#34C759',
  successMuted: 'rgba(52, 199, 89, 0.15)',
  error: '#FF3B30',
  errorMuted: 'rgba(255, 59, 48, 0.15)',
  warning: '#FF9500',
} as const;

/**
 * Game-specific color schemes
 * Each game has a primary (background) and accent (highlights) color
 */
export const GAME = {
  blackjack: { primary: '#1E3A5F', accent: '#4A90D9' },
  roulette: { primary: '#2D5016', accent: '#8B0000' },
  craps: { primary: '#4A2C0A', accent: '#D4AF37' },
  baccarat: { primary: '#2C1810', accent: '#C5A572' },
  videoPoker: { primary: '#1A1A2E', accent: '#E94560' },
  hiLo: { primary: '#16213E', accent: '#0F3460' },
  sicBo: { primary: '#3D0C02', accent: '#FF6B35' },
  threeCard: { primary: '#1B4332', accent: '#52B788' },
  ultimateHoldem: { primary: '#2D3436', accent: '#00B894' },
  casinoWar: { primary: '#2C3E50', accent: '#E74C3C' },
} as const;

// Type exports for type inference
export type TitaniumShade = keyof typeof TITANIUM;
export type TitaniumColor = (typeof TITANIUM)[TitaniumShade];

export type ActionColor = keyof typeof ACTION;
export type ActionColorValue = (typeof ACTION)[ActionColor];

export type GameId = keyof typeof GAME;
export type GameColorScheme = (typeof GAME)[GameId];
