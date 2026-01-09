import { describe, it, expect } from 'vitest';
import {
  parseColor,
  getRelativeLuminance,
  getContrastRatio,
  meetsContrastThreshold,
  validateGlassContrast,
  WCAG_CONTRAST,
  GLASS_TEXT_COLORS,
  isBlurWithinBudget,
  getRecommendedGlassLevel,
  PERFORMANCE_BUDGET,
  REDUCED_MOTION,
} from '../src/liquid-crystal-a11y.js';

describe('Liquid Crystal Accessibility (US-268)', () => {
  describe('parseColor', () => {
    it('parses 3-digit hex colors', () => {
      expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    });

    it('parses 6-digit hex colors', () => {
      expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseColor('#1a1a1a')).toEqual({ r: 26, g: 26, b: 26, a: 1 });
    });

    it('parses 8-digit hex colors with alpha', () => {
      expect(parseColor('#ffffff80')).toEqual({ r: 255, g: 255, b: 255, a: 128 / 255 });
      expect(parseColor('#00000000')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it('parses rgb() format', () => {
      expect(parseColor('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseColor('rgb(0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    });

    it('parses rgba() format', () => {
      expect(parseColor('rgba(255, 255, 255, 0.5)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
      expect(parseColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it('returns null for invalid colors', () => {
      expect(parseColor('invalid')).toBeNull();
      expect(parseColor('#gggggg')).toBeNull();
      expect(parseColor('rgb()')).toBeNull();
    });
  });

  describe('getRelativeLuminance', () => {
    it('returns 1 for white', () => {
      expect(getRelativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
    });

    it('returns 0 for black', () => {
      expect(getRelativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
    });

    it('returns intermediate values for grays', () => {
      const midGray = getRelativeLuminance(128, 128, 128);
      expect(midGray).toBeGreaterThan(0);
      expect(midGray).toBeLessThan(1);
    });
  });

  describe('getContrastRatio', () => {
    it('returns 21:1 for black on white', () => {
      expect(getContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    });

    it('returns 21:1 for white on black', () => {
      expect(getContrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    });

    it('returns 1:1 for same colors', () => {
      expect(getContrastRatio('#808080', '#808080')).toBeCloseTo(1, 0);
    });

    it('handles RGB format', () => {
      const ratio = getContrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)');
      expect(ratio).toBeCloseTo(21, 0);
    });
  });

  describe('meetsContrastThreshold', () => {
    it('validates WCAG AA for normal text (4.5:1)', () => {
      // Black on white: 21:1 - should pass
      expect(meetsContrastThreshold('#000000', '#ffffff', 'AA', 'normal')).toBe(true);
      // Light gray on white: ~1.6:1 - should fail
      expect(meetsContrastThreshold('#cccccc', '#ffffff', 'AA', 'normal')).toBe(false);
    });

    it('validates WCAG AA for large text (3:1)', () => {
      // Medium gray on white should pass for large text
      const ratio = getContrastRatio('#666666', '#ffffff');
      expect(ratio).toBeGreaterThan(WCAG_CONTRAST.AA_LARGE);
      expect(meetsContrastThreshold('#666666', '#ffffff', 'AA', 'large')).toBe(true);
    });

    it('validates WCAG AAA thresholds', () => {
      expect(meetsContrastThreshold('#000000', '#ffffff', 'AAA', 'normal')).toBe(true);
      // #777777 on white: ~4.48:1 - fails AAA (7:1) but passes AA (4.5:1)
      expect(meetsContrastThreshold('#777777', '#ffffff', 'AAA', 'normal')).toBe(false);
    });
  });

  describe('validateGlassContrast', () => {
    it('validates text on mist glass', () => {
      const result = validateGlassContrast('#000000', 'mist', '#ffffff', 'light');
      expect(result.valid).toBe(true);
      expect(result.ratio).toBeGreaterThan(WCAG_CONTRAST.AA_NORMAL);
    });

    it('validates text on smoke glass', () => {
      const result = validateGlassContrast('#000000', 'smoke', '#ffffff', 'light');
      expect(result.valid).toBe(true);
    });

    it('provides suggestions for insufficient contrast', () => {
      const result = validateGlassContrast('#cccccc', 'mist', '#ffffff', 'light');
      // Light gray on near-white glass likely fails
      if (!result.valid) {
        expect(result.suggestion).toBeDefined();
        expect(result.suggestion).toContain('mono');
      }
    });

    it('works in dark mode', () => {
      const result = validateGlassContrast('#ffffff', 'smoke', '#000000', 'dark');
      expect(result.valid).toBe(true);
    });
  });

  describe('GLASS_TEXT_COLORS', () => {
    it('provides safe text colors for all glass levels', () => {
      const levels = ['ghost', 'whisper', 'mist', 'veil', 'smoke', 'fog', 'frost', 'solid'] as const;

      for (const level of levels) {
        expect(GLASS_TEXT_COLORS.light[level]).toBeDefined();
        expect(GLASS_TEXT_COLORS.light[level].primary).toBeDefined();
        expect(GLASS_TEXT_COLORS.light[level].secondary).toBeDefined();
        expect(GLASS_TEXT_COLORS.dark[level]).toBeDefined();
      }
    });

    it('uses high-contrast colors for primary text', () => {
      // Light mode should use black for primary
      expect(GLASS_TEXT_COLORS.light.smoke.primary).toBe('#000000');
      // Dark mode should use white for primary
      expect(GLASS_TEXT_COLORS.dark.smoke.primary).toBe('#FFFFFF');
    });
  });

  describe('REDUCED_MOTION', () => {
    it('lists animations to disable', () => {
      expect(REDUCED_MOTION.disable).toContain('lc-sweep');
      expect(REDUCED_MOTION.disable).toContain('lc-refract');
      expect(REDUCED_MOTION.disable).toContain('pulse-glow');
    });

    it('lists animations to simplify', () => {
      expect(REDUCED_MOTION.simplify).toContain('scale-in');
      expect(REDUCED_MOTION.simplify).toContain('fade-in');
    });

    it('provides duration presets for different motion preferences', () => {
      expect(REDUCED_MOTION.durations.full.reveal).toBe('0.3s');
      expect(REDUCED_MOTION.durations.reduced.reveal).toBe('0.01s');
      expect(REDUCED_MOTION.durations.none.reveal).toBe('0s');
    });
  });

  describe('Performance Budgets', () => {
    it('defines maximum blur radius', () => {
      expect(PERFORMANCE_BUDGET.maxBlurRadius).toBe(24);
    });

    it('defines maximum glass surfaces', () => {
      expect(PERFORMANCE_BUDGET.maxGlassSurfaces).toBe(5);
    });

    it('isBlurWithinBudget validates blur values', () => {
      expect(isBlurWithinBudget(8)).toBe(true);
      expect(isBlurWithinBudget(24)).toBe(true);
      expect(isBlurWithinBudget(32)).toBe(false);
    });

    it('getRecommendedGlassLevel returns appropriate levels by density', () => {
      // Sparse view
      const sparse = getRecommendedGlassLevel(3);
      expect(sparse.level).toBe('frost');
      expect(sparse.animationsAllowed).toBe(2);

      // Medium view
      const medium = getRecommendedGlassLevel(10);
      expect(medium.level).toBe('fog');
      expect(medium.animationsAllowed).toBe(1);

      // Dense view
      const dense = getRecommendedGlassLevel(20);
      expect(dense.level).toBe('smoke');
      expect(dense.animationsAllowed).toBe(0);
    });

    it('defines device-tier recommendations', () => {
      expect(PERFORMANCE_BUDGET.byDevice.highEnd.blur).toBe(true);
      expect(PERFORMANCE_BUDGET.byDevice.lowEnd.blur).toBe(false);
    });
  });
});
