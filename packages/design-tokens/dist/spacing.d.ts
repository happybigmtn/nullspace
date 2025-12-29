/**
 * Spacing tokens for Nullspace design system
 * Based on an 8pt grid with half-step for tight spacing
 *
 * NO platform-specific code - raw values only (in pixels)
 */
/**
 * Spacing scale values in pixels
 * Uses 4px base unit for flexibility
 */
export declare const SPACING: {
    readonly 0: 0;
    readonly 1: 4;
    readonly 2: 8;
    readonly 3: 12;
    readonly 4: 16;
    readonly 5: 20;
    readonly 6: 24;
    readonly 8: 32;
    readonly 10: 40;
    readonly 12: 48;
    readonly 16: 64;
    readonly 20: 80;
    readonly 24: 96;
};
/**
 * Common spacing values by semantic name
 * More readable than numeric keys in component code
 */
export declare const SPACING_SEMANTIC: {
    readonly none: 0;
    readonly xs: 4;
    readonly sm: 8;
    readonly md: 16;
    readonly lg: 24;
    readonly xl: 32;
    readonly '2xl': 48;
    readonly '3xl': 64;
};
/**
 * Border radius values in pixels
 * Follows the design system's rounded aesthetic
 */
export declare const RADIUS: {
    readonly none: 0;
    readonly sm: 4;
    readonly md: 8;
    readonly lg: 12;
    readonly xl: 16;
    readonly '2xl': 24;
    readonly full: 9999;
};
/**
 * Container max-widths for responsive layouts
 * Values in pixels
 */
export declare const CONTAINER: {
    readonly sm: 640;
    readonly md: 768;
    readonly lg: 1024;
    readonly xl: 1280;
    readonly '2xl': 1536;
};
export type SpacingKey = keyof typeof SPACING;
export type SpacingValue = (typeof SPACING)[SpacingKey];
export type SemanticSpacingKey = keyof typeof SPACING_SEMANTIC;
export type RadiusKey = keyof typeof RADIUS;
export type ContainerKey = keyof typeof CONTAINER;
//# sourceMappingURL=spacing.d.ts.map