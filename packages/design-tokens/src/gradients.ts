/**
 * Gradient configuration tokens for Nullspace design system
 * Luxury backgrounds and visual effects
 *
 * Format is platform-agnostic:
 * - Web: Convert to CSS linear-gradient() / radial-gradient()
 * - Mobile: Convert to expo-linear-gradient props
 *
 * NO platform-specific code - raw values only
 */

import { TITANIUM, ACTION } from './colors.js';

/**
 * Gradient stop structure
 * position: 0-100 percentage along the gradient
 */
export type GradientStop = {
  color: string;
  position: number;
};

/**
 * Linear gradient configuration
 */
export type LinearGradientConfig = {
  type: 'linear';
  angle: number; // degrees (0 = top, 90 = right, 180 = bottom, 270 = left)
  stops: GradientStop[];
};

/**
 * Radial gradient configuration
 */
export type RadialGradientConfig = {
  type: 'radial';
  shape: 'circle' | 'ellipse';
  position: { x: number; y: number }; // 0-100 percentage
  stops: GradientStop[];
};

/**
 * Linear gradient presets for backgrounds and surfaces
 */
export const GRADIENT_LINEAR = {
  /** Subtle top-down light fade */
  subtleLight: {
    type: 'linear' as const,
    angle: 180,
    stops: [
      { color: 'rgba(255, 255, 255, 0.08)', position: 0 },
      { color: 'rgba(255, 255, 255, 0)', position: 100 },
    ],
  },
  /** Subtle bottom-up dark fade */
  subtleDark: {
    type: 'linear' as const,
    angle: 0,
    stops: [
      { color: 'rgba(0, 0, 0, 0.1)', position: 0 },
      { color: 'rgba(0, 0, 0, 0)', position: 100 },
    ],
  },
  /** Card surface gradient - slight depth */
  cardSurface: {
    type: 'linear' as const,
    angle: 180,
    stops: [
      { color: TITANIUM[50], position: 0 },
      { color: TITANIUM[100], position: 100 },
    ],
  },
  /** Dark card surface */
  cardSurfaceDark: {
    type: 'linear' as const,
    angle: 180,
    stops: [
      { color: TITANIUM[800], position: 0 },
      { color: TITANIUM[900], position: 100 },
    ],
  },
  /** Indigo brand gradient */
  brandIndigo: {
    type: 'linear' as const,
    angle: 135,
    stops: [
      { color: ACTION.indigo, position: 0 },
      { color: ACTION.indigoHover, position: 100 },
    ],
  },
  /** Success celebration gradient */
  success: {
    type: 'linear' as const,
    angle: 135,
    stops: [
      { color: ACTION.success, position: 0 },
      { color: '#2DA44E', position: 100 },
    ],
  },
  /** Error/warning gradient */
  error: {
    type: 'linear' as const,
    angle: 135,
    stops: [
      { color: ACTION.error, position: 0 },
      { color: '#D62828', position: 100 },
    ],
  },
} as const;

/**
 * Radial gradient presets for spotlight and focus effects
 */
export const GRADIENT_RADIAL = {
  /** Center spotlight - white */
  spotlightLight: {
    type: 'radial' as const,
    shape: 'circle' as const,
    position: { x: 50, y: 50 },
    stops: [
      { color: 'rgba(255, 255, 255, 0.2)', position: 0 },
      { color: 'rgba(255, 255, 255, 0)', position: 70 },
    ],
  },
  /** Center spotlight - dark */
  spotlightDark: {
    type: 'radial' as const,
    shape: 'circle' as const,
    position: { x: 50, y: 50 },
    stops: [
      { color: 'rgba(0, 0, 0, 0.3)', position: 0 },
      { color: 'rgba(0, 0, 0, 0)', position: 70 },
    ],
  },
  /** Indigo glow from center */
  glowIndigo: {
    type: 'radial' as const,
    shape: 'circle' as const,
    position: { x: 50, y: 50 },
    stops: [
      { color: 'rgba(94, 92, 230, 0.3)', position: 0 },
      { color: 'rgba(94, 92, 230, 0)', position: 60 },
    ],
  },
  /** Gold glow for jackpots */
  glowGold: {
    type: 'radial' as const,
    shape: 'circle' as const,
    position: { x: 50, y: 50 },
    stops: [
      { color: 'rgba(255, 215, 0, 0.4)', position: 0 },
      { color: 'rgba(255, 215, 0, 0)', position: 70 },
    ],
  },
  /** Top-left highlight */
  highlightTopLeft: {
    type: 'radial' as const,
    shape: 'ellipse' as const,
    position: { x: 20, y: 20 },
    stops: [
      { color: 'rgba(255, 255, 255, 0.15)', position: 0 },
      { color: 'rgba(255, 255, 255, 0)', position: 50 },
    ],
  },
} as const;

/**
 * Luxury gradient presets for premium visual effects
 * Used sparingly for hero elements and celebrations
 */
export const GRADIENT_LUXURY = {
  /** Titanium metallic sheen - subtle brushed metal effect */
  titaniumSheen: {
    type: 'linear' as const,
    angle: 135,
    stops: [
      { color: TITANIUM[200], position: 0 },
      { color: TITANIUM[100], position: 30 },
      { color: TITANIUM[50], position: 50 },
      { color: TITANIUM[100], position: 70 },
      { color: TITANIUM[200], position: 100 },
    ],
  },
  /** Gold reflection for wins and celebrations */
  goldReflection: {
    type: 'linear' as const,
    angle: 135,
    stops: [
      { color: '#D4AF37', position: 0 },
      { color: '#FFD700', position: 30 },
      { color: '#FFF8DC', position: 50 },
      { color: '#FFD700', position: 70 },
      { color: '#D4AF37', position: 100 },
    ],
  },
  /** Indigo glow for premium CTAs */
  indigoGlow: {
    type: 'linear' as const,
    angle: 180,
    stops: [
      { color: 'rgba(94, 92, 230, 0.2)', position: 0 },
      { color: ACTION.indigo, position: 50 },
      { color: 'rgba(94, 92, 230, 0.2)', position: 100 },
    ],
  },
  /** Dark luxury - deep gradients for dark mode */
  darkLuxury: {
    type: 'linear' as const,
    angle: 180,
    stops: [
      { color: TITANIUM[950], position: 0 },
      { color: TITANIUM[900], position: 50 },
      { color: TITANIUM[950], position: 100 },
    ],
  },
  /** Aurora effect - subtle color shift */
  aurora: {
    type: 'linear' as const,
    angle: 135,
    stops: [
      { color: 'rgba(94, 92, 230, 0.1)', position: 0 },
      { color: 'rgba(52, 199, 89, 0.1)', position: 50 },
      { color: 'rgba(94, 92, 230, 0.1)', position: 100 },
    ],
  },
  /** Jackpot celebration - animated gold burst */
  jackpot: {
    type: 'radial' as const,
    shape: 'circle' as const,
    position: { x: 50, y: 50 },
    stops: [
      { color: '#FFF8DC', position: 0 },
      { color: '#FFD700', position: 30 },
      { color: '#D4AF37', position: 60 },
      { color: 'rgba(212, 175, 55, 0)', position: 100 },
    ],
  },
} as const;

/**
 * Semantic gradient mappings for common UI elements
 */
export const GRADIENT_SEMANTIC = {
  /** Page background */
  pageBackground: GRADIENT_LINEAR.subtleLight,
  /** Card surface */
  card: GRADIENT_LINEAR.cardSurface,
  /** Primary button */
  buttonPrimary: GRADIENT_LINEAR.brandIndigo,
  /** Success state */
  success: GRADIENT_LINEAR.success,
  /** Error state */
  error: GRADIENT_LINEAR.error,
  /** Hero spotlight */
  heroSpotlight: GRADIENT_RADIAL.spotlightLight,
  /** Win celebration */
  winCelebration: GRADIENT_LUXURY.goldReflection,
} as const;

// Type exports for type inference
export type GradientLinearPreset = keyof typeof GRADIENT_LINEAR;
export type GradientRadialPreset = keyof typeof GRADIENT_RADIAL;
export type GradientLuxuryPreset = keyof typeof GRADIENT_LUXURY;
export type GradientSemanticKey = keyof typeof GRADIENT_SEMANTIC;
