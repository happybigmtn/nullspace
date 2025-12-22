# Guided 3D QA Checklist

Use this checklist before shipping changes to guided 3D scenes.

## Determinism + Chain Fidelity
- Round IDs come from chain state for each game (no local RNG outcomes).
- `buildReplayFingerprint` returns the same value on repeated calls for a fixed game + round ID.
- 3D animations wait for chain outcomes, then settle to the provided result.

## Scene Checks (Core Games)
- Roulette: ball spin, settle, and pocket alignment match chain result.
- Craps/Sic Bo: dice settle to chain faces; back wall collisions occur.
- Blackjack/Baccarat: deal order correct; reveal/peek timings consistent.

## Card Visuals
- Squeeze reveal active for Baccarat reveal slots (no flipped card artifacts).
- Card edges remain readable after flips and skips.

## Performance + UX
- 3D toggle persists per game, and A/B default does not override explicit user choice.
- Performance sampler emits `casino.3d.perf_sample` when telemetry is enabled.
- Feedback prompt appears only after multiple animations and dismisses after submit.

## Regression Smoke
- Run `npm run test:unit` and `npm test` in `website/`.
- Confirm no console errors in 3D scenes during a full round.
