/**
 * Shadow tokens for Nullspace design system
 * Elevation system inspired by Material Design and Apple HIG
 *
 * NO platform-specific code - raw values only
 */
/**
 * Shadow elevation definitions
 * Each level has multiple layers for realistic depth
 *
 * Format for web (CSS box-shadow):
 *   `${offsetX}px ${offsetY}px ${blur}px ${spread}px ${color}`
 *
 * Format for mobile (React Native):
 *   shadowOffset: { width, height }, shadowRadius, shadowOpacity, shadowColor
 */
export declare const SHADOW: {
    readonly none: {
        readonly offsetX: 0;
        readonly offsetY: 0;
        readonly blur: 0;
        readonly spread: 0;
        readonly opacity: 0;
    };
    readonly sm: {
        readonly offsetX: 0;
        readonly offsetY: 1;
        readonly blur: 2;
        readonly spread: 0;
        readonly opacity: 0.05;
    };
    readonly md: {
        readonly offsetX: 0;
        readonly offsetY: 4;
        readonly blur: 6;
        readonly spread: -1;
        readonly opacity: 0.1;
    };
    readonly lg: {
        readonly offsetX: 0;
        readonly offsetY: 10;
        readonly blur: 15;
        readonly spread: -3;
        readonly opacity: 0.1;
    };
    readonly xl: {
        readonly offsetX: 0;
        readonly offsetY: 20;
        readonly blur: 25;
        readonly spread: -5;
        readonly opacity: 0.1;
    };
    readonly '2xl': {
        readonly offsetX: 0;
        readonly offsetY: 25;
        readonly blur: 50;
        readonly spread: -12;
        readonly opacity: 0.25;
    };
};
/**
 * Elevation levels for semantic usage
 * Maps common UI patterns to shadow levels
 */
export declare const ELEVATION: {
    readonly flat: "none";
    readonly raised: "sm";
    readonly card: "md";
    readonly dropdown: "lg";
    readonly modal: "xl";
    readonly overlay: "2xl";
};
/**
 * Glow effects for interactive states
 * Used for focus rings, hover highlights, win animations
 */
export declare const GLOW: {
    readonly indigo: {
        readonly color: "#5E5CE6";
        readonly blur: 20;
        readonly opacity: 0.4;
    };
    readonly success: {
        readonly color: "#34C759";
        readonly blur: 20;
        readonly opacity: 0.4;
    };
    readonly error: {
        readonly color: "#FF3B30";
        readonly blur: 20;
        readonly opacity: 0.4;
    };
    readonly gold: {
        readonly color: "#FFD700";
        readonly blur: 30;
        readonly opacity: 0.5;
    };
};
/**
 * Colored shadow variants for brand cohesion
 * Each variant has offset, blur, spread, color, and opacity
 *
 * Usage Guidelines:
 * - indigoGlow: Selected states, focused elements, brand highlights
 * - goldAccent: Win celebrations, achievements, premium features
 * - successGlow: Success states, confirmations, positive feedback
 * - errorGlow: Error states, warnings, destructive actions
 * - warmShadow: Day mode, warm themes, inviting elements
 * - coolShadow: Night mode, cool themes, calm elements
 */
export declare const SHADOW_COLORED: {
    /** Brand indigo glow - selected states, focus */
    readonly indigoGlow: {
        readonly offsetX: 0;
        readonly offsetY: 4;
        readonly blur: 16;
        readonly spread: -2;
        readonly color: "#5E5CE6";
        readonly opacity: 0.4;
    };
    /** Gold accent - wins, achievements, premium */
    readonly goldAccent: {
        readonly offsetX: 0;
        readonly offsetY: 4;
        readonly blur: 20;
        readonly spread: -2;
        readonly color: "#FFD700";
        readonly opacity: 0.45;
    };
    /** Success glow - confirmations, positive feedback */
    readonly successGlow: {
        readonly offsetX: 0;
        readonly offsetY: 4;
        readonly blur: 16;
        readonly spread: -2;
        readonly color: "#34C759";
        readonly opacity: 0.4;
    };
    /** Error glow - warnings, destructive actions */
    readonly errorGlow: {
        readonly offsetX: 0;
        readonly offsetY: 4;
        readonly blur: 16;
        readonly spread: -2;
        readonly color: "#FF3B30";
        readonly opacity: 0.4;
    };
    /** Warm shadow - day mode, inviting elements */
    readonly warmShadow: {
        readonly offsetX: 0;
        readonly offsetY: 6;
        readonly blur: 20;
        readonly spread: -4;
        readonly color: "#8B4513";
        readonly opacity: 0.15;
    };
    /** Cool shadow - night mode, calm elements */
    readonly coolShadow: {
        readonly offsetX: 0;
        readonly offsetY: 6;
        readonly blur: 20;
        readonly spread: -4;
        readonly color: "#1E3A5F";
        readonly opacity: 0.2;
    };
};
/**
 * Inset shadow variants for card depth effects
 * Used for pressed states, sunken panels, and debossed elements
 *
 * Usage Guidelines:
 * - sm: Subtle depression, text fields, minor pressed states
 * - md: Card insets, panel depressions, pressed buttons
 * - lg: Deep insets, well containers, significant pressed states
 */
export declare const SHADOW_INSET: {
    /** Subtle inset - text fields, minor pressed states */
    readonly sm: {
        readonly offsetX: 0;
        readonly offsetY: 1;
        readonly blur: 3;
        readonly spread: 0;
        readonly opacity: 0.1;
    };
    /** Medium inset - card wells, pressed buttons */
    readonly md: {
        readonly offsetX: 0;
        readonly offsetY: 2;
        readonly blur: 6;
        readonly spread: -1;
        readonly opacity: 0.15;
    };
    /** Large inset - deep wells, significant pressed states */
    readonly lg: {
        readonly offsetX: 0;
        readonly offsetY: 4;
        readonly blur: 10;
        readonly spread: -2;
        readonly opacity: 0.2;
    };
};
export type ShadowLevel = keyof typeof SHADOW;
export type ShadowConfig = (typeof SHADOW)[ShadowLevel];
export type ElevationLevel = keyof typeof ELEVATION;
export type GlowColor = keyof typeof GLOW;
export type GlowConfig = (typeof GLOW)[GlowColor];
export type ShadowColoredKey = keyof typeof SHADOW_COLORED;
export type ShadowColoredConfig = (typeof SHADOW_COLORED)[ShadowColoredKey];
export type ShadowInsetLevel = keyof typeof SHADOW_INSET;
export type ShadowInsetConfig = (typeof SHADOW_INSET)[ShadowInsetLevel];
//# sourceMappingURL=shadows.d.ts.map