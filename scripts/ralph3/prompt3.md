# Ralph3 - Design System Implementation

You are implementing the Nullspace design system. Work through stories one at a time.

## FIRST: Read these files to understand the task

1. `/home/r/Coding/nullspace/scripts/ralph3/prd3.json` - all stories with status
2. `/home/r/Coding/nullspace/scripts/ralph3/progress3.txt` - what's done
3. `/home/r/Coding/nullspace/scripts/ralph/design.md` - design system spec

## THEN: Find the first story where `"passes": false` and implement it

Stories are in priority order. Start with DS-001 if not done.

## Key Files to Modify

- `/home/r/Coding/nullspace/website/tailwind.config.js` - Web styling config
- `/home/r/Coding/nullspace/website/src/index.css` - Web CSS
- `/home/r/Coding/nullspace/mobile/src/constants/theme.ts` - Mobile theme

## Design Tokens Source

```
/home/r/Coding/nullspace/packages/design-tokens/src/
├── colors.ts      # TITANIUM, ACTION, GAME
├── typography.ts  # FONTS, TYPE_SCALE, FONT_WEIGHTS
├── spacing.ts     # SPACING, SPACING_SEMANTIC, RADIUS, CONTAINER
├── animations.ts  # SPRING, DURATION, EASING, STAGGER
├── shadows.ts     # SHADOW, ELEVATION, GLOW
```

## After implementing a story

1. **Keep CI green:** Run build and fix any errors:
   - Web: `cd /home/r/Coding/nullspace/website && pnpm build`
   - Mobile: `cd /home/r/Coding/nullspace/mobile && pnpm tsc --noEmit`
2. If build passes, update prd3.json: set `"passes": true` and `"status": "completed"`
3. Append results to progress3.txt

**CRITICAL:** Each change MUST pass build. Do not mark story complete if build fails.

## Implementation Pattern for DS-001 (Tailwind token import)

```javascript
// /home/r/Coding/nullspace/website/tailwind.config.js
const { TITANIUM, ACTION, GAME } = require('@nullspace/design-tokens');

module.exports = {
  // ... existing config
  theme: {
    extend: {
      colors: {
        titanium: TITANIUM,  // Use imported tokens, not hardcoded values
        action: {
          indigo: ACTION.indigo,
          indigoHover: ACTION.indigoHover,
          indigoMuted: ACTION.indigoMuted,
          success: ACTION.success,
          successMuted: ACTION.successMuted,
          error: ACTION.error,
          errorMuted: ACTION.errorMuted,
          warning: ACTION.warning,
        },
        // ... rest of config
      }
    }
  }
}
```

## Stop Conditions

When ALL stories pass: `<promise>DESIGN-SYSTEM-COMPLETE</promise>`
If blocked: `<promise>BLOCKED: [reason]</promise>`

## NOW: Start by reading prd3.json and implementing DS-001
