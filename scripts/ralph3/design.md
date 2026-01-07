# Nullspace Design System Implementation Plan

## Executive Summary

This document outlines the comprehensive design system implementation for Nullspace, aligning web and mobile platforms with a unified, Jony Ive-inspired aesthetic. The design system is built on principles of **radical simplicity**, **progressive disclosure**, **clarity**, and **tactile response**.

## Current State Analysis

### Source of Truth: `@nullspace/design-tokens`

Location: `/packages/design-tokens/src/`

| Token File       | Status | Notes |
|------------------|--------|-------|
| `colors.ts`      | ✅ Complete | TITANIUM scale, ACTION colors, GAME palettes |
| `typography.ts`  | ✅ Complete | FONTS, TYPE_SCALE, FONT_WEIGHTS |
| `spacing.ts`     | ✅ Complete | 4px grid, semantic keys, RADIUS, CONTAINER |
| `animations.ts`  | ✅ Complete | SPRING physics, DURATION, EASING, STAGGER |
| `shadows.ts`     | ✅ Complete | SHADOW levels, ELEVATION, GLOW effects |

### Platform Implementation Gaps

#### Web (`/website`)
| Issue | Current | Target |
|-------|---------|--------|
| Titanium colors | Hardcoded, different values | Import from tokens |
| Typography | Partial alignment | Full TYPE_SCALE adoption |
| Shadows | Custom shadows | Use SHADOW/ELEVATION tokens |
| Animations | Basic keyframes | Spring physics via Framer Motion |
| Spacing | Custom px-* values | Token-based scale |

#### Mobile (`/mobile`)
| Issue | Current | Target |
|-------|---------|--------|
| Shadows | Not implemented | Add SHADOW/GLOW from tokens |
| Typography | Partial alignment | Full TYPE_SCALE adoption |
| Game themes | Accent colors only | Full primary+accent usage |
| Glass effects | Local definitions | Move to tokens if needed |

---

## Design Principles

### 1. Radical Simplicity
- Every element earns its place
- Remove visual noise: borders, backgrounds, decorations
- Let content breathe with generous whitespace
- Single-purpose components

### 2. Progressive Disclosure
- Show only what's needed at each moment
- Complexity emerges through interaction
- Layered information hierarchy
- Contextual actions appear when relevant

### 3. Clarity
- High contrast text (WCAG AA minimum)
- Clear visual hierarchy
- Consistent spacing rhythm
- Readable typography at all sizes

### 4. Tactile Response
- Spring physics for natural motion
- Haptic feedback on mobile
- Immediate visual feedback
- Satisfying micro-interactions

---

## Color System

### Titanium Palette (Neutrals)
```
50:  #FAFAFA  - Lightest background
100: #F5F5F5  - Secondary background
200: #E5E5E5  - Borders, dividers
300: #D4D4D4  - Disabled text
400: #A3A3A3  - Muted text
500: #737373  - Secondary text
600: #525252  - Body text
700: #404040  - Emphasized text
800: #262626  - Headings
900: #171717  - Primary text
950: #0A0A0A  - Deepest dark
```

### Action Colors
```
indigo:        #5E5CE6  - Primary brand, CTAs
indigoHover:   #4B4ACE  - Hover state
indigoMuted:   rgba(94, 92, 230, 0.15)  - Backgrounds
success:       #34C759  - Wins, confirmations
successMuted:  rgba(52, 199, 89, 0.15)
error:         #FF3B30  - Losses, errors
errorMuted:    rgba(255, 59, 48, 0.15)
warning:       #FF9500  - Cautions
gold:          #FFD700  - Jackpots, special wins
```

### Game Color Schemes
Each game has a distinct visual identity:

| Game | Primary (BG) | Accent (Highlights) |
|------|--------------|---------------------|
| Blackjack | #1E3A5F | #4A90D9 |
| Roulette | #2D5016 | #8B0000 |
| Craps | #4A2C0A | #D4AF37 |
| Baccarat | #2C1810 | #C5A572 |
| Video Poker | #1A1A2E | #E94560 |
| Hi-Lo | #16213E | #0F3460 |
| Sic Bo | #3D0C02 | #FF6B35 |
| Three Card | #1B4332 | #52B788 |
| Ultimate Holdem | #2D3436 | #00B894 |
| Casino War | #2C3E50 | #E74C3C |

---

## Typography System

### Font Families
- **Display**: Outfit (headlines, large numbers)
- **Body**: Plus Jakarta Sans (UI text, paragraphs)
- **Mono**: JetBrains Mono (numbers, code, balances)

### Type Scale
| Variant | Size | Line Height | Weight | Letter Spacing |
|---------|------|-------------|--------|----------------|
| micro | 10px | 12px | 500 | 0.5px |
| label | 12px | 16px | 500 | 0.25px |
| body | 14px | 20px | 400 | 0 |
| bodyLarge | 16px | 24px | 400 | 0 |
| heading | 20px | 28px | 600 | -0.25px |
| headingLarge | 24px | 32px | 600 | -0.5px |
| display | 32px | 40px | 700 | -0.5px |
| hero | 48px | 56px | 800 | -1px |

---

## Spacing System

### Base Unit: 4px

| Token | Value | Usage |
|-------|-------|-------|
| 0 | 0px | None |
| xs | 4px | Tight spacing, inline elements |
| sm | 8px | Button padding, small gaps |
| md | 16px | Card padding, form gaps |
| lg | 24px | Section gaps |
| xl | 32px | Major sections |
| 2xl | 48px | Page sections |
| 3xl | 64px | Hero spacing |

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| none | 0 | Sharp corners |
| sm | 4px | Subtle rounding |
| md | 8px | Buttons, inputs |
| lg | 12px | Cards |
| xl | 16px | Modals |
| 2xl | 24px | Large containers |
| full | 9999px | Pills, avatars |

---

## Shadow & Elevation

### Shadow Levels
| Level | Offset Y | Blur | Opacity | Usage |
|-------|----------|------|---------|-------|
| none | 0 | 0 | 0 | Flat surfaces |
| sm | 1px | 2px | 5% | Raised buttons |
| md | 4px | 6px | 10% | Cards |
| lg | 10px | 15px | 10% | Dropdowns |
| xl | 20px | 25px | 10% | Modals |
| 2xl | 25px | 50px | 25% | Overlays |

### Glow Effects
| Type | Color | Blur | Opacity | Usage |
|------|-------|------|---------|-------|
| indigo | #5E5CE6 | 20px | 40% | Focus rings |
| success | #34C759 | 20px | 40% | Win states |
| error | #FF3B30 | 20px | 40% | Error states |
| gold | #FFD700 | 30px | 50% | Jackpots |

---

## Animation System

### Spring Physics
For natural, physics-based motion:

| Preset | Mass | Stiffness | Damping | Use Case |
|--------|------|-----------|---------|----------|
| button | 0.5 | 400 | 30 | Button press |
| modal | 0.8 | 300 | 28 | Modal open/close |
| dropdown | 0.6 | 350 | 26 | Dropdown reveal |
| tooltip | 0.4 | 500 | 35 | Tooltip show |
| cardFlip | 1.0 | 200 | 20 | Card flip |
| cardDeal | 0.7 | 280 | 22 | Card deal |
| chipStack | 0.8 | 300 | 25 | Chip stacking |
| chipToss | 0.6 | 250 | 18 | Bet placement |
| wheelSpin | 2.0 | 50 | 10 | Roulette wheel |
| diceTumble | 1.2 | 150 | 15 | Dice roll |
| success | 0.5 | 350 | 25 | Win feedback |
| error | 0.3 | 600 | 40 | Error shake |
| shake | 0.2 | 800 | 15 | Attention shake |

### Duration Values
| Name | Value | Usage |
|------|-------|-------|
| instant | 100ms | Immediate feedback |
| fast | 200ms | Quick transitions |
| normal | 300ms | Standard animations |
| slow | 500ms | Emphasis |
| dramatic | 1000ms | Important reveals |
| cinematic | 2000ms | Hero animations |

---

## Implementation Plan

### Phase 1: Token Alignment (Priority: High)

#### 1.1 Web - Tailwind Configuration
**File**: `/website/tailwind.config.js`

Changes:
- Import tokens directly instead of hardcoding
- Align titanium scale with exact token values
- Add all TYPE_SCALE variants
- Add SHADOW/ELEVATION presets
- Add spring animation utilities

#### 1.2 Web - CSS Variables
**File**: `/website/src/index.css`

Changes:
- Generate CSS custom properties from tokens
- Support dark mode via CSS variables
- Add glow effect utilities

#### 1.3 Mobile - Theme Constants
**File**: `/mobile/src/constants/theme.ts`

Changes:
- Add SHADOW exports for React Native
- Align TYPOGRAPHY with TYPE_SCALE
- Add GLOW effects

### Phase 2: Component Updates (Priority: High)

#### 2.1 Web Components
| Component | Changes |
|-----------|---------|
| Button variants | Use action colors, spring animations |
| Card components | Use ELEVATION shadows |
| Modal/Dialog | Use modal spring, xl shadow |
| Form inputs | Focus rings with indigo glow |
| Typography | Map to TYPE_SCALE variants |

#### 2.2 Mobile Components
| Component | Changes |
|-----------|---------|
| PrimaryButton | Add shadow, spring press |
| Cards/Surfaces | Add elevation shadows |
| Game screens | Full game color implementation |
| Text components | TYPE_SCALE alignment |

### Phase 3: Game Theming (Priority: Medium)

#### 3.1 Game Screen Backgrounds
Each game screen should use:
- `GAME[gameId].primary` as gradient base
- `GAME[gameId].accent` for highlights and active states
- Consistent overlay patterns

#### 3.2 Game-Specific Animations
| Game | Key Animations |
|------|---------------|
| Blackjack | cardDeal, cardFlip |
| Roulette | wheelSpin, chipToss |
| Craps | diceTumble, chipStack |
| Video Poker | cardDeal, cardFlip |
| Hi-Lo | cardFlip, success/error |
| Sic Bo | diceTumble |

### Phase 4: Polish & Accessibility (Priority: Medium)

#### 4.1 Accessibility Checks
- Verify all text meets WCAG AA contrast
- Test focus indicators
- Ensure animations respect prefers-reduced-motion
- Screen reader compatibility

#### 4.2 Dark Mode Support
- Implement inverted titanium scale
- Adjust shadows for dark backgrounds
- Test all game themes in dark mode

---

## File Changes Summary

### New Files
None - all changes are updates to existing files

### Modified Files

#### `/website/tailwind.config.js`
- Import from `@nullspace/design-tokens`
- Update colors to use TITANIUM
- Add TYPE_SCALE font sizes
- Add SHADOW box-shadows
- Add spring animation keyframes

#### `/website/src/index.css`
- Add CSS custom properties for tokens
- Add glow utility classes
- Add spring animation classes

#### `/mobile/src/constants/theme.ts`
- Add SHADOW exports
- Add GLOW exports
- Align TYPOGRAPHY with TYPE_SCALE

#### Component Files (Both Platforms)
- Update hardcoded colors → token references
- Update hardcoded spacing → semantic keys
- Update animations → spring configs

---

## Success Criteria

1. **Visual Consistency**: Web and mobile apps look identical for shared elements
2. **Token Coverage**: 100% of colors, spacing, typography from tokens
3. **Animation Quality**: All interactions use spring physics
4. **Accessibility**: WCAG AA compliance for all text
5. **Performance**: No animation jank on mobile
6. **Dark Mode**: Full support on both platforms

---

## Testing Strategy

### Visual Regression
- Screenshot comparison for key screens
- Cross-browser testing (Chrome, Safari, Firefox)
- Device testing (iOS, Android, Web responsive)

### Accessibility
- Automated contrast checks
- Screen reader testing
- Keyboard navigation

### Performance
- Animation frame rate monitoring
- Bundle size impact
- Memory usage during animations

---

## Appendix: Token Import Patterns

### Web (Tailwind)
```javascript
// tailwind.config.js
const { TITANIUM, ACTION, GAME } = require('@nullspace/design-tokens');

module.exports = {
  theme: {
    extend: {
      colors: {
        titanium: TITANIUM,
        action: ACTION,
        // ...
      }
    }
  }
}
```

### Mobile (React Native)
```typescript
// theme.ts
import { SHADOW, GLOW, TYPE_SCALE } from '@nullspace/design-tokens';

export const SHADOWS = {
  card: {
    shadowOffset: { width: SHADOW.md.offsetX, height: SHADOW.md.offsetY },
    shadowRadius: SHADOW.md.blur,
    shadowOpacity: SHADOW.md.opacity,
    shadowColor: '#000',
  },
};
```

### CSS Custom Properties
```css
:root {
  --color-titanium-50: #FAFAFA;
  --color-titanium-100: #F5F5F5;
  /* ... */
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  /* ... */
}
```
