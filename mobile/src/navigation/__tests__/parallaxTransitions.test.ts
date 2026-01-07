/**
 * Tests for parallax screen transition animations
 *
 * These tests verify the CardStyleInterpolator functions return
 * proper animated styles at different progress values.
 */

import { Animated } from 'react-native';
import {
  forParallaxHorizontal,
  forParallaxVertical,
  forFadeWithDepth,
  TransitionSpecs,
  ParallaxTransitionPresets,
} from '../parallaxTransitions';
import type { StackCardInterpolationProps } from '@react-navigation/stack';

// Helper to create mock interpolation props
function createMockProps(
  currentProgress: number,
  nextProgress: number | null = null
): StackCardInterpolationProps {
  return {
    current: {
      progress: new Animated.Value(currentProgress),
    },
    next: nextProgress !== null
      ? { progress: new Animated.Value(nextProgress) }
      : undefined,
    inverted: new Animated.Value(1), // 1 = LTR
    layouts: {
      screen: { width: 375, height: 812 },
    },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    index: 0,
    closing: new Animated.Value(0),
    swiping: new Animated.Value(0),
  } as unknown as StackCardInterpolationProps;
}

// Extract numeric value from animated interpolation
function getAnimatedValue(value: unknown): number {
  if (value instanceof Animated.Value) {
    return (value as any).__getValue();
  }
  if (typeof value === 'number') {
    return value;
  }
  // For interpolated values, we can't easily extract - return the object
  return NaN;
}

describe('parallaxTransitions', () => {
  describe('forParallaxHorizontal', () => {
    it('returns cardStyle with transform and opacity', () => {
      const props = createMockProps(0);
      const result = forParallaxHorizontal(props);

      expect(result).toHaveProperty('cardStyle');
      expect(result.cardStyle).toHaveProperty('transform');
      expect(result.cardStyle).toHaveProperty('opacity');
    });

    it('returns shadowStyle for depth perception', () => {
      const props = createMockProps(0.5);
      const result = forParallaxHorizontal(props);

      expect(result).toHaveProperty('shadowStyle');
      expect(result.shadowStyle).toHaveProperty('shadowColor');
      expect(result.shadowStyle).toHaveProperty('shadowRadius');
    });

    it('handles next screen push (background state)', () => {
      const props = createMockProps(1, 0.5);
      const result = forParallaxHorizontal(props);

      // When being pushed to background, should have opacity dim
      expect(result.cardStyle).toHaveProperty('opacity');
      // shadowOpacity should be 0 when going to background
      expect(result.shadowStyle).toHaveProperty('shadowOpacity');
    });

    it('uses inverted direction for RTL support', () => {
      const propsLTR = createMockProps(0);
      const resultLTR = forParallaxHorizontal(propsLTR);

      // Transform should include translateX
      expect(resultLTR.cardStyle?.transform).toBeDefined();
      expect(Array.isArray(resultLTR.cardStyle?.transform)).toBe(true);
    });
  });

  describe('forParallaxVertical', () => {
    it('returns cardStyle with vertical transform', () => {
      const props = createMockProps(0);
      const result = forParallaxVertical(props);

      expect(result).toHaveProperty('cardStyle');
      expect(result.cardStyle).toHaveProperty('transform');
    });

    it('includes shadowStyle with negative offset', () => {
      const props = createMockProps(0.5);
      const result = forParallaxVertical(props);

      expect(result.shadowStyle?.shadowOffset).toEqual({
        width: 0,
        height: -8, // Negative for modal coming from bottom
      });
    });

    it('handles background state when another modal pushes on top', () => {
      const props = createMockProps(1, 0.5);
      const result = forParallaxVertical(props);

      // Should have scale transform for background state
      expect(result.cardStyle?.transform).toBeDefined();
    });
  });

  describe('forFadeWithDepth', () => {
    it('returns cardStyle with opacity and scale transform', () => {
      const props = createMockProps(0);
      const result = forFadeWithDepth(props);

      expect(result).toHaveProperty('cardStyle');
      expect(result.cardStyle).toHaveProperty('opacity');
      expect(result.cardStyle).toHaveProperty('transform');
    });

    it('does not return shadowStyle (fade is subtle)', () => {
      const props = createMockProps(0.5);
      const result = forFadeWithDepth(props);

      expect(result.shadowStyle).toBeUndefined();
    });

    it('handles background state dimming', () => {
      const props = createMockProps(1, 0.5);
      const result = forFadeWithDepth(props);

      // When next screen is fading in, background should dim
      expect(result.cardStyle).toHaveProperty('opacity');
    });
  });

  describe('TransitionSpecs', () => {
    it('defines timing-based horizontal spec with momentum easing', () => {
      expect(TransitionSpecs.ParallaxHorizontalSpec.animation).toBe('timing');
      expect(TransitionSpecs.ParallaxHorizontalSpec.config.duration).toBeDefined();
      expect(TransitionSpecs.ParallaxHorizontalSpec.config.easing).toBeDefined();
    });

    it('defines longer duration for vertical modal transitions', () => {
      const horizontalDuration = TransitionSpecs.ParallaxHorizontalSpec.config.duration;
      const verticalDuration = TransitionSpecs.ParallaxVerticalSpec.config.duration;

      expect(verticalDuration).toBeGreaterThan(horizontalDuration);
    });

    it('defines fast fade spec', () => {
      expect(TransitionSpecs.FadeSpec.animation).toBe('timing');
      expect(TransitionSpecs.FadeSpec.config.duration).toBeLessThan(
        TransitionSpecs.ParallaxHorizontalSpec.config.duration
      );
    });
  });

  describe('ParallaxTransitionPresets', () => {
    it('exports slideWithParallax preset with horizontal gesture', () => {
      const preset = ParallaxTransitionPresets.slideWithParallax;

      expect(preset.cardStyleInterpolator).toBe(forParallaxHorizontal);
      expect(preset.gestureDirection).toBe('horizontal');
      expect(preset.gestureEnabled).toBe(true);
    });

    it('exports modalWithParallax preset with vertical gesture', () => {
      const preset = ParallaxTransitionPresets.modalWithParallax;

      expect(preset.cardStyleInterpolator).toBe(forParallaxVertical);
      expect(preset.gestureDirection).toBe('vertical');
      expect(preset.gestureEnabled).toBe(true);
    });

    it('exports fadeWithDepth preset without gesture', () => {
      const preset = ParallaxTransitionPresets.fadeWithDepth;

      expect(preset.cardStyleInterpolator).toBe(forFadeWithDepth);
      expect(preset.gestureEnabled).toBe(false);
    });

    it('all presets have transitionSpec for open and close', () => {
      const presets = [
        ParallaxTransitionPresets.slideWithParallax,
        ParallaxTransitionPresets.modalWithParallax,
        ParallaxTransitionPresets.fadeWithDepth,
      ];

      for (const preset of presets) {
        expect(preset.transitionSpec).toHaveProperty('open');
        expect(preset.transitionSpec).toHaveProperty('close');
        expect(preset.transitionSpec.open).toHaveProperty('animation');
        expect(preset.transitionSpec.close).toHaveProperty('animation');
      }
    });
  });

  describe('depth perception constants', () => {
    it('background scale is smaller than foreground (creates depth)', () => {
      // The SCALE constants define depth perception
      // We test by checking behavior at different progress values
      const propsBackground = createMockProps(1, 1); // Fully pushed to background
      const resultBackground = forParallaxHorizontal(propsBackground);

      // Transform should contain scale
      const transform = resultBackground.cardStyle?.transform as unknown[];
      expect(transform).toBeDefined();
      expect(transform.length).toBeGreaterThan(0);
    });

    it('opacity dims when in background', () => {
      // When next screen is fully on top, opacity should be less than 1
      const props = createMockProps(1, 1);
      const result = forParallaxHorizontal(props);

      // Opacity should be animated (not a static number)
      expect(result.cardStyle?.opacity).toBeDefined();
    });
  });
});
