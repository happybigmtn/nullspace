# E10 - Web app architecture (from scratch, deep dive)

Focus files:
- `website/src/App.jsx`
- `website/src/CasinoApp.tsx`

Supporting context (read for understanding):
- `website/src/hooks/useTerminalGame.ts`
- `website/src/hooks/useKeyboardControls.ts`
- `website/src/services/featureFlags`
- `website/src/services/referrals`

Goal: explain how the web app routes between sections and how the casino UI is structured. This lesson walks through the routing tree, the casino state engine, and the key UI and safety controls that make the web experience robust.

---

## Learning objectives

After this lesson you should be able to:

1) Describe the route hierarchy and how lazy loading works in the web app.
2) Explain how feature flags gate large sections of the UI.
3) Trace the data flow in `CasinoApp` from chain state to UI components.
4) Explain how the PWA architecture provides offline-first caching and installability.
5) Explain how responsible play controls and safety checks are enforced on the client.
6) Identify the primary failure modes and what the architecture does to mitigate them.

---

## 1) Web app fundamentals (before the walkthrough)

### 1.1 What a SPA is

A **Single Page App (SPA)** loads one HTML shell and then renders all views with JavaScript. Navigation is handled by a router, not full page reloads. This enables:

- fast transitions between routes,
- shared state across pages,
- lazy loading of heavy sections.

### 1.2 React component tree (the mental model)

React renders a component tree. In the web app:

- the root component mounts global providers and routing,
- each route renders a component subtree,
- state updates cause re-render.

This is the same one-way data flow you see in React Native.

### 1.3 Client-side routing basics

React Router maps paths to components. It lets you:

- define nested layouts,
- lazy load subtrees,
- preserve state while changing views.

Routes are just components. That's why the routing tree is the architecture.

### 1.4 Lazy loading and Suspense

Large SPAs use **code splitting**: only load code when a route is visited. React's `Suspense` provides a fallback UI while bundles download.

### 1.5 Shared state and side effects

Hooks and shared state (stores/contexts) are used for:

- gateway connections,
- feature flags,
- analytics/referrals.

This is why the root layout includes listeners and providers: they must be mounted once for the entire app.

---

## 2) The web app as a multi-product SPA

The web app is not just a casino UI. It is a multi-product single-page app (SPA) that includes:

- The casino (root route)
- Economy dashboards and swap/borrow/stake flows
- Analytics dashboards
- Security tools
- Explorer views for blocks, transactions, and accounts

The architecture therefore favors **route-level modularity**: each major section is lazy loaded and wrapped in a layout component that provides shared structure.

---

## 3) `App.jsx`: the routing spine

`App.jsx` defines the router and the lazy-loaded layout. The key elements are:

- `BrowserRouter` for client-side routing.
- `Suspense` for lazy-loaded sections with a global fallback.
- A nested `Routes` tree with layouts and subpages.

Simplified view:

```jsx
<BrowserRouter>
  <ToastHost />
  <ReferralListener />
  <Suspense fallback={<LoadingScreen />}>
    <Routes>
      <Route path="/" element={<CasinoApp />} />
      <Route element={<AppLayout />}>
        <Route path="economy" element={<EconomyDashboard />} />
        <Route path="analytics" element={<OpsAnalyticsDashboard />} />
        <Route element={<ChainConnectionLayout />}>
          <Route path="swap" element={<EconomyRoute />} />
          <Route path="borrow" element={<EconomyRoute />} />
          <Route path="stake" element={<StakingRoute />} />
          <Route path="liquidity" element={<EconomyRoute />} />
          <Route path="bridge" element={<BridgeApp />} />
        </Route>
        <Route path="security" element={<SecurityApp />} />
        <Route path="explorer" element={<ExplorerLayout />}>
          <Route index element={<BlocksPage />} />
          <Route path="blocks/:id" element={<BlockDetailPage />} />
          <Route path="tx/:hash" element={<TxDetailPage />} />
          <Route path="account/:pubkey" element={<AccountPage />} />
          <Route path="tokens" element={<TokensPage />} />
        </Route>
      </Route>
    </Routes>
  </Suspense>
</BrowserRouter>
```

### 3.1 Why nested layouts matter

`AppLayout` provides the global shell for dashboard-like sections (economy, analytics, explorer). `ChainConnectionLayout` is a second-level wrapper that likely enforces chain connectivity prerequisites (wallet connection, chain status) for transactional routes like swap and bridge.

This layering keeps concerns separate: layout handles navigation and scaffolding, while the nested routes handle domain logic.

### 3.2 Global loading fallback

The `Suspense` fallback shows a lightweight terminal-styled loader. This is important because lazy-loaded pages may take a moment to download. A consistent fallback prevents white screens and gives users a perception of responsiveness.

---

## 4) Feature flags and legacy routes

The economy and staking routes are gated by feature flags:

```jsx
const EconomyRoute = () => (isFeatureEnabled('new_economy_ui') ? <EconomyApp /> : <LegacyEconomyApp />);
const StakingRoute = () => (isFeatureEnabled('new_staking_ui') ? <StakingApp /> : <LegacyStakingApp />);
```

This allows the team to ship new UI incrementally without breaking existing functionality. The key property is **safe fallback**: if the feature flag is off or misconfigured, the user still gets a working legacy UI.

Feature flags also enable A/B testing and staged rollouts. The architecture makes it easy to toggle without changing routes or code elsewhere.

---

## 5) ReferralListener: a small but important side effect

`ReferralListener` is mounted at the top level. It captures referral parameters from the URL and later claims them when the browser regains focus:

- On initial mount, it parses the query string (`captureReferralFromSearch`).
- On window focus, it attempts to claim the referral (`claimReferralIfReady`).

This is a nice example of a cross-cutting concern that belongs at the router level. It should run regardless of which page the user is on.

---

## 6) `CasinoApp.tsx`: the casino UI engine

`CasinoApp` is the root route for the casino experience. It is large because it orchestrates many cross-cutting concerns:

- Chain state and wallet state
- Game state and UI state
- Tournament scheduling
- Responsible play settings
- Keyboard and touch input modes
- Audio and reduced-motion preferences

The most important line is this one:

```tsx
const { stats, gameState, setGameState, aiAdvice, tournamentTime, phase, leaderboard, isRegistered, walletRng, walletVusdt, walletCredits, walletCreditsLocked, walletPublicKeyHex, lastTxSig, isOnChain, botConfig, setBotConfig, isRegisteringOrJoining, isFaucetClaiming, freerollActiveTournamentId, freerollActiveTimeLeft, freerollActivePrizePool, freerollActivePlayerCount, playerActiveTournamentId, freerollNextStartIn, freerollNextTournamentId, freerollIsJoinedNext, tournamentsPlayedToday, tournamentDailyLimit, actions } = useTerminalGame(playMode);
```

This hook is the casino state machine. Everything else in `CasinoApp` is either UI state (local toggles) or derived safety logic. Understanding `useTerminalGame` is key to understanding the casino UI.

---

## 6.1) Game catalog and ordering

At the top of `CasinoApp.tsx`, the code constructs a list of games:

```tsx
const SORTED_GAMES = Object.values(GameType).filter(g => g !== GameType.NONE).sort();
```

This list feeds menus and command palette navigation. The logic assumes that `GameType` is a numeric enum so it can be sorted by value. That matches how `GameType` is defined in the shared types, but it is worth noting: if you ever change `GameType` to a string enum, this code will behave differently.

`CasinoApp` also imports `ROULETTE_DOUBLE_ZERO`, which is a feature toggle for roulette variants. This is an example of a game-specific configuration that lives near the UI, not in the generic state engine. It allows the UI to present different layouts without changing core chain logic.

---

## 7) What `useTerminalGame` actually does

`useTerminalGame` is a compositional hook. It pulls together multiple sub-hooks:

- `useTerminalGameState`: initializes state, refs, and setters.
- `useChainInit`: connects to chain services and fetches initial state.
- `useChainEvents`: listens for chain events and updates stats.
- `useChainTimeouts`: detects stalled chain responses.
- `useStartGame` and `useDeal`: action hooks that submit transactions.
- `useFreerollScheduler`: manages tournament timing and signup flows.
- `useBotManager`: manages optional bot/autoplay configurations.

In other words, `useTerminalGame` is a high-level orchestrator: it wires chain services to UI state and provides a clean set of `actions` for the UI to call.

This is a common architectural pattern: **the UI layer should not know about chain timing, transaction signing, or error handling**. The hook abstracts those details.

---

## 7.1) Reading the `useTerminalGame` return value

The return value of `useTerminalGame` is large, but you can group it into four categories:

1) **Game state and stats**: `gameState`, `stats`, `phase`, `aiAdvice`, `leaderboard`.
2) **Wallet and chain state**: `walletRng`, `walletVusdt`, `walletCredits`, `walletCreditsLocked`, `walletPublicKeyHex`, `isOnChain`, `lastTxSig`.
3) **Tournament and scheduling**: `freerollActiveTournamentId`, `freerollActiveTimeLeft`, `freerollNextStartIn`, `tournamentsPlayedToday`, `tournamentDailyLimit`, and similar fields.
4) **Actions and config**: `actions`, `botConfig`, `setBotConfig`, `isRegisteringOrJoining`, `isFaucetClaiming`.

The UI treats these as read-only data plus a small set of actions. The important design principle is that the UI does not mutate chain state directly; it calls actions that encapsulate transaction logic. That keeps the UI predictable and reduces the surface area for bugs.

---

## 8) Network labeling and chain connectivity

`CasinoApp` derives a network label from environment variables:

```tsx
const chainUrl = String(import.meta.env.VITE_CHAIN_URL ?? import.meta.env.VITE_URL ?? '');
const networkLabel = chainUrl.includes('localhost') || chainUrl.includes('127.0.0.1') ? 'Localnet' : 'Testnet';
const networkStatus = isOnChain ? 'online' : 'offline';
```

This is small but important. Users should not confuse testnet with production. The UI makes the network explicit. It also surfaces `online`/`offline` based on chain connectivity so users have a clear signal when the app cannot submit transactions.

---

## 9) UI preferences: sound, motion, and touch

`CasinoApp` keeps several UI preferences in localStorage:

- `soundEnabled` toggles audio effects.
- `reducedMotion` respects the user's preference for reduced animation.
- `touchMode` adapts UI controls for touch devices.

Each preference is initialized from localStorage (with safe fallbacks), then persisted whenever it changes. The app also updates `document.documentElement.dataset` flags so CSS can react to the preference. This is a clean way to bridge state into styling.

The key design decision is **persistence**: if a user disables sound, it should stay disabled across sessions.

---

## 9.1) Reduced motion and accessibility details

The `reducedMotion` preference is derived from two sources:

1) A stored user preference in localStorage.
2) The browser's `prefers-reduced-motion` media query.

This dual approach respects explicit user choice while also honoring system-level accessibility settings. When the preference changes, `CasinoApp` writes a `data-reduced-motion` flag to the document root. This makes it easy for CSS and animations to respond consistently across the entire app, not just within a single component.

This is an example of accessible design built into the architecture, not bolted on later.

---

## 10) Progressive Web App (PWA) support

The web app is built as a **Progressive Web App (PWA)**, which means users can install it to their home screen and use it offline. This provides an app-like experience without requiring a native app download from an app store.

### 10.1 What a PWA provides

PWAs combine the reach of the web with the experience of native apps:

- **Installable**: Users can add the app to their home screen on mobile or desktop.
- **Offline-first**: Critical assets are cached so the app works even without network connectivity.
- **Fast loading**: Cached resources load instantly on repeat visits.
- **Native app feel**: Runs in standalone mode without browser chrome (address bar, tabs).

For a casino app, this is especially valuable: users get a dedicated gaming experience without installing a separate app.

### 10.2 Service worker architecture

The service worker lives at `/website/public/sw.js` and implements an **offline-first caching strategy** with network fallback:

```javascript
// Precache critical assets on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/offline.html'
];
```

The service worker implements three caching strategies depending on the resource type:

1. **Navigation requests (HTML pages)**: Network-first with offline fallback. The app tries to fetch fresh HTML, but if the network fails, it serves cached content or an offline page.

2. **Static assets (JS, CSS, fonts, images)**: Stale-while-revalidate. The app serves cached assets immediately for speed, then updates the cache in the background.

3. **API requests**: Always network-only. Transaction submission and chain queries should never be cached.

This hybrid approach ensures the UI shell loads instantly while keeping chain state fresh.

### 10.3 Service worker lifecycle

The service worker follows a three-phase lifecycle:

**Install phase**: When a new service worker is discovered, it precaches critical assets:

```javascript
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())  // Activate immediately
  );
});
```

**Activate phase**: The new service worker cleans up old caches and takes control:

```javascript
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        // Delete old caches
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('nullspace-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())  // Take control immediately
  );
});
```

**Fetch phase**: The service worker intercepts network requests and applies caching logic based on the resource type.

The key architectural decision is `skipWaiting()` and `clients.claim()`. These ensure the new service worker activates immediately without waiting for tabs to close. This keeps updates fast but requires careful testing to avoid breaking in-progress sessions.

### 10.4 Install prompt handling (Chrome/Edge vs iOS)

The install experience differs dramatically across platforms:

**Chrome/Edge (Android and desktop)**:
- Browsers fire a `beforeinstallprompt` event when install criteria are met.
- The app captures this event and shows a custom install banner.
- When the user clicks "Install", the app calls `prompt()` to trigger the native install UI.

**iOS Safari**:
- Safari does not support the `beforeinstallprompt` API.
- Users must manually tap Share → "Add to Home Screen".
- The app detects iOS Safari and shows visual instructions instead.

The `usePWA` hook (`/website/src/hooks/usePWA.ts`) abstracts these platform differences:

```typescript
const { canInstall, promptInstall, isIOSSafari, dismissBanner, isDismissed } = usePWA();
```

- `canInstall` is true when the install prompt is available (Chrome/Edge).
- `isIOSSafari` is true when manual instructions are needed (iOS).
- `promptInstall` triggers the native install dialog on supported browsers.
- `dismissBanner` hides the banner for 7 days to avoid nagging users.

The `InstallBanner` component (`/website/src/components/ui/InstallBanner.tsx`) renders platform-specific UI:

```tsx
if (isIOSSafari) {
  return <IOSInstallInstructions />;  // Shows "Tap Share → Add to Home Screen"
}

if (canInstall) {
  return <InstallButton onClick={promptInstall} />;  // Shows native prompt
}
```

This is mounted at the router level in `App.jsx` so it appears consistently across all routes.

### 10.5 Manifest and app metadata

The web app manifest (`/website/public/manifest.json`) defines how the app appears when installed:

```json
{
  "name": "null/space Casino",
  "short_name": "null/space",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#111111",
  "theme_color": "#111111",
  "icons": [...]
}
```

Key properties:

- `display: "standalone"` hides the browser UI (address bar, back button) for an app-like experience.
- `theme_color` sets the status bar color on mobile devices.
- `start_url` defines where the app opens (the casino root route).
- `icons` provides app icons for home screen, splash screen, and task switcher.

The manifest is linked in `index.html` along with iOS-specific meta tags:

```html
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="null/space">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
```

These tags ensure the app works correctly on both Android (via manifest) and iOS (via meta tags).

### 10.6 App icons and maskable variants

The app provides four icon variants:

1. **icon-192.png** and **icon-512.png**: Standard icons with transparent backgrounds. Used on most platforms.

2. **icon-maskable-192.png** and **icon-maskable-512.png**: Icons with extra padding that can be safely cropped into different shapes (circle, squircle, rounded square). Used on Android 13+ where the OS applies adaptive icon shapes.

The manifest declares both purposes:

```json
{
  "src": "/icons/icon-192.png",
  "purpose": "any"  // Standard icon
},
{
  "src": "/icons/icon-maskable-192.png",
  "purpose": "maskable"  // Safe-area icon for adaptive shapes
}
```

This ensures the icon looks correct whether the OS displays it as a circle (Pixel), squircle (Samsung), or rounded square (iOS).

### 10.7 Service worker registration

The service worker is registered in `index.html` after the app loads:

```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => console.log('[PWA] Service worker registered'))
      .catch((error) => console.error('[PWA] Registration failed:', error));
  });
}
```

Registration is deferred until after page load to avoid blocking the initial render. This is a best practice: the service worker will not help the first visit, so there is no reason to slow it down.

The service worker is served from `/public/sw.js` (not bundled with the app). This keeps the scope at the root path and avoids versioning conflicts with the main bundle.

### 10.8 Why offline-first matters for a casino app

Most casino logic requires chain connectivity, so why support offline mode?

1. **Instant UI load**: The app shell (HTML, CSS, JS) loads from cache immediately. Users see the UI in under 100ms even on slow networks.

2. **Resilience to flaky connections**: Mobile networks drop in and out. Caching ensures the UI does not flicker or reload when connectivity is intermittent.

3. **Perception of speed**: A cached shell makes the app feel fast. Once the UI is loaded, the app can show connection status and wait for chain services gracefully.

4. **App-like continuity**: Users expect installed apps to open instantly. Offline-first caching provides that experience.

The key insight is that the UI and the chain state are separate concerns. The service worker caches the UI layer, while the app handles chain connectivity at the application level.

---

## 11) Responsible play settings

The `ResponsiblePlaySettings` structure is stored in localStorage under `nullspace_responsible_play_v1`. It includes:

- Maximum wager
- Maximum loss
- Maximum session minutes
- Cooldown timers
- Reality check intervals

`CasinoApp` enforces these settings in several helper functions:

- `ensureSessionStarted` initializes session baselines (time and PnL).
- `safeSetBetAmount` clamps bets to `maxWager` and shows a warning.
- `safeDeal` checks cooldowns, loss limits, and reality check intervals before allowing play.
- `stopPlaying` ends the session and logs metrics.

These controls are client-side, but they are still valuable: they shape user behavior and ensure the UI respects self-imposed limits. The code treats them as first-class logic, not as optional decoration.

---

## 11.1) How `safeDeal` enforces limits in practice

`safeDeal` is the gatekeeper for starting a new round. It only performs checks when the game is at a round boundary (`BETTING` or `RESULT` stage), which prevents mid-round interruptions. The checks include:

- **Cooldown**: if a cooldown timer is active, the deal is blocked and the UI shows a cooldown message.
- **Session limit**: if the user has been playing longer than the allowed session duration, the deal is blocked.
- **Loss limit**: if the net PnL exceeds the loss threshold, the deal is blocked.
- **Reality check**: if the reality check timer has elapsed, the UI is forced into a confirmation overlay.

For each block, the app logs a telemetry event (for example, `casino.deal.blocked` with a reason). This makes it possible to measure how often safety controls are activated.

After passing the checks, `safeDeal` logs a `casino.deal` event and plays a sound effect (except for games like Craps and Sic Bo where the sound pattern is different). Then it delegates to `actions.deal()` to execute the chain transaction.

This pattern is critical: **UI safety logic wraps, but does not replace, the core action**. The underlying chain logic still executes the same way, and safety checks only guard the UI from sending unsafe actions.

---

## 11.2) Session baselines and PnL tracking

`CasinoApp` calculates `currentPnl`, `sessionMinutes`, and `netPnl` from `stats` and `rp`. When a session starts, it stores a baseline PnL and a start timestamp. Subsequent PnL checks compute net gain or loss relative to that baseline, not absolute wallet balance. This is important because a user's wallet may change for reasons unrelated to the current session (for example, tournament payouts or airdrops).

By baselining at session start, the UI can enforce loss limits based on actual session performance rather than total account balance. This is a more accurate and fair interpretation of responsible play limits.

---

## 12) Command palette, help, and overlays

`CasinoApp` manages multiple overlays:

- Command palette
- Help overlay
- Custom bet overlay
- Rewards drawer
- Responsible play overlay

Each overlay has its own open/closed state, and the UI actions deliberately close other overlays when one is opened. For example, opening the command palette clears help details and closes the custom bet overlay. This reduces UI conflict and keeps focus on one interaction at a time.

The command palette also integrates with keyboard shortcuts (see `useKeyboardControls`). It provides a fast navigation path for power users.

---

## 12.1) Input refs and focus management

`CasinoApp` keeps `inputRef` and `customBetRef` so it can programmatically focus inputs when overlays open. This is a small UX detail, but it matters: when a user opens the command palette, they can start typing immediately. When they open custom bet mode, the numeric input is focused without extra clicks.

This is a classic example of how React refs are used for imperative UX improvements that state alone cannot provide.

---

## 13) Keyboard controls: power-user UX

The `useKeyboardControls` hook (not shown in full here) provides a large set of shortcuts:

- Alt+Z toggles focus mode.
- Alt+R opens rewards.
- Alt+S opens safety settings.
- Alt+L toggles the live feed.
- `/` opens the command palette.
- `?` toggles help.
- Ctrl+1..9 sets bet amounts.

The hook also implements game-specific shortcuts (blackjack hit/stand, roulette number input, etc.). This is a deliberate UI choice: the web app caters to advanced users who want speed and keyboard control.

---

## 13.1) Local UI state belongs in the component

`CasinoApp` maintains a large number of UI-only state variables: `commandOpen`, `customBetOpen`, `helpOpen`, `helpDetail`, `customBetString`, `searchQuery`, `leaderboardView`, `feedOpen`, `numberInputString`, `focusMode`, and `rewardsOpen`. These states are not part of the core chain or game logic. They are purely presentation concerns.

Keeping them local has two benefits:

- It avoids polluting the global game state with ephemeral UI flags.
- It keeps the casino hook (`useTerminalGame`) focused on protocol and chain concerns.

This division is an architectural choice: global state for things that must be consistent across the app, local state for UI details that only the casino view cares about.

---

## 13.2) Play mode flow (cash vs freeroll)

The casino can operate in different modes. `playMode` is stored in component state and drives which screens are shown:

- When `playMode` is `null`, the UI shows a mode selector.
- When `playMode` is set, the UI transitions into either cash or freeroll mode.

This is why `CasinoApp` imports `ModeSelectView`, `RegistrationView`, and `ActiveGame`. These components encapsulate the main phases of the casino experience. The top-level component decides which view is active; the underlying hook decides how to interact with the chain.

Separating mode selection from game state is important: you can add new modes or change onboarding flows without rewriting the core game engine.

---

## 14) QA harness and feature gating

The `qaEnabled` flag is derived from `VITE_QA_BETS`. When enabled, the UI renders a `QABetHarness` component. This is a testing tool that should never appear in production.

This is another example of environment-driven feature gating. It allows QA and developers to test edge cases without modifying production logic.

---

## 14.1) Wallet and auth indicators

`CasinoApp` imports `WalletPill` and `AuthStatusPill` components. These are small UI elements, but they provide essential situational awareness:

- `WalletPill` typically displays the current wallet address, balance, or connection status.
- `AuthStatusPill` indicates whether the user is registered, connected, or authenticated.

These components are especially important in a blockchain app because users need to know whether their actions will actually reach the chain. A bet placed while disconnected is just a UI action; a bet placed while connected is a transaction. The pills make that distinction visible.

These indicators also serve as anchor points for support and debugging. When a user reports an issue, a screenshot of the pill status often tells you whether the problem is local (not connected) or systemic (chain offline).

---

## 15) Sound effects and telemetry

`CasinoApp` calls `setSfxEnabled(soundEnabled)` when the sound preference changes. This lets the sound engine run independently of the UI. Sound effects are a key part of casino feedback, but they must respect user preferences.

The app also tracks events via `track` (telemetry). This mirrors the mobile app approach and provides observability into game sessions, funnel progression, and drop-offs.

---

## 16) Error boundaries

`CasinoApp` wraps large sections in an `ErrorBoundary` component. This prevents a single render error from crashing the entire app. In a complex UI with many game components, this is essential for resilience.

---

## 17) A simplified data flow

A casino action flows like this:

1) UI calls an action from `useTerminalGame` (for example, `actions.setBetAmount` or `actions.deal`).
2) The action submits a transaction or updates local optimistic state.
3) Chain events arrive and update `gameState` and `stats`.
4) UI components render based on the updated state.

The UI does not embed chain logic. It delegates to the hook, which maintains consistency with the chain.

---

## 18) Failure modes and mitigations

- **Chain offline**: `isOnChain` toggles to `offline`, and the UI can block actions.
- **Feature flag misconfig**: fallback to legacy UI ensures functionality.
- **UI overload**: overlays are mutually exclusive; command palette and help do not stack.
- **LocalStorage failure**: try/catch guards prevent crashes if storage is unavailable.

These are not theoretical. They reflect real conditions: ad blockers, privacy settings, or browser restrictions can break localStorage; network outages can break chain connections. The architecture is defensive.

---

## 18.1) Chain responsiveness timeouts

Although not shown directly in `CasinoApp.tsx`, the `useTerminalGame` hook wires in `useChainTimeouts`. This subsystem arms timeouts when a transaction is sent and clears them when a response arrives. If a timeout fires, the UI can reset pending state or warn the user that the chain is unresponsive.

This is important because chain latency can be unpredictable. Without timeouts, the UI might stay stuck in a loading state forever. With timeouts, the user gets feedback and can retry or refresh.

Even though this logic lives inside a hook, it has user-visible consequences. It is part of why the UI feels resilient even when the chain is slow.

---

## 19) Feynman recap: explain it like I am five

Think of the web app as a big arcade hall. The front door is the router. Inside, there are different rooms (economy, explorer, casino). The casino room has a big control panel (`useTerminalGame`) that knows how to talk to the chain. All the buttons, sounds, and overlays are just decorations around that panel. If the control panel says the chain is offline, the room closes its doors.

---

## 20) Exercises

1) Why does the app use lazy loading for large sections like the explorer?
2) What is the benefit of routing `economy` and `stake` through feature-flagged components?
3) Explain how `safeDeal` enforces responsible play settings.
4) If the chain is offline, which state signals should the UI use to disable actions?
5) Where would you add a new top-level route if you wanted a new product section?
6) Why does the service worker use network-first caching for HTML but stale-while-revalidate for static assets?
7) What is the difference between installing a PWA on Chrome/Edge vs iOS Safari?
8) Why are maskable icons important for Android 13+ devices?

---

## Next lesson

E11 - Telemetry, logs, and ops events: `feynman/lessons/E11-telemetry-ops.md`
