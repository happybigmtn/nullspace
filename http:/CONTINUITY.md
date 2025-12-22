Goal (incl. success criteria):
- Proceed with current uncommitted changes, then finish remaining Phase 2 tasks in `4d.md` with deliberate stage tracking; continue to add/run tests along the way.

Constraints/Assumptions:
- Follow `agents.md` guidance: read/update this ledger at start of each turn and whenever goal/state/decisions change; keep it brief and factual.
- Default ASCII edits; avoid destructive commands.
- Must be deliberate about tracking progress through each stage in `4d.md`.

Key decisions:
- None yet (pending scope/ordering based on `4d.md` stages).

State:
- Phase 1 complete; Phase 2 complete (roulette/dice physics guidance, colliders, shooter arm, pyramid wall).
- Uncommitted changes include Phase 2 refinements + new tests.

Done:
- Read `agents.md` and `4d.md`.
- Added `zustand` dependency for GuidedStore usage.
- Seeded RNG for roulette/craps/sic bo launches; passed round IDs through wrappers/views.
- Committed and pushed all repo changes.
- Added Vitest runner and guided forces unit tests.
- Added roulette physics tests and aligned dice guidance with attractor config/physics constants.

Now:
- Decide whether to commit Phase 2 refinements; ready to start Phase 3 (card system) when requested.

Next:
- Phase 3: implement card pool, deal animation, dealer peek.

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
