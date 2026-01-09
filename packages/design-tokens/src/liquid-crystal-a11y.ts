/**
 * Liquid Crystal Accessibility & Performance Guardrails (US-268)
 *
 * This module provides accessibility and performance constraints for the
 * Liquid Crystal material system to ensure:
 *
 * 1. WCAG 2.1 compliance - Contrast ratios for text on glass surfaces
 * 2. Reduced motion respect - Disable/simplify animations for users with motion sensitivity
 * 3. Performance budgets - Limits on blur/backdrop-filter usage to prevent jank
 *
 * All utilities are runtime-safe (no DOM dependencies) for SSR compatibility.
 */

import { TRANSLUCENCY, LIQUID_CRYSTAL, type LiquidCrystalPreset } from './liquid-crystal.js';
import { MONO } from './colors.js';

// ─────────────────────────────────────────────────────────────────────────────
// WCAG Contrast Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WCAG 2.1 contrast ratio thresholds
 *
 * AA (minimum): 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold)
 * AAA (enhanced): 7:1 for normal text, 4.5:1 for large text
 */
export const WCAG_CONTRAST = {
  /** Normal text minimum (AA) */
  AA_NORMAL: 4.5,
  /** Large text minimum (AA) - 18px+ or 14px+ bold */
  AA_LARGE: 3.0,
  /** Normal text enhanced (AAA) */
  AAA_NORMAL: 7.0,
  /** Large text enhanced (AAA) */
  AAA_LARGE: 4.5,
  /** UI components and graphical objects */
  UI_COMPONENT: 3.0,
} as const;

/**
 * Parse a color string to RGB values
 * Supports hex (#RGB, #RRGGBB), rgb(r,g,b), and rgba(r,g,b,a)
 */
export function parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
  // Hex format
  const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }

  // RGB/RGBA format
  const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  return null;
}

/**
 * Calculate relative luminance per WCAG 2.1 definition
 * @see https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
export function getRelativeLuminance(r: number, g: number, b: number): number {
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;

  const rLinear = rsRGB <= 0.04045 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gLinear = gsRGB <= 0.04045 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bLinear = bsRGB <= 0.04045 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Calculate contrast ratio between two colors
 * @returns Contrast ratio (1:1 to 21:1)
 */
export function getContrastRatio(foreground: string, background: string): number {
  const fg = parseColor(foreground);
  const bg = parseColor(background);

  if (!fg || !bg) {
    return 0;
  }

  const fgLum = getRelativeLuminance(fg.r, fg.g, fg.b);
  const bgLum = getRelativeLuminance(bg.r, bg.g, bg.b);

  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a color combination meets WCAG criteria
 */
export function meetsContrastThreshold(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA' = 'AA',
  textSize: 'normal' | 'large' = 'normal'
): boolean {
  const ratio = getContrastRatio(foreground, background);
  const threshold = level === 'AAA'
    ? (textSize === 'large' ? WCAG_CONTRAST.AAA_LARGE : WCAG_CONTRAST.AAA_NORMAL)
    : (textSize === 'large' ? WCAG_CONTRAST.AA_LARGE : WCAG_CONTRAST.AA_NORMAL);
  return ratio >= threshold;
}

/**
 * Get the effective background color when glass is applied over a base color
 * This helps calculate contrast when text is on a translucent glass surface
 */
export function getEffectiveGlassBackground(
  glassLevel: LiquidCrystalPreset,
  baseBackground: string,
  mode: 'light' | 'dark' = 'light'
): string {
  const glass = LIQUID_CRYSTAL[glassLevel];
  const baseParsed = parseColor(baseBackground);

  if (!baseParsed) {
    return baseBackground;
  }

  // Glass adds white (light mode) or black (dark mode) at the translucency level
  const glassR = mode === 'light' ? 255 : 0;
  const glassG = mode === 'light' ? 255 : 0;
  const glassB = mode === 'light' ? 255 : 0;
  const alpha = glass.translucency;

  // Alpha compositing: result = glass * alpha + base * (1 - alpha)
  const r = Math.round(glassR * alpha + baseParsed.r * (1 - alpha));
  const g = Math.round(glassG * alpha + baseParsed.g * (1 - alpha));
  const b = Math.round(glassB * alpha + baseParsed.b * (1 - alpha));

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Validate that a text color has sufficient contrast on a glass surface
 */
export function validateGlassContrast(
  textColor: string,
  glassLevel: LiquidCrystalPreset,
  baseBackground: string,
  mode: 'light' | 'dark' = 'light',
  options: { level?: 'AA' | 'AAA'; textSize?: 'normal' | 'large' } = {}
): { valid: boolean; ratio: number; threshold: number; suggestion?: string } {
  const { level = 'AA', textSize = 'normal' } = options;

  const effectiveBg = getEffectiveGlassBackground(glassLevel, baseBackground, mode);
  const ratio = getContrastRatio(textColor, effectiveBg);
  const threshold = level === 'AAA'
    ? (textSize === 'large' ? WCAG_CONTRAST.AAA_LARGE : WCAG_CONTRAST.AAA_NORMAL)
    : (textSize === 'large' ? WCAG_CONTRAST.AA_LARGE : WCAG_CONTRAST.AA_NORMAL);

  const valid = ratio >= threshold;

  // Suggest using pure black or white if contrast is insufficient
  let suggestion: string | undefined;
  if (!valid) {
    const blackRatio = getContrastRatio(MONO[0], effectiveBg);
    const whiteRatio = getContrastRatio(MONO[1000], effectiveBg);
    suggestion = blackRatio >= whiteRatio
      ? `Use text-mono-0 (${blackRatio.toFixed(1)}:1 ratio)`
      : `Use text-mono-1000 (${whiteRatio.toFixed(1)}:1 ratio)`;
  }

  return { valid, ratio, threshold, suggestion };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Text Colors for Glass Levels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pre-calculated safe text colors for each glass level
 * These guarantee WCAG AA compliance on common backgrounds
 */
export const GLASS_TEXT_COLORS = {
  light: {
    /** Text colors for light mode glass on white background */
    ghost: { primary: MONO[0], secondary: MONO[400] },
    whisper: { primary: MONO[0], secondary: MONO[400] },
    mist: { primary: MONO[0], secondary: MONO[300] },
    veil: { primary: MONO[0], secondary: MONO[300] },
    smoke: { primary: MONO[0], secondary: MONO[200] },
    fog: { primary: MONO[0], secondary: MONO[200] },
    frost: { primary: MONO[0], secondary: MONO[150] },
    solid: { primary: MONO[0], secondary: MONO[400] },
  },
  dark: {
    /** Text colors for dark mode glass on black background */
    ghost: { primary: MONO[1000], secondary: MONO[500] },
    whisper: { primary: MONO[1000], secondary: MONO[500] },
    mist: { primary: MONO[1000], secondary: MONO[600] },
    veil: { primary: MONO[1000], secondary: MONO[600] },
    smoke: { primary: MONO[1000], secondary: MONO[700] },
    fog: { primary: MONO[1000], secondary: MONO[700] },
    frost: { primary: MONO[1000], secondary: MONO[800] },
    solid: { primary: MONO[1000], secondary: MONO[500] },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Reduced Motion Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Motion sensitivity levels for progressive enhancement
 */
export type MotionPreference = 'full' | 'reduced' | 'none';

/**
 * Configuration for handling reduced motion preferences
 */
export const REDUCED_MOTION = {
  /**
   * Animations that should be completely disabled with prefers-reduced-motion
   * These are decorative and non-essential to understanding
   */
  disable: [
    'lc-sweep',      // Specular highlight sweep
    'lc-refract',    // Refraction pulse
    'pulse-glow',    // Glow pulse
    'float',         // Floating animation
    'shimmer',       // Loading shimmer
  ],

  /**
   * Animations that should be simplified (instant/very fast)
   * These provide functional feedback but can be reduced
   */
  simplify: [
    'scale-in',      // Modal/popover entrance → instant fade
    'slide-in',      // Sheet entrance → instant appear
    'fade-in',       // General fade → instant appear
  ],

  /**
   * CSS variables for reduced motion durations
   */
  durations: {
    full: {
      reveal: '0.3s',
      state: '0.15s',
      interaction: '0.2s',
    },
    reduced: {
      reveal: '0.01s',  // Near-instant but not jarring
      state: '0.01s',
      interaction: '0.01s',
    },
    none: {
      reveal: '0s',
      state: '0s',
      interaction: '0s',
    },
  },
} as const;

/**
 * Generate CSS for reduced motion handling
 * Use in a global stylesheet or Tailwind plugin
 */
export function generateReducedMotionCSS(): string {
  return `
/* Liquid Crystal Reduced Motion Handling (US-268) */
@media (prefers-reduced-motion: reduce) {
  /* Disable decorative animations */
  .animate-lc-sweep,
  .animate-lc-refract,
  .animate-pulse-glow,
  .animate-float,
  .animate-shimmer {
    animation: none !important;
  }

  /* Simplify functional animations */
  .animate-scale-in,
  .motion-safe\\:animate-scale-in {
    animation-duration: 0.01s !important;
  }

  /* Reset transforms that may cause motion */
  .motion-interaction {
    transform: none !important;
    transition: opacity 0.01s ease !important;
  }

  /* Reduce backdrop-filter intensity (can cause visual motion) */
  [class*="backdrop-blur-lc-heavy"],
  [class*="backdrop-blur-lc-frosted"],
  [class*="backdrop-blur-lc-cinema"] {
    backdrop-filter: blur(4px) !important;
    -webkit-backdrop-filter: blur(4px) !important;
  }
}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Budgets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performance budgets for glass effects
 *
 * These limits prevent overuse of expensive CSS properties that can
 * cause jank, especially on mobile devices and lower-end hardware.
 */
export const PERFORMANCE_BUDGET = {
  /**
   * Maximum blur radius (px) for backdrop-filter
   * Higher values are computationally expensive
   */
  maxBlurRadius: 24, // REFRACTION.frosted level

  /**
   * Maximum number of simultaneous glass surfaces on screen
   * Each glass surface with backdrop-filter creates a stacking context
   * and triggers compositing
   */
  maxGlassSurfaces: 5,

  /**
   * Maximum number of animating glass elements
   * Animating backdrop-filter is very expensive
   */
  maxAnimatingGlass: 1,

  /**
   * Recommended glass levels for different view densities
   * Use lighter glass when many elements are present
   */
  byViewDensity: {
    /** Sparse views (1-5 elements): full glass allowed */
    sparse: {
      maxLevel: 'frost' as LiquidCrystalPreset,
      maxAnimations: 2,
    },
    /** Medium views (6-15 elements): moderate glass */
    medium: {
      maxLevel: 'fog' as LiquidCrystalPreset,
      maxAnimations: 1,
    },
    /** Dense views (16+ elements): minimal glass */
    dense: {
      maxLevel: 'smoke' as LiquidCrystalPreset,
      maxAnimations: 0,
    },
  },

  /**
   * Device-specific recommendations
   */
  byDevice: {
    /** High-end devices: full effects */
    highEnd: {
      blur: true,
      animations: true,
      maxBlur: 32,
    },
    /** Mid-range devices: reduced effects */
    midRange: {
      blur: true,
      animations: false, // Disable glass animations
      maxBlur: 16,
    },
    /** Low-end devices: minimal effects */
    lowEnd: {
      blur: false, // Use solid fallbacks
      animations: false,
      maxBlur: 0,
    },
  },

  /**
   * CSS properties to monitor for performance
   */
  expensiveProperties: [
    'backdrop-filter',
    '-webkit-backdrop-filter',
    'filter',
    'box-shadow', // Multiple shadows
    'transform', // When combined with filters
  ],
} as const;

/**
 * Check if a blur value is within performance budget
 */
export function isBlurWithinBudget(blurPx: number): boolean {
  return blurPx <= PERFORMANCE_BUDGET.maxBlurRadius;
}

/**
 * Get recommended glass level based on view density
 */
export function getRecommendedGlassLevel(
  elementCount: number
): { level: LiquidCrystalPreset; animationsAllowed: number } {
  if (elementCount <= 5) {
    return {
      level: PERFORMANCE_BUDGET.byViewDensity.sparse.maxLevel,
      animationsAllowed: PERFORMANCE_BUDGET.byViewDensity.sparse.maxAnimations,
    };
  }
  if (elementCount <= 15) {
    return {
      level: PERFORMANCE_BUDGET.byViewDensity.medium.maxLevel,
      animationsAllowed: PERFORMANCE_BUDGET.byViewDensity.medium.maxAnimations,
    };
  }
  return {
    level: PERFORMANCE_BUDGET.byViewDensity.dense.maxLevel,
    animationsAllowed: PERFORMANCE_BUDGET.byViewDensity.dense.maxAnimations,
  };
}

// Type exports
export type WCAGLevel = 'AA' | 'AAA';
export type TextSize = 'normal' | 'large';
export type ViewDensity = 'sparse' | 'medium' | 'dense';
export type DeviceTier = 'highEnd' | 'midRange' | 'lowEnd';
