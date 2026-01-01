# Review Issues Log

This file tracks cumulative issues or potential improvements discovered during the walkthrough.
Each entry captures the file, issue, impact, and any suggested action.

## Open Issues
- packages/protocol/src/encode.ts: `encodeGameStart` is labeled as a placeholder and uses little-endian for amounts while other encoders use big-endian; if consumers call this, it likely won’t match the Rust protocol. Suggest either implement the real spec or remove from the public API until ready.
- evm/src/abis/*.js: ABIs are hand-maintained; potential for drift from deployed contracts. Suggest generating from Hardhat artifacts or TypeChain output and importing from a single source.
- execution/src/casino/super_mode.rs: uses `f32` probabilities in consensus-critical RNG paths; likely deterministic but still float-based. Consider replacing with integer-threshold sampling to eliminate any cross-platform float variance risk.
- gateway/src/codec/instructions.ts: legacy payload builders duplicate newer protocol encoders and are now unused internally; consider deprecating/removing or delegating to protocol encoders to reduce drift.
- packages/protocol/src/schema/mobile.ts: some bet schemas still accept arbitrary strings (roulette/craps/sic bo); consider tightening to enums based on `@nullspace/constants` so invalid bet types are rejected at validation time instead of at encode-time.
- evm/scripts/*: mixed CJS/ESM scripts still require interop; consider standardizing module format and adding typed config validation (zod) to reduce runtime env parsing drift.

## Resolved
- evm/scripts/*: duplicated env parsing and bidder key helpers now live in `evm/src/utils` and are shared across scripts.
