/**
 * @nullspace/design-tokens
 *
 * Centralized design tokens for the Nullspace design system.
 * Consumed by website (Tailwind) and mobile (StyleSheet).
 *
 * IMPORTANT: This package contains ONLY raw values (strings, numbers, objects).
 * NO platform-specific code (no React, no StyleSheet, no CSS-in-JS).
 */

// Colors
export {
  // Primary monochrome palette
  MONO,
  SEMANTIC,
  STATE,
  EDGE,
  GAME_PATTERN,
  // Deprecated - kept for backwards compatibility
  TITANIUM,
  ACTION,
  GAME,
  // Type exports
  type MonoShade,
  type MonoColor,
  type TitaniumShade,
  type TitaniumColor,
  type StateCategory,
  type StateVariant,
  type ActionColor,
  type ActionColorValue,
  type GameId,
  type GameColorScheme,
  type GamePatternId,
  type GamePatternConfig,
} from './colors.js';

// Typography
export {
  FONTS,
  TYPE_SCALE,
  FONT_WEIGHTS,
  type FontFamily,
  type TypeVariant,
  type TypeStyle,
  type FontWeight,
} from './typography.js';

// Spacing
export {
  SPACING,
  SPACING_SEMANTIC,
  RADIUS,
  CONTAINER,
  type SpacingKey,
  type SpacingValue,
  type SemanticSpacingKey,
  type RadiusKey,
  type ContainerKey,
} from './spacing.js';

// Animations
export {
  SPRING,
  SPRING_LIQUID,
  DURATION,
  EASING,
  EASING_LUXURY,
  SCALE,
  SCALE_DOWN,
  SCALE_SEMANTIC,
  STAGGER,
  type SpringPreset,
  type SpringConfig,
  type SpringLiquidPreset,
  type SpringLiquidConfig,
  type DurationKey,
  type DurationValue,
  type EasingKey,
  type EasingCurve,
  type EasingLuxuryKey,
  type EasingLuxuryCurve,
  type ScaleKey,
  type ScaleValue,
  type ScaleDownKey,
  type ScaleDownValue,
  type ScaleSemanticKey,
  type ScaleSemanticValue,
  type StaggerKey,
} from './animations.js';

// Shadows
export {
  SHADOW,
  ELEVATION,
  GLOW,
  SHADOW_COLORED,
  SHADOW_INSET,
  type ShadowLevel,
  type ShadowConfig,
  type ElevationLevel,
  type GlowColor,
  type GlowConfig,
  type ShadowColoredKey,
  type ShadowColoredConfig,
  type ShadowInsetLevel,
  type ShadowInsetConfig,
} from './shadows.js';

// Opacity
export {
  OPACITY,
  OPACITY_SEMANTIC,
  type OpacityKey,
  type OpacityValue,
  type OpacitySemanticKey,
  type OpacitySemanticValue,
} from './opacity.js';

// Z-Index
export {
  Z_INDEX,
  Z_INDEX_GAME,
  type ZIndexKey,
  type ZIndexValue,
  type ZIndexGameKey,
  type ZIndexGameValue,
} from './zindex.js';

// Focus (Accessibility)
export {
  FOCUS,
  FOCUS_COLORS,
  FOCUS_WIDTH,
  FOCUS_OFFSET,
  type FocusVariant,
  type FocusConfig,
  type FocusColorKey,
  type FocusColorValue,
  type FocusWidthKey,
  type FocusWidthValue,
  type FocusOffsetKey,
  type FocusOffsetValue,
} from './focus.js';

// Blur (Glassmorphism)
export {
  BLUR,
  BLUR_SEMANTIC,
  BLUR_GLOW,
  type BlurLevel,
  type BlurValue,
  type BlurSemanticKey,
  type BlurSemanticValue,
  type BlurGlowKey,
  type BlurGlowValue,
} from './blur.js';

// Glass Effects (Glassmorphism)
export {
  GLASS,
  GLASS_DARK,
  BACKDROP_FILTER,
  GLASS_SEMANTIC,
  type GlassPreset,
  type GlassConfig,
  type GlassDarkPreset,
  type GlassDarkConfig,
  type BackdropFilterPreset,
  type BackdropFilterConfig,
  type GlassSemanticKey,
  type GlassSemanticValue,
} from './glass.js';

// Gradients
export {
  GRADIENT_LINEAR,
  GRADIENT_RADIAL,
  GRADIENT_LUXURY,
  GRADIENT_SEMANTIC,
  type GradientStop,
  type LinearGradientConfig,
  type RadialGradientConfig,
  type GradientLinearPreset,
  type GradientRadialPreset,
  type GradientLuxuryPreset,
  type GradientSemanticKey,
} from './gradients.js';
