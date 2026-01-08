/**
 * Glassmorphism effect tokens for Nullspace design system
 * Combined configurations for frosted glass UI elements
 *
 * Inspired by iOS/macOS vibrancy and Jony Ive's "material honesty"
 * NO platform-specific code - raw values only
 */

import { BLUR } from './blur.js';

/**
 * Glass effect presets
 * Each preset defines a complete glass material with blur, background, border, and shadow
 *
 * Structure:
 * - blur: backdrop-filter blur radius in px
 * - background: RGBA background with transparency
 * - border: RGBA border color for edge definition
 * - tint: Additional overlay tint (used for colored glass)
 */
export const GLASS = {
  /** Barely visible glass - for subtle depth layering */
  subtle: {
    blur: BLUR.xs,
    background: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.08)',
    tint: 'transparent',
  },
  /** Light glass - standard UI surfaces */
  light: {
    blur: BLUR.sm,
    background: 'rgba(255, 255, 255, 0.1)',
    border: 'rgba(255, 255, 255, 0.12)',
    tint: 'transparent',
  },
  /** Medium glass - cards and panels */
  medium: {
    blur: BLUR.md,
    background: 'rgba(255, 255, 255, 0.15)',
    border: 'rgba(255, 255, 255, 0.15)',
    tint: 'transparent',
  },
  /** Heavy glass - modals and overlays */
  heavy: {
    blur: BLUR.lg,
    background: 'rgba(255, 255, 255, 0.2)',
    border: 'rgba(255, 255, 255, 0.18)',
    tint: 'transparent',
  },
  /** Maximum frosted effect - hero elements */
  frosted: {
    blur: BLUR.xl,
    background: 'rgba(255, 255, 255, 0.25)',
    border: 'rgba(255, 255, 255, 0.2)',
    tint: 'transparent',
  },
} as const;

/**
 * Dark mode glass variants
 * Inverted for dark backgrounds
 */
export const GLASS_DARK = {
  subtle: {
    blur: BLUR.xs,
    background: 'rgba(0, 0, 0, 0.1)',
    border: 'rgba(255, 255, 255, 0.05)',
    tint: 'transparent',
  },
  light: {
    blur: BLUR.sm,
    background: 'rgba(0, 0, 0, 0.15)',
    border: 'rgba(255, 255, 255, 0.08)',
    tint: 'transparent',
  },
  medium: {
    blur: BLUR.md,
    background: 'rgba(0, 0, 0, 0.25)',
    border: 'rgba(255, 255, 255, 0.1)',
    tint: 'transparent',
  },
  heavy: {
    blur: BLUR.lg,
    background: 'rgba(0, 0, 0, 0.35)',
    border: 'rgba(255, 255, 255, 0.12)',
    tint: 'transparent',
  },
  frosted: {
    blur: BLUR.xl,
    background: 'rgba(0, 0, 0, 0.45)',
    border: 'rgba(255, 255, 255, 0.15)',
    tint: 'transparent',
  },
} as const;

/**
 * Backdrop filter presets
 * CSS backdrop-filter combinations for various effects
 *
 * Format: { blur, brightness, saturate, contrast }
 * All values as numbers (blur in px, others as percentages 0-200)
 */
export const BACKDROP_FILTER = {
  /** Standard frosted glass */
  glass: {
    blur: BLUR.md,
    brightness: 105,
    saturate: 120,
    contrast: 100,
  },
  /** Lighter, brighter glass */
  lightGlass: {
    blur: BLUR.sm,
    brightness: 110,
    saturate: 110,
    contrast: 100,
  },
  /** Dark overlay with blur */
  darkOverlay: {
    blur: BLUR.lg,
    brightness: 80,
    saturate: 100,
    contrast: 105,
  },
  /** Vibrant, saturated glass (like iOS Control Center) */
  vibrant: {
    blur: BLUR.md,
    brightness: 100,
    saturate: 180,
    contrast: 100,
  },
  /** Ultra-light mist effect */
  mist: {
    blur: BLUR.xs,
    brightness: 102,
    saturate: 100,
    contrast: 100,
  },
  /** Heavy cinema-style overlay */
  cinematic: {
    blur: BLUR['2xl'],
    brightness: 70,
    saturate: 90,
    contrast: 110,
  },
} as const;

/**
 * Semantic glass mappings for common UI elements
 */
export const GLASS_SEMANTIC = {
  /** Navigation bars and headers */
  navbar: GLASS.light,
  /** Cards and content containers */
  card: GLASS.medium,
  /** Dropdown menus */
  dropdown: GLASS.medium,
  /** Modal dialogs */
  modal: GLASS.heavy,
  /** Toast notifications */
  toast: GLASS.light,
  /** Tooltip overlays */
  tooltip: GLASS.subtle,
  /** Full-screen overlays */
  overlay: GLASS.frosted,
  /** Bottom sheets */
  sheet: GLASS.heavy,
} as const;

// Type exports for type inference
export type GlassPreset = keyof typeof GLASS;
export type GlassConfig = (typeof GLASS)[GlassPreset];

export type GlassDarkPreset = keyof typeof GLASS_DARK;
export type GlassDarkConfig = (typeof GLASS_DARK)[GlassDarkPreset];

export type BackdropFilterPreset = keyof typeof BACKDROP_FILTER;
export type BackdropFilterConfig = (typeof BACKDROP_FILTER)[BackdropFilterPreset];

export type GlassSemanticKey = keyof typeof GLASS_SEMANTIC;
export type GlassSemanticValue = (typeof GLASS_SEMANTIC)[GlassSemanticKey];
