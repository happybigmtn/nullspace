import {
  COLORS,
  LIGHT_COLORS,
  DARK_COLORS,
  SPACING,
  RADIUS,
  TYPOGRAPHY,
  GAME_COLORS,
  getColors,
  getGlowStyle,
  DARK_MODE_GLOW,
} from './theme';

describe('theme constants', () => {
  it('exports core design tokens', () => {
    expect(COLORS.background).toBeDefined();
    expect(SPACING.md).toBeDefined();
    expect(RADIUS.lg).toBeDefined();
    expect(TYPOGRAPHY.h1).toBeDefined();
  });

  it('exposes game color mappings', () => {
    expect(GAME_COLORS.blackjack).toBeDefined();
    expect(GAME_COLORS.roulette).toBeDefined();
  });
});

describe('color palettes', () => {
  describe('LIGHT_COLORS', () => {
    it('has light background (#F5F5F5)', () => {
      expect(LIGHT_COLORS.background).toBe('#F5F5F5');
    });

    it('has white surfaces', () => {
      expect(LIGHT_COLORS.surface).toBe('#FFFFFF');
      expect(LIGHT_COLORS.surfaceElevated).toBe('#FFFFFF');
    });

    it('has dark text for contrast', () => {
      expect(LIGHT_COLORS.textPrimary).toBe('#171717');
    });
  });

  describe('DARK_COLORS', () => {
    it('has pure black OLED background (#000000)', () => {
      expect(DARK_COLORS.background).toBe('#000000');
    });

    it('has dark surfaces with elevation differentiation', () => {
      expect(DARK_COLORS.surface).toBe('#171717');
      expect(DARK_COLORS.surfaceElevated).toBe('#262626');
    });

    it('has light text for contrast on dark', () => {
      expect(DARK_COLORS.textPrimary).toBe('#FAFAFA');
    });

    it('has brighter red for dark mode visibility', () => {
      expect(DARK_COLORS.suitRed).toBe('#FF6B6B');
    });

    it('shares brand colors with light mode', () => {
      expect(DARK_COLORS.primary).toBe(LIGHT_COLORS.primary);
      expect(DARK_COLORS.success).toBe(LIGHT_COLORS.success);
      expect(DARK_COLORS.error).toBe(LIGHT_COLORS.error);
    });
  });

  describe('getColors()', () => {
    it('returns LIGHT_COLORS for light scheme', () => {
      const colors = getColors('light');
      expect(colors).toBe(LIGHT_COLORS);
    });

    it('returns DARK_COLORS for dark scheme', () => {
      const colors = getColors('dark');
      expect(colors).toBe(DARK_COLORS);
    });
  });

  describe('COLORS legacy export', () => {
    it('equals LIGHT_COLORS for backwards compatibility', () => {
      expect(COLORS).toBe(LIGHT_COLORS);
    });
  });
});

describe('dark mode glow effects', () => {
  describe('DARK_MODE_GLOW', () => {
    it('defines primary glow with indigo shadow', () => {
      expect(DARK_MODE_GLOW.primary.shadowColor).toBe('#5E5CE6');
      expect(DARK_MODE_GLOW.primary.shadowOpacity).toBe(0.6);
      expect(DARK_MODE_GLOW.primary.shadowRadius).toBe(12);
    });

    it('defines success glow with green shadow', () => {
      expect(DARK_MODE_GLOW.success.shadowColor).toBe('#34C759');
    });

    it('defines gold glow for win states', () => {
      expect(DARK_MODE_GLOW.gold.shadowColor).toBe('#FFCC00');
    });

    it('defines error glow for destructive actions', () => {
      expect(DARK_MODE_GLOW.error.shadowColor).toBe('#FF3B30');
    });

    it('defines subtle glow for secondary elements', () => {
      expect(DARK_MODE_GLOW.subtle.shadowOpacity).toBe(0.1);
    });
  });

  describe('getGlowStyle()', () => {
    it('returns glow style when isDark is true', () => {
      const glow = getGlowStyle(true, 'primary');
      expect(glow).toEqual(DARK_MODE_GLOW.primary);
    });

    it('returns empty object when isDark is false', () => {
      const glow = getGlowStyle(false, 'primary');
      expect(glow).toEqual({});
    });

    it('defaults to primary variant', () => {
      const glow = getGlowStyle(true);
      expect(glow).toEqual(DARK_MODE_GLOW.primary);
    });

    it('supports all glow variants', () => {
      expect(getGlowStyle(true, 'success')).toEqual(DARK_MODE_GLOW.success);
      expect(getGlowStyle(true, 'gold')).toEqual(DARK_MODE_GLOW.gold);
      expect(getGlowStyle(true, 'error')).toEqual(DARK_MODE_GLOW.error);
      expect(getGlowStyle(true, 'subtle')).toEqual(DARK_MODE_GLOW.subtle);
    });
  });
});
