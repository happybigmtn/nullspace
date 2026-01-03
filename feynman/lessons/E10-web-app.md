# E10 - Web app architecture (from scratch)

Focus files: `website/src/App.jsx`, `website/src/CasinoApp.tsx`

Goal: explain how the web app routes between sections and how the casino UI is structured. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) SPA routing
The web app uses React Router to switch between routes without full page reloads.

### 2) Lazy loading
Large sections are loaded lazily to reduce initial bundle size.

### 3) Casino UI state
The casino app centralizes state via hooks like `useTerminalGame`, which drives game UI, wallet state, and tournament state.

---

## Limits & management callouts (important)

1) **Lazy loading hides runtime errors until route usage**
- If a lazy component fails, the error appears only when the route is visited.
- Monitor errors on all routes, not just home.

2) **Large UI state surfaces many feature flags**
- The casino app uses feature flags and envs; misconfigurations can disable key UI flows.

---

## Walkthrough with code excerpts

### 1) Router and lazy-loaded layout
```rust
const AppLayout = lazy(() => import('./components/AppLayout'));
const ChainConnectionLayout = lazy(() => import('./components/ChainConnectionLayout'));
const EconomyDashboard = lazy(() => import('./components/EconomyDashboard'));
const OpsAnalyticsDashboard = lazy(() => import('./components/OpsAnalyticsDashboard'));

function App() {
  return (
    <BrowserRouter>
      <ToastHost />
      <ReferralListener />
      <Suspense
        fallback={
          <div className="min-h-screen bg-terminal-black text-white flex items-center justify-center font-mono">
            <div className="text-[10px] tracking-widest text-gray-400">LOADING…</div>
          </div>
        }
      >
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
  );
}
```

Why this matters:
- This defines the main navigation structure of the web app.

What this code does:
- Lazily loads large sections.
- Sets up the root casino route and nested dashboard/explorer routes.
- Provides a loading fallback while bundles load.

---

### 2) Casino app state engine
```rust
const { stats, gameState, setGameState, aiAdvice, tournamentTime, phase, leaderboard, isRegistered, walletRng, walletVusdt, walletCredits, walletCreditsLocked, walletPublicKeyHex, lastTxSig, isOnChain, botConfig, setBotConfig, isRegisteringOrJoining, isFaucetClaiming, freerollActiveTournamentId, freerollActiveTimeLeft, freerollActivePrizePool, freerollActivePlayerCount, playerActiveTournamentId, freerollNextStartIn, freerollNextTournamentId, freerollIsJoinedNext, tournamentsPlayedToday, tournamentDailyLimit, actions } = useTerminalGame(playMode);
```

Why this matters:
- This hook centralizes the casino game state and actions used by the UI.

What this code does:
- Pulls a large state object from `useTerminalGame`.
- Exposes wallet state, tournament state, and UI actions in one place.

---

### 3) Environment-derived network labeling
```rust
const chainUrl = String(import.meta.env.VITE_CHAIN_URL ?? import.meta.env.VITE_URL ?? '');
const networkLabel = chainUrl.includes('localhost') || chainUrl.includes('127.0.0.1') ? 'Localnet' : 'Testnet';
const networkStatus = isOnChain ? 'online' : 'offline';
```

Why this matters:
- Users need to know whether they are on testnet or local.

What this code does:
- Derives the chain URL from environment variables.
- Labels the UI as Localnet or Testnet.
- Displays online/offline status based on on-chain connectivity.

---

## Key takeaways
- The web app uses React Router + lazy loading for modular sections.
- Casino UI state is centralized in `useTerminalGame`.
- Environment variables drive network labeling and feature toggles.

## Next lesson
E11 - Telemetry, logs, and ops events: `feynman/lessons/E11-telemetry-ops.md`
