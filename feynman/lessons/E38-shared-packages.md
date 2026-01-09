# E38 - Shared packages in the monorepo (TypeScript ecosystem deep dive)

Focus files:
- Package manifests: `packages/types/package.json`, `packages/constants/package.json`, `packages/design-tokens/package.json`, `packages/game-state/package.json`, `packages/protocol/package.json`
- Type definitions: `packages/types/src/index.ts`, `packages/types/src/game.ts`, `packages/types/src/cards.ts`
- Constants: `packages/constants/src/games.ts`, `packages/constants/src/chips.ts`, `packages/constants/src/bet-types.ts`
- Design system: `packages/design-tokens/src/index.ts`, `packages/design-tokens/src/colors.ts`
- Game state parsers: `packages/game-state/src/index.ts`
- Protocol encoding: `packages/protocol/src/index.ts`, `packages/protocol/src/encode.ts`
- Workspace config: `pnpm-workspace.yaml`
- Consumer apps: `mobile/package.json`, `website/package.json`

Goal: explain the monorepo's shared package architecture, how TypeScript packages are structured and published within the workspace, what each package's role is, and how frontends consume them. This is a comprehensive guide to the TypeScript-side of the codebase's dependency graph.

---

## Learning objectives

By the end of this lesson you should be able to:

1) Explain why the monorepo uses workspace packages instead of duplicating code.
2) Describe the role and responsibility of each shared package (`@nullspace/types`, `@nullspace/constants`, etc.).
3) Understand package exports and subpath exports (e.g., `@nullspace/types/game`).
4) Trace how the Rust codebase generates TypeScript types for `@nullspace/types`.
5) Walk through concrete examples of how mobile and website consume these packages.
6) Identify when code belongs in a shared package vs. when it stays in an app.
7) Explain versioning strategy and why all packages use `workspace:*`.

---

## 0) Big idea (Feynman summary)

Imagine you are building a house. Instead of each room having its own separate walls, foundation, and plumbing, you share those core components. The living room and bedroom both use the same plumbing system, the same electrical grid, and the same foundation.

That is what the shared packages do for Nullspace. The mobile app and the website both need to know what a "Card" is, what chip values exist, what colors the design system uses, and how to encode game moves into binary payloads. Instead of duplicating that code in two places, we define it once in shared packages and both apps import it.

The packages live in `packages/` and are consumed via pnpm workspace dependencies. They are not published to npm; they are private packages that only exist within this monorepo. This gives us the benefits of code reuse without the overhead of maintaining public npm packages.

---

## 1) Why shared packages? (problem framing)

The Nullspace system has multiple frontends:
- A React Native mobile app (`mobile/`)
- A React web app (`website/`)
- A Node.js gateway (`gateway/`)

All three need to:
- Use the same TypeScript types for cards, games, and player state.
- Encode game moves into the same binary protocol format.
- Use the same constants for chip values, bet types, and game names.
- Apply the same design tokens for colors, spacing, and animations.

Without shared packages, you would have three copies of this code. When you add a new game or change a chip value, you would need to update all three places. That is error-prone and violates DRY (Don't Repeat Yourself).

The monorepo solution is to extract shared code into workspace packages. Each package has a single responsibility. Apps declare dependencies on these packages and import what they need.

---

## 2) Monorepo structure: pnpm workspaces

The `pnpm-workspace.yaml` file defines which directories are workspace packages:

```yaml
packages:
  - 'packages/*'
  - 'website'
  - 'mobile'
  - 'gateway'
  - 'services/*'
```

This tells pnpm that:
- Everything in `packages/` is a workspace package.
- The `website`, `mobile`, and `gateway` directories are also workspace packages (they are apps that consume the shared packages).

When you run `pnpm install`, pnpm creates symlinks so that `@nullspace/types` in `node_modules` points to `packages/types/dist`. This means changes to a shared package are instantly visible to all consumers (after rebuilding).

---

## 3) Package dependency strategy: `workspace:*`

All shared packages use `"private": true` and version `"0.0.0"`. They are not meant to be published to npm. Apps depend on them using the `workspace:*` protocol:

```json
{
  "dependencies": {
    "@nullspace/types": "workspace:*",
    "@nullspace/constants": "workspace:*"
  }
}
```

The `workspace:*` syntax tells pnpm to resolve the dependency from the workspace, not from the npm registry. The `*` means "use whatever version is in the workspace" (which is always `0.0.0` for these packages).

This ensures that:
- Apps always use the latest local version of shared packages.
- There is no risk of accidentally pulling an old version from npm.
- The build system can rebuild packages in the correct dependency order.

---

## 4) Package deep-dive: @nullspace/types

### 4.1 What it is

`@nullspace/types` is the TypeScript type definitions for the Nullspace system. It exports interfaces, enums, and type aliases for:
- Game types (`GameType`, `GameId`, `GameSession`)
- Card representations (`Card`, `Suit`, `Rank`)
- Player state (`PlayerState`, `PlayerBalanceSnapshot`)
- Events (`CasinoGameStartedEvent`, `CasinoGameCompletedEvent`)
- On-chain casino types (`GameType`, `GameState`, etc.)

It is the authoritative source for TypeScript types that must match the Rust definitions.

### 4.2 How it is generated

Notice the `package.json` scripts:

```json
{
  "scripts": {
    "generate": "cd ../../ && cargo run --release --bin export_ts --features ts",
    "prebuild": "pnpm run generate",
    "prepare": "pnpm run generate",
    "build": "tsc -p tsconfig.build.json"
  }
}
```

The `generate` script runs a Rust binary (`export_ts`) that reads Rust type definitions and outputs TypeScript `.ts` files into `packages/types/src/generated/`. This ensures that TypeScript types stay in sync with Rust types.

Then the `build` script compiles those TypeScript files into JavaScript in `packages/types/dist/`.

This is a **code generation pipeline**: Rust → TypeScript source → TypeScript build artifacts.

### 4.3 Example: GameType enum

From `packages/types/src/game.ts`:

```typescript
/**
 * Game type definitions
 * MUST match Rust enum in types/src/casino/game.rs
 */
export enum GameType {
  Baccarat = 0,
  Blackjack = 1,
  CasinoWar = 2,
  Craps = 3,
  VideoPoker = 4,
  HiLo = 5,
  Roulette = 6,
  SicBo = 7,
  ThreeCard = 8,
  UltimateHoldem = 9,
}

export type GameId =
  | 'baccarat'
  | 'blackjack'
  | 'casino_war'
  | 'craps'
  | 'video_poker'
  | 'hi_lo'
  | 'roulette'
  | 'sic_bo'
  | 'three_card_poker'
  | 'ultimate_texas_holdem';

export interface GameSession {
  id: bigint;
  gameType: GameType;
  bet: bigint;
  isComplete: boolean;
  moveCount: number;
  createdAt: bigint;
}
```

The comment "MUST match Rust enum" is not just a suggestion. The numeric values (0, 1, 2, ...) are part of the wire protocol. If you change them, you break compatibility with the on-chain program.

### 4.4 Subpath exports

The `package.json` defines multiple entry points:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./game": {
      "types": "./dist/game.d.ts",
      "import": "./dist/game.js"
    },
    "./cards": {
      "types": "./dist/cards.d.ts",
      "import": "./dist/cards.js"
    },
    "./casino": {
      "types": "./dist/casino.d.ts",
      "import": "./dist/casino.js"
    }
  }
}
```

This allows consumers to import specific modules:

```typescript
import { GameType } from '@nullspace/types/game';
import { Card, Suit } from '@nullspace/types/cards';
import { CasinoGameStartedEvent } from '@nullspace/types/casino';
```

This is more efficient than bundling all types into a single export, especially for tree-shaking in production builds.

### 4.5 Why cards.ts is handwritten

From `packages/types/src/cards.ts`:

```typescript
/**
 * Canonical card representations
 * Decision: Use string literals for JSON compatibility across all platforms
 */
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: Suit;
  rank: Rank;
  faceUp?: boolean;
}

/** Unicode symbols for display (derived from Suit) */
export const SUIT_SYMBOLS = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
} as const satisfies Record<Suit, string>;

export const SUIT_COLORS = {
  hearts: 'red',
  diamonds: 'red',
  clubs: 'black',
  spades: 'black',
} as const satisfies Record<Suit, 'red' | 'black'>;
```

This is handwritten (not generated from Rust) because it is UI-specific. The Rust side uses numeric card encodings. The TypeScript side uses string literals for developer ergonomics and JSON serialization.

The `satisfies` keyword is a TypeScript 4.9 feature that ensures the object matches the expected type without widening it. It catches errors at compile time while preserving autocomplete.

---

## 5) Package deep-dive: @nullspace/constants

### 5.1 What it is

`@nullspace/constants` exports pure constant values that are shared across the system:
- `GAME_DISPLAY_NAMES`: Human-readable game names
- `CHIP_VALUES`: Chip denominations for the UI
- `BACCARAT_BET_TYPES`, `CRAPS_BET_TYPES`, etc.: Bet type enumerations
- `encodeBaccaratBet()`, `encodeCrapsBet()`: Encoding helpers

It depends on `@nullspace/types` for type definitions but provides no logic—only constants.

### 5.2 Example: Game display names

From `packages/constants/src/games.ts`:

```typescript
import { GameType, type GameId } from "@nullspace/types";

/**
 * Maps GameType enum to GameId string
 */
export const GAME_TYPE_TO_ID = {
  [GameType.Baccarat]: "baccarat",
  [GameType.Blackjack]: "blackjack",
  [GameType.CasinoWar]: "casino_war",
  // ... more games
} as const satisfies Record<GameType, GameId>;

export const GAME_DISPLAY_NAMES = {
  baccarat: "Baccarat",
  blackjack: "Blackjack",
  casino_war: "Casino War",
  // ... more games
} as const satisfies Record<GameId, string>;

export const GAME_EMOJIS = {
  baccarat: "👑",
  blackjack: "🃏",
  casino_war: "⚔️",
  // ... more games
} as const satisfies Record<GameId, string>;
```

These constants are used everywhere in the UI:
- Navigation labels
- Card headers
- Game selection screens

By centralizing them, we ensure consistency. If you change a game name, it updates everywhere.

### 5.3 Example: Chip values

From `packages/constants/src/chips.ts`:

```typescript
/**
 * Chip denominations for UI display (button amounts)
 * These are display-only - actual bet validation happens on-chain
 */
export const CHIP_VALUES = [1, 5, 25, 100, 500, 1000] as const;
export type ChipValue = typeof CHIP_VALUES[number];

/**
 * NO MIN_BET / MAX_BET here!
 *
 * Bet limits are chain-enforced rules. Fetch them at runtime:
 * - Website: GET /api/config -> { minBet, maxBet, ... }
 * - Mobile: WebSocket config message from gateway
 * - Gateway: Read from chain config at startup
 */

// Default fallbacks ONLY for initial render before config loads
export const BET_LIMIT_FALLBACKS = {
  minBet: 1n,
  maxBet: 10000n,
  defaultBet: 10n,
} as const;
```

Notice the comment: "NO MIN_BET / MAX_BET here!" This is important. The chip values are UI-only. The actual bet limits are dynamic and come from the chain. This prevents hardcoding assumptions that could become stale.

### 5.4 Example: Bet type encoding

From `packages/constants/src/bet-types.ts`:

```typescript
// Baccarat bet types (execution/src/casino/baccarat.rs)
export const BACCARAT_BET_TYPES = {
  PLAYER: 0,
  BANKER: 1,
  TIE: 2,
  P_PAIR: 3,
  B_PAIR: 4,
  LUCKY6: 5,
  // ... more bet types
} as const;

export type BaccaratBetName = keyof typeof BACCARAT_BET_TYPES;

export function encodeBaccaratBet(type: BaccaratBetName): number {
  return BACCARAT_BET_TYPES[type];
}
```

The comment references the Rust source file (`execution/src/casino/baccarat.rs`). This makes it clear that the numeric values must match the Rust enum. If they drift, bet encoding breaks.

The `encodeBaccaratBet()` function is type-safe: it only accepts valid bet names. This prevents typos like `encodeBaccaratBet('PLAYYER')`.

### 5.5 Why constants are separate from types

You might ask: why not put `GAME_DISPLAY_NAMES` in `@nullspace/types`?

The answer is **separation of concerns**:
- Types define the shape of data.
- Constants define the values.

Types are compile-time only. Constants are runtime values. By separating them, we make it clear which package has what responsibility. It also reduces bundle size: if you only need types (for a type annotation), you do not need to import the constants module.

---

## 6) Package deep-dive: @nullspace/design-tokens

### 6.1 What it is

`@nullspace/design-tokens` is the design system's single source of truth. It exports:
- Colors (brand, semantic, game-specific)
- Typography (fonts, sizes, weights)
- Spacing (margin, padding, radius)
- Animations (spring configs, easing curves, durations)
- Shadows, blur, gradients, z-index

It is platform-agnostic: it exports raw values (strings, numbers, objects) with no React or React Native code. Both the website (Tailwind) and mobile (StyleSheet) consume these tokens.

### 6.2 Example: Color tokens

From `packages/design-tokens/src/colors.ts`:

```typescript
/**
 * Titanium color palette - Jony Ive inspired neutral scale
 * Luxury Redesign v4.0 - 5 Essential Shades
 */
export const TITANIUM = {
  50: '#FAFAFA',
  100: '#F5F5F5',
  200: '#E5E5E5',
  300: '#D4D4D4',
  400: '#A3A3A3',
  500: '#737373',
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  950: '#0A0A0A',
} as const;

/**
 * Semantic color aliases
 */
export const SEMANTIC = {
  light: {
    background: TITANIUM[50],   // Page background
    surface: TITANIUM[100],     // Cards, panels
    border: TITANIUM[200],      // Dividers
    textMuted: TITANIUM[600],   // Secondary text
    textPrimary: TITANIUM[900], // Primary text
  },
  dark: {
    background: TITANIUM[950],
    surface: TITANIUM[900],
    border: TITANIUM[700],
    textMuted: TITANIUM[400],
    textPrimary: TITANIUM[50],
  },
} as const;

/**
 * Action colors for interactive elements
 */
export const ACTION = {
  indigo: '#5E5CE6',
  indigoHover: '#4B4ACE',
  indigoMuted: 'rgba(94, 92, 230, 0.15)',
  success: '#34C759',
  error: '#FF3B30',
  warning: '#FF9500',
} as const;

/**
 * Game-specific color schemes
 */
export const GAME = {
  blackjack: { primary: '#1E3A5F', accent: '#4A90D9' },
  roulette: { primary: '#2D5016', accent: '#8B0000' },
  // ... more games
} as const;
```

The website consumes these tokens in its Tailwind config:

```javascript
// website/tailwind.config.js
import { TITANIUM, ACTION, GAME } from '@nullspace/design-tokens';

export default {
  theme: {
    colors: {
      titanium: TITANIUM,
      action: ACTION,
      game: GAME,
    },
  },
};
```

The mobile app consumes them in StyleSheet:

```typescript
// mobile/src/constants/theme.ts
import { TITANIUM, ACTION } from '@nullspace/design-tokens';

export const colors = {
  background: TITANIUM[50],
  primary: ACTION.indigo,
};
```

This ensures that both platforms use the exact same color values. When you change a color in the design tokens, both apps update automatically.

### 6.3 Platform-agnostic design

The key insight is that `@nullspace/design-tokens` contains **zero platform-specific code**. It is just raw JavaScript values. This makes it universally consumable.

From the package header comment:

```typescript
/**
 * IMPORTANT: This package contains ONLY raw values (strings, numbers, objects).
 * NO platform-specific code (no React, no StyleSheet, no CSS-in-JS).
 */
```

This is enforced in code review. If someone tries to add a React component to the design tokens package, the PR is rejected.

---

## 7) Package deep-dive: @nullspace/game-state

### 7.1 What it is

`@nullspace/game-state` provides game state parsers. The on-chain game state is a binary blob (Uint8Array). This package exports functions that parse those blobs into typed JavaScript objects:

- `parseBlackjackState(blob: Uint8Array) -> BlackjackState`
- `parseBaccaratState(blob: Uint8Array) -> BaccaratState`
- `parseCrapsState(blob: Uint8Array) -> CrapsState`
- etc.

It depends on `@nullspace/types` for type definitions.

### 7.2 Why it exists

Game state comes from the chain as raw bytes. The mobile and website both need to decode those bytes to display the UI. Without a shared package, both would implement the same parsing logic. That is wasteful and error-prone.

By centralizing the parsers, we ensure that:
- Mobile and website see the same state.
- Bug fixes apply to both platforms.
- The parsing logic is tested once, not twice.

### 7.3 Example usage

From `mobile/src/utils/state/blackjack.ts`:

```typescript
import { parseBlackjackState as parseBlackjackStateBlob } from '@nullspace/game-state';

export function parseBlackjackState(blob: Uint8Array) {
  const state = parseBlackjackStateBlob(blob);
  // ... additional UI-specific logic
  return state;
}
```

From `website/src/services/games/state/videoPoker.ts`:

```typescript
import { parseVideoPokerState as parseVideoPokerStateBlob } from '@nullspace/game-state';

export function parseVideoPokerState(blob: Uint8Array) {
  return parseVideoPokerStateBlob(blob);
}
```

Both apps import the same parser. If the on-chain state format changes, you update the parser once and both apps benefit.

### 7.4 Internal implementation: SafeReader

From `packages/game-state/src/index.ts`:

```typescript
export class SafeReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  readU8(field: string): number {
    if (this.offset + 1 > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const value = this.data[this.offset];
    this.offset += 1;
    return value;
  }

  readU64BE(field: string): bigint {
    if (this.offset + 8 > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
    const value = view.getBigUint64(0, false);
    this.offset += 8;
    return value;
  }

  // ... more read methods
}
```

The `SafeReader` class provides bounds-checked binary reading. This is a defensive programming technique: if the blob is malformed, the parser throws an error instead of silently reading garbage data.

---

## 8) Package deep-dive: @nullspace/protocol

### 8.1 What it is

`@nullspace/protocol` handles protocol-level encoding and decoding:
- Encoding game moves into binary payloads
- Decoding WebSocket messages
- Validating messages with Zod schemas
- Versioning (protocol version headers)

It depends on `@nullspace/types` and `@nullspace/constants` and uses `zod` for runtime validation.

### 8.2 Subpath exports

From `packages/protocol/package.json`:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./encode": "./dist/encode.js",
    "./decode": "./dist/decode.js",
    "./websocket": "./dist/websocket.js",
    "./validation": "./dist/validation.js",
    "./mobile": "./dist/mobile.js"
  }
}
```

This allows apps to import only what they need:

```typescript
import { encodeBlackjackMove } from '@nullspace/protocol/encode';
import { GameMessageSchema } from '@nullspace/protocol/mobile';
```

### 8.3 Example: Encoding a blackjack move

From `packages/protocol/src/encode.ts`:

```typescript
import { BlackjackMove } from '@nullspace/constants';
import { CURRENT_PROTOCOL_VERSION, withVersionHeader } from './version.js';

export type BlackjackMoveAction = 'hit' | 'stand' | 'double' | 'split' | 'deal' | 'surrender';

const BLACKJACK_OPCODES = {
  hit: BlackjackMove.Hit,
  stand: BlackjackMove.Stand,
  double: BlackjackMove.Double,
  split: BlackjackMove.Split,
  deal: BlackjackMove.Deal,
  surrender: BlackjackMove.Surrender,
} as const satisfies Record<BlackjackMoveAction, number>;

export function encodeBlackjackMove(action: BlackjackMoveAction): Uint8Array {
  const opcode = BLACKJACK_OPCODES[action];
  return withVersionHeader(new Uint8Array([opcode]));
}
```

The `encodeBlackjackMove()` function:
1. Maps the action string to an opcode number.
2. Wraps it in a version header.
3. Returns a `Uint8Array` payload.

The website uses this when sending a WebSocket message:

```typescript
import { encodeBlackjackMove } from '@nullspace/protocol/encode';

const payload = encodeBlackjackMove('hit');
socket.send(payload);
```

The gateway uses the same function when forwarding moves to the chain. This ensures that the encoding is identical across all components.

### 8.4 Why encoding is critical

Encoding is consensus-critical. If the mobile app encodes "hit" as `[0x01]` but the website encodes it as `[0x02]`, the chain will reject one of them. By centralizing encoding in `@nullspace/protocol`, we eliminate this class of bugs.

### 8.5 Relationship to E08 (protocol-packages)

E08 covers the full protocol stack (Rust types, TypeScript types, Zod schemas, and versioning). This lesson (E38) focuses on the TypeScript package structure. For a deeper dive into protocol versioning and schema validation, see E08.

---

## 9) Consumption patterns (how apps use packages)

### 9.1 Mobile app dependencies

From `mobile/package.json`:

```json
{
  "dependencies": {
    "@nullspace/types": "workspace:*",
    "@nullspace/constants": "workspace:*",
    "@nullspace/design-tokens": "workspace:*",
    "@nullspace/game-state": "workspace:*",
    "@nullspace/protocol": "workspace:*"
  }
}
```

The mobile app uses all five shared packages.

### 9.2 Website dependencies

From `website/package.json`:

```json
{
  "dependencies": {
    "@nullspace/types": "workspace:*",
    "@nullspace/constants": "workspace:*",
    "@nullspace/design-tokens": "workspace:*",
    "@nullspace/game-state": "workspace:*",
    "@nullspace/protocol": "workspace:*"
  }
}
```

The website also uses all five shared packages. This is expected: both frontends need the same core primitives.

### 9.3 Real-world import examples (mobile)

From `mobile/src/types/index.ts`:

```typescript
import type { Card, Suit, Rank, GameId } from '@nullspace/types';
import { GAME_DISPLAY_NAMES } from '@nullspace/constants/games';
import type { ChipValue } from '@nullspace/constants/chips';
import type { BaccaratBetName, CrapsBetName } from '@nullspace/constants/bet-types';
```

From `mobile/src/constants/theme.ts`:

```typescript
import { CHIP_VALUES } from '@nullspace/constants/chips';
import {
  TITANIUM,
  SEMANTIC,
  ACTION,
  SPACING,
  FONTS,
  TYPE_SCALE,
  SHADOW,
  DURATION,
} from '@nullspace/design-tokens';
```

From `mobile/src/utils/state/blackjack.ts`:

```typescript
import { parseBlackjackState as parseBlackjackStateBlob } from '@nullspace/game-state';
```

From `mobile/src/services/websocket.ts`:

```typescript
import { GameMessageSchema, type GameMessage as ProtocolGameMessage } from '@nullspace/protocol/mobile';
```

These imports show that the mobile app uses:
- Types for type annotations
- Constants for display names and chip values
- Design tokens for styling
- Game state parsers for decoding blobs
- Protocol schemas for WebSocket validation

### 9.4 Real-world import examples (website)

From `website/src/utils/motion.ts`:

```typescript
import { SPRING, SPRING_LIQUID, DURATION, EASING } from '@nullspace/design-tokens';
```

From `website/src/hooks/games/useBlackjack.ts`:

```typescript
import { BlackjackMove } from '@nullspace/constants';
```

From `website/src/services/games/state/videoPoker.ts`:

```typescript
import { parseVideoPokerState as parseVideoPokerStateBlob } from '@nullspace/game-state';
```

From `website/src/services/CasinoChainService.ts`:

```typescript
import { GameType, CasinoGameStartedEvent, CasinoGameMovedEvent, CasinoGameCompletedEvent } from '@nullspace/types/casino';
```

The website uses the same packages as mobile, but for different purposes:
- Motion utilities use design tokens for animations.
- Game hooks use constants for move encoding.
- Chain service uses types for event parsing.

---

## 10) Package versioning and publishing

### 10.1 No npm publishing

All shared packages have `"private": true` in their `package.json`. This prevents accidental `npm publish`. They are workspace-only packages.

```json
{
  "name": "@nullspace/types",
  "version": "0.0.0",
  "private": true
}
```

The version is always `0.0.0` because it is not used. The `workspace:*` protocol means "use whatever is in the workspace."

### 10.2 Build order: Turbo

The root `package.json` uses Turbo to orchestrate builds:

```json
{
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "test": "turbo test"
  }
}
```

Turbo reads `turbo.json` to determine the build order. It knows that:
- `@nullspace/types` must build before `@nullspace/constants` (because constants depends on types).
- `@nullspace/protocol` must build after both types and constants.
- Apps must build after all shared packages.

This ensures that when you run `pnpm build`, packages build in the correct order.

### 10.3 Watch mode for development

During development, you can run `pnpm dev` to start all packages in watch mode. This means:
- When you edit a file in `packages/types/src/`, TypeScript rebuilds `packages/types/dist/`.
- Apps that depend on `@nullspace/types` automatically pick up the changes (after a hot reload).

This gives you a fast feedback loop without manually running build commands.

---

## 11) When to create a new shared package

You should create a new shared package when:
1. The code is used by at least two consumers (mobile + website, or website + gateway).
2. The code has a single, well-defined responsibility.
3. The code is stable enough that frequent breaking changes are unlikely.

You should NOT create a shared package if:
- The code is only used by one app.
- The code is UI-specific (e.g., a React component that is not reusable).
- The code is experimental and likely to change frequently.

Examples of good shared packages:
- `@nullspace/types`: Used by all TypeScript code.
- `@nullspace/design-tokens`: Used by mobile and website.
- `@nullspace/game-state`: Used by mobile and website.

Examples of code that should NOT be in a shared package:
- Mobile-specific navigation logic (stays in `mobile/src/navigation/`).
- Website-specific Tailwind components (stays in `website/src/components/`).
- App-specific state management (stays in the app).

---

## 12) Limits and management callouts

### 12.1 Circular dependencies are forbidden

If `@nullspace/types` depends on `@nullspace/constants`, and `@nullspace/constants` depends on `@nullspace/types`, you have a circular dependency. This breaks the build.

The current dependency graph is acyclic:
- `@nullspace/types` depends on nothing.
- `@nullspace/constants` depends on `@nullspace/types`.
- `@nullspace/protocol` depends on `@nullspace/types` and `@nullspace/constants`.
- `@nullspace/game-state` depends on `@nullspace/types`.
- Apps depend on all packages.

This is a DAG (Directed Acyclic Graph), which is required for a working build.

### 12.2 Type-only imports to reduce bundle size

When you only need a type (not a runtime value), use a type-only import:

```typescript
import type { Card, Suit } from '@nullspace/types/cards';
```

The `type` keyword tells TypeScript that this import is erased at runtime. It does not add to the bundle size. This is especially important for mobile apps where bundle size matters.

### 12.3 Avoid re-exporting everything

Bad:

```typescript
// mobile/src/types/index.ts
export * from '@nullspace/types';
export * from '@nullspace/constants';
export * from '@nullspace/design-tokens';
```

This creates a mega-barrel file that imports everything. It bloats the bundle and makes tree-shaking less effective.

Good:

```typescript
// mobile/src/types/index.ts
export type { Card, Suit, Rank } from '@nullspace/types/cards';
export type { GameId } from '@nullspace/types/game';
```

Only re-export what you need. This keeps the bundle small and makes the dependency graph explicit.

---

## 13) Key takeaways (Feynman recap)

Let's go back to the house analogy. The shared packages are the foundation, plumbing, and electrical grid. The apps are the rooms.

- `@nullspace/types`: The blueprints (type definitions).
- `@nullspace/constants`: The building codes (constant values like chip denominations and bet types).
- `@nullspace/design-tokens`: The style guide (colors, fonts, spacing).
- `@nullspace/game-state`: The plumbing (state parsers that decode binary blobs).
- `@nullspace/protocol`: The electrical grid (encoding and decoding messages).

When you change a blueprint (type definition), all rooms (apps) see the change. When you change the style guide (design tokens), all rooms update their paint colors.

The key insight is that shared packages eliminate duplication. Instead of having three copies of "what is a Card?", you have one definition that all apps import. This makes the codebase easier to maintain, test, and evolve.

The tradeoff is that shared packages must be backward-compatible. If you make a breaking change to `@nullspace/types`, you must update all consumers. This is manageable in a monorepo because you can update everything in a single commit.

---

## 14) Exercises

### Exercise 1: Trace the dependency graph

Starting from the mobile app, trace the dependency graph:
1. What packages does `mobile/package.json` depend on?
2. What packages do those packages depend on?
3. Draw the full dependency graph as a DAG.
4. Identify which packages have zero dependencies (the "leaves" of the graph).

### Exercise 2: Add a new chip value

Suppose you want to add a `5000` chip denomination. What files would you change?
1. Update `packages/constants/src/chips.ts` to add `5000` to `CHIP_VALUES`.
2. Rebuild the package: `cd packages/constants && pnpm build`.
3. Verify that mobile and website can now use the new chip value (no code changes needed in the apps).

### Exercise 3: Find all uses of a design token

Use grep to find all places where the `ACTION.indigo` color is used:

```bash
grep -r "ACTION\.indigo" mobile/ website/
```

How many files use this color? What would happen if you changed `ACTION.indigo` to a different hex value?

### Exercise 4: Understand type-only imports

Open `mobile/src/types/index.ts` and find a type-only import. What would happen if you removed the `type` keyword? Would the bundle size increase? Why or why not?

---

**End of lesson E38**

This lesson covered the shared package structure in the Nullspace monorepo. For protocol-level details (encoding, versioning, Zod schemas), see E08. For mobile-specific architecture, see E09. For website architecture, see E10.
