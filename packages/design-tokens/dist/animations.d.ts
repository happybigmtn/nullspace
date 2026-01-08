/**
 * Animation tokens for Nullspace design system
 * Spring configs consumed by Framer Motion (web) and Reanimated (mobile)
 * Both libraries accept { mass, stiffness, damping } format
 *
 * NO platform-specific code - raw values only
 */
/**
 * Spring physics configurations
 * Each preset is tuned for specific interaction types
 */
export declare const SPRING: {
    readonly button: {
        readonly mass: 0.5;
        readonly stiffness: 400;
        readonly damping: 30;
    };
    readonly modal: {
        readonly mass: 0.8;
        readonly stiffness: 300;
        readonly damping: 28;
    };
    readonly dropdown: {
        readonly mass: 0.6;
        readonly stiffness: 350;
        readonly damping: 26;
    };
    readonly tooltip: {
        readonly mass: 0.4;
        readonly stiffness: 500;
        readonly damping: 35;
    };
    readonly cardFlip: {
        readonly mass: 1;
        readonly stiffness: 200;
        readonly damping: 20;
    };
    readonly cardDeal: {
        readonly mass: 0.7;
        readonly stiffness: 280;
        readonly damping: 22;
    };
    readonly chipStack: {
        readonly mass: 0.8;
        readonly stiffness: 300;
        readonly damping: 25;
    };
    readonly chipToss: {
        readonly mass: 0.6;
        readonly stiffness: 250;
        readonly damping: 18;
    };
    readonly chipSettle: {
        readonly mass: 0.4;
        readonly stiffness: 400;
        readonly damping: 20;
    };
    readonly wheelSpin: {
        readonly mass: 2;
        readonly stiffness: 50;
        readonly damping: 10;
    };
    readonly diceTumble: {
        readonly mass: 1.2;
        readonly stiffness: 150;
        readonly damping: 15;
    };
    readonly success: {
        readonly mass: 0.5;
        readonly stiffness: 350;
        readonly damping: 25;
    };
    readonly error: {
        readonly mass: 0.3;
        readonly stiffness: 600;
        readonly damping: 40;
    };
    readonly shake: {
        readonly mass: 0.2;
        readonly stiffness: 800;
        readonly damping: 15;
    };
};
/**
 * Duration values in milliseconds
 * For non-spring animations (opacity, color transitions)
 */
export declare const DURATION: {
    readonly instant: 100;
    readonly fast: 200;
    readonly normal: 300;
    readonly slow: 500;
    readonly dramatic: 1000;
    readonly cinematic: 2000;
};
/**
 * Easing curves as cubic bezier arrays
 * Format: [x1, y1, x2, y2] for CSS cubic-bezier()
 */
export declare const EASING: {
    readonly linear: readonly [0, 0, 1, 1];
    readonly easeIn: readonly [0.4, 0, 1, 1];
    readonly easeOut: readonly [0.16, 1, 0.3, 1];
    readonly easeInOut: readonly [0.4, 0, 0.2, 1];
    readonly bounce: readonly [0.34, 1.56, 0.64, 1];
    readonly anticipate: readonly [0.68, -0.6, 0.32, 1.6];
};
/**
 * Luxury easing curves for premium motion
 * Carefully tuned for Jony Ive-inspired fluid animations
 * Format: [x1, y1, x2, y2] for CSS cubic-bezier()
 */
export declare const EASING_LUXURY: {
    /** Ultra-smooth fluid motion - no sharp edges */
    readonly liquidSmooth: readonly [0.23, 1, 0.32, 1];
    /** Elastic liquid feel with subtle overshoot */
    readonly liquidElastic: readonly [0.68, -0.55, 0.27, 1.55];
    /** Apple-style elegant entrance - quick start, graceful settle */
    readonly elegantEntry: readonly [0.22, 0.61, 0.36, 1];
    /** Refined exit - accelerates away gracefully */
    readonly elegantExit: readonly [0.64, 0, 0.78, 0];
    /** Apple iOS-inspired expressive exit */
    readonly expressiveOut: readonly [0.16, 1, 0.3, 1];
    /** Symmetric expressive motion */
    readonly expressiveInOut: readonly [0.87, 0, 0.13, 1];
    /** Precious, deliberate movement like fine jewelry */
    readonly jewelMotion: readonly [0.33, 0, 0.2, 1];
    /** Silk-like smooth slide */
    readonly silkSlide: readonly [0.25, 0.1, 0.25, 1];
    /** Gentle breathing rhythm for idle states */
    readonly breathe: readonly [0.4, 0, 0.6, 1];
    /** Snap-then-settle for quick feedback */
    readonly snapSettle: readonly [0.175, 0.885, 0.32, 1.275];
};
/**
 * Spring configurations for organic liquid motion
 * Feels like moving through water or honey
 * Works with react-spring (web) and Reanimated (mobile)
 */
export declare const SPRING_LIQUID: {
    /** Light floating motion - minimal mass, gentle settle */
    readonly liquidFloat: {
        readonly mass: 0.3;
        readonly stiffness: 120;
        readonly damping: 12;
    };
    /** Water ripple effect - medium weight, bouncy */
    readonly liquidRipple: {
        readonly mass: 0.5;
        readonly stiffness: 180;
        readonly damping: 14;
    };
    /** Shape morphing - heavier, smooth transformation */
    readonly liquidMorph: {
        readonly mass: 0.8;
        readonly stiffness: 100;
        readonly damping: 18;
    };
    /** Settling after motion - heavy, controlled landing */
    readonly liquidSettle: {
        readonly mass: 1.2;
        readonly stiffness: 140;
        readonly damping: 22;
    };
    /** Wave-like oscillation - medium mass, less damping for flow */
    readonly liquidWave: {
        readonly mass: 0.6;
        readonly stiffness: 160;
        readonly damping: 10;
    };
    /** Honey-like thick movement - very smooth, no bounce */
    readonly liquidHoney: {
        readonly mass: 1.5;
        readonly stiffness: 80;
        readonly damping: 28;
    };
    /** Quick splash response */
    readonly liquidSplash: {
        readonly mass: 0.4;
        readonly stiffness: 220;
        readonly damping: 12;
    };
    /** Sliding along a wet surface */
    readonly liquidSlide: {
        readonly mass: 0.7;
        readonly stiffness: 150;
        readonly damping: 16;
    };
};
/**
 * Scale transform values for consistent animation effects
 * Used for hover, press, focus, and active states
 */
export declare const SCALE: {
    /** Barely visible growth - 1.02x */
    readonly subtle: 1.02;
    /** Small hover effect - 1.05x */
    readonly small: 1.05;
    /** Medium emphasis - 1.1x */
    readonly medium: 1.1;
    /** Large attention grab - 1.15x */
    readonly large: 1.15;
    /** Dramatic emphasis - 1.25x */
    readonly dramatic: 1.25;
};
/**
 * Scale down values for press/active states
 * Creates "squish" effect on interaction
 */
export declare const SCALE_DOWN: {
    /** Subtle press - 0.98x */
    readonly subtle: 0.98;
    /** Small press - 0.95x */
    readonly small: 0.95;
    /** Medium press - 0.9x */
    readonly medium: 0.9;
};
/**
 * Semantic scale mappings for common interactions
 */
export declare const SCALE_SEMANTIC: {
    /** Hover state scale - subtle lift */
    readonly hover: 1.02;
    /** Press/active state - slight shrink */
    readonly press: 0.95;
    /** Focus state - minimal emphasis */
    readonly focus: 1.02;
    /** Active/selected state */
    readonly active: 1.05;
    /** Card hover lift */
    readonly cardHover: 1.02;
    /** Button press squish */
    readonly buttonPress: 0.98;
    /** Icon pop on interaction */
    readonly iconPop: 1.05;
    /** Chip selection */
    readonly chipSelect: 1.1;
};
/**
 * Stagger delays for sequential animations
 * Values in milliseconds
 */
export declare const STAGGER: {
    readonly fast: 30;
    readonly normal: 50;
    readonly slow: 100;
    readonly dramatic: 150;
};
export type SpringPreset = keyof typeof SPRING;
export type SpringConfig = (typeof SPRING)[SpringPreset];
export type SpringLiquidPreset = keyof typeof SPRING_LIQUID;
export type SpringLiquidConfig = (typeof SPRING_LIQUID)[SpringLiquidPreset];
export type DurationKey = keyof typeof DURATION;
export type DurationValue = (typeof DURATION)[DurationKey];
export type EasingKey = keyof typeof EASING;
export type EasingCurve = (typeof EASING)[EasingKey];
export type EasingLuxuryKey = keyof typeof EASING_LUXURY;
export type EasingLuxuryCurve = (typeof EASING_LUXURY)[EasingLuxuryKey];
export type ScaleKey = keyof typeof SCALE;
export type ScaleValue = (typeof SCALE)[ScaleKey];
export type ScaleDownKey = keyof typeof SCALE_DOWN;
export type ScaleDownValue = (typeof SCALE_DOWN)[ScaleDownKey];
export type ScaleSemanticKey = keyof typeof SCALE_SEMANTIC;
export type ScaleSemanticValue = (typeof SCALE_SEMANTIC)[ScaleSemanticKey];
export type StaggerKey = keyof typeof STAGGER;
//# sourceMappingURL=animations.d.ts.map