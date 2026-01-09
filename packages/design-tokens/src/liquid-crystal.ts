/**
 * Liquid Crystal Material System for Nullspace design system
 *
 * Inspired by Apple's Liquid Glass material (WWDC 2024) but constrained
 * to our monochrome design philosophy. Creates depth and materiality
 * through translucency, refraction simulation, and specular highlights
 * without introducing color.
 *
 * Key principles:
 * - Translucent, not transparent - content shows through with depth
 * - Edge highlights simulate light refraction
 * - Specular gradients create dimensional form
 * - Adaptive to underlying content (dark adapts, light adapts)
 * - Strictly monochrome - depth via opacity, not hue
 *
 * NO platform-specific code - raw values only
 */

import { BLUR } from './blur.js';
import { MONO } from './colors.js';

/**
 * Translucency levels - nuanced opacity scale for glass materials
 *
 * Unlike binary transparent/opaque, these create subtle depth layers.
 * Higher numbers = more opaque = closer to viewer.
 */
export const TRANSLUCENCY = {
  /** Near-invisible - ghost elements, hover states */
  ghost: 0.02,
  /** Whisper - barely perceptible depth layer */
  whisper: 0.05,
  /** Mist - subtle glass for backgrounds */
  mist: 0.08,
  /** Veil - standard translucent surface */
  veil: 0.12,
  /** Smoke - prominent glass panel */
  smoke: 0.18,
  /** Fog - heavy glass for modals */
  fog: 0.25,
  /** Frost - maximum glass effect */
  frost: 0.35,
  /** Solid - opaque but still part of glass system */
  solid: 0.85,
} as const;

/**
 * Specular highlight configurations
 *
 * These simulate light hitting the glass surface at an angle.
 * Applied as CSS gradients or RN LinearGradient overlays.
 *
 * Structure:
 * - angle: degrees (0=top, 90=right, 180=bottom, 270=left)
 * - stops: opacity values at gradient positions
 * - intensity: overall effect strength multiplier
 */
export const SPECULAR = {
  /** Top-left highlight - default light source */
  topLeft: {
    angle: 135,
    stops: [
      { position: 0, opacity: 0.15 },
      { position: 30, opacity: 0.05 },
      { position: 100, opacity: 0 },
    ],
    intensity: 1.0,
  },
  /** Top edge highlight - overhead lighting */
  topEdge: {
    angle: 180,
    stops: [
      { position: 0, opacity: 0.12 },
      { position: 20, opacity: 0.03 },
      { position: 100, opacity: 0 },
    ],
    intensity: 1.0,
  },
  /** Rim light - subtle edge glow all around */
  rim: {
    angle: 0,
    stops: [
      { position: 0, opacity: 0.08 },
      { position: 5, opacity: 0.04 },
      { position: 95, opacity: 0.04 },
      { position: 100, opacity: 0.08 },
    ],
    intensity: 0.8,
  },
  /** Sweep - animated specular for interactions */
  sweep: {
    angle: -45,
    stops: [
      { position: 0, opacity: 0 },
      { position: 40, opacity: 0 },
      { position: 50, opacity: 0.2 },
      { position: 60, opacity: 0 },
      { position: 100, opacity: 0 },
    ],
    intensity: 1.5,
  },
} as const;

/**
 * Edge highlight configurations for dimensional form
 *
 * These are applied as inset box-shadows or border effects
 * to create the illusion of thickness and refraction.
 */
export const EDGE_HIGHLIGHT = {
  /** Subtle single-pixel highlight */
  hairline: {
    top: 'rgba(255, 255, 255, 0.1)',
    bottom: 'rgba(0, 0, 0, 0.05)',
    width: 1,
  },
  /** Standard edge treatment */
  standard: {
    top: 'rgba(255, 255, 255, 0.15)',
    bottom: 'rgba(0, 0, 0, 0.08)',
    width: 1,
  },
  /** Pronounced edge for floating elements */
  pronounced: {
    top: 'rgba(255, 255, 255, 0.2)',
    bottom: 'rgba(0, 0, 0, 0.12)',
    width: 1,
  },
  /** Thick edge for hero elements */
  thick: {
    top: 'rgba(255, 255, 255, 0.25)',
    bottom: 'rgba(0, 0, 0, 0.15)',
    width: 2,
  },
} as const;

/**
 * Refraction effect configurations
 *
 * Simulates light bending through glass using backdrop-filter
 * adjustments beyond simple blur.
 */
export const REFRACTION = {
  /** No refraction - clear glass */
  none: {
    blur: BLUR.none,
    brightness: 100,
    saturate: 100,
    contrast: 100,
  },
  /** Subtle distortion - thin glass */
  subtle: {
    blur: BLUR.xs,
    brightness: 102,
    saturate: 100,
    contrast: 100,
  },
  /** Standard glass refraction */
  standard: {
    blur: BLUR.sm,
    brightness: 105,
    saturate: 100,
    contrast: 100,
  },
  /** Heavy refraction - thick glass */
  heavy: {
    blur: BLUR.md,
    brightness: 108,
    saturate: 95,
    contrast: 102,
  },
  /** Frosted glass - maximum distortion */
  frosted: {
    blur: BLUR.lg,
    brightness: 110,
    saturate: 90,
    contrast: 105,
  },
  /** Cinema - dramatic depth effect */
  cinema: {
    blur: BLUR.xl,
    brightness: 85,
    saturate: 80,
    contrast: 110,
  },
} as const;

/**
 * Complete Liquid Crystal material configurations
 *
 * Each material combines translucency, specular, edge, and refraction
 * into a cohesive glass effect. Use these as the primary API.
 */
export const LIQUID_CRYSTAL = {
  /** Ghost - nearly invisible, for hover states and hints */
  ghost: {
    translucency: TRANSLUCENCY.ghost,
    background: {
      light: `rgba(255, 255, 255, ${TRANSLUCENCY.ghost})`,
      dark: `rgba(0, 0, 0, ${TRANSLUCENCY.ghost})`,
    },
    border: {
      light: 'rgba(0, 0, 0, 0.02)',
      dark: 'rgba(255, 255, 255, 0.02)',
    },
    specular: null, // Too subtle for specular
    edge: null,
    refraction: REFRACTION.none,
  },

  /** Whisper - subtle depth layer, tooltips */
  whisper: {
    translucency: TRANSLUCENCY.whisper,
    background: {
      light: `rgba(255, 255, 255, ${TRANSLUCENCY.whisper})`,
      dark: `rgba(0, 0, 0, ${TRANSLUCENCY.whisper})`,
    },
    border: {
      light: 'rgba(0, 0, 0, 0.03)',
      dark: 'rgba(255, 255, 255, 0.03)',
    },
    specular: null,
    edge: EDGE_HIGHLIGHT.hairline,
    refraction: REFRACTION.none,
  },

  /** Mist - light glass for navigation, headers */
  mist: {
    translucency: TRANSLUCENCY.mist,
    background: {
      light: `rgba(255, 255, 255, ${TRANSLUCENCY.mist})`,
      dark: `rgba(0, 0, 0, ${TRANSLUCENCY.mist})`,
    },
    border: {
      light: 'rgba(0, 0, 0, 0.05)',
      dark: 'rgba(255, 255, 255, 0.05)',
    },
    specular: SPECULAR.topEdge,
    edge: EDGE_HIGHLIGHT.hairline,
    refraction: REFRACTION.subtle,
  },

  /** Veil - standard glass surface, cards */
  veil: {
    translucency: TRANSLUCENCY.veil,
    background: {
      light: `rgba(255, 255, 255, ${TRANSLUCENCY.veil})`,
      dark: `rgba(0, 0, 0, ${TRANSLUCENCY.veil})`,
    },
    border: {
      light: 'rgba(0, 0, 0, 0.08)',
      dark: 'rgba(255, 255, 255, 0.08)',
    },
    specular: SPECULAR.topLeft,
    edge: EDGE_HIGHLIGHT.standard,
    refraction: REFRACTION.standard,
  },

  /** Smoke - prominent glass, dropdowns, popovers */
  smoke: {
    translucency: TRANSLUCENCY.smoke,
    background: {
      light: `rgba(255, 255, 255, ${TRANSLUCENCY.smoke})`,
      dark: `rgba(0, 0, 0, ${TRANSLUCENCY.smoke})`,
    },
    border: {
      light: 'rgba(0, 0, 0, 0.1)',
      dark: 'rgba(255, 255, 255, 0.1)',
    },
    specular: SPECULAR.topLeft,
    edge: EDGE_HIGHLIGHT.standard,
    refraction: REFRACTION.standard,
  },

  /** Fog - heavy glass, modals, dialogs */
  fog: {
    translucency: TRANSLUCENCY.fog,
    background: {
      light: `rgba(255, 255, 255, ${TRANSLUCENCY.fog})`,
      dark: `rgba(0, 0, 0, ${TRANSLUCENCY.fog})`,
    },
    border: {
      light: 'rgba(0, 0, 0, 0.12)',
      dark: 'rgba(255, 255, 255, 0.12)',
    },
    specular: SPECULAR.topLeft,
    edge: EDGE_HIGHLIGHT.pronounced,
    refraction: REFRACTION.heavy,
  },

  /** Frost - maximum glass effect, overlays */
  frost: {
    translucency: TRANSLUCENCY.frost,
    background: {
      light: `rgba(255, 255, 255, ${TRANSLUCENCY.frost})`,
      dark: `rgba(0, 0, 0, ${TRANSLUCENCY.frost})`,
    },
    border: {
      light: 'rgba(0, 0, 0, 0.15)',
      dark: 'rgba(255, 255, 255, 0.15)',
    },
    specular: SPECULAR.topLeft,
    edge: EDGE_HIGHLIGHT.pronounced,
    refraction: REFRACTION.frosted,
  },

  /** Solid - opaque glass for primary surfaces */
  solid: {
    translucency: TRANSLUCENCY.solid,
    background: {
      light: `rgba(255, 255, 255, ${TRANSLUCENCY.solid})`,
      dark: `rgba(0, 0, 0, ${TRANSLUCENCY.solid})`,
    },
    border: {
      light: 'rgba(0, 0, 0, 0.18)',
      dark: 'rgba(255, 255, 255, 0.18)',
    },
    specular: SPECULAR.rim,
    edge: EDGE_HIGHLIGHT.thick,
    refraction: REFRACTION.none, // Solid doesn't need refraction
  },
} as const;

/**
 * Semantic Liquid Crystal mappings for common UI elements
 *
 * Usage guide:
 * - navbar: Headers and navigation bars
 * - card: Content cards and panels
 * - dropdown: Menus and popovers
 * - modal: Dialog boxes and sheets
 * - betSlip: Casino bet slip (primary control surface)
 * - overlay: Full-screen dimming overlays
 * - tooltip: Small informational popups
 * - toast: Notification toasts
 */
export const LIQUID_CRYSTAL_SEMANTIC = {
  /** Navigation bar - mist level for header strip */
  navbar: LIQUID_CRYSTAL.mist,
  /** Content cards - veil level for standard panels */
  card: LIQUID_CRYSTAL.veil,
  /** Dropdown menus - smoke level for prominence */
  dropdown: LIQUID_CRYSTAL.smoke,
  /** Modal dialogs - fog level for separation */
  modal: LIQUID_CRYSTAL.fog,
  /** Bet slip - primary control surface, smoke level */
  betSlip: LIQUID_CRYSTAL.smoke,
  /** Full-screen overlay - frost level */
  overlay: LIQUID_CRYSTAL.frost,
  /** Tooltips - whisper level for subtlety */
  tooltip: LIQUID_CRYSTAL.whisper,
  /** Toast notifications - veil level */
  toast: LIQUID_CRYSTAL.veil,
} as const;

/**
 * Fallback configurations for browsers without backdrop-filter support
 *
 * These provide graceful degradation using solid backgrounds
 * that approximate the glass effect.
 */
export const LIQUID_CRYSTAL_FALLBACK = {
  ghost: {
    light: MONO[1000],
    dark: MONO[0],
  },
  whisper: {
    light: MONO[950],
    dark: MONO[50],
  },
  mist: {
    light: MONO[900],
    dark: MONO[100],
  },
  veil: {
    light: MONO[800],
    dark: MONO[150],
  },
  smoke: {
    light: MONO[700],
    dark: MONO[200],
  },
  fog: {
    light: MONO[600],
    dark: MONO[300],
  },
  frost: {
    light: MONO[500],
    dark: MONO[400],
  },
  solid: {
    light: MONO[1000],
    dark: MONO[0],
  },
} as const;

/**
 * Helper to generate CSS backdrop-filter string from refraction config
 */
export function toBackdropFilter(refraction: typeof REFRACTION[keyof typeof REFRACTION]): string {
  return `blur(${refraction.blur}px) brightness(${refraction.brightness}%) saturate(${refraction.saturate}%) contrast(${refraction.contrast}%)`;
}

/**
 * Helper to generate CSS inset box-shadow from edge highlight config
 */
export function toEdgeHighlight(edge: typeof EDGE_HIGHLIGHT[keyof typeof EDGE_HIGHLIGHT]): string {
  return `inset 0 ${edge.width}px 0 ${edge.top}, inset 0 -${edge.width}px 0 ${edge.bottom}`;
}

/**
 * Helper to generate CSS linear-gradient from specular config (light mode)
 */
export function toSpecularGradient(
  specular: typeof SPECULAR[keyof typeof SPECULAR],
  mode: 'light' | 'dark' = 'light'
): string {
  const baseColor = mode === 'light' ? '255, 255, 255' : '255, 255, 255';
  const stops = specular.stops
    .map(s => `rgba(${baseColor}, ${s.opacity * specular.intensity}) ${s.position}%`)
    .join(', ');
  return `linear-gradient(${specular.angle}deg, ${stops})`;
}

// Type exports for type inference
export type TranslucencyLevel = keyof typeof TRANSLUCENCY;
export type TranslucencyValue = (typeof TRANSLUCENCY)[TranslucencyLevel];

export type SpecularPreset = keyof typeof SPECULAR;
export type SpecularConfig = (typeof SPECULAR)[SpecularPreset];

export type EdgeHighlightPreset = keyof typeof EDGE_HIGHLIGHT;
export type EdgeHighlightConfig = (typeof EDGE_HIGHLIGHT)[EdgeHighlightPreset];

export type RefractionPreset = keyof typeof REFRACTION;
export type RefractionConfig = (typeof REFRACTION)[RefractionPreset];

export type LiquidCrystalPreset = keyof typeof LIQUID_CRYSTAL;
export type LiquidCrystalConfig = (typeof LIQUID_CRYSTAL)[LiquidCrystalPreset];

export type LiquidCrystalSemanticKey = keyof typeof LIQUID_CRYSTAL_SEMANTIC;
export type LiquidCrystalSemanticValue = (typeof LIQUID_CRYSTAL_SEMANTIC)[LiquidCrystalSemanticKey];
