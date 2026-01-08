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
export const SPRING = {
    // UI interactions - quick and responsive
    button: { mass: 0.5, stiffness: 400, damping: 30 },
    modal: { mass: 0.8, stiffness: 300, damping: 28 },
    dropdown: { mass: 0.6, stiffness: 350, damping: 26 },
    tooltip: { mass: 0.4, stiffness: 500, damping: 35 },
    // Game elements - more theatrical
    cardFlip: { mass: 1, stiffness: 200, damping: 20 },
    cardDeal: { mass: 0.7, stiffness: 280, damping: 22 },
    chipStack: { mass: 0.8, stiffness: 300, damping: 25 },
    chipToss: { mass: 0.6, stiffness: 250, damping: 18 },
    chipSettle: { mass: 0.4, stiffness: 400, damping: 20 }, // Micro-bounce when chip lands
    wheelSpin: { mass: 2, stiffness: 50, damping: 10 },
    diceTumble: { mass: 1.2, stiffness: 150, damping: 15 },
    // Feedback animations
    success: { mass: 0.5, stiffness: 350, damping: 25 },
    error: { mass: 0.3, stiffness: 600, damping: 40 },
    shake: { mass: 0.2, stiffness: 800, damping: 15 },
};
/**
 * Duration values in milliseconds
 * For non-spring animations (opacity, color transitions)
 */
export const DURATION = {
    instant: 100,
    fast: 200,
    normal: 300,
    slow: 500,
    dramatic: 1000,
    cinematic: 2000,
};
/**
 * Easing curves as cubic bezier arrays
 * Format: [x1, y1, x2, y2] for CSS cubic-bezier()
 */
export const EASING = {
    linear: [0, 0, 1, 1],
    easeIn: [0.4, 0, 1, 1],
    easeOut: [0.16, 1, 0.3, 1],
    easeInOut: [0.4, 0, 0.2, 1],
    bounce: [0.34, 1.56, 0.64, 1],
    anticipate: [0.68, -0.6, 0.32, 1.6],
};
/**
 * Luxury easing curves for premium motion
 * Carefully tuned for Jony Ive-inspired fluid animations
 * Format: [x1, y1, x2, y2] for CSS cubic-bezier()
 */
export const EASING_LUXURY = {
    /** Ultra-smooth fluid motion - no sharp edges */
    liquidSmooth: [0.23, 1, 0.32, 1],
    /** Elastic liquid feel with subtle overshoot */
    liquidElastic: [0.68, -0.55, 0.27, 1.55],
    /** Apple-style elegant entrance - quick start, graceful settle */
    elegantEntry: [0.22, 0.61, 0.36, 1],
    /** Refined exit - accelerates away gracefully */
    elegantExit: [0.64, 0, 0.78, 0],
    /** Apple iOS-inspired expressive exit */
    expressiveOut: [0.16, 1, 0.3, 1],
    /** Symmetric expressive motion */
    expressiveInOut: [0.87, 0, 0.13, 1],
    /** Precious, deliberate movement like fine jewelry */
    jewelMotion: [0.33, 0, 0.2, 1],
    /** Silk-like smooth slide */
    silkSlide: [0.25, 0.1, 0.25, 1],
    /** Gentle breathing rhythm for idle states */
    breathe: [0.4, 0, 0.6, 1],
    /** Snap-then-settle for quick feedback */
    snapSettle: [0.175, 0.885, 0.32, 1.275],
};
/**
 * Spring configurations for organic liquid motion
 * Feels like moving through water or honey
 * Works with react-spring (web) and Reanimated (mobile)
 */
export const SPRING_LIQUID = {
    /** Light floating motion - minimal mass, gentle settle */
    liquidFloat: { mass: 0.3, stiffness: 120, damping: 12 },
    /** Water ripple effect - medium weight, bouncy */
    liquidRipple: { mass: 0.5, stiffness: 180, damping: 14 },
    /** Shape morphing - heavier, smooth transformation */
    liquidMorph: { mass: 0.8, stiffness: 100, damping: 18 },
    /** Settling after motion - heavy, controlled landing */
    liquidSettle: { mass: 1.2, stiffness: 140, damping: 22 },
    /** Wave-like oscillation - medium mass, less damping for flow */
    liquidWave: { mass: 0.6, stiffness: 160, damping: 10 },
    /** Honey-like thick movement - very smooth, no bounce */
    liquidHoney: { mass: 1.5, stiffness: 80, damping: 28 },
    /** Quick splash response */
    liquidSplash: { mass: 0.4, stiffness: 220, damping: 12 },
    /** Sliding along a wet surface */
    liquidSlide: { mass: 0.7, stiffness: 150, damping: 16 },
};
/**
 * Scale transform values for consistent animation effects
 * Used for hover, press, focus, and active states
 */
export const SCALE = {
    /** Barely visible growth - 1.02x */
    subtle: 1.02,
    /** Small hover effect - 1.05x */
    small: 1.05,
    /** Medium emphasis - 1.1x */
    medium: 1.1,
    /** Large attention grab - 1.15x */
    large: 1.15,
    /** Dramatic emphasis - 1.25x */
    dramatic: 1.25,
};
/**
 * Scale down values for press/active states
 * Creates "squish" effect on interaction
 */
export const SCALE_DOWN = {
    /** Subtle press - 0.98x */
    subtle: 0.98,
    /** Small press - 0.95x */
    small: 0.95,
    /** Medium press - 0.9x */
    medium: 0.9,
};
/**
 * Semantic scale mappings for common interactions
 */
export const SCALE_SEMANTIC = {
    /** Hover state scale - subtle lift */
    hover: SCALE.subtle,
    /** Press/active state - slight shrink */
    press: SCALE_DOWN.small,
    /** Focus state - minimal emphasis */
    focus: SCALE.subtle,
    /** Active/selected state */
    active: SCALE.small,
    /** Card hover lift */
    cardHover: SCALE.subtle,
    /** Button press squish */
    buttonPress: SCALE_DOWN.subtle,
    /** Icon pop on interaction */
    iconPop: SCALE.small,
    /** Chip selection */
    chipSelect: SCALE.medium,
};
/**
 * Stagger delays for sequential animations
 * Values in milliseconds
 */
export const STAGGER = {
    fast: 30,
    normal: 50,
    slow: 100,
    dramatic: 150,
};
//# sourceMappingURL=animations.js.map