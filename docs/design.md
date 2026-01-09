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

## Liquid Crystal Typography (US-267)

The typography system is optimized for glass surfaces and edge contrast. It defines role-based styles that ensure readability on translucent backgrounds while maintaining the sharp, edgy aesthetic.

### Font Stack

| Role | Font | Use Case |
|------|------|----------|
| Display | Syne | Bold, geometric headlines with tight tracking |
| Body | Space Grotesk | Clean, modern UI text |
| Mono | JetBrains Mono | Tabular numbers, code, financial data |

### Tracking (Letter-Spacing)

Tracking is carefully calibrated for edge visibility and visual density:

| Preset | Value | Use Case |
|--------|-------|----------|
| `tighter` | -0.4px | Large display text (48px+) |
| `tight` | -0.32px | Headlines, section titles |
| `normal` | 0px | Body text, descriptions |
| `wide` | 0.16px | Labels, captions |
| `wider` | 0.8px | All-caps text |
| `widest` | 1.6px | Badges, micro text |

Use Tailwind classes: `tracking-tighter`, `tracking-tight`, `tracking-normal`, `tracking-wide`, `tracking-wider`, `tracking-widest`

### Type Roles

Role-based typography ensures consistent usage across the casino UI:

```html
<!-- Display roles (use font-display) -->
<h1 class="text-lc-display-hero font-display">Splash Title</h1>
<h2 class="text-lc-display-large font-display">Page Title</h2>
<h3 class="text-lc-display-medium font-display">Card Title</h3>

<!-- Body roles (use font-sans) -->
<p class="text-lc-body">Paragraph text</p>
<span class="text-lc-label">Button Label</span>
<span class="text-lc-label-upper uppercase">STATUS BADGE</span>
<span class="text-lc-caption">Timestamp</span>

<!-- Numeric roles (use font-mono + tabular-nums) -->
<span class="text-lc-numeric font-mono tabular-nums">1,234.56</span>
<span class="text-lc-numeric-large font-mono tabular-nums">$10,000</span>
<span class="text-lc-numeric-hero font-mono tabular-nums">JACKPOT!</span>
<span class="text-lc-numeric-small font-mono tabular-nums">2.5x</span>
```

### Tabular Numbers

**Critical for financial data**: Always use `tabular-nums` for balances, odds, and payouts to ensure proper alignment.

```html
<!-- Balance display -->
<div class="font-mono tabular-nums text-lc-numeric-large">
  $1,234.56
</div>

<!-- Odds display -->
<div class="font-mono tabular-nums text-lc-numeric-small">
  3.5x
</div>
```

In React Native:
```tsx
import { LC_TYPOGRAPHY } from '@/constants/theme';

<Text style={LC_TYPOGRAPHY.numericLarge}>$1,234.56</Text>
```

### Semantic Mappings

For consistent usage across casino UI elements:

| Element | Type Role | Classes |
|---------|-----------|---------|
| Balance | `numericLarge` | `text-lc-numeric-large font-mono tabular-nums` |
| Session P&L | `numeric` | `text-lc-numeric font-mono tabular-nums` |
| Bet Amount | `numeric` | `text-lc-numeric font-mono tabular-nums` |
| Odds | `numericSmall` | `text-lc-numeric-small font-mono tabular-nums` |
| Payout | `numericLarge` | `text-lc-numeric-large font-mono tabular-nums` |
| Big Win | `numericHero` | `text-lc-numeric-hero font-mono tabular-nums` |
| Game Title | `displayMedium` | `text-lc-display-medium font-display` |
| Section Title | `headline` | `text-lc-headline` |
| Button | `label` | `text-lc-label` |
| Badge | `labelUppercase` | `text-lc-label-upper uppercase` |

### Glass Surface Adjustments

On translucent glass surfaces, text needs specific treatment for readability:

| Glass Level | Weight Boost | Size Boost | Text Shadow |
|-------------|--------------|------------|-------------|
| `mist` | 0 | 0 | none |
| `veil` | 0 | 0 | none |
| `smoke` | +100 | 0 | none |
| `fog` | +100 | 0 | `0 1px 2px rgba(0,0,0,0.1)` |
| `frost` | +100 | +1px | `0 1px 3px rgba(0,0,0,0.15)` |

Example applying glass adjustments:
```tsx
import { LC_GLASS_ADJUSTMENTS } from '@nullspace/design-tokens';

// For text on fog-level glass
const fogAdjustment = LC_GLASS_ADJUSTMENTS.fog;
// Apply: fontWeight + 100, textShadow: '0 1px 2px rgba(0,0,0,0.1)'
```

### Direct Token Usage (TypeScript)

```typescript
import {
  LC_TYPE_ROLE,
  LC_TYPE_SEMANTIC,
  TRACKING,
  FONT_FEATURES,
} from '@nullspace/design-tokens';

// Get complete role config
const balanceStyle = LC_TYPE_ROLE[LC_TYPE_SEMANTIC.balance];
// {
//   fontFamily: 'mono',
//   size: 32,
//   lineHeight: 40,
//   weight: 500,
//   letterSpacing: -0.32,
//   textTransform: 'none',
//   fontFeatures: 'tnum',  // tabular-nums
// }

// Use tracking presets
const headlineTracking = TRACKING.tight; // -0.32px

// Check font features for role
if (balanceStyle.fontFeatures === FONT_FEATURES.tabularNums) {
  // Apply tabular-nums
}
```

### Mobile (React Native)

```tsx
import { LC_TYPOGRAPHY, TRACKING } from '@/constants/theme';

// Use role-based styles directly
<Text style={LC_TYPOGRAPHY.displayHero}>Hero Title</Text>
<Text style={LC_TYPOGRAPHY.numericLarge}>$1,234.56</Text>

// Numeric roles include fontVariant: ['tabular-nums']
<Text style={LC_TYPOGRAPHY.numeric}>Bet: 100</Text>
```
