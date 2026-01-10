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
    it('has pure white background', () => {
      expect(LIGHT_COLORS.background).toBe('#FFFFFF');
    });

    it('has near-white surfaces for elevation', () => {
      expect(LIGHT_COLORS.surface).toBe('#FAFAFA');
      expect(LIGHT_COLORS.surfaceElevated).toBe('#F5F5F5');
    });

    it('has dark text for contrast', () => {
      expect(LIGHT_COLORS.textPrimary).toBe('#000000');
    });
  });

  describe('DARK_COLORS', () => {
    it('has pure black OLED background (#000000)', () => {
      expect(DARK_COLORS.background).toBe('#000000');
    });

    it('has dark surfaces with elevation differentiation', () => {
      expect(DARK_COLORS.surface).toBe('#0A0A0A');
      expect(DARK_COLORS.surfaceElevated).toBe('#141414');
    });

    it('has light text for contrast on dark', () => {
      expect(DARK_COLORS.textPrimary).toBe('#FFFFFF');
    });

    it('uses monochrome suit accents', () => {
      expect(DARK_COLORS.suitRed).toBe('#737373');
    });

    it('uses inverted monochrome primaries for contrast', () => {
      expect(LIGHT_COLORS.primary).toBe('#000000');
      expect(DARK_COLORS.primary).toBe('#FFFFFF');
      expect(DARK_COLORS.success).toBe('#FFFFFF');
      expect(DARK_COLORS.error).toBe('#FFFFFF');
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
    it('defines primary glow with white shadow', () => {
      expect(DARK_MODE_GLOW.primary.shadowColor).toBe('#FFFFFF');
      expect(DARK_MODE_GLOW.primary.shadowOpacity).toBe(0.4);
      expect(DARK_MODE_GLOW.primary.shadowRadius).toBe(12);
    });

    it('defines success glow with white shadow', () => {
      expect(DARK_MODE_GLOW.success.shadowColor).toBe('#FFFFFF');
      expect(DARK_MODE_GLOW.success.shadowOpacity).toBe(0.35);
      expect(DARK_MODE_GLOW.success.shadowRadius).toBe(10);
    });

    it('defines gold glow for win states', () => {
      expect(DARK_MODE_GLOW.gold.shadowColor).toBe('#FFFFFF');
      expect(DARK_MODE_GLOW.gold.shadowOpacity).toBe(0.5);
      expect(DARK_MODE_GLOW.gold.shadowRadius).toBe(14);
    });

    it('defines error glow for destructive actions', () => {
      expect(DARK_MODE_GLOW.error.shadowColor).toBe('#FFFFFF');
      expect(DARK_MODE_GLOW.error.shadowOpacity).toBe(0.3);
      expect(DARK_MODE_GLOW.error.shadowRadius).toBe(8);
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
