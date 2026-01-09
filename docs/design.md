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

### Accessibility Guidelines (US-268)

#### WCAG Contrast Requirements

All text on glass surfaces must meet WCAG 2.1 standards:

| Standard | Normal Text (< 18px) | Large Text (18px+ or 14px+ bold) |
|----------|---------------------|----------------------------------|
| **AA** | 4.5:1 | 3.0:1 |
| **AAA** | 7.0:1 | 4.5:1 |

Use the contrast validation utilities:

```typescript
import { validateGlassContrast, GLASS_TEXT_COLORS } from '@nullspace/design-tokens';

// Validate a specific combination
const result = validateGlassContrast(
  '#1a1a1a',           // text color
  'smoke',             // glass level
  '#ffffff',           // base background
  'light',             // mode
  { level: 'AA', textSize: 'normal' }
);
// { valid: true, ratio: 12.63, threshold: 4.5 }

// Or use pre-calculated safe colors
const safeText = GLASS_TEXT_COLORS.light.smoke.primary; // '#000000'
```

#### Reduced Motion

Glass effects are disabled or simplified when `prefers-reduced-motion: reduce`:

- **Disabled**: `animate-lc-sweep`, `animate-lc-refract` (decorative)
- **Reduced**: Heavy blur (frosted/cinema) → 4px blur (functional but minimal)
- **Preserved**: Opacity changes, color feedback (essential for understanding)

This is handled automatically in CSS. For programmatic checks:

```typescript
import { REDUCED_MOTION } from '@nullspace/design-tokens';

// Check if an animation should be disabled
if (REDUCED_MOTION.disable.includes('lc-sweep')) {
  // Skip animation
}
```

#### Fallbacks

Always provide solid-color fallbacks using `@supports`:

```css
/* Automatic in Glass components */
.glass-surface {
  background-color: var(--glass-bg);
}

@supports not (backdrop-filter: blur(1px)) {
  .glass-surface {
    background-color: var(--fallback-bg);
  }
}
```

#### Usage Limits

Limit glass to primary surfaces only to protect readability:
- Bet slip
- Header strip
- Modals and sheets
- Tooltips (whisper level only)

Avoid glass on:
- Body content areas
- Dense data tables
- Small text elements
- Interactive form fields

### Performance Budgets (US-268)

Glass effects are computationally expensive. Follow these budgets:

| Metric | Limit | Rationale |
|--------|-------|-----------|
| Max blur radius | 24px | GPU compositing cost |
| Max glass surfaces | 5 per screen | Stacking context overhead |
| Max animating glass | 1 per screen | Animated backdrop-filter is expensive |

#### View Density Guidelines

| View Type | Max Glass Level | Animations |
|-----------|-----------------|------------|
| Sparse (1-5 elements) | frost | 2 allowed |
| Medium (6-15 elements) | fog | 1 allowed |
| Dense (16+ elements) | smoke | 0 allowed |

Use the performance utilities:

```typescript
import { getRecommendedGlassLevel, isBlurWithinBudget } from '@nullspace/design-tokens';

// Get recommended level based on view density
const { level, animationsAllowed } = getRecommendedGlassLevel(10);
// { level: 'fog', animationsAllowed: 1 }

// Check blur is within budget
isBlurWithinBudget(16); // true (within 24px limit)
isBlurWithinBudget(32); // false (exceeds budget)
```

#### Device-Tier Recommendations

| Device | Blur | Animations | Max Blur |
|--------|------|------------|----------|
| High-end | Yes | Yes | 32px |
| Mid-range | Yes | No | 16px |
| Low-end | No (use fallbacks) | No | 0px |

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

## Liquid Crystal Motion Language (US-269)

Motion in the Liquid Crystal system should feel like liquid glass reacting to user interaction. Specular highlights sweep across surfaces, refraction pulses on touch, and edges glow subtly to create material depth.

### Core Principles

1. **Subordinate to Game State** - Decorative motion never competes with game results (wins/losses)
2. **Reactive** - Motion responds to user touch/hover like liquid surfaces
3. **Light, Not Glass** - Feels like light moving across glass, not the glass itself moving
4. **Accessible** - Full reduced-motion support with graceful degradation

### Motion Tiers

| Tier | Use Case | Micro | State | Reveal | Dramatic |
|------|----------|-------|-------|--------|----------|
| `none` | Animations disabled | 0ms | 0ms | 0ms | 0ms |
| `reduced` | prefers-reduced-motion | 10ms | 10ms | 10ms | 100ms |
| `standard` | Default UI | 180ms | 300ms | 600ms | 1000ms |
| `elevated` | Big wins, celebrations | 200ms | 400ms | 800ms | 2000ms |

### Motion Priority (Hierarchy)

| Priority | Value | Examples |
|----------|-------|----------|
| `gameResult` | 100 | Win/loss animations, jackpots |
| `gameAction` | 80 | Card flips, dice rolls, wheel spins |
| `userFeedback` | 60 | Button presses, bet placement |
| `uiState` | 40 | Modal opens, sheet slides |
| `decorative` | 20 | Glass shimmer, specular sweeps |

Higher priority motion can suppress lower priority. During game reveals, decorative motion is automatically suppressed.

### Animation Types

#### Specular Sweep (`animate-lc-sweep`)

Light highlight sweeping across the glass surface. Use for:
- Interactive element hover states
- Attention-drawing surfaces
- Idle animation for prominent elements

```html
<!-- Standard sweep on hover -->
<div class="bg-lc-smoke hover:animate-lc-sweep">
  Interactive surface
</div>
```

#### Refraction Pulse (`animate-lc-refract`)

Glass surface responding to touch with blur/brightness shift. Use for:
- Press feedback on glass buttons
- Focus state activation
- State transitions

```html
<!-- Pulse on interaction -->
<button class="bg-lc-veil active:animate-lc-refract">
  Glass Button
</button>
```

#### Edge Glow (`animate-lc-edge-glow`)

Subtle pulsing of edge highlights. Use for:
- Selected states
- Active panels
- Attention indicators

```html
<!-- Glowing edge on selection -->
<div class="bg-lc-smoke shadow-lc-edge-standard data-[selected]:animate-lc-edge-glow">
  Selectable card
</div>
```

#### Liquid Float (`animate-lc-float`)

Gentle floating motion. Use for:
- Floating action buttons
- Tooltips
- Attention-drawing badges

#### Breathing (`animate-lc-breathe`)

Subtle scale/opacity pulse. Use for:
- Loading states
- Idle indicators
- Waiting states

#### Ripple (`animate-lc-ripple`)

Outward ripple from interaction point. Use for:
- Touch feedback
- Click effects
- Confirmation feedback

### Game State Suppression

When game results are revealing, decorative motion should be suppressed:

```html
<!-- Add lc-suppress-decorative during game reveals -->
<div class="lc-suppress-decorative">
  <!-- All decorative animations paused during reveal -->
  <div class="animate-lc-shimmer">This won't animate</div>
  <div class="animate-lc-float">This won't animate</div>
</div>
```

For elevated celebration states (big wins):

```html
<!-- Add lc-motion-elevated for big win states -->
<div class="lc-motion-elevated">
  <!-- Longer, more theatrical durations -->
</div>
```

### CSS Custom Properties

The motion system uses CSS custom properties for timing:

```css
:root {
  --lc-motion-micro: 180ms;    /* Quick interactions */
  --lc-motion-state: 300ms;    /* State changes */
  --lc-motion-reveal: 600ms;   /* Content reveal */
  --lc-motion-dramatic: 1000ms; /* Big moments */
  --lc-motion-ease: cubic-bezier(0.23, 1, 0.32, 1);
  --lc-motion-ease-spring: cubic-bezier(0.68, -0.55, 0.27, 1.55);
}
```

### Usage in Tailwind

```html
<!-- Sweep on hover -->
<div class="hover:animate-lc-sweep">Surface</div>

<!-- Edge glow for selected state -->
<div class="data-[selected]:animate-lc-edge-glow">Card</div>

<!-- Float for attention -->
<button class="animate-lc-float">FAB</button>

<!-- Ripple on click (apply via JS) -->
<div class="animate-lc-ripple">Clicked element</div>

<!-- Suppress decorative motion during game -->
<div class="lc-suppress-decorative">
  <child class="animate-lc-shimmer" /> <!-- Won't animate -->
</div>
```

### Usage in React Native

```tsx
import { LC_MOTION, SPRING_LIQUID } from '@/constants/theme';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';

// Use LC spring configs
const animatedStyle = useAnimatedStyle(() => ({
  transform: [{
    scale: withSpring(pressed ? 0.95 : 1, LC_MOTION.spring.splash)
  }]
}));

// Use LC timing for state changes
const fadeStyle = useAnimatedStyle(() => ({
  opacity: withTiming(visible ? 1 : 0, {
    duration: LC_MOTION.timing.standard.state,
    easing: Easing.bezier(...LC_MOTION.easing.liquidSmooth),
  })
}));

// Check game state before decorative motion
if (LC_MOTION.gameRules.revealingResult.suppress.includes(MOTION_PRIORITY.decorative)) {
  // Skip decorative animation
}
```

### Spring Configurations

For physics-based animations (Framer Motion, Reanimated):

| Preset | Mass | Stiffness | Damping | Use Case |
|--------|------|-----------|---------|----------|
| `float` | 0.3 | 120 | 12 | Tooltips, badges |
| `ripple` | 0.5 | 180 | 14 | Touch feedback |
| `morph` | 0.8 | 100 | 18 | Shape transitions |
| `settle` | 1.2 | 140 | 22 | Landing elements |
| `wave` | 0.6 | 160 | 10 | Sheets, curtains |
| `heavy` | 1.5 | 80 | 28 | Modals, thick movement |
| `splash` | 0.4 | 220 | 12 | Quick responses |
| `slide` | 0.7 | 150 | 16 | Drawers, sidebars |

### Entrance/Exit Animations

Pre-configured entrance/exit animations for common UI elements:

```typescript
import { LC_ENTRANCE } from '@nullspace/design-tokens';

// Tooltip entrance
const tooltipConfig = LC_ENTRANCE.tooltip;
// {
//   enter: { duration: 200, opacity: [0,1], blur: [0,4], scale: [0.95,1] },
//   exit: { duration: 150, opacity: [1,0], blur: [4,0], scale: [1,0.95] },
// }

// Modal entrance
const modalConfig = LC_ENTRANCE.modal;
// {
//   enter: { duration: 500, opacity: [0,1], blur: [0,16], scale: [0.9,1] },
//   exit: { duration: 300, opacity: [1,0], blur: [16,8], scale: [1,0.95] },
// }
```

### Reduced Motion

All LC motion respects `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  /* All LC animations disabled or reduced to 10ms */
  .animate-lc-sweep,
  .animate-lc-shimmer,
  .animate-lc-float,
  .animate-lc-breathe,
  .animate-lc-edge-glow {
    animation: none !important;
  }

  :root {
    --lc-motion-micro: 10ms;
    --lc-motion-state: 10ms;
    --lc-motion-reveal: 10ms;
    --lc-motion-dramatic: 100ms;
  }
}
```

### Performance Guidelines

- Maximum 1 animating glass surface per view (backdrop-filter is expensive)
- Use `lc-suppress-decorative` during game sequences
- Prefer springs over keyframes for interactive elements
- Use CSS custom properties for coordinated timing changes
