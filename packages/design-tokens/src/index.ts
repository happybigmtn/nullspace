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
  TITANIUM,
  ACTION,
  GAME,
  type TitaniumShade,
  type TitaniumColor,
  type ActionColor,
  type ActionColorValue,
  type GameId,
  type GameColorScheme,
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
  DURATION,
  EASING,
  STAGGER,
  type SpringPreset,
  type SpringConfig,
  type DurationKey,
  type DurationValue,
  type EasingKey,
  type EasingCurve,
  type StaggerKey,
} from './animations.js';

// Shadows
export {
  SHADOW,
  ELEVATION,
  GLOW,
  type ShadowLevel,
  type ShadowConfig,
  type ElevationLevel,
  type GlowColor,
  type GlowConfig,
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
