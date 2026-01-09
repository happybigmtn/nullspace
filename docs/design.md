# Nullspace Design System

## Overview

The Nullspace design system is built on a strictly **monochrome** visual language. All UI elements use grayscale values with depth achieved through translucency, texture, and contrast rather than color hues.

**Core Principles:**
- Monochrome only - no colored accents (green/red/blue states)
- Depth via glass effects, not shadows alone
- Game identity via geometric patterns, not color themes
- High contrast for OLED optimization and accessibility

## Liquid Crystal Material System (US-265)

Inspired by Apple's Liquid Glass design language (WWDC 2024), constrained to monochrome.

### Material Levels

The system defines 8 translucency levels for glass surfaces:

| Level | Opacity | Use Case |
|-------|---------|----------|
| `ghost` | 2% | Hover states, hints |
| `whisper` | 5% | Tooltips |
| `mist` | 8% | Navigation bars, headers |
| `veil` | 12% | Cards, panels |
| `smoke` | 18% | Dropdowns, bet slip |
| `fog` | 25% | Modals, dialogs |
| `frost` | 35% | Full-screen overlays |
| `solid` | 85% | Primary opaque surfaces |

### Usage in Tailwind

```html
<!-- Light mode glass card -->
<div class="bg-lc-veil backdrop-blur-lc-standard border border-lc-border-veil shadow-lc-edge-standard">
  Card content
</div>

<!-- Dark mode glass card -->
<div class="bg-lc-dark-veil dark:bg-lc-dark-veil backdrop-blur-lc-standard border border-lc-border-dark-veil shadow-lc-edge-standard">
  Card content
</div>

<!-- Modal with heavy glass -->
<div class="bg-lc-fog backdrop-blur-lc-heavy backdrop-brightness-lc-heavy border border-lc-border-fog shadow-lc-edge-pronounced">
  Modal content
</div>
```

### Semantic Mappings

For consistent UI patterns, use semantic mappings:

| Element | Material | Classes |
|---------|----------|---------|
| Navbar | `mist` | `bg-lc-mist backdrop-blur-lc-subtle` |
| Card | `veil` | `bg-lc-veil backdrop-blur-lc-standard shadow-lc-edge-standard` |
| Dropdown | `smoke` | `bg-lc-smoke backdrop-blur-lc-standard shadow-lc-edge-standard` |
| Modal | `fog` | `bg-lc-fog backdrop-blur-lc-heavy shadow-lc-edge-pronounced` |
| Bet Slip | `smoke` | `bg-lc-smoke backdrop-blur-lc-standard shadow-lc-edge-standard` |
| Overlay | `frost` | `bg-lc-frost backdrop-blur-lc-frosted` |
| Tooltip | `whisper` | `bg-lc-whisper shadow-lc-edge-hairline` |
| Toast | `veil` | `bg-lc-veil backdrop-blur-lc-standard shadow-lc-edge-standard` |

### Refraction Effects

The system includes backdrop-filter configurations that simulate light refraction through glass:

| Preset | Blur | Brightness | Saturate | Contrast |
|--------|------|------------|----------|----------|
| `none` | 0px | 100% | 100% | 100% |
| `subtle` | 4px | 102% | 100% | 100% |
| `standard` | 8px | 105% | 100% | 100% |
| `heavy` | 16px | 108% | 95% | 102% |
| `frosted` | 24px | 110% | 90% | 105% |
| `cinema` | 32px | 85% | 80% | 110% |

Use Tailwind classes: `backdrop-blur-lc-{preset}`, `backdrop-brightness-lc-{preset}`, etc.

### Edge Highlights

Edge highlights create dimensional form by simulating light refraction at glass edges:

```css
/* Hairline - subtle single-pixel highlight */
shadow-lc-edge-hairline

/* Standard - default edge treatment */
shadow-lc-edge-standard

/* Pronounced - floating elements */
shadow-lc-edge-pronounced

/* Thick - hero elements */
shadow-lc-edge-thick
```

### Animations

Two Liquid Crystal-specific animations:

- `animate-lc-sweep` - Specular highlight sweep across surface
- `animate-lc-refract` - Refraction pulse on interaction

### Fallbacks

For browsers without `backdrop-filter` support, use fallback colors:

```css
/* Fallback pattern */
@supports not (backdrop-filter: blur(1px)) {
  .glass-surface {
    background-color: theme('colors.lc-fallback.veil');
  }
}
```

### Accessibility Guidelines

1. **Contrast**: All text on glass surfaces must meet WCAG 2.1 AA (4.5:1 for body, 3:1 for large text)
2. **Reduced Motion**: Respect `prefers-reduced-motion` for glass animations
3. **Fallbacks**: Always provide solid-color fallbacks for glass effects
4. **Primary Surfaces Only**: Limit glass usage to bet slip, header strip, and modals to protect readability

### Direct Token Usage (TypeScript)

For React Native or custom implementations:

```typescript
import {
  LIQUID_CRYSTAL,
  LIQUID_CRYSTAL_SEMANTIC,
  toBackdropFilter,
  toEdgeHighlight,
  toSpecularGradient,
} from '@nullspace/design-tokens';

// Get complete material config
const cardMaterial = LIQUID_CRYSTAL_SEMANTIC.card;
// {
//   translucency: 0.12,
//   background: { light: 'rgba(255, 255, 255, 0.12)', dark: 'rgba(0, 0, 0, 0.12)' },
//   border: { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.08)' },
//   specular: { angle: 135, stops: [...], intensity: 1.0 },
//   edge: { top: 'rgba(255, 255, 255, 0.15)', bottom: 'rgba(0, 0, 0, 0.08)', width: 1 },
//   refraction: { blur: 8, brightness: 105, saturate: 100, contrast: 100 },
// }

// Generate CSS backdrop-filter string
const filter = toBackdropFilter(cardMaterial.refraction);
// "blur(8px) brightness(105%) saturate(100%) contrast(100%)"

// Generate edge highlight box-shadow
const edgeShadow = toEdgeHighlight(cardMaterial.edge);
// "inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 -1px 0 rgba(0, 0, 0, 0.08)"

// Generate specular gradient
const specularGradient = toSpecularGradient(cardMaterial.specular, 'light');
// "linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 30%, ...)"
```

## Game Pattern System (US-263)

Instead of colored themes, games are differentiated by geometric patterns:

| Game | Pattern | Density |
|------|---------|---------|
| Blackjack | diagonal-stripes | sparse |
| Roulette | radial-segments | dense |
| Craps | dot-grid | medium |
| Baccarat | horizontal-lines | sparse |
| Video Poker | vertical-bars | medium |
| Hi-Lo | chevron | sparse |
| Sic Bo | honeycomb | dense |
| Three Card Poker | triangle-mesh | medium |
| Ultimate Holdem | crosshatch | sparse |
| Casino War | diagonal-grid | medium |

These patterns are implemented as Skia-rendered overlays in mobile and CSS backgrounds in web.

## State Differentiation

Without colored states, we use contrast and icons:

- **Win/Success**: High contrast (`text-mono-0 dark:text-mono-1000`) + checkmark icon
- **Loss/Error**: Muted contrast (`text-mono-400 dark:text-mono-500`) + X icon
- **Warning**: Medium contrast (`text-mono-300`) + warning icon
- **Info**: Inverted contrast (`bg-mono-900 text-mono-0`) + info icon

## Typography

Font stack optimized for the monochrome aesthetic:

- **Display**: Syne - bold, geometric headlines
- **Body**: Space Grotesk - clean, modern UI text
- **Mono**: JetBrains Mono - tabular numbers, code

Use `font-display`, `font-sans`, `font-mono` Tailwind classes.
