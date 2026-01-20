# Compact Game Encoding Framework (Bitwise, Rust-Canonical)

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Compact, bitwise encoding for all casino game move payloads and on-chain state blobs. Rust is the canonical source, JS/TS consumes generated artifacts.

This spec is inspired by robopoker's bitwise encoding style (see `/home/r/Coding/poker/src/gameplay/action.rs`, `.../path.rs`, `.../cards/card.rs`) and addresses protocol drift and inconsistent bet formats across games.

## 1. Goals

1. **Compact on-chain footprint**: Reduce move payload and state blob size by at least 40% on average without removing functionality.
2. **Unified bet encoding**: Use a single bet descriptor schema across table games (roulette, craps, sic bo, baccarat) to eliminate inconsistent formats.
3. **Rust-canonical codec**: Rust defines bit layouts, limits, and versioning. JS/TS uses generated bindings or WASM.
4. **Deterministic parsing**: All decoding is deterministic with explicit version handling and bounded lengths.
5. **Protocol drift elimination**: Golden vectors are generated from Rust and validated in JS/TS and gateway.

## 2. Non-Goals

- Changing game rules or payout logic.
- Removing existing UI features or side bets.
- Introducing new game types.
- Forcing backward compatibility forever (v1 supported only during migration).

## 3. Architecture

### 3.1 Canonical Bit Writer/Reader

Introduce `BitWriter` / `BitReader` in Rust (in `types` or `execution::casino::codec`) with:
- Explicit bit order (LSB-first within a byte, byte order little-endian) OR MSB-first if chosen globally.
- Checked bounds and max-length guards.
- Deterministic varint decoding (ULEB128) for amounts.

### 3.2 Common Envelope (Move Payload)

All game move payloads use a compact envelope:

- **Header bits** (8 bits total):
  - `version` (3 bits, 0-7)
  - `opcode` (5 bits, 0-31)

This fits into 1 byte and leaves opcode room for all current games.

### 3.3 Unified Bet Descriptor

Define a shared bet descriptor for all table games:

- `bet_type` (N bits, per game)
- `target` (M bits, per game; omitted when not required)
- `amount` (ULEB128 varint)

Each game defines `bet_type` and `target` bit widths based on enum ranges and validation rules.

### 3.4 Amount Encoding

Use **ULEB128** for `amount` (unsigned). Typical bets fit in 1-2 bytes. This is bitwise-compact and deterministic.

### 3.5 Dual Decode Migration

- Rust decoders accept **v1** (current byte format) and **v2** (bitwise compact) for a transition window.
- Gateway strips version headers only for v1. v2 is passed through as-is.
- Golden vectors include both v1 and v2 until v1 is fully retired.

## 4. Testing Requirements

### 4.1 Golden Vectors
- Rust generates `golden-vectors-v2.json` with move payloads and state blob snapshots.
- JS/TS tests validate v2 vectors and round-trip encode/decode.

### 4.2 Cross-Language Parity
- For each game: `encode -> decode` parity tests in Rust, JS, and gateway.
- Ensure `stripVersionHeader` paths are not applied to v2 payloads.

### 4.3 Size Benchmarks
- Add size regression tests: average payload size reduction >= 40%.
- State blob size reduction >= 30% for roulette/craps/sicbo histories.

## 5. Acceptance Criteria

### AC-1: Size Reduction
- **AC-1.1**: Average move payload size is reduced by >= 40% vs v1.
- **AC-1.2**: State blobs for table games are reduced by >= 30% without losing fields.

### AC-2: Unified Bet Encoding
- **AC-2.1**: Roulette/Craps/SicBo/Baccarat share the same bet descriptor structure.
- **AC-2.2**: No game uses bespoke bet payloads outside the shared descriptor.

### AC-3: Canonical Codec
- **AC-3.1**: Rust defines all bit layouts and versioning.
- **AC-3.2**: JS/TS uses Rust-derived artifacts (generated or WASM).

### AC-4: Compatibility
- **AC-4.1**: v1 and v2 are both accepted during migration with explicit version checks.
- **AC-4.2**: Golden vector parity tests pass for all games.

## 6. Implementation Map

- Bit codec core: `types/src/casino/codec.rs` (new) or `execution/src/casino/codec.rs`.
- Game-specific encoding: `execution/src/casino/*.rs` and `packages/protocol/src/games/*` (generated wrappers).
- JS/TS generation: `types/src/bin/export_ts.rs` or WASM build in `website/wasm`.
- Gateway: `gateway/src/handlers/base.ts` (strip v1 only; pass v2 raw).
- Golden vectors: `packages/protocol/test/fixtures/golden-vectors.json` (add v2 set).
