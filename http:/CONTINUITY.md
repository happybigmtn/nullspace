Goal (incl. success criteria):
- Start Phase 7 (Game Shows) by shipping Lightning Roulette visuals + data wiring; then proceed to Football Studio and Dream Catcher.

Constraints/Assumptions:
- Follow `agents.md` guidance: read/update this ledger at start of each turn and whenever goal/state/decisions change; keep it brief and factual.
- Default ASCII edits; avoid destructive commands.
- Must be deliberate about tracking progress through each stage in `4d.md`.

Key decisions:
- None yet (pending scope/ordering based on `4d.md` stages).

State:
- Phase 1 complete; Phase 2 complete (roulette/dice physics guidance, colliders, shooter arm, pyramid wall).
- Phase 3 complete (card pool/deal/peek system integrated and tested).

Done:
- Read `agents.md` and `4d.md`.
- Added `zustand` dependency for GuidedStore usage.
- Seeded RNG for roulette/craps/sic bo launches; passed round IDs through wrappers/views.
- Committed and pushed all repo changes.
- Added Vitest runner and guided forces unit tests.
- Added roulette physics tests and aligned dice guidance with attractor config/physics constants.
- Added card pool manager, deal/peek animation helpers, integrated into CardTableScene3D with tests.
- Added lighting rig presets and wired them into casino scenes with post-processing exposure.
- Added LightningEffect and SqueezeCard shader components.
- Ran `npm run test:unit` and `npm test`.
- Committed and pushed Phase 4 lighting/shader updates.
- Created AudioManager and procedural sound generators.
- Added CollisionSound, PositionalAudioEmitter, and AmbientSoundscape components.
- Ran `npm run test:unit`.
- Synced AudioManager with sound toggle.
- Wired ambient soundscapes into roulette/craps/sic bo scenes.
- Added collision audio to physics dice.
- Ran `npm run test:unit` after audio integration.
- Added positional audio emitters for dice and roulette ball.
- Wired GuidedStore actions for chain outcomes, skip requests, and animation blocking.
- Ran `npm run test:unit` and `npm test`.
- Committed and pushed positional audio + guided store wiring.
- Added dev-only performance overlay for 3D scenes.
- Tuned mobile physics settings for lighter simulation.
- Wired GuidedStore for blackjack/baccarat card animations (blocking/skip/outcomes).
- Ran `npm run test:unit` and `npm test`.
- Added telemetry tracking for 3D toggles/animation starts/skips.
- Ran `npm run test:unit` and `npm test` (from `website/`).
- Wired Lightning Roulette multipliers from `superMode` into roulette 3D scene.
- Added Lightning Roulette multiplier badges + lightning overlay effect in RouletteScene3D.
- Ran `npm run test:unit` and `npm test` (from `website/`).
- Added `sessionId` + `moveNumber` to `GameState`, wired round ID derivation for all card games/overlays.
- Added baccarat squeeze shader integration and card reveal handling.
- Added Casino War outcome lighting + trend display and 3D chip stack instancing.
- Added physics worker scaffold and deterministic replay harness + tests.
- Added performance sampler, 3D A/B default, and feedback prompts for 3D scenes.
- Added QA checklist doc for guided 3D regression coverage.
- Ran `npm run test:unit` and `npm test` (from `website/`).

Now:
- Phase 7 prep complete: 4d.md gap coverage addressed and tests run.

Next:
- Resume Phase 7 with Football Studio and Dream Catcher scaffolding.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- http://CONTINUITY.md
- 4d.md
- website/src/components/casino/3d/CardAnimationOverlay.tsx
- website/src/components/casino/3d/CardTableScene3D.tsx
- website/src/components/casino/3d/PerformanceSampler.tsx
- website/src/components/casino/3d/RouletteWheel3DWrapper.tsx
- website/src/components/casino/3d/CrapsDice3DWrapper.tsx
- website/src/components/casino/3d/SicBoDice3DWrapper.tsx
- website/src/components/casino/3d/RouletteScene3D.tsx
- website/src/components/casino/3d/CrapsScene3D.tsx
- website/src/components/casino/3d/SicBoScene3D.tsx
- website/src/components/casino/3d/BaccaratScene3D.tsx
- website/src/components/casino/3d/cards/SqueezeCard3D.tsx
- website/src/components/casino/3d/chips/ChipStack3D.tsx
- website/src/components/casino/3d/physics/PhysicsWorkerBridge.ts
- website/src/components/casino/3d/engine/replayHarness.ts
- website/src/components/casino/3d/use3DFeedbackPrompt.ts
- website/src/components/casino/games/GenericGameView.tsx
- website/docs/guided-3d-qa.md
