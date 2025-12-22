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

Now:
- Phase 7 in progress: Lightning Roulette visuals/data wiring complete.

Next:
- Continue Phase 7 with Football Studio and Dream Catcher scaffolding.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- http://CONTINUITY.md
- 4d.md
- website/package.json
- website/package-lock.json
- website/vitest.config.ts
- website/src/components/casino/3d/physics/guidedForces.test.ts
- website/src/components/casino/3d/physics/RoulettePhysics.test.ts
- website/src/components/casino/3d/physics/RoulettePhysics.ts
- website/src/components/casino/3d/RouletteColliders.tsx
- website/src/components/casino/3d/PyramidWallCollider.tsx
- website/src/components/casino/3d/ShooterArm.tsx
- website/src/components/casino/3d/CrapsScene3D.tsx
- website/src/components/casino/3d/SicBoScene3D.tsx
- website/src/components/casino/3d/RouletteScene3D.tsx
- website/src/components/casino/3d/PhysicsDice.tsx
- website/src/components/casino/3d/diceUtils.ts
- website/src/components/casino/3d/CrapsDice3DWrapper.tsx
- website/src/components/casino/3d/SicBoDice3DWrapper.tsx
- website/src/components/casino/games/CrapsView.tsx
- website/src/components/casino/games/SicBoView.tsx
- website/src/components/casino/3d/cards/CardDealAnimation.ts
- website/src/components/casino/3d/cards/CardPeekAnimation.ts
- website/src/components/casino/3d/cards/CardPoolManager.ts
- website/src/components/casino/3d/cards/index.ts
- website/src/components/casino/3d/CardTableScene3D.tsx
