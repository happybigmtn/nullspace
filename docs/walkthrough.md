# Repository Walkthrough Checklist

Goal: walk every tracked file (excluding generated/temporary artifacts), mark it done, and reach the "95/20" target (95% of key concepts via ~20% of lines).

## Method (Feynman)

- Explain the file in plain language as if teaching a new teammate.
- Identify any gaps or unclear terms; we pause and resolve them.
- Re-explain with a simpler analogy or minimal example.
- Summarize the core idea in 1-2 sentences.

## 95/20 Focus Rules

- For small files (<200 lines), we cover all lines.
- For medium/large files, we deep dive ~20% of lines:
  - Entry points, exports, public APIs
  - Data models, state transitions, and invariants
  - Security/auth/crypto boundaries
  - External I/O (network, storage, chain, queues)
  - Error handling and retries
- We still read every file end-to-end, but only the 20% gets line-by-line detail.

## Non-code Artifacts (quick pass)

- For binaries, images, data dumps, or logs: confirm purpose, origin, and whether it should be tracked.
- Record any surprises (secrets, large artifacts, generated files) for cleanup before testnet.

## Testnet Readiness Emphasis

- Network config, chain params, and environment flags
- Key management, auth, and secrets handling
- Consensus/execution correctness and error handling
- Observability, logging, and alerting hooks

## Excluded (generated/temporary)

These are removed from the walkthrough to keep focus on code understanding. Add back if you want to review them:

- Turbo cache artifacts (.turbo/...)
- Logs (_.log), PID files (_.pid), editor swap files (_.swp/_.swo), OS files (.DS_Store)
- Build outputs (target/, node_modules/, dist/, build/)
- Backups and runtime data (backups/, logs/, .gateway-data/)
- Lockfiles (Cargo.lock, pnpm-lock.yaml, etc.)
- Data dumps (economy_log.json)
- Excluded file count: 477

## Walkthrough Format Per File

1. Purpose: what problem does this file solve?
2. Inputs/Outputs: what data flows in/out?
3. Key concepts: syntax, patterns, or domain logic to learn
4. 95/20 deep dive: which lines matter most and why
5. Open questions or follow-ups

## Intentional Learning Order

We use a Feynman-style ladder: start with narrative, then shared vocabulary, then protocol logic, then execution/runtime, then edges/clients, and finally ops/tooling. This maximizes concept transfer before code density.

## Checklist

### Phase 0: Orientation & Domain (25 files)

Build the big-picture mental model: what the system is, why it exists, and the language we use to talk about it.

#### docs/

- [x] docs/BUSINESS_PLAN.md
- [x] docs/plan.md
- [x] docs/backend.md
- [x] docs/economy.md
- [x] docs/liquidity.md
- [x] docs/limits.md
- [ ] docs/persistence.md
- [ ] docs/observability.md
- [ ] docs/SECURITY.md
- [ ] docs/resource_sizing.md
- [ ] docs/ux.md
- [ ] docs/updates.md
- [ ] docs/runbooks.md
- [ ] docs/golive.md
- [ ] docs/release.md
- [ ] docs/testnet-readiness-runbook.md
- [ ] docs/testnet-runbook.md
- [ ] docs/hetzner-deployment-runbook.md
- [ ] docs/postgres-ops-runbook.md
- [ ] docs/mobile-e2e-parity.md
- [ ] docs/mobile-vault-qa-runbook.md
- [ ] docs/cca_runbook.md
- [ ] docs/remediation.md

#### plans/

- [ ] plans/design-principles.md

#### Root context

- [x] quickstart.md

### Phase 1: Shared Vocabulary (Types & Constants) (76 files)

Establish the core data types, invariants, and shared constants that everything else depends on.

#### types/

- [x] types/Cargo.lock
- [x] types/Cargo.toml
- [x] types/benches/tournament_membership.rs
- [x] types/src/api.rs
- [x] types/src/bin/export_ts.rs
- [x] types/src/casino/codec.rs
- [x] types/src/casino/constants.rs
- [x] types/src/casino/economy.rs
- [x] types/src/casino/game.rs
- [x] types/src/casino/leaderboard.rs
- [x] types/src/casino/mod.rs
- [x] types/src/casino/player.rs
- [x] types/src/casino/tests.rs
- [x] types/src/casino/tournament.rs
- [x] types/src/casino_state.rs
- [x] types/src/compat.rs
- [x] types/src/execution.rs
- [x] types/src/lib.rs
- [x] types/src/token.rs

### Phase 2: Protocol & State Machines (22 files)

Understand the rules of the game: protocol messages, state transitions, and core domain logic.

#### packages/

- [x] packages/game-state/README.md
- [x] packages/game-state/package.json
- [x] packages/game-state/src/index.ts
- [x] packages/game-state/test/game-state.test.ts
- [x] packages/game-state/test/safe-reader.test.ts
- [x] packages/game-state/tsconfig.build.json
- [x] packages/game-state/tsconfig.json
- [x] packages/game-state/vitest.config.ts
- [x] packages/protocol/package.json
- [x] packages/protocol/src/decode.ts
- [x] packages/protocol/src/encode.ts
- [x] packages/protocol/src/errors.ts
- [x] packages/protocol/src/games/blackjack.ts
- [x] packages/protocol/src/games/craps.ts
- [x] packages/protocol/src/games/index.ts
- [x] packages/protocol/src/games/roulette.ts
- [x] packages/protocol/src/games/types.ts
- [x] packages/protocol/src/games/atomic.ts
- [x] packages/protocol/src/index.ts
- [x] packages/protocol/src/mobile.ts
- [x] packages/protocol/src/schema/base.ts
- [x] packages/protocol/src/schema/gateway.ts
- [x] packages/protocol/src/schema/mobile.ts
- [x] packages/protocol/src/schema/websocket.ts
- [x] packages/protocol/src/validation.ts
- [x] packages/protocol/src/websocket.ts
- [x] packages/protocol/test/encoding.test.ts
- [x] packages/protocol/test/fixtures/golden-vectors.json
- [x] packages/protocol/test/validation.test.ts
- [x] packages/protocol/tsconfig.build.json
- [x] packages/protocol/tsconfig.json
- [x] packages/protocol/vitest.config.ts

### Phase 3: Execution & Node Runtime (87 files)

See how the protocol is executed in practice: runtime, consensus/execution pipeline, and EVM boundaries.

#### evm/

- [ ] evm/.env.example
- [ ] evm/.gitignore
- [ ] evm/contracts/BogoDistributor.sol
- [ ] evm/contracts/BridgeLockbox.sol
- [ ] evm/contracts/FeeDistributor.sol
- [ ] evm/contracts/MockUSDT.sol
- [ ] evm/contracts/RNGToken.sol
- [ ] evm/contracts/RecoveryPool.sol
- [ ] evm/hardhat.config.js
- [ ] evm/package-lock.json
- [ ] evm/package.json
- [ ] evm/scripts/buildEligibilitySnapshot.js
- [ ] evm/scripts/deployPhase2.js
- [ ] evm/scripts/finalizeCca.js
- [ ] evm/scripts/generateBidders.js
- [ ] evm/scripts/recoveryPoolActions.js
- [ ] evm/scripts/simulateCcaBids.js
- [ ] evm/src/abis/cca.js
- [ ] evm/src/abis/distributionContract.js
- [ ] evm/src/abis/erc20.js
- [ ] evm/src/abis/feeDistributor.js
- [ ] evm/src/abis/lbpStrategy.js
- [ ] evm/src/abis/permit2.js
- [ ] evm/src/abis/recoveryPool.js
- [ ] evm/src/abis/virtualLbpFactory.js
- [ ] evm/src/auction/params.js
- [ ] evm/src/auction/steps.js
- [ ] evm/src/config/addresses.js
- [ ] evm/src/config/phase2.js
- [ ] evm/test/contracts.test.js
- [ ] evm/tsconfig.json

#### execution/

- [ ] execution/Cargo.lock
- [ ] execution/Cargo.toml
- [ ] execution/src/casino/baccarat.rs
- [ ] execution/src/casino/blackjack.rs
- [ ] execution/src/casino/cards.rs
- [ ] execution/src/casino/casino_war.rs
- [ ] execution/src/casino/craps.rs
- [ ] execution/src/casino/hilo.rs
- [ ] execution/src/casino/integration_tests.rs
- [ ] execution/src/casino/limits.rs
- [ ] execution/src/casino/logging.rs
- [ ] execution/src/casino/mod.rs
- [ ] execution/src/casino/payload.rs
- [ ] execution/src/casino/roulette.rs
- [ ] execution/src/casino/serialization.rs
- [ ] execution/src/casino/sic_bo.rs
- [ ] execution/src/casino/super_mode.rs
- [ ] execution/src/casino/three_card.rs
- [ ] execution/src/casino/ultimate_holdem.rs
- [ ] execution/src/casino/video_poker.rs
- [ ] execution/src/fixed.rs
- [ ] execution/src/layer/handlers/bridge.rs
- [ ] execution/src/layer/handlers/casino.rs
- [ ] execution/src/layer/handlers/liquidity.rs
- [ ] execution/src/layer/handlers/mod.rs
- [ ] execution/src/layer/handlers/staking.rs
- [ ] execution/src/layer/mod.rs
- [ ] execution/src/lib.rs
- [ ] execution/src/mocks.rs
- [ ] execution/src/state.rs
- [ ] execution/src/state_transition.rs

#### node/

- [ ] node/.gitignore
- [ ] node/Cargo.toml
- [ ] node/Dockerfile
- [ ] node/src/aggregator/actor.rs
- [ ] node/src/aggregator/ingress.rs
- [ ] node/src/aggregator/mod.rs
- [ ] node/src/application/actor.rs
- [ ] node/src/application/ingress.rs
- [ ] node/src/application/mempool.rs
- [ ] node/src/application/mod.rs
- [ ] node/src/backoff.rs
- [ ] node/src/bin/generate_keys.rs
- [ ] node/src/bin/init_amm.rs
- [ ] node/src/bin/test_transactions.rs
- [ ] node/src/defaults.rs
- [ ] node/src/engine.rs
- [ ] node/src/indexer.rs
- [ ] node/src/lib.rs
- [ ] node/src/main.rs
- [ ] node/src/seeder/actor.rs
- [ ] node/src/seeder/ingress.rs
- [ ] node/src/seeder/mod.rs
- [ ] node/src/supervisor.rs
- [ ] node/src/system_metrics.rs
- [ ] node/src/tests.rs

### Phase 4: Gateways & Services (53 files)

Study the system edges: APIs, gateways, service orchestration, and external integrations.

#### gateway/

- [ ] gateway/package-lock.json
- [ ] gateway/package.json
- [ ] gateway/src/backend/http.ts
- [ ] gateway/src/backend/index.ts
- [ ] gateway/src/backend/updates.ts
- [ ] gateway/src/codec/constants.ts
- [ ] gateway/src/codec/events.ts
- [ ] gateway/src/codec/index.ts
- [ ] gateway/src/codec/instructions.ts
- [ ] gateway/src/codec/transactions.ts
- [ ] gateway/src/handlers/baccarat.ts
- [ ] gateway/src/handlers/base.ts
- [ ] gateway/src/handlers/blackjack.ts
- [ ] gateway/src/handlers/casinowar.ts
- [ ] gateway/src/handlers/craps.ts
- [ ] gateway/src/handlers/hilo.ts
- [ ] gateway/src/handlers/index.ts
- [ ] gateway/src/handlers/roulette.ts
- [ ] gateway/src/handlers/sicbo.ts
- [ ] gateway/src/handlers/threecardpoker.ts
- [ ] gateway/src/handlers/ultimateholdem.ts
- [ ] gateway/src/handlers/videopoker.ts
- [ ] gateway/src/index.ts
- [ ] gateway/src/session/index.ts
- [ ] gateway/src/session/limiter.ts
- [ ] gateway/src/session/manager.ts
- [ ] gateway/src/session/nonce.ts
- [ ] gateway/src/telemetry.ts
- [ ] gateway/src/types/errors.ts
- [ ] gateway/src/types/index.ts
- [ ] gateway/src/types/session.ts
- [ ] gateway/tests/integration/all-bet-types.test.ts
- [ ] gateway/tests/unit/codec.test.ts
- [ ] gateway/tests/manual/comprehensive-game-test.ts
- [ ] gateway/tests/manual/debug-signature.ts
- [ ] gateway/tests/manual/hilo-live.ts
- [ ] gateway/tests/integration/integration.test.ts
- [ ] gateway/tests/manual/quick-bet-test.ts
- [ ] gateway/tests/manual/test-single-craps.ts
- [ ] gateway/tests/manual/test-single-hilo.ts
- [ ] gateway/tests/manual/trace-signing.ts
- [ ] gateway/tsconfig.json
- [ ] gateway/vitest.config.ts

#### services/

- [ ] services/auth/.env.example
- [ ] services/auth/Dockerfile
- [ ] services/auth/package-lock.json
- [ ] services/auth/package.json
- [ ] services/auth/src/casinoAdmin.ts
- [ ] services/auth/src/server.ts
- [ ] services/auth/src/telemetry.ts
- [ ] services/auth/tsconfig.json

### Phase 5: Simulation & QA (16 files)

Explore deterministic harnesses, simulators, and test scaffolding that prove correctness.

#### simulator/

- [ ] simulator/Cargo.lock
- [ ] simulator/Cargo.toml
- [ ] simulator/examples/get_identity.rs
- [ ] simulator/src/api/http.rs
- [ ] simulator/src/api/mod.rs
- [ ] simulator/src/api/ws.rs
- [ ] simulator/src/cache.rs
- [ ] simulator/src/explorer.rs
- [ ] simulator/src/explorer_persistence.rs
- [ ] simulator/src/fanout.rs
- [ ] simulator/src/lib.rs
- [ ] simulator/src/main.rs
- [ ] simulator/src/metrics.rs
- [ ] simulator/src/passkeys.rs
- [ ] simulator/src/state.rs
- [ ] simulator/src/submission.rs

### Phase 6: Clients & UX (379 files)

Connect the protocol to humans: web/mobile clients, UX assets, and design tokens.

#### client/

- [ ] client/Cargo.lock
- [ ] client/Cargo.toml
- [ ] client/Dockerfile
- [ ] client/examples/comprehensive_bot.rs
- [ ] client/examples/maximize_pnl.rs
- [ ] client/examples/network_bot.rs
- [ ] client/examples/simulation_ecosystem.rs
- [ ] client/src/bin/bridge_relayer.rs
- [ ] client/src/bin/freeroll_snapshot.rs
- [ ] client/src/bin/phase_simulation.rs
- [ ] client/src/bin/recovery_pool.rs
- [ ] client/src/bin/session_dump.rs
- [ ] client/src/bin/stress_test.rs
- [ ] client/src/bin/sybil_scan.rs
- [ ] client/src/bin/tournament_scheduler.rs
- [ ] client/src/client.rs
- [ ] client/src/consensus.rs
- [ ] client/src/events.rs
- [ ] client/src/lib.rs

#### mobile/

- [ ] mobile/.gitignore
- [ ] mobile/App.tsx
- [ ] mobile/app.json
- [ ] mobile/assets/images/adaptive-icon.png
- [ ] mobile/assets/images/favicon.png
- [ ] mobile/assets/images/icon.png
- [ ] mobile/assets/images/splash.png
- [ ] mobile/babel.config.js
- [ ] mobile/eas.json
- [ ] mobile/eslint.config.js
- [ ] mobile/jest.config.js
- [ ] mobile/jest/expoModulesCoreWebMock.js
- [ ] mobile/jest/nativeAnimatedHelperMock.js
- [ ] mobile/jest/nativeModulesMock.js
- [ ] mobile/jest/setup.js
- [ ] mobile/metro.config.js
- [ ] mobile/package-lock.json
- [ ] mobile/package.json
- [ ] mobile/src/components/GameErrorBoundary.tsx
- [ ] mobile/src/components/casino/Card.tsx
- [ ] mobile/src/components/casino/ChipSelector.tsx
- [ ] mobile/src/components/casino/**tests**/Card.test.tsx
- [ ] mobile/src/components/casino/index.ts
- [ ] mobile/src/components/game/EventBadge.tsx
- [ ] mobile/src/components/game/GameHeader.tsx
- [ ] mobile/src/components/game/GameLayout.tsx
- [ ] mobile/src/components/game/index.ts
- [ ] mobile/src/components/ui/ConnectionStatusBanner.tsx
- [ ] mobile/src/components/ui/HelpButton.tsx
- [ ] mobile/src/components/ui/PrimaryButton.tsx
- [ ] mobile/src/components/ui/TutorialOverlay.tsx
- [ ] mobile/src/components/ui/WalletBadge.tsx
- [ ] mobile/src/components/ui/index.ts
- [ ] mobile/src/constants/theme.ts
- [ ] mobile/src/context/AuthContext.tsx
- [ ] mobile/src/context/WebSocketContext.tsx
- [ ] mobile/src/context/index.ts
- [ ] mobile/src/hooks/index.ts
- [ ] mobile/src/hooks/useAppState.ts
- [ ] mobile/src/hooks/useChipBetting.ts
- [ ] mobile/src/hooks/useGameConnection.ts
- [ ] mobile/src/hooks/useGatewaySession.ts
- [ ] mobile/src/hooks/useKeyboardControls.ts
- [ ] mobile/src/hooks/useModalBackHandler.ts
- [ ] mobile/src/hooks/useWebSocketReconnectOnForeground.ts
- [ ] mobile/src/hooks/useWeeklyEvent.ts
- [ ] mobile/src/navigation/RootNavigator.tsx
- [ ] mobile/src/navigation/index.ts
- [ ] mobile/src/navigation/types.ts
- [ ] mobile/src/screens/AuthScreen.tsx
- [ ] mobile/src/screens/GameScreen.tsx
- [ ] mobile/src/screens/LobbyScreen.tsx
- [ ] mobile/src/screens/SplashScreen.tsx
- [ ] mobile/src/screens/VaultScreen.tsx
- [ ] mobile/src/screens/games/BaccaratScreen.tsx
- [ ] mobile/src/screens/games/BlackjackScreen.tsx
- [ ] mobile/src/screens/games/CasinoWarScreen.tsx
- [ ] mobile/src/screens/games/CrapsScreen.tsx
- [ ] mobile/src/screens/games/HiLoScreen.tsx
- [ ] mobile/src/screens/games/RouletteScreen.tsx
- [ ] mobile/src/screens/games/SicBoScreen.tsx
- [ ] mobile/src/screens/games/ThreeCardPokerScreen.tsx
- [ ] mobile/src/screens/games/UltimateTXHoldemScreen.tsx
- [ ] mobile/src/screens/games/VideoPokerScreen.tsx
- [ ] mobile/src/screens/games/index.ts
- [ ] mobile/src/screens/index.ts
- [ ] mobile/src/services/**tests**/vault.test.ts
- [ ] mobile/src/services/auth.ts
- [ ] mobile/src/services/crypto.ts
- [ ] mobile/src/services/haptics.ts
- [ ] mobile/src/services/index.ts
- [ ] mobile/src/services/notifications.ts
- [ ] mobile/src/services/storage.ts
- [ ] mobile/src/services/vault.ts
- [ ] mobile/src/services/websocket.ts
- [ ] mobile/src/stores/gameStore.ts
- [ ] mobile/src/stores/index.ts
- [ ] mobile/src/types/index.ts
- [ ] mobile/src/utils/**tests**/numbers.test.ts
- [ ] mobile/src/utils/cards.ts
- [ ] mobile/src/utils/dice.ts
- [ ] mobile/src/utils/hex.ts
- [ ] mobile/src/utils/index.ts
- [ ] mobile/src/utils/network.ts
- [ ] mobile/src/utils/numbers.ts
- [ ] mobile/src/utils/state/baccarat.ts
- [ ] mobile/src/utils/state/blackjack.ts
- [ ] mobile/src/utils/state/casinoWar.ts
- [ ] mobile/src/utils/state/craps.ts
- [ ] mobile/src/utils/state/hilo.ts
- [ ] mobile/src/utils/state/index.ts
- [ ] mobile/src/utils/state/roulette.ts
- [ ] mobile/src/utils/state/shared.ts
- [ ] mobile/src/utils/state/sicbo.ts
- [ ] mobile/src/utils/state/threeCard.ts
- [ ] mobile/src/utils/state/ultimateHoldem.ts
- [ ] mobile/src/utils/state/videoPoker.ts
- [ ] mobile/src/utils/stateBytes.ts
- [ ] mobile/tsconfig.json

#### packages/

- [ ] packages/design-tokens/package.json
- [ ] packages/design-tokens/src/animations.ts
- [ ] packages/design-tokens/src/colors.ts
- [ ] packages/design-tokens/src/index.ts
- [ ] packages/design-tokens/src/shadows.ts
- [ ] packages/design-tokens/src/spacing.ts
- [ ] packages/design-tokens/src/typography.ts
- [ ] packages/design-tokens/test/tokens.test.ts
- [ ] packages/design-tokens/tsconfig.build.json
- [ ] packages/design-tokens/tsconfig.json
- [ ] packages/design-tokens/vitest.config.ts

#### website/

- [ ] website/.env.example
- [ ] website/.env.production.example
- [ ] website/.env.staging.example
- [ ] website/Dockerfile
- [ ] website/convex.json
- [ ] website/convex/\_generated/api.d.ts
- [ ] website/convex/\_generated/api.js
- [ ] website/convex/\_generated/dataModel.d.ts
- [ ] website/convex/\_generated/server.d.ts
- [ ] website/convex/\_generated/server.js
- [ ] website/convex/admin.ts
- [ ] website/convex/auth.ts
- [ ] website/convex/cron.ts
- [ ] website/convex/entitlements.ts
- [ ] website/convex/evm.ts
- [ ] website/convex/http.ts
- [ ] website/convex/maintenance.ts
- [ ] website/convex/schema.ts
- [ ] website/convex/serviceAuth.ts
- [ ] website/convex/stripe.ts
- [ ] website/convex/stripeStore.ts
- [ ] website/convex/tsconfig.json
- [ ] website/convex/users.ts
- [ ] website/favicon.ico
- [ ] website/index.html
- [ ] website/latency-results.json
- [ ] website/nginx.conf
- [ ] website/nginx.ssl.conf
- [ ] website/package-lock.json
- [ ] website/package.json
- [ ] website/plans/fix-mobile-bet-type-mappings.md
- [ ] website/pnpm-lock.yaml
- [ ] website/postcss.config.js
- [ ] website/preview.png
- [ ] website/public/\_headers
- [ ] website/public/economy_log.json
- [ ] website/scripts/create-stripe-membership.mjs
- [ ] website/scripts/debug-chain.mjs
- [ ] website/scripts/e2e-auth-billing.mjs
- [ ] website/scripts/export-evm-links.mjs
- [ ] website/scripts/latency-test.mjs
- [ ] website/scripts/layout-smoke.mjs
- [ ] website/scripts/mobile-test-running.mjs
- [ ] website/scripts/qa-bet-suite.mjs
- [ ] website/scripts/setup-webkit-libs.sh
- [ ] website/scripts/smoke-playwright.mjs
- [ ] website/src/App.jsx
- [ ] website/src/BridgeApp.tsx
- [ ] website/src/CasinoApp.tsx
- [ ] website/src/EconomyApp.tsx
- [ ] website/src/LegacyLiquidityApp.tsx
- [ ] website/src/LegacyStakingApp.tsx
- [ ] website/src/LiquidityApp.tsx
- [ ] website/src/SecurityApp.tsx
- [ ] website/src/StakingApp.tsx
- [ ] website/src/api/client.js
- [ ] website/src/api/explorerClient.ts
- [ ] website/src/api/nonceManager.js
- [ ] website/src/api/wasm.js
- [ ] website/src/chain/CasinoConnectionContext.tsx
- [ ] website/src/components/AppLayout.jsx
- [ ] website/src/components/AuthStatusPill.tsx
- [ ] website/src/components/BottomNav.tsx
- [ ] website/src/components/ChainConnectionLayout.tsx
- [ ] website/src/components/ConnectionStatus.tsx
- [ ] website/src/components/EconomyDashboard.jsx
- [ ] website/src/components/ErrorBoundary.tsx
- [ ] website/src/components/EventExplorer.jsx
- [ ] website/src/components/GameTables.jsx
- [ ] website/src/components/LoadingScreen.jsx
- [ ] website/src/components/MaintenancePage.css
- [ ] website/src/components/MaintenancePage.jsx
- [ ] website/src/components/PageHeader.tsx
- [ ] website/src/components/PlaySwapStakeTabs.tsx
- [ ] website/src/components/RetroBox.jsx
- [ ] website/src/components/RetroText.jsx
- [ ] website/src/components/StatsCard.jsx
- [ ] website/src/components/WalletPill.tsx
- [ ] website/src/components/casino/ActiveGame.tsx
- [ ] website/src/components/casino/BigWinEffect.tsx
- [ ] website/src/components/casino/GameComponents.tsx
- [ ] website/src/components/casino/GameControlBar.tsx
- [ ] website/src/components/casino/HamburgerMenu.tsx
- [ ] website/src/components/casino/Layout.tsx
- [ ] website/src/components/casino/MobileChipSelector.tsx
- [ ] website/src/components/casino/MobileDrawer.tsx
- [ ] website/src/components/casino/ModeSelectView.tsx
- [ ] website/src/components/casino/QABetHarness.tsx
- [ ] website/src/components/casino/RegistrationView.tsx
- [ ] website/src/components/casino/RewardsDrawer.tsx
- [ ] website/src/components/casino/games/BaccaratView.tsx
- [ ] website/src/components/casino/games/BlackjackView.tsx
- [ ] website/src/components/casino/games/CrapsBetMenu.tsx
- [ ] website/src/components/casino/games/CrapsBonusDashboard.tsx
- [ ] website/src/components/casino/games/CrapsView.tsx
- [ ] website/src/components/casino/games/GenericGameView.tsx
- [ ] website/src/components/casino/games/HiLoView.tsx
- [ ] website/src/components/casino/games/RouletteView.tsx
- [ ] website/src/components/casino/games/SicBoView.tsx
- [ ] website/src/components/casino/games/SideBetMenu.tsx
- [ ] website/src/components/casino/games/ThreeCardPokerView.tsx
- [ ] website/src/components/casino/games/UltimateHoldemView.tsx
- [ ] website/src/components/casino/games/VideoPokerView.tsx
- [ ] website/src/components/casino/legacy/3d/ChipStack3D.tsx
- [ ] website/src/components/casino/pseudo3d/Pseudo3DCard.tsx
- [ ] website/src/components/casino/pseudo3d/Pseudo3DChip.tsx
- [ ] website/src/components/casino/pseudo3d/Pseudo3DDice.tsx
- [ ] website/src/components/casino/pseudo3d/Pseudo3DWheel.tsx
- [ ] website/src/components/casino/shared/BetItem.tsx
- [ ] website/src/components/casino/shared/BetSlip.tsx
- [ ] website/src/components/casino/shared/BetsSidebar.tsx
- [ ] website/src/components/casino/shared/EventChip.tsx
- [ ] website/src/components/casino/shared/index.ts
- [ ] website/src/components/casino/ui/Label.tsx
- [ ] website/src/components/charts/CollateralChart.jsx
- [ ] website/src/components/charts/ErrorChart.jsx
- [ ] website/src/components/charts/IssuanceChart.jsx
- [ ] website/src/components/charts/PnLChart.jsx
- [ ] website/src/components/charts/PoolHealthChart.jsx
- [ ] website/src/components/charts/RoleVolumeChart.jsx
- [ ] website/src/components/charts/SupplyChart.jsx
- [ ] website/src/components/economy/BorrowPanel.tsx
- [ ] website/src/components/economy/LiquidityPanel.tsx
- [ ] website/src/components/economy/SwapPanel.tsx
- [ ] website/src/components/staking/StakeFlow.tsx
- [ ] website/src/components/staking/StakingAdvanced.tsx
- [ ] website/src/components/staking/StakingDashboard.tsx
- [ ] website/src/components/ui/ConfirmModal.tsx
- [ ] website/src/components/ui/ThemeToggle.tsx
- [ ] website/src/components/ui/ToastHost.tsx
- [ ] website/src/explorer/AccountPage.jsx
- [ ] website/src/explorer/BlockDetailPage.jsx
- [ ] website/src/explorer/BlocksPage.jsx
- [ ] website/src/explorer/ExplorerLayout.jsx
- [ ] website/src/explorer/TokensPage.jsx
- [ ] website/src/explorer/TxDetailPage.jsx
- [ ] website/src/hooks/games/crapsHelpers.ts
- [ ] website/src/hooks/games/useBaccarat.ts
- [ ] website/src/hooks/games/useBlackjack.ts
- [ ] website/src/hooks/games/useCasinoWar.ts
- [ ] website/src/hooks/games/useCraps.ts
- [ ] website/src/hooks/games/useHiLo.ts
- [ ] website/src/hooks/games/useRoulette.ts
- [ ] website/src/hooks/games/useSicBo.ts
- [ ] website/src/hooks/games/useThreeCardPoker.ts
- [ ] website/src/hooks/games/useUltimateHoldem.ts
- [ ] website/src/hooks/games/useVideoPoker.ts
- [ ] website/src/hooks/terminalGame/actions/useBetControls.ts
- [ ] website/src/hooks/terminalGame/actions/useDeal.ts
- [ ] website/src/hooks/terminalGame/actions/useStartGame.ts
- [ ] website/src/hooks/terminalGame/actions/useTournamentActions.ts
- [ ] website/src/hooks/terminalGame/autoPlay.ts
- [ ] website/src/hooks/terminalGame/chainEvents/handleGameCompleted.ts
- [ ] website/src/hooks/terminalGame/chainEvents/handleGameMoved.ts
- [ ] website/src/hooks/terminalGame/chainEvents/handleGameStarted.ts
- [ ] website/src/hooks/terminalGame/constants.ts
- [ ] website/src/hooks/terminalGame/freeroll.ts
- [ ] website/src/hooks/terminalGame/generateGameResult.ts
- [ ] website/src/hooks/terminalGame/initialState.ts
- [ ] website/src/hooks/terminalGame/leaderboard.ts
- [ ] website/src/hooks/terminalGame/useBotManager.ts
- [ ] website/src/hooks/terminalGame/useChainEvents.ts
- [ ] website/src/hooks/terminalGame/useChainInit.ts
- [ ] website/src/hooks/terminalGame/useChainTimeouts.ts
- [ ] website/src/hooks/terminalGame/useFreerollScheduler.ts
- [ ] website/src/hooks/terminalGame/useGameActions.ts
- [ ] website/src/hooks/terminalGame/useTerminalGameState.ts
- [ ] website/src/hooks/useActivityFeed.ts
- [ ] website/src/hooks/useAuthSession.ts
- [ ] website/src/hooks/useCasinoConnection.ts
- [ ] website/src/hooks/useChainService.ts
- [ ] website/src/hooks/useGameState.ts
- [ ] website/src/hooks/useKeyboardControls.ts
- [ ] website/src/hooks/usePasskeyAuth.ts
- [ ] website/src/hooks/useTerminalGame.ts
- [ ] website/src/hooks/useTheme.tsx
- [ ] website/src/hooks/useWeeklyEvent.ts
- [ ] website/src/index.css
- [ ] website/src/main.jsx
- [ ] website/src/security/VaultBetBot.ts
- [ ] website/src/security/authSigning.ts
- [ ] website/src/security/base64url.ts
- [ ] website/src/security/keyVault.test.ts
- [ ] website/src/security/keyVault.ts
- [ ] website/src/security/vaultRuntime.ts
- [ ] website/src/services/BotService.ts
- [ ] website/src/services/CasinoChainService.serializers.js
- [ ] website/src/services/CasinoChainService.ts
- [ ] website/src/services/authClient.ts
- [ ] website/src/services/evmWallet.ts
- [ ] website/src/services/featureFlags.ts
- [ ] website/src/services/games/**tests**/game-state.test.ts
- [ ] website/src/services/games/**tests**/serialization.test.ts
- [ ] website/src/services/games/constants.ts
- [ ] website/src/services/games/crapsLogs.ts
- [ ] website/src/services/games/index.ts
- [ ] website/src/services/games/mapping.ts
- [ ] website/src/services/games/refs.ts
- [ ] website/src/services/games/serialization.ts
- [ ] website/src/services/games/shared/cards.ts
- [ ] website/src/services/games/state/applyGameState.ts
- [ ] website/src/services/games/state/baccarat.ts
- [ ] website/src/services/games/state/blackjack.ts
- [ ] website/src/services/games/state/casinoWar.ts
- [ ] website/src/services/games/state/craps.ts
- [ ] website/src/services/games/state/hilo.ts
- [ ] website/src/services/games/state/roulette.ts
- [ ] website/src/services/games/state/sicbo.ts
- [ ] website/src/services/games/state/threeCard.ts
- [ ] website/src/services/games/state/types.ts
- [ ] website/src/services/games/state/ultimateHoldem.ts
- [ ] website/src/services/games/state/videoPoker.ts
- [ ] website/src/services/games/validation.ts
- [ ] website/src/services/geminiService.ts
- [ ] website/src/services/membershipConfig.ts
- [ ] website/src/services/sfx.ts
- [ ] website/src/services/telemetry.ts
- [ ] website/src/services/toasts.ts
- [ ] website/src/services/txTracker.d.ts
- [ ] website/src/services/txTracker.js
- [ ] website/src/types.ts
- [ ] website/src/utils/**tests**/caseNormalizer.test.ts
- [ ] website/src/utils/**tests**/gameUtils.parity.test.ts
- [ ] website/src/utils/ammQuote.js
- [ ] website/src/utils/amounts.js
- [ ] website/src/utils/bip39.txt
- [ ] website/src/utils/caseNormalizer.js
- [ ] website/src/utils/caseNormalizer.ts
- [ ] website/src/utils/chartHelpers.js
- [ ] website/src/utils/chartHelpers.test.js
- [ ] website/src/utils/gameUtils.ts
- [ ] website/src/utils/logger.js
- [ ] website/src/utils/logger.ts
- [ ] website/src/utils/motion.ts
- [ ] website/src/utils/time.ts
- [ ] website/src/vite-env.d.ts
- [ ] website/tailwind.config.js
- [ ] website/tests/integration/CasinoChainService.test.js
- [ ] website/tests/integration/ammQuote.test.js
- [ ] website/tests/integration/client.test.js
- [ ] website/tests/integration/nonceManager.test.js
- [ ] website/tests/integration/txTracker.test.js
- [ ] website/tsconfig.json
- [ ] website/vite.config.js
- [ ] website/vitest.config.ts
- [ ] website/wasm/Cargo.toml
- [ ] website/wasm/LICENSE-APACHE
- [ ] website/wasm/LICENSE-MIT
- [ ] website/wasm/src/lib.rs

### Phase 7: Ops, Config & Tooling (69 files)

Learn how the system is built, deployed, configured, and monitored in testnet environments.

#### Root build/tooling

- [ ] package.json
- [ ] pnpm-workspace.yaml
- [ ] .npmrc
- [ ] turbo.json
- [ ] Cargo.toml
- [ ] Dockerfile
- [x] .dockerignore
- [ ] .gitignore
- [ ] .gitleaks.toml
- [ ] .pre-commit-config.yaml
- [ ] codecov.yml

#### .gemini/

- [ ] .gemini/settings.json

#### .github/

- [ ] .github/actions/setup/action.yml
- [ ] .github/workflows/coverage.yml
- [ ] .github/workflows/publish.yml
- [ ] .github/workflows/tests.yml
- [ ] .github/workflows/types.yml

#### configs/

- [ ] configs/local/.env.local.example
- [ ] configs/local/node.yaml.example
- [ ] configs/local/peers.yaml.example
- [ ] configs/production/README.md
- [ ] configs/production/gateway.env.example
- [ ] configs/production/node.env.example
- [ ] configs/production/simulator.env.example
- [ ] configs/staging/README.md
- [ ] configs/staging/gateway.env.example
- [ ] configs/staging/node.env.example
- [ ] configs/staging/simulator.env.example
- [ ] configs/testnet/hosts.yaml.example
- [ ] configs/testnet/peers.yaml.example

#### docker/

- [ ] docker/convex/.env.example
- [ ] docker/convex/docker-compose.yml
- [ ] docker/observability/alertmanager.yml
- [ ] docker/observability/alerts.yml
- [ ] docker/observability/docker-compose.yml
- [ ] docker/observability/grafana/dashboards/nullspace-slo.json
- [ ] docker/observability/grafana/provisioning/dashboards/dashboards.yml
- [ ] docker/observability/grafana/provisioning/datasources/datasource.yml
- [ ] docker/observability/loki.yml
- [ ] docker/observability/prometheus.yml
- [ ] docker/observability/promtail.yml

#### ops/

- [ ] ops/systemd/README.md
- [ ] ops/systemd/nullspace-auth.service
- [ ] ops/systemd/nullspace-gateway.service
- [ ] ops/systemd/nullspace-node.service
- [ ] ops/systemd/nullspace-simulator.service
- [ ] ops/systemd/nullspace-website.service

#### packages/

- [ ] packages/tsconfig/base.json
- [ ] packages/tsconfig/node.json
- [ ] packages/tsconfig/package.json
- [ ] packages/tsconfig/react-native.json
- [ ] packages/tsconfig/react.json

#### scripts/

- [ ] scripts/bootstrap-testnet.sh
- [ ] scripts/check-no-panics.sh
- [ ] scripts/diagnose-chain-latency.ts
- [ ] scripts/e2e-auth-billing-local.sh
- [ ] scripts/generate-admin-key.sh
- [ ] scripts/load-test.sh
- [ ] scripts/phase-sim.sh
- [ ] scripts/phase2-e2e-sim.sh
- [ ] scripts/prune-dev-artifacts.sh
- [ ] scripts/prune-node-data.sh
- [ ] scripts/run-bots.sh
- [ ] scripts/run-tournament-scheduler.sh
- [ ] scripts/soak-test.sh
- [ ] scripts/start-local-network.sh
- [ ] scripts/start-network.sh
- [ ] scripts/start.py
- [ ] scripts/testnet-local-runbook.sh

### Phase 8: Assets & Legal (quick pass) (13 files)

Review non-code artifacts for provenance and relevance.

#### Root assets

- [ ] LICENSE-APACHE
- [ ] LICENSE-MIT
- [ ] left-die.png
- [ ] left-die-boost.png
- [ ] right-die.png
- [ ] right-die-boost.png

#### Root misc

- [ ] AGENTS.md
- [ ] Untitled
- [ ] convex.txt
- [ ] restart.log
- [ ] website.log
- [ ] website_direct.log
