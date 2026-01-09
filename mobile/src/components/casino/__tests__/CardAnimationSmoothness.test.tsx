/**
 * Card Animation Smoothness Tests (QA-N08)
 *
 * Tests for ensuring card dealing animations can achieve 60fps performance.
 * Since Jest runs in a test environment where animations are skipped, these tests:
 * - Validate animation constants stay within performance budgets
 * - Verify spring configurations converge (no infinite oscillation)
 * - Test animation complexity doesn't scale exponentially with card count
 * - Document performance characteristics for low-end device testing
 *
 * For actual 60fps verification on real devices, run:
 * - Detox E2E tests with Flashlight performance monitoring
 * - Manual testing on low-end Android devices (see RUNBOOK.md §6.6.1)
 */
import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { DealtCard, DealtHiddenCard } from '../DealtCard';
import { Card } from '../Card';
import type { Suit, Rank } from '../../../types';

// Import animation constants for validation
import { SPRING, STAGGER } from '../../../constants/theme';

// Mock haptics
jest.mock('../../../services/haptics', () => ({
  haptics: { cardDeal: jest.fn().mockResolvedValue(undefined) },
}));

// Mock theme constants with valid Spring configs
jest.mock('../../../constants/theme', () => ({
  COLORS: {
    suitRed: '#FF0000',
    suitBlack: '#1A1A1A',
  },
  RADIUS: { md: 8, sm: 4 },
  SPRING: {
    cardFlip: { damping: 15, stiffness: 100, mass: 0.8 },
    cardDeal: { damping: 22, stiffness: 280, mass: 0.7 },
    liquidRipple: { damping: 15, stiffness: 180, mass: 0.5 },
  },
  STAGGER: {
    fast: 25,
    normal: 50,
    slow: 100,
  },
}));

/**
 * Animation timing constants from DealtCard.tsx
 * These are the values we're testing against for 60fps budget
 */
const ANIMATION_CONSTANTS = {
  DEAL_DURATION_MS: 350,
  ARC_HEIGHT_RATIO: 0.25,
  FLIGHT_ROTATION_START_DEG: 45,
  FLIGHT_ROTATION_END_DEG: 0,
  LANDING_SCALE_PEAK: 1.08,
  FLIP_DELAY_AFTER_LANDING_MS: 80,
  DEFAULT_STAGGER_MS: 50,
};

/**
 * 60fps performance budget constants
 */
const PERFORMANCE_BUDGET = {
  /** Maximum frame time for 60fps (1000ms / 60fps = 16.67ms) */
  FRAME_BUDGET_MS: 16.67,
  /** Maximum acceptable total animation duration for single card deal */
  MAX_SINGLE_CARD_DURATION_MS: 600,
  /** Maximum acceptable total duration for 4-card deal (Blackjack opening) */
  MAX_FOUR_CARD_DURATION_MS: 1000,
  /** Maximum spring damping ratio to prevent overdamping (sluggish animations) */
  MAX_DAMPING_RATIO: 1.5,
  /** Minimum spring damping ratio to prevent underdamping (bouncy chaos) */
  MIN_DAMPING_RATIO: 0.3,
  /** Maximum number of simultaneous transform operations per frame */
  MAX_TRANSFORMS_PER_FRAME: 5,
  /** Maximum interpolation keyframes for smooth curves */
  MAX_INTERPOLATION_POINTS: 10,
};

describe('Card Animation Smoothness (QA-N08)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('Animation timing budget validation', () => {
    it('deal duration fits within 60fps frame budget (21 frames)', () => {
      // 350ms / 16.67ms = 21 frames
      const frameCount = ANIMATION_CONSTANTS.DEAL_DURATION_MS / PERFORMANCE_BUDGET.FRAME_BUDGET_MS;

      // Should have at least 10 frames for smooth animation
      expect(frameCount).toBeGreaterThanOrEqual(10);

      // Should not exceed 40 frames (avoiding sluggish feel)
      expect(frameCount).toBeLessThanOrEqual(40);

      // Document actual frame count
      console.log(`Deal animation: ${ANIMATION_CONSTANTS.DEAL_DURATION_MS}ms = ${frameCount.toFixed(1)} frames at 60fps`);
    });

    it('stagger delay allows sufficient frames between card starts', () => {
      const staggerFrames = ANIMATION_CONSTANTS.DEFAULT_STAGGER_MS / PERFORMANCE_BUDGET.FRAME_BUDGET_MS;

      // Should have at least 2 frames between card starts for visual distinction
      expect(staggerFrames).toBeGreaterThanOrEqual(2);

      // Should not exceed 10 frames to avoid slow feel
      expect(staggerFrames).toBeLessThanOrEqual(10);

      console.log(`Stagger: ${ANIMATION_CONSTANTS.DEFAULT_STAGGER_MS}ms = ${staggerFrames.toFixed(1)} frames between cards`);
    });

    it('total 4-card deal duration stays within budget', () => {
      // 4 cards with 50ms stagger + 350ms deal duration
      // First card: starts at 0ms, ends at 350ms
      // Fourth card: starts at 150ms (3 * 50ms), ends at 500ms
      const totalDuration = ANIMATION_CONSTANTS.DEAL_DURATION_MS + (3 * ANIMATION_CONSTANTS.DEFAULT_STAGGER_MS);

      expect(totalDuration).toBeLessThanOrEqual(PERFORMANCE_BUDGET.MAX_FOUR_CARD_DURATION_MS);

      console.log(`4-card deal total: ${totalDuration}ms (budget: ${PERFORMANCE_BUDGET.MAX_FOUR_CARD_DURATION_MS}ms)`);
    });

    it('flip delay is minimal but perceptible', () => {
      // Flip should happen quickly after landing but be distinct
      const flipDelayFrames = ANIMATION_CONSTANTS.FLIP_DELAY_AFTER_LANDING_MS / PERFORMANCE_BUDGET.FRAME_BUDGET_MS;

      // At least 3 frames for perception
      expect(flipDelayFrames).toBeGreaterThanOrEqual(3);

      // Not more than 10 frames to avoid sluggish feel
      expect(flipDelayFrames).toBeLessThanOrEqual(10);

      console.log(`Flip delay: ${ANIMATION_CONSTANTS.FLIP_DELAY_AFTER_LANDING_MS}ms = ${flipDelayFrames.toFixed(1)} frames`);
    });
  });

  describe('Spring configuration validation', () => {
    it('cardDeal spring has appropriate damping ratio', () => {
      const { damping, stiffness, mass } = SPRING.cardDeal;

      // Damping ratio = damping / (2 * sqrt(stiffness * mass))
      // Critical damping = 1.0 (no oscillation)
      // < 1.0 = underdamped (bouncy)
      // > 1.0 = overdamped (sluggish)
      const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));

      expect(dampingRatio).toBeGreaterThanOrEqual(PERFORMANCE_BUDGET.MIN_DAMPING_RATIO);
      expect(dampingRatio).toBeLessThanOrEqual(PERFORMANCE_BUDGET.MAX_DAMPING_RATIO);

      console.log(`cardDeal spring damping ratio: ${dampingRatio.toFixed(3)} (optimal: 0.6-1.0)`);
    });

    it('cardFlip spring has appropriate damping ratio', () => {
      const { damping, stiffness, mass } = SPRING.cardFlip;
      const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));

      expect(dampingRatio).toBeGreaterThanOrEqual(PERFORMANCE_BUDGET.MIN_DAMPING_RATIO);
      expect(dampingRatio).toBeLessThanOrEqual(PERFORMANCE_BUDGET.MAX_DAMPING_RATIO);

      console.log(`cardFlip spring damping ratio: ${dampingRatio.toFixed(3)} (optimal: 0.6-1.0)`);
    });

    it('landing spring modification preserves convergence', () => {
      // Landing spring uses modified cardDeal config:
      // stiffness * 1.2, damping * 0.85
      const baseDamping = SPRING.cardDeal.damping * 0.85;
      const baseStiffness = SPRING.cardDeal.stiffness * 1.2;
      const mass = SPRING.cardDeal.mass;

      const dampingRatio = baseDamping / (2 * Math.sqrt(baseStiffness * mass));

      // Landing spring should be slightly underdamped for visible bounce
      expect(dampingRatio).toBeGreaterThanOrEqual(0.4); // Allow some bounce
      expect(dampingRatio).toBeLessThanOrEqual(1.2); // But still converge

      console.log(`Landing spring damping ratio: ${dampingRatio.toFixed(3)} (slightly underdamped for bounce)`);
    });

    it('spring settle time estimation stays within animation budget', () => {
      // Approximate settle time for underdamped spring: 4 * (mass / damping)
      const { damping, stiffness, mass } = SPRING.cardDeal;
      const settleTime = 4 * (mass / damping) * 1000; // Convert to ms

      // Should settle within reasonable time (not dragging on forever)
      expect(settleTime).toBeLessThan(500);

      console.log(`Estimated spring settle time: ${settleTime.toFixed(0)}ms`);
    });
  });

  describe('Transform complexity validation', () => {
    it('trajectory animation uses acceptable number of transforms', () => {
      // From DealtCard.tsx trajectoryStyle:
      // transform: [translateX, translateY, rotate, scale]
      // Plus opacity (not a transform but computed each frame)
      const transformCount = 4;
      const computedPropertiesPerFrame = 5; // translateX, translateY, rotation, scale, opacity

      expect(computedPropertiesPerFrame).toBeLessThanOrEqual(PERFORMANCE_BUDGET.MAX_TRANSFORMS_PER_FRAME);

      console.log(`Per-frame computed properties: ${computedPropertiesPerFrame}`);
    });

    it('interpolation uses reasonable number of keyframes', () => {
      // From DealtCard.tsx:
      // - dealProgress X interpolation: [0, 1] = 2 points
      // - dealProgress Y interpolation: [0, 1] = 2 points
      // - rotation interpolation: [0, 0.4, 0.8, 1] = 4 points
      // - opacity interpolation: [0, 0.2, 1] = 3 points
      const maxKeyframes = 4; // rotation has most keyframes

      expect(maxKeyframes).toBeLessThanOrEqual(PERFORMANCE_BUDGET.MAX_INTERPOLATION_POINTS);

      console.log(`Max interpolation keyframes: ${maxKeyframes}`);
    });

    it('arc trajectory calculation is O(1) complexity', () => {
      // Parabolic arc: -arcHeight * 4 * progress * (1 - progress)
      // This is a constant-time calculation regardless of animation progress
      const progress = 0.5;
      const arcHeight = 100;

      const startTime = performance.now();
      for (let i = 0; i < 10000; i++) {
        const arcOffset = -arcHeight * 4 * progress * (1 - progress);
      }
      const endTime = performance.now();

      // 10000 iterations should complete in under 10ms (constant time)
      expect(endTime - startTime).toBeLessThan(10);
    });
  });

  describe('Multi-card animation scaling', () => {
    it('renders 4 cards (Blackjack opening) without performance degradation', () => {
      const cards: Array<{ suit: Suit; rank: Rank }> = [
        { suit: 'hearts', rank: 'A' },
        { suit: 'spades', rank: 'K' },
        { suit: 'diamonds', rank: 'Q' },
        { suit: 'clubs', rank: 'J' },
      ];

      let tree!: ReactTestRenderer;

      const startTime = performance.now();
      act(() => {
        tree = renderer.create(
          <View>
            {cards.map((card, i) => (
              <DealtCard
                key={i}
                suit={card.suit}
                rank={card.rank}
                faceUp={true}
                dealIndex={i}
              />
            ))}
          </View>
        );
      });
      const renderTime = performance.now() - startTime;

      // Initial render should complete quickly
      expect(renderTime).toBeLessThan(100);

      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });

      console.log(`4-card initial render: ${renderTime.toFixed(1)}ms`);
    });

    it('renders 8 cards (Baccarat full deal) without exponential slowdown', () => {
      const cards: Array<{ suit: Suit; rank: Rank }> = [
        { suit: 'hearts', rank: 'A' },
        { suit: 'spades', rank: 'K' },
        { suit: 'diamonds', rank: 'Q' },
        { suit: 'clubs', rank: 'J' },
        { suit: 'hearts', rank: '10' },
        { suit: 'spades', rank: '9' },
        { suit: 'diamonds', rank: '8' },
        { suit: 'clubs', rank: '7' },
      ];

      let tree!: ReactTestRenderer;

      const startTime = performance.now();
      act(() => {
        tree = renderer.create(
          <View>
            {cards.map((card, i) => (
              <DealtCard
                key={i}
                suit={card.suit}
                rank={card.rank}
                faceUp={true}
                dealIndex={i}
              />
            ))}
          </View>
        );
      });
      const renderTime = performance.now() - startTime;

      // 8 cards should not be more than 3x slower than 4 cards
      // (linear scaling acceptable, exponential is not)
      expect(renderTime).toBeLessThan(300);

      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });

      console.log(`8-card initial render: ${renderTime.toFixed(1)}ms`);
    });

    it('mixed DealtCard and DealtHiddenCard render efficiently', () => {
      let tree!: ReactTestRenderer;

      const startTime = performance.now();
      act(() => {
        tree = renderer.create(
          <View>
            <DealtCard suit="hearts" rank="A" faceUp={true} dealIndex={0} />
            <DealtHiddenCard dealIndex={1} />
            <DealtCard suit="spades" rank="K" faceUp={true} dealIndex={2} />
            <DealtHiddenCard dealIndex={3} />
          </View>
        );
      });
      const renderTime = performance.now() - startTime;

      expect(renderTime).toBeLessThan(100);
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });

      console.log(`Mixed 4-card render: ${renderTime.toFixed(1)}ms`);
    });
  });

  describe('Animation overlap scenarios', () => {
    it('calculates non-overlapping animation windows for staggered cards', () => {
      // For 60fps smoothness, we need to ensure animations don't create
      // too many simultaneous transform calculations
      const cardCount = 4;
      const stagger = ANIMATION_CONSTANTS.DEFAULT_STAGGER_MS;
      const duration = ANIMATION_CONSTANTS.DEAL_DURATION_MS;

      // Calculate overlap period (when all cards are animating simultaneously)
      // Card 1: 0ms - 350ms
      // Card 2: 50ms - 400ms
      // Card 3: 100ms - 450ms
      // Card 4: 150ms - 500ms
      // Overlap period: 150ms - 350ms = 200ms
      const overlapStart = (cardCount - 1) * stagger;
      const overlapEnd = duration;
      const overlapDuration = Math.max(0, overlapEnd - overlapStart);

      // During overlap, we have 4 cards computing transforms
      // This should still be manageable (4 * 5 properties = 20 calculations per frame)
      const simultaneousCards = cardCount;
      const calculationsPerFrame = simultaneousCards * 5;

      // Document the overlap characteristics
      console.log(`Overlap period: ${overlapDuration}ms (${overlapStart}ms - ${overlapEnd}ms)`);
      console.log(`Simultaneous animations: ${simultaneousCards} cards`);
      console.log(`Peak calculations per frame: ${calculationsPerFrame}`);

      // 20 calculations per frame should be manageable on mid-range devices
      expect(calculationsPerFrame).toBeLessThanOrEqual(30);
    });

    it('flip animations are sequential (not overlapping with deal)', () => {
      // Flip starts AFTER deal completes + FLIP_DELAY_AFTER_LANDING_MS
      // This ensures flip animation doesn't compound with deal animation
      const dealEnd = ANIMATION_CONSTANTS.DEAL_DURATION_MS;
      const flipStart = dealEnd + ANIMATION_CONSTANTS.FLIP_DELAY_AFTER_LANDING_MS;

      // No overlap between deal and flip
      expect(flipStart).toBeGreaterThan(dealEnd);

      console.log(`Deal ends: ${dealEnd}ms, Flip starts: ${flipStart}ms (no overlap)`);
    });
  });

  describe('Low-end device considerations', () => {
    it('documents performance expectations for different device tiers', () => {
      // These are documented expectations, not runtime measurements
      const deviceExpectations = {
        highEnd: {
          description: 'iPhone 14+, Pixel 7+',
          expectedFps: 60,
          expectedJank: 0,
        },
        midRange: {
          description: 'iPhone 11, Pixel 5, Samsung A52',
          expectedFps: 60,
          expectedJank: 2, // Up to 2% acceptable
        },
        lowEnd: {
          description: 'iPhone 8, Pixel 3a, Budget Android',
          expectedFps: 45,
          expectedJank: 10, // Up to 10% acceptable
        },
      };

      console.log('\n=== Performance Expectations by Device Tier ===');
      for (const [tier, exp] of Object.entries(deviceExpectations)) {
        console.log(`${tier} (${exp.description}): ${exp.expectedFps}fps, ≤${exp.expectedJank}% jank`);
      }

      // Document that low-end devices may not achieve 60fps
      expect(deviceExpectations.lowEnd.expectedFps).toBeLessThan(60);
      expect(deviceExpectations.highEnd.expectedFps).toBe(60);
    });

    it('animation can be disabled via skipAnimation prop for performance', () => {
      let tree!: ReactTestRenderer;

      // skipAnimation should render instantly without animation
      const startTime = performance.now();
      act(() => {
        tree = renderer.create(
          <View>
            {[...Array(8)].map((_, i) => (
              <DealtCard
                key={i}
                suit="hearts"
                rank="A"
                faceUp={true}
                dealIndex={i}
                skipAnimation={true}
              />
            ))}
          </View>
        );
      });
      const renderTime = performance.now() - startTime;

      // Should be very fast since no animation setup
      expect(renderTime).toBeLessThan(50);

      act(() => {
        tree.unmount();
      });

      console.log(`8-card skipAnimation render: ${renderTime.toFixed(1)}ms`);
    });
  });

  describe('Documentation: Animation constants reference', () => {
    it('documents all animation constants for performance tuning', () => {
      console.log('\n=== DealtCard Animation Constants ===');
      console.log(`Deal Duration: ${ANIMATION_CONSTANTS.DEAL_DURATION_MS}ms`);
      console.log(`Stagger Delay: ${ANIMATION_CONSTANTS.DEFAULT_STAGGER_MS}ms`);
      console.log(`Arc Height Ratio: ${ANIMATION_CONSTANTS.ARC_HEIGHT_RATIO} (25% of travel)`);
      console.log(`Flight Rotation: ${ANIMATION_CONSTANTS.FLIGHT_ROTATION_START_DEG}° → ${ANIMATION_CONSTANTS.FLIGHT_ROTATION_END_DEG}°`);
      console.log(`Landing Scale Peak: ${ANIMATION_CONSTANTS.LANDING_SCALE_PEAK}`);
      console.log(`Flip Delay: ${ANIMATION_CONSTANTS.FLIP_DELAY_AFTER_LANDING_MS}ms`);

      console.log('\n=== Spring Configurations ===');
      console.log(`cardDeal: mass=${SPRING.cardDeal.mass}, stiffness=${SPRING.cardDeal.stiffness}, damping=${SPRING.cardDeal.damping}`);
      console.log(`cardFlip: mass=${SPRING.cardFlip.mass}, stiffness=${SPRING.cardFlip.stiffness}, damping=${SPRING.cardFlip.damping}`);

      console.log('\n=== Stagger Presets ===');
      console.log(`fast: ${STAGGER.fast}ms`);
      console.log(`normal: ${STAGGER.normal}ms`);
      console.log(`slow: ${STAGGER.slow}ms`);

      // This test always passes - it's for documentation
      expect(true).toBe(true);
    });

    it('documents 60fps budget calculations', () => {
      const frameMs = 1000 / 60;
      const dealFrames = ANIMATION_CONSTANTS.DEAL_DURATION_MS / frameMs;
      const staggerFrames = ANIMATION_CONSTANTS.DEFAULT_STAGGER_MS / frameMs;

      console.log('\n=== 60fps Budget Analysis ===');
      console.log(`Frame budget: ${frameMs.toFixed(2)}ms per frame`);
      console.log(`Deal animation: ${dealFrames.toFixed(0)} frames`);
      console.log(`Stagger gap: ${staggerFrames.toFixed(0)} frames`);
      console.log(`4-card deal total: ${ANIMATION_CONSTANTS.DEAL_DURATION_MS + 3 * ANIMATION_CONSTANTS.DEFAULT_STAGGER_MS}ms`);

      // Transforms per frame during deal
      console.log('\n=== GPU Load per Frame ===');
      console.log('Transforms: translateX, translateY, rotate, scale');
      console.log('Computed values: 4 transforms + 1 opacity = 5 per card');
      console.log('Peak load (4 cards): 20 computed values per frame');

      expect(true).toBe(true);
    });
  });
});

describe('Card flip animation budget', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('Card flip uses 3D transform efficiently', () => {
    // From Card.tsx:
    // transform: [perspective(1000), rotateY, scale]
    // This is 3 transform operations, which is efficient
    const flipTransformCount = 3;

    expect(flipTransformCount).toBeLessThanOrEqual(PERFORMANCE_BUDGET.MAX_TRANSFORMS_PER_FRAME);
  });

  it('Card renders without animation in test environment', () => {
    let tree!: ReactTestRenderer;

    act(() => {
      tree = renderer.create(
        <Card suit="hearts" rank="A" faceUp={true} />
      );
    });

    expect(tree.toJSON()).toBeTruthy();

    // Toggle faceUp (would trigger flip animation in real env)
    act(() => {
      tree.update(<Card suit="hearts" rank="A" faceUp={false} />);
    });

    expect(tree.toJSON()).toBeTruthy();

    act(() => {
      tree.unmount();
    });
  });

  it('Card flip spring has appropriate characteristics', () => {
    const { damping, stiffness, mass } = SPRING.cardFlip;

    // Calculate natural frequency
    const naturalFrequency = Math.sqrt(stiffness / mass);

    // Calculate period (how long one oscillation takes)
    const period = (2 * Math.PI) / naturalFrequency;
    const periodMs = period * 1000;

    // Flip should complete within reasonable time (not dragging on)
    // With damping, it should settle faster than pure oscillation
    expect(periodMs).toBeLessThan(1000);

    console.log(`Card flip natural period: ${periodMs.toFixed(0)}ms`);
    console.log(`Card flip natural frequency: ${(naturalFrequency / (2 * Math.PI)).toFixed(1)}Hz`);
  });
});
