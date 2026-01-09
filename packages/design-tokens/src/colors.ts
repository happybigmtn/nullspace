/**
 * Color tokens for Nullspace design system
 * Consumed by Tailwind (web) and StyleSheet (mobile)
 *
 * NO platform-specific code - raw values only
 *
 * Monochrome Redesign (US-260):
 * - Entirely monochrome, high-contrast, edgy visual system
 * - No hue-based colors - only grayscale with contrast differentiation
 * - Game identity via texture/pattern, not color
 */

/**
 * Monochrome palette - High-contrast grayscale
 *
 * Extended scale with pure black (0) and pure white (1000) for maximum edge contrast.
 * Luxury meets brutalist: sharp, sophisticated, no compromise.
 */
export const MONO = {
  // Pure extremes
  0: '#000000',      // Pure black - OLED savings, maximum contrast
  50: '#0A0A0A',     // Near-black - dark mode backgrounds
  100: '#141414',    // Dark surface
  150: '#1A1A1A',    // Elevated dark surface
  200: '#262626',    // Dark borders, subtle dividers
  300: '#404040',    // Dark mode muted text
  400: '#525252',    // Mid-gray
  500: '#737373',    // Neutral mid-point
  600: '#A3A3A3',    // Light mode muted text
  700: '#D4D4D4',    // Light borders
  800: '#E5E5E5',    // Light surface
  900: '#F5F5F5',    // Light background
  950: '#FAFAFA',    // Near-white background
  1000: '#FFFFFF',   // Pure white
} as const;

/**
 * @deprecated Use MONO instead. Kept for backwards compatibility.
 */
export const TITANIUM = {
  50: MONO[950],
  100: MONO[900],
  200: MONO[800],
  300: MONO[700],
  400: MONO[600],
  500: MONO[500],
  600: MONO[400],
  700: MONO[300],
  800: MONO[200],
  900: MONO[100],
  950: MONO[50],
} as const;

/**
 * Semantic color aliases - Monochrome Redesign
 *
 * Use these instead of numbered shades.
 * Optimized for maximum contrast and readability.
 */
export const SEMANTIC = {
  // Light mode - high contrast white theme
  light: {
    background: MONO[1000],     // Pure white background
    surface: MONO[950],         // Near-white cards, panels
    surfaceElevated: MONO[900], // Elevated surfaces
    border: MONO[700],          // Visible borders
    borderSubtle: MONO[800],    // Subtle dividers
    textPrimary: MONO[0],       // Pure black text - maximum contrast
    textSecondary: MONO[400],   // Secondary text
    textMuted: MONO[500],       // Muted text, hints
    textDisabled: MONO[600],    // Disabled state
  },
  // Dark mode - OLED-optimized pure black
  dark: {
    background: MONO[0],        // Pure black - OLED battery savings
    surface: MONO[50],          // Near-black cards
    surfaceElevated: MONO[100], // Elevated surfaces
    border: MONO[200],          // Visible borders
    borderSubtle: MONO[150],    // Subtle dividers
    textPrimary: MONO[1000],    // Pure white text - maximum contrast
    textSecondary: MONO[600],   // Secondary text
    textMuted: MONO[500],       // Muted text, hints
    textDisabled: MONO[400],    // Disabled state
  },
} as const;

/**
 * State tokens - Monochrome state differentiation
 *
 * Instead of colored states (green=success, red=error), we use:
 * - Contrast levels (high/medium/low)
 * - Edge treatments (sharp borders, glows)
 * - Opacity variations
 *
 * This maintains accessibility while staying strictly monochrome.
 */
export const STATE = {
  // Interactive states (buttons, links)
  interactive: {
    default: MONO[0],           // Primary interactive color
    hover: MONO[200],           // Hover state (slightly lighter)
    active: MONO[100],          // Active/pressed state
    disabled: MONO[500],        // Disabled state
  },
  // Success state - uses high contrast + optional checkmark icon
  success: {
    background: MONO[0],        // Black background
    foreground: MONO[1000],     // White text
    border: MONO[0],            // Solid black border
    muted: MONO[200],           // Muted background
  },
  // Error state - uses high contrast + optional X icon
  error: {
    background: MONO[0],        // Black background
    foreground: MONO[1000],     // White text
    border: MONO[0],            // Solid black border
    muted: MONO[200],           // Muted background
  },
  // Warning state - uses medium contrast
  warning: {
    background: MONO[300],      // Dark gray background
    foreground: MONO[1000],     // White text
    border: MONO[400],          // Gray border
    muted: MONO[800],           // Muted background
  },
  // Info state - uses inverted contrast
  info: {
    background: MONO[900],      // Light background
    foreground: MONO[0],        // Black text
    border: MONO[700],          // Light border
    muted: MONO[950],           // Near-white background
  },
} as const;

/**
 * @deprecated Use STATE instead. Kept for backwards compatibility.
 * Maps old ACTION colors to monochrome STATE equivalents.
 */
export const ACTION = {
  indigo: MONO[0],              // Primary action -> black
  indigoHover: MONO[200],       // Hover -> dark gray
  indigoMuted: 'rgba(0, 0, 0, 0.15)', // Muted -> transparent black
  success: MONO[0],             // Success -> black (use icons)
  successMuted: 'rgba(0, 0, 0, 0.15)',
  error: MONO[0],               // Error -> black (use icons)
  errorMuted: 'rgba(0, 0, 0, 0.15)',
  warning: MONO[300],           // Warning -> dark gray
} as const;

/**
 * Game identity - Monochrome differentiation via patterns
 *
 * Instead of colored themes, games are differentiated by:
 * - Geometric patterns (stripes, dots, grids)
 * - Texture density (sparse, medium, dense)
 * - Edge treatment (sharp, rounded, beveled)
 *
 * These are identifiers, not colors. Components use these
 * to select appropriate pattern/texture assets.
 */
export const GAME_PATTERN = {
  blackjack: { pattern: 'diagonal-stripes', density: 'sparse' },
  roulette: { pattern: 'radial-segments', density: 'dense' },
  craps: { pattern: 'dot-grid', density: 'medium' },
  baccarat: { pattern: 'horizontal-lines', density: 'sparse' },
  videoPoker: { pattern: 'vertical-bars', density: 'medium' },
  hiLo: { pattern: 'chevron', density: 'sparse' },
  sicBo: { pattern: 'honeycomb', density: 'dense' },
  threeCard: { pattern: 'triangle-mesh', density: 'medium' },
  ultimateHoldem: { pattern: 'crosshatch', density: 'sparse' },
  casinoWar: { pattern: 'diagonal-grid', density: 'medium' },
} as const;

/**
 * @deprecated Use GAME_PATTERN instead. Kept for backwards compatibility.
 * Maps to monochrome equivalents - all games now use same grayscale.
 */
export const GAME = {
  blackjack: { primary: MONO[50], accent: MONO[300] },
  roulette: { primary: MONO[50], accent: MONO[300] },
  craps: { primary: MONO[50], accent: MONO[300] },
  baccarat: { primary: MONO[50], accent: MONO[300] },
  videoPoker: { primary: MONO[50], accent: MONO[300] },
  hiLo: { primary: MONO[50], accent: MONO[300] },
  sicBo: { primary: MONO[50], accent: MONO[300] },
  threeCard: { primary: MONO[50], accent: MONO[300] },
  ultimateHoldem: { primary: MONO[50], accent: MONO[300] },
  casinoWar: { primary: MONO[50], accent: MONO[300] },
} as const;

/**
 * Edge highlights - For creating depth in monochrome
 *
 * Used for glass effects, borders, and subtle dimensionality
 * without introducing color.
 */
export const EDGE = {
  light: {
    highlight: 'rgba(255, 255, 255, 0.1)',  // Top/left edge highlight
    shadow: 'rgba(0, 0, 0, 0.1)',           // Bottom/right edge shadow
    glow: 'rgba(255, 255, 255, 0.05)',      // Subtle outer glow
  },
  dark: {
    highlight: 'rgba(255, 255, 255, 0.05)', // Subtle highlight on dark
    shadow: 'rgba(0, 0, 0, 0.3)',           // Stronger shadow on dark
    glow: 'rgba(255, 255, 255, 0.02)',      // Very subtle glow
  },
} as const;

// Type exports for type inference
export type MonoShade = keyof typeof MONO;
export type MonoColor = (typeof MONO)[MonoShade];

export type TitaniumShade = keyof typeof TITANIUM;
export type TitaniumColor = (typeof TITANIUM)[TitaniumShade];

export type StateCategory = keyof typeof STATE;
export type StateVariant = keyof (typeof STATE)[StateCategory];

export type ActionColor = keyof typeof ACTION;
export type ActionColorValue = (typeof ACTION)[ActionColor];

export type GameId = keyof typeof GAME;
export type GameColorScheme = (typeof GAME)[GameId];

export type GamePatternId = keyof typeof GAME_PATTERN;
export type GamePatternConfig = (typeof GAME_PATTERN)[GamePatternId];
