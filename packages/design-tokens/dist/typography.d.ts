/**
 * Typography tokens for Nullspace design system
 * Consumed by CSS/Tailwind (web) and StyleSheet (mobile)
 *
 * NO platform-specific code - raw values only
 */
/**
 * Font family definitions
 * Display: Headlines and large text
 * Body: Readable paragraphs and UI text
 * Mono: Code, numbers, and technical content
 */
export declare const FONTS: {
    readonly display: "Outfit";
    readonly body: "Plus Jakarta Sans";
    readonly mono: "JetBrains Mono";
};
/**
 * Type scale with size, line height, weight, and letter spacing
 * All numeric values are in pixels (consumers convert as needed)
 */
export declare const TYPE_SCALE: {
    readonly micro: {
        readonly size: 10;
        readonly lineHeight: 12;
        readonly weight: 500;
        readonly letterSpacing: 0.5;
    };
    readonly label: {
        readonly size: 12;
        readonly lineHeight: 16;
        readonly weight: 500;
        readonly letterSpacing: 0.25;
    };
    readonly body: {
        readonly size: 14;
        readonly lineHeight: 20;
        readonly weight: 400;
        readonly letterSpacing: 0;
    };
    readonly bodyLarge: {
        readonly size: 16;
        readonly lineHeight: 24;
        readonly weight: 400;
        readonly letterSpacing: 0;
    };
    readonly heading: {
        readonly size: 20;
        readonly lineHeight: 28;
        readonly weight: 600;
        readonly letterSpacing: -0.25;
    };
    readonly headingLarge: {
        readonly size: 24;
        readonly lineHeight: 32;
        readonly weight: 600;
        readonly letterSpacing: -0.5;
    };
    readonly display: {
        readonly size: 32;
        readonly lineHeight: 40;
        readonly weight: 700;
        readonly letterSpacing: -0.5;
    };
    readonly hero: {
        readonly size: 48;
        readonly lineHeight: 56;
        readonly weight: 800;
        readonly letterSpacing: -1;
    };
};
/**
 * Font weights as numeric values
 * Maps to standard font-weight CSS/RN values
 */
export declare const FONT_WEIGHTS: {
    readonly regular: 400;
    readonly medium: 500;
    readonly semibold: 600;
    readonly bold: 700;
    readonly extrabold: 800;
};
export type FontFamily = keyof typeof FONTS;
export type TypeVariant = keyof typeof TYPE_SCALE;
export type TypeStyle = (typeof TYPE_SCALE)[TypeVariant];
export type FontWeight = keyof typeof FONT_WEIGHTS;
//# sourceMappingURL=typography.d.ts.map