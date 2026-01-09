/**
 * Liquid Crystal Motion Language (US-269)
 *
 * Defines motion patterns for the Liquid Crystal design system that feel
 * like liquid glass reacting to user interaction. Motion should be:
 *
 * 1. Subordinate - Never compete with game state or result animations
 * 2. Reactive - Respond to user touch/hover like liquid surfaces
 * 3. Cohesive - Create unified material behavior across surfaces
 * 4. Accessible - Respect reduced-motion preferences
 *
 * Key principle: Motion should feel like light and reflections moving
 * across a glass surface, not the glass itself moving.
 *
 * NO platform-specific code - raw values only
 */

import { DURATION, EASING_LUXURY, SPRING_LIQUID } from './animations.js';
import { SPECULAR } from './liquid-crystal.js';

// ─────────────────────────────────────────────────────────────────────────────
// Motion Tiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Motion tiers define the intensity of animation effects.
 * Lower tiers are used for more prominent game feedback.
 *
 * - `none`: No motion (reduced-motion: reduce + animations disabled)
 * - `reduced`: Minimal motion (reduced-motion: reduce, essential only)
 * - `standard`: Default motion level for most UI
 * - `elevated`: Enhanced motion for special moments (big wins, etc.)
 */
export const MOTION_TIER = {
  none: 'none',
  reduced: 'reduced',
  standard: 'standard',
  elevated: 'elevated',
} as const;

export type MotionTier = keyof typeof MOTION_TIER;

/**
 * Timing configurations per motion tier
 */
export const MOTION_TIMING = {
  none: {
    micro: 0,
    state: 0,
    reveal: 0,
    dramatic: 0,
  },
  reduced: {
    micro: 10,      // Near-instant but not jarring
    state: 10,
    reveal: 10,
    dramatic: 100,  // Minimal for important feedback
  },
  standard: {
    micro: 180,     // Subtle interactions
    state: 300,     // State changes
    reveal: 600,    // Content reveal
    dramatic: 1000, // Big moments
  },
  elevated: {
    micro: 200,     // Slightly longer for impact
    state: 400,     // More theatrical
    reveal: 800,    // Cinematic reveal
    dramatic: 2000, // Full celebration
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Motion Hierarchy - Game State > UI Feedback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Motion hierarchy defines which animations take precedence.
 * Higher priority = can interrupt or suppress lower priority motion.
 *
 * This prevents decorative glass effects from competing with
 * important game feedback like win/loss animations.
 */
export const MOTION_PRIORITY = {
  /** Game result animations (wins, losses, jackpots) - HIGHEST */
  gameResult: 100,
  /** Game state changes (card flip, dice roll, wheel spin) */
  gameAction: 80,
  /** User feedback (button press, bet placement) */
  userFeedback: 60,
  /** UI state changes (modal open, sheet slide) */
  uiState: 40,
  /** Decorative effects (glass shimmer, specular sweep) - LOWEST */
  decorative: 20,
} as const;

export type MotionPriorityKey = keyof typeof MOTION_PRIORITY;

// ─────────────────────────────────────────────────────────────────────────────
// Liquid Crystal Animations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Specular sweep configurations for interactive glass surfaces.
 * Creates the illusion of light sweeping across the surface on interaction.
 */
export const LC_SWEEP = {
  /** Quick interaction feedback */
  micro: {
    duration: DURATION.fast,
    easing: EASING_LUXURY.liquidSmooth,
    specular: SPECULAR.sweep,
    priority: MOTION_PRIORITY.userFeedback,
  },
  /** Standard hover/focus sweep */
  standard: {
    duration: DURATION.normal,
    easing: EASING_LUXURY.liquidSmooth,
    specular: SPECULAR.sweep,
    priority: MOTION_PRIORITY.userFeedback,
  },
  /** Extended sweep for emphasis */
  slow: {
    duration: DURATION.slow,
    easing: EASING_LUXURY.liquidSmooth,
    specular: SPECULAR.sweep,
    priority: MOTION_PRIORITY.decorative,
  },
  /** Idle loop for attention-drawing surfaces */
  idle: {
    duration: 3000, // 3 seconds
    easing: EASING_LUXURY.breathe,
    specular: { ...SPECULAR.sweep, intensity: 0.5 }, // Reduced intensity
    priority: MOTION_PRIORITY.decorative,
    loop: true,
  },
} as const;

/**
 * Refraction pulse configurations for glass surface feedback.
 * Simulates the glass "responding" to touch like water rippling.
 */
export const LC_REFRACT = {
  /** Subtle pulse on hover */
  hover: {
    duration: DURATION.fast,
    blurDelta: 2,        // px change in blur
    brightnessDelta: 3,  // % change in brightness
    easing: EASING_LUXURY.liquidElastic,
    priority: MOTION_PRIORITY.userFeedback,
  },
  /** Press/tap feedback */
  press: {
    duration: 120,       // Very quick
    blurDelta: 4,
    brightnessDelta: 8,
    easing: EASING_LUXURY.snapSettle,
    priority: MOTION_PRIORITY.userFeedback,
  },
  /** Focus ring activation */
  focus: {
    duration: DURATION.normal,
    blurDelta: 2,
    brightnessDelta: 5,
    easing: EASING_LUXURY.elegantEntry,
    priority: MOTION_PRIORITY.uiState,
  },
  /** State transition (e.g., selected) */
  state: {
    duration: DURATION.normal,
    blurDelta: 4,
    brightnessDelta: 10,
    easing: EASING_LUXURY.jewelMotion,
    priority: MOTION_PRIORITY.uiState,
  },
} as const;

/**
 * Edge highlight animations for glass surface edges.
 * Creates subtle edge glow effects on interaction.
 */
export const LC_EDGE = {
  /** Subtle edge activation on hover */
  hover: {
    duration: DURATION.fast,
    opacityDelta: 0.05, // Increase edge opacity
    easing: EASING_LUXURY.liquidSmooth,
    priority: MOTION_PRIORITY.userFeedback,
  },
  /** Edge pulse on press */
  press: {
    duration: 100,
    opacityDelta: 0.1,
    easing: EASING_LUXURY.snapSettle,
    priority: MOTION_PRIORITY.userFeedback,
  },
  /** Active/selected state */
  active: {
    duration: DURATION.normal,
    opacityDelta: 0.15,
    easing: EASING_LUXURY.elegantEntry,
    priority: MOTION_PRIORITY.uiState,
  },
} as const;

/**
 * Glass surface entrance/exit animations.
 * For modals, sheets, tooltips appearing on screen.
 */
export const LC_ENTRANCE = {
  /** Tooltip/popover appearance */
  tooltip: {
    enter: {
      duration: DURATION.fast,
      opacity: { from: 0, to: 1 },
      blur: { from: 0, to: 4 },
      scale: { from: 0.95, to: 1 },
      easing: EASING_LUXURY.liquidElastic,
    },
    exit: {
      duration: 150,
      opacity: { from: 1, to: 0 },
      blur: { from: 4, to: 0 },
      scale: { from: 1, to: 0.95 },
      easing: EASING_LUXURY.elegantExit,
    },
    priority: MOTION_PRIORITY.uiState,
  },
  /** Dropdown menu appearance */
  dropdown: {
    enter: {
      duration: DURATION.normal,
      opacity: { from: 0, to: 1 },
      blur: { from: 0, to: 8 },
      translateY: { from: -8, to: 0 },
      easing: EASING_LUXURY.expressiveOut,
    },
    exit: {
      duration: DURATION.fast,
      opacity: { from: 1, to: 0 },
      blur: { from: 8, to: 4 },
      translateY: { from: 0, to: -4 },
      easing: EASING_LUXURY.elegantExit,
    },
    priority: MOTION_PRIORITY.uiState,
  },
  /** Modal appearance */
  modal: {
    enter: {
      duration: DURATION.slow,
      opacity: { from: 0, to: 1 },
      blur: { from: 0, to: 16 },
      scale: { from: 0.9, to: 1 },
      easing: EASING_LUXURY.jewelMotion,
    },
    exit: {
      duration: DURATION.normal,
      opacity: { from: 1, to: 0 },
      blur: { from: 16, to: 8 },
      scale: { from: 1, to: 0.95 },
      easing: EASING_LUXURY.elegantExit,
    },
    priority: MOTION_PRIORITY.uiState,
  },
  /** Bottom sheet slide */
  sheet: {
    enter: {
      duration: DURATION.slow,
      opacity: { from: 0.5, to: 1 },
      blur: { from: 8, to: 24 },
      translateY: { from: '100%', to: 0 },
      easing: EASING_LUXURY.silkSlide,
    },
    exit: {
      duration: DURATION.normal,
      opacity: { from: 1, to: 0 },
      blur: { from: 24, to: 12 },
      translateY: { from: 0, to: '100%' },
      easing: EASING_LUXURY.elegantExit,
    },
    priority: MOTION_PRIORITY.uiState,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Spring Configurations for Liquid Motion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spring configurations specifically tuned for Liquid Crystal effects.
 * Re-exports from animations.ts with semantic naming for glass surfaces.
 */
export const LC_SPRING = {
  /** Light floating elements (tooltips, badges) */
  float: SPRING_LIQUID.liquidFloat,
  /** Ripple effect on interaction */
  ripple: SPRING_LIQUID.liquidRipple,
  /** Shape/size transitions */
  morph: SPRING_LIQUID.liquidMorph,
  /** Element coming to rest */
  settle: SPRING_LIQUID.liquidSettle,
  /** Wave-like motion (sheets, curtains) */
  wave: SPRING_LIQUID.liquidWave,
  /** Thick, smooth movement (modals) */
  heavy: SPRING_LIQUID.liquidHoney,
  /** Quick response (buttons, chips) */
  splash: SPRING_LIQUID.liquidSplash,
  /** Sliding motion (drawers, sidebars) */
  slide: SPRING_LIQUID.liquidSlide,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CSS Keyframe Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CSS keyframe definitions for Liquid Crystal animations.
 * Use these to define @keyframes in CSS or generate them dynamically.
 */
export const LC_KEYFRAMES = {
  /** Specular highlight sweep across surface */
  'lc-sweep': {
    '0%': { backgroundPosition: '-200% 0' },
    '100%': { backgroundPosition: '200% 0' },
  },
  /** Refraction pulse effect */
  'lc-refract': {
    '0%': { backdropFilter: 'blur(8px) brightness(105%)' },
    '50%': { backdropFilter: 'blur(12px) brightness(115%)' },
    '100%': { backdropFilter: 'blur(8px) brightness(105%)' },
  },
  /** Subtle edge glow pulse */
  'lc-edge-glow': {
    '0%, 100%': { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.08)' },
    '50%': { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.12)' },
  },
  /** Glass shimmer for loading states */
  'lc-shimmer': {
    '0%': { backgroundPosition: '-100% 0', opacity: '0.5' },
    '50%': { opacity: '0.8' },
    '100%': { backgroundPosition: '100% 0', opacity: '0.5' },
  },
  /** Subtle floating motion */
  'lc-float': {
    '0%, 100%': { transform: 'translateY(0)' },
    '50%': { transform: 'translateY(-4px)' },
  },
  /** Breathing pulse for idle states */
  'lc-breathe': {
    '0%, 100%': { opacity: '0.9', transform: 'scale(1)' },
    '50%': { opacity: '1', transform: 'scale(1.02)' },
  },
  /** Ripple effect from center */
  'lc-ripple': {
    '0%': { transform: 'scale(0.8)', opacity: '1' },
    '100%': { transform: 'scale(1.5)', opacity: '0' },
  },
} as const;

/**
 * CSS animation definitions combining keyframes with timing.
 * Use these directly as animation property values.
 */
export const LC_ANIMATION = {
  /** Standard specular sweep */
  sweep: `lc-sweep 1.5s ${toEasingCSS(EASING_LUXURY.liquidSmooth)}`,
  /** Quick refraction pulse */
  refract: `lc-refract 0.3s ${toEasingCSS(EASING_LUXURY.liquidElastic)}`,
  /** Edge highlight pulse */
  edgeGlow: `lc-edge-glow 2s ${toEasingCSS(EASING_LUXURY.breathe)} infinite`,
  /** Loading shimmer */
  shimmer: `lc-shimmer 2s ${toEasingCSS(EASING_LUXURY.liquidSmooth)} infinite`,
  /** Floating motion */
  float: `lc-float 3s ${toEasingCSS(EASING_LUXURY.breathe)} infinite`,
  /** Idle breathing */
  breathe: `lc-breathe 4s ${toEasingCSS(EASING_LUXURY.breathe)} infinite`,
  /** Single ripple */
  ripple: `lc-ripple 0.6s ${toEasingCSS(EASING_LUXURY.liquidElastic)} forwards`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Motion Suppression for Game States
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Game states that should suppress decorative motion.
 * When these states are active, only high-priority animations should play.
 */
export const GAME_STATE_MOTION_RULES = {
  /** Waiting for game result - suppress decorative motion */
  awaitingResult: {
    allow: [MOTION_PRIORITY.gameResult, MOTION_PRIORITY.gameAction],
    suppress: [MOTION_PRIORITY.decorative],
  },
  /** Result revealing - only game animations */
  revealingResult: {
    allow: [MOTION_PRIORITY.gameResult],
    suppress: [MOTION_PRIORITY.decorative, MOTION_PRIORITY.uiState],
  },
  /** Big win celebration - elevated motion tier */
  bigWin: {
    tier: MOTION_TIER.elevated,
    allow: [MOTION_PRIORITY.gameResult],
    suppress: [MOTION_PRIORITY.decorative, MOTION_PRIORITY.uiState],
  },
  /** Normal play - standard motion */
  playing: {
    tier: MOTION_TIER.standard,
    allow: 'all',
    suppress: [],
  },
  /** Idle lobby - decorative motion allowed */
  idle: {
    tier: MOTION_TIER.standard,
    allow: 'all',
    suppress: [],
  },
} as const;

export type GameStateKey = keyof typeof GAME_STATE_MOTION_RULES;

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert easing array to CSS cubic-bezier string
 */
export function toEasingCSS(easing: readonly number[]): string {
  return `cubic-bezier(${easing[0]}, ${easing[1]}, ${easing[2]}, ${easing[3]})`;
}

/**
 * Check if motion should be allowed given current priority and game state
 */
export function shouldAllowMotion(
  motionPriority: number,
  gameState: GameStateKey
): boolean {
  const rules = GAME_STATE_MOTION_RULES[gameState];
  if (rules.allow === 'all') return true;
  return (rules.allow as readonly number[]).includes(motionPriority);
}

/**
 * Get timing for a motion tier
 */
export function getMotionTiming(
  tier: MotionTier,
  type: keyof typeof MOTION_TIMING.standard
): number {
  return MOTION_TIMING[tier][type];
}

/**
 * Generate CSS custom properties for motion timing
 */
export function generateMotionCSSVars(tier: MotionTier): string {
  const timing = MOTION_TIMING[tier];
  return `
    --lc-motion-micro: ${timing.micro}ms;
    --lc-motion-state: ${timing.state}ms;
    --lc-motion-reveal: ${timing.reveal}ms;
    --lc-motion-dramatic: ${timing.dramatic}ms;
  `.trim();
}

/**
 * Generate complete CSS for Liquid Crystal motion system
 * Use in global stylesheet or inject dynamically
 */
export function generateLCMotionCSS(): string {
  return `
/* ─────────────────────────────────────────────────────────────────────────────
 * Liquid Crystal Motion Language (US-269)
 *
 * Motion should feel like liquid glass reacting to user interaction.
 * Specular highlights sweep across surfaces, refraction pulses on touch,
 * and edges glow subtly to create material depth.
 * ───────────────────────────────────────────────────────────────────────────── */

/* Motion CSS Custom Properties */
:root {
${generateMotionCSSVars('standard').split('\n').map(line => '  ' + line.trim()).join('\n')}
  --lc-motion-ease: ${toEasingCSS(EASING_LUXURY.liquidSmooth)};
  --lc-motion-ease-spring: ${toEasingCSS(EASING_LUXURY.liquidElastic)};
  --lc-motion-ease-settle: ${toEasingCSS(EASING_LUXURY.jewelMotion)};
}

/* Reduced motion tier */
@media (prefers-reduced-motion: reduce) {
  :root {
${generateMotionCSSVars('reduced').split('\n').map(line => '    ' + line.trim()).join('\n')}
  }
}

/* Keyframe Definitions */
@keyframes lc-sweep {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes lc-refract {
  0% { backdrop-filter: blur(8px) brightness(105%); }
  50% { backdrop-filter: blur(12px) brightness(115%); }
  100% { backdrop-filter: blur(8px) brightness(105%); }
}

@keyframes lc-edge-glow {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.08); }
  50% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.12); }
}

@keyframes lc-shimmer {
  0% { background-position: -100% 0; opacity: 0.5; }
  50% { opacity: 0.8; }
  100% { background-position: 100% 0; opacity: 0.5; }
}

@keyframes lc-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes lc-breathe {
  0%, 100% { opacity: 0.9; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.02); }
}

@keyframes lc-ripple {
  0% { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(1.5); opacity: 0; }
}

/* Animation Classes */
.animate-lc-sweep {
  animation: lc-sweep 1.5s var(--lc-motion-ease);
}

.animate-lc-refract {
  animation: lc-refract 0.3s var(--lc-motion-ease-spring);
}

.animate-lc-edge-glow {
  animation: lc-edge-glow 2s var(--lc-motion-ease) infinite;
}

.animate-lc-shimmer {
  animation: lc-shimmer 2s var(--lc-motion-ease) infinite;
}

.animate-lc-float {
  animation: lc-float 3s var(--lc-motion-ease) infinite;
}

.animate-lc-breathe {
  animation: lc-breathe 4s var(--lc-motion-ease) infinite;
}

.animate-lc-ripple {
  animation: lc-ripple 0.6s var(--lc-motion-ease-spring) forwards;
}

/* Interactive motion utilities */
.lc-motion-hover:hover {
  animation: lc-refract 0.2s var(--lc-motion-ease-spring);
}

.lc-motion-press:active {
  animation: lc-ripple 0.3s var(--lc-motion-ease-spring);
}

/* Game state suppression - add to container when game state is active */
.lc-suppress-decorative .animate-lc-sweep,
.lc-suppress-decorative .animate-lc-shimmer,
.lc-suppress-decorative .animate-lc-float,
.lc-suppress-decorative .animate-lc-breathe,
.lc-suppress-decorative .animate-lc-edge-glow {
  animation: none !important;
}

/* Elevated motion tier - for big win states */
.lc-motion-elevated {
  --lc-motion-micro: ${MOTION_TIMING.elevated.micro}ms;
  --lc-motion-state: ${MOTION_TIMING.elevated.state}ms;
  --lc-motion-reveal: ${MOTION_TIMING.elevated.reveal}ms;
  --lc-motion-dramatic: ${MOTION_TIMING.elevated.dramatic}ms;
}
`;
}

// Type exports
export type LCSweepPreset = keyof typeof LC_SWEEP;
export type LCRefractPreset = keyof typeof LC_REFRACT;
export type LCEdgePreset = keyof typeof LC_EDGE;
export type LCEntrancePreset = keyof typeof LC_ENTRANCE;
export type LCSpringPreset = keyof typeof LC_SPRING;
export type LCKeyframeName = keyof typeof LC_KEYFRAMES;
export type LCAnimationName = keyof typeof LC_ANIMATION;
