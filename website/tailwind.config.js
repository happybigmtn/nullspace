import {
  MONO, TITANIUM, SEMANTIC, STATE, EDGE, ACTION, GAME,
  TYPE_SCALE, FONTS, SHADOW, ELEVATION, GLOW,
  SPACING_SEMANTIC, RADIUS, CONTAINER,
  LIQUID_CRYSTAL, LIQUID_CRYSTAL_SEMANTIC, LIQUID_CRYSTAL_FALLBACK,
  REFRACTION, toBackdropFilter, toEdgeHighlight,
  // Liquid Crystal Typography (US-267)
  TRACKING, LC_TYPE_ROLE,
} from '@nullspace/design-tokens';

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

        // Liquid Crystal Typography (US-267) - Role-based sizes
        'lc-display-hero': toTailwindFontSize(LC_TYPE_ROLE.displayHero),     // 48px
        'lc-display-large': toTailwindFontSize(LC_TYPE_ROLE.displayLarge),   // 36px
        'lc-display-medium': toTailwindFontSize(LC_TYPE_ROLE.displayMedium), // 24px
        'lc-headline': toTailwindFontSize(LC_TYPE_ROLE.headline),            // 18px
        'lc-label': toTailwindFontSize(LC_TYPE_ROLE.label),                  // 14px
        'lc-label-upper': toTailwindFontSize(LC_TYPE_ROLE.labelUppercase),   // 12px uppercase
        'lc-body': toTailwindFontSize(LC_TYPE_ROLE.body),                    // 16px
        'lc-body-small': toTailwindFontSize(LC_TYPE_ROLE.bodySmall),         // 14px
        'lc-caption': toTailwindFontSize(LC_TYPE_ROLE.caption),              // 12px
        'lc-numeric': toTailwindFontSize(LC_TYPE_ROLE.numeric),              // 16px tabular
        'lc-numeric-large': toTailwindFontSize(LC_TYPE_ROLE.numericLarge),   // 32px tabular
        'lc-numeric-hero': toTailwindFontSize(LC_TYPE_ROLE.numericHero),     // 48px tabular
        'lc-numeric-small': toTailwindFontSize(LC_TYPE_ROLE.numericSmall),   // 14px tabular
        'lc-code': toTailwindFontSize(LC_TYPE_ROLE.code),                    // 14px mono

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

        // Liquid Crystal material system (US-265)
        // Background colors for glass surfaces
        'lc': {
          // Light mode backgrounds
          'ghost': LIQUID_CRYSTAL.ghost.background.light,
          'whisper': LIQUID_CRYSTAL.whisper.background.light,
          'mist': LIQUID_CRYSTAL.mist.background.light,
          'veil': LIQUID_CRYSTAL.veil.background.light,
          'smoke': LIQUID_CRYSTAL.smoke.background.light,
          'fog': LIQUID_CRYSTAL.fog.background.light,
          'frost': LIQUID_CRYSTAL.frost.background.light,
          'solid': LIQUID_CRYSTAL.solid.background.light,
          // Dark mode backgrounds (use dark: prefix)
          'dark-ghost': LIQUID_CRYSTAL.ghost.background.dark,
          'dark-whisper': LIQUID_CRYSTAL.whisper.background.dark,
          'dark-mist': LIQUID_CRYSTAL.mist.background.dark,
          'dark-veil': LIQUID_CRYSTAL.veil.background.dark,
          'dark-smoke': LIQUID_CRYSTAL.smoke.background.dark,
          'dark-fog': LIQUID_CRYSTAL.fog.background.dark,
          'dark-frost': LIQUID_CRYSTAL.frost.background.dark,
          'dark-solid': LIQUID_CRYSTAL.solid.background.dark,
        },
        // Border colors for liquid crystal
        'lc-border': {
          'ghost': LIQUID_CRYSTAL.ghost.border.light,
          'whisper': LIQUID_CRYSTAL.whisper.border.light,
          'mist': LIQUID_CRYSTAL.mist.border.light,
          'veil': LIQUID_CRYSTAL.veil.border.light,
          'smoke': LIQUID_CRYSTAL.smoke.border.light,
          'fog': LIQUID_CRYSTAL.fog.border.light,
          'frost': LIQUID_CRYSTAL.frost.border.light,
          'solid': LIQUID_CRYSTAL.solid.border.light,
          // Dark mode borders
          'dark-ghost': LIQUID_CRYSTAL.ghost.border.dark,
          'dark-whisper': LIQUID_CRYSTAL.whisper.border.dark,
          'dark-mist': LIQUID_CRYSTAL.mist.border.dark,
          'dark-veil': LIQUID_CRYSTAL.veil.border.dark,
          'dark-smoke': LIQUID_CRYSTAL.smoke.border.dark,
          'dark-fog': LIQUID_CRYSTAL.fog.border.dark,
          'dark-frost': LIQUID_CRYSTAL.frost.border.dark,
          'dark-solid': LIQUID_CRYSTAL.solid.border.dark,
        },
        // Fallback colors (for @supports not (backdrop-filter))
        'lc-fallback': {
          'ghost': LIQUID_CRYSTAL_FALLBACK.ghost.light,
          'whisper': LIQUID_CRYSTAL_FALLBACK.whisper.light,
          'mist': LIQUID_CRYSTAL_FALLBACK.mist.light,
          'veil': LIQUID_CRYSTAL_FALLBACK.veil.light,
          'smoke': LIQUID_CRYSTAL_FALLBACK.smoke.light,
          'fog': LIQUID_CRYSTAL_FALLBACK.fog.light,
          'frost': LIQUID_CRYSTAL_FALLBACK.frost.light,
          'solid': LIQUID_CRYSTAL_FALLBACK.solid.light,
          'dark-ghost': LIQUID_CRYSTAL_FALLBACK.ghost.dark,
          'dark-whisper': LIQUID_CRYSTAL_FALLBACK.whisper.dark,
          'dark-mist': LIQUID_CRYSTAL_FALLBACK.mist.dark,
          'dark-veil': LIQUID_CRYSTAL_FALLBACK.veil.dark,
          'dark-smoke': LIQUID_CRYSTAL_FALLBACK.smoke.dark,
          'dark-fog': LIQUID_CRYSTAL_FALLBACK.fog.dark,
          'dark-frost': LIQUID_CRYSTAL_FALLBACK.frost.dark,
          'dark-solid': LIQUID_CRYSTAL_FALLBACK.solid.dark,
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
        // Liquid Crystal edge highlights (US-265)
        'lc-edge-hairline': toEdgeHighlight(LIQUID_CRYSTAL.whisper.edge),
        'lc-edge-standard': toEdgeHighlight(LIQUID_CRYSTAL.veil.edge),
        'lc-edge-pronounced': toEdgeHighlight(LIQUID_CRYSTAL.fog.edge),
        'lc-edge-thick': toEdgeHighlight(LIQUID_CRYSTAL.solid.edge),
      },
      // Liquid Crystal backdrop filters (US-265)
      backdropBlur: {
        'lc-none': `${REFRACTION.none.blur}px`,
        'lc-subtle': `${REFRACTION.subtle.blur}px`,
        'lc-standard': `${REFRACTION.standard.blur}px`,
        'lc-heavy': `${REFRACTION.heavy.blur}px`,
        'lc-frosted': `${REFRACTION.frosted.blur}px`,
        'lc-cinema': `${REFRACTION.cinema.blur}px`,
      },
      backdropBrightness: {
        'lc-none': `${REFRACTION.none.brightness}%`,
        'lc-subtle': `${REFRACTION.subtle.brightness}%`,
        'lc-standard': `${REFRACTION.standard.brightness}%`,
        'lc-heavy': `${REFRACTION.heavy.brightness}%`,
        'lc-frosted': `${REFRACTION.frosted.brightness}%`,
        'lc-cinema': `${REFRACTION.cinema.brightness}%`,
      },
      backdropSaturate: {
        'lc-none': `${REFRACTION.none.saturate}%`,
        'lc-subtle': `${REFRACTION.subtle.saturate}%`,
        'lc-standard': `${REFRACTION.standard.saturate}%`,
        'lc-heavy': `${REFRACTION.heavy.saturate}%`,
        'lc-frosted': `${REFRACTION.frosted.saturate}%`,
        'lc-cinema': `${REFRACTION.cinema.saturate}%`,
      },
      backdropContrast: {
        'lc-none': `${REFRACTION.none.contrast}%`,
        'lc-subtle': `${REFRACTION.subtle.contrast}%`,
        'lc-standard': `${REFRACTION.standard.contrast}%`,
        'lc-heavy': `${REFRACTION.heavy.contrast}%`,
        'lc-frosted': `${REFRACTION.frosted.contrast}%`,
        'lc-cinema': `${REFRACTION.cinema.contrast}%`,
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
      // Liquid Crystal Typography (US-267)
      letterSpacing: {
        // Tracking presets from design tokens
        'tighter': `${TRACKING.tighter}px`,  // -0.4px for large display
        'tight': `${TRACKING.tight}px`,      // -0.32px for headlines
        'normal': `${TRACKING.normal}px`,    // 0px for body
        'wide': `${TRACKING.wide}px`,        // 0.16px for labels/captions
        'wider': `${TRACKING.wider}px`,      // 0.8px for all-caps
        'widest': `${TRACKING.widest}px`,    // 1.6px for badges
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
        // Liquid Crystal animations (US-265)
        'lc-sweep': 'lc-sweep 1.5s ease-in-out',
        'lc-refract': 'lc-refract 0.3s ease-out',
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
        // Liquid Crystal specular sweep animation (US-265)
        'lc-sweep': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // Liquid Crystal refraction pulse on interaction
        'lc-refract': {
          '0%': { backdropFilter: 'blur(8px) brightness(105%)' },
          '50%': { backdropFilter: 'blur(12px) brightness(115%)' },
          '100%': { backdropFilter: 'blur(8px) brightness(105%)' },
        },
      },
    },
  },
  plugins: [],
}
