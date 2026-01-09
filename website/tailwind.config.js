import { MONO, TITANIUM, SEMANTIC, STATE, EDGE, ACTION, GAME, TYPE_SCALE, FONTS, SHADOW, ELEVATION, GLOW, SPACING_SEMANTIC, RADIUS, CONTAINER } from '@nullspace/design-tokens';

// Helper to convert TYPE_SCALE to Tailwind fontSize format
const toTailwindFontSize = (style) => [
  `${style.size}px`,
  {
    lineHeight: `${style.lineHeight}px`,
    letterSpacing: `${style.letterSpacing}px`,
    fontWeight: style.weight,
  },
];

// Helper to convert SHADOW token to CSS box-shadow string
const toBoxShadow = (shadow) =>
  `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.spread}px rgba(0,0,0,${shadow.opacity})`;

// Helper to convert GLOW token to CSS box-shadow string (monochrome-only)
const toGlow = (glow) => {
  const hex = glow.color;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `0 0 ${glow.blur}px rgba(${r},${g},${b},${glow.opacity})`;
};

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Monochrome Redesign (US-260) - Updated font stack
        // Display: Syne for bold, geometric headlines
        display: [`"${FONTS.display}"`, '"Inter"', '-apple-system', 'system-ui', 'sans-serif'],
        // Body: Space Grotesk for clean, modern UI text
        sans: [`"${FONTS.body}"`, '"Inter"', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        // Mono: JetBrains Mono for tabular numbers and code
        mono: [`"${FONTS.mono}"`, 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Monochrome Redesign - Strict 4-level hierarchy + micro
        // Primary semantic names (use these)
        'micro': toTailwindFontSize(TYPE_SCALE.micro),      // 10px - badges, tiny labels
        'caption': toTailwindFontSize(TYPE_SCALE.caption),  // 12px - labels, hints
        'body': toTailwindFontSize(TYPE_SCALE.body),        // 16px - all readable content
        'headline': toTailwindFontSize(TYPE_SCALE.headline),// 24px - section titles
        'hero': toTailwindFontSize(TYPE_SCALE.hero),        // 48px - page titles

        // Legacy aliases (for backwards compatibility, map to new hierarchy)
        'label': toTailwindFontSize(TYPE_SCALE.label),
        'body-lg': toTailwindFontSize(TYPE_SCALE.bodyLarge),
        'heading': toTailwindFontSize(TYPE_SCALE.heading),
        'heading-lg': toTailwindFontSize(TYPE_SCALE.headingLarge),
        'display': toTailwindFontSize(TYPE_SCALE.display),
      },
      colors: {
        // Monochrome palette - Primary color system (US-260)
        mono: MONO,

        // Semantic color aliases - Monochrome Redesign
        // Light mode (default)
        'ns-bg': SEMANTIC.light.background,
        'ns-surface': SEMANTIC.light.surface,
        'ns-surface-elevated': SEMANTIC.light.surfaceElevated,
        'ns-border': SEMANTIC.light.border,
        'ns-border-subtle': SEMANTIC.light.borderSubtle,
        'ns-text': SEMANTIC.light.textPrimary,
        'ns-text-secondary': SEMANTIC.light.textSecondary,
        'ns-text-muted': SEMANTIC.light.textMuted,
        'ns-text-disabled': SEMANTIC.light.textDisabled,

        // State colors - Monochrome states
        state: {
          interactive: STATE.interactive,
          success: STATE.success,
          error: STATE.error,
          warning: STATE.warning,
          info: STATE.info,
        },

        // Edge highlights for depth
        edge: EDGE,

        // Glass effects (monochrome-compatible)
        glass: {
          light: 'rgba(255, 255, 255, 0.75)',
          dark: 'rgba(0, 0, 0, 0.8)',
          border: 'rgba(0, 0, 0, 0.05)',
        },

        // Legacy action colors (deprecated - maps to monochrome)
        action: {
          indigo: ACTION.indigo,
          indigoHover: ACTION.indigoHover,
          indigoMuted: ACTION.indigoMuted,
          success: ACTION.success,
          successMuted: ACTION.successMuted,
          error: ACTION.error,
          errorMuted: ACTION.errorMuted,
          warning: ACTION.warning,
          // Legacy aliases
          primary: ACTION.indigo,
          destructive: ACTION.error,
          gold: MONO[0], // Gold -> Black in monochrome
        },

        // Legacy titanium (deprecated - use mono instead)
        titanium: TITANIUM,

        // Legacy game colors (deprecated - all games now use same grayscale)
        game: {
          blackjack: GAME.blackjack,
          roulette: GAME.roulette,
          craps: GAME.craps,
          baccarat: GAME.baccarat,
          videoPoker: GAME.videoPoker,
          hiLo: GAME.hiLo,
          sicBo: GAME.sicBo,
          threeCard: GAME.threeCard,
          ultimateHoldem: GAME.ultimateHoldem,
          casinoWar: GAME.casinoWar,
        },
      },
      boxShadow: {
        // Shadow levels from design tokens
        'none': toBoxShadow(SHADOW.none),
        'sm': toBoxShadow(SHADOW.sm),
        'md': toBoxShadow(SHADOW.md),
        'lg': toBoxShadow(SHADOW.lg),
        'xl': toBoxShadow(SHADOW.xl),
        '2xl': toBoxShadow(SHADOW['2xl']),
        // Semantic elevation shadows
        'card': toBoxShadow(SHADOW[ELEVATION.card]),
        'dropdown': toBoxShadow(SHADOW[ELEVATION.dropdown]),
        'modal': toBoxShadow(SHADOW[ELEVATION.modal]),
        'overlay': toBoxShadow(SHADOW[ELEVATION.overlay]),
        // Glow effects - monochrome compatible (white/black only)
        'glow-white': '0 0 20px rgba(255,255,255,0.3)',
        'glow-black': '0 0 20px rgba(0,0,0,0.3)',
        // Legacy glow effects (deprecated)
        'glow-indigo': toGlow(GLOW.indigo),
        'glow-success': toGlow(GLOW.success),
        'glow-error': toGlow(GLOW.error),
        'glow-gold': toGlow(GLOW.gold),
        // Legacy shadows (kept for compatibility)
        'soft': '0 2px 12px rgba(0,0,0,0.03)',
        'float': '0 20px 48px rgba(0,0,0,0.08)',
        'inner-light': 'inset 0 1px 0 rgba(255,255,255,0.5)',
        'card-elevated': '0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
        // Edge highlights for monochrome depth
        'edge-highlight': 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.1)',
      },
      borderRadius: {
        // Border radius from design tokens
        'none': `${RADIUS.none}px`,
        'sm': `${RADIUS.sm}px`,
        'md': `${RADIUS.md}px`,
        'lg': `${RADIUS.lg}px`,
        'xl': `${RADIUS.xl}px`,
        '2xl': `${RADIUS['2xl']}px`,
        'full': `${RADIUS.full}px`,
      },
      spacing: {
        // Semantic spacing from design tokens (extends Tailwind defaults)
        'xs': `${SPACING_SEMANTIC.xs}px`,
        'sm': `${SPACING_SEMANTIC.sm}px`,
        'md': `${SPACING_SEMANTIC.md}px`,
        'lg': `${SPACING_SEMANTIC.lg}px`,
        'xl': `${SPACING_SEMANTIC.xl}px`,
        '2xl': `${SPACING_SEMANTIC['2xl']}px`,
        '3xl': `${SPACING_SEMANTIC['3xl']}px`,
      },
      maxWidth: {
        // Container max-widths from design tokens
        'container-sm': `${CONTAINER.sm}px`,
        'container-md': `${CONTAINER.md}px`,
        'container-lg': `${CONTAINER.lg}px`,
        'container-xl': `${CONTAINER.xl}px`,
        'container-2xl': `${CONTAINER['2xl']}px`,
      },
      animation: {
        'shimmer': 'shimmer 2s infinite linear',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'scale-in': 'scale-in 0.2s ease-out',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-glow': {
          // Monochrome-compatible pulse (white glow)
          '0%, 100%': { boxShadow: '0 0 20px rgba(255,255,255,0.2), inset 0 0 30px rgba(255,255,255,0.02)' },
          '50%': { boxShadow: '0 0 30px rgba(255,255,255,0.4), inset 0 0 40px rgba(255,255,255,0.05)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
