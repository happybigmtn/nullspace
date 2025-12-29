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
export type DurationKey = keyof typeof DURATION;
export type DurationValue = (typeof DURATION)[DurationKey];
export type EasingKey = keyof typeof EASING;
export type EasingCurve = (typeof EASING)[EasingKey];
export type StaggerKey = keyof typeof STAGGER;
//# sourceMappingURL=animations.d.ts.map