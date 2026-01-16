# Codec Consolidation (Rust-Canonical)

## Overview
Make Rust the canonical source of truth for protocol encoding/decoding and remove duplicate codec stacks. JS/TS consumers should use Rust-derived artifacts (WASM or generated types), and the gateway should avoid maintaining a custom decoder. This consolidation must cover the new bitwise compact encodings described in `compact-encoding-framework.md` and per-game specs.

## Acceptance Criteria

### AC-1: Single Source of Truth
- **AC-1.1**: Protocol tags, wire formats, and version constants are defined in Rust and exported to JS/TS.
- **AC-1.2**: No hand-maintained duplicate codec logic remains in the gateway.
 - **AC-1.3**: Bitwise v2 encodings are defined only in Rust, with generated JS/TS bindings.

### AC-2: Gateway Simplification
- **AC-2.1**: Gateway no longer decodes Update payloads with custom parsers.
- **AC-2.2**: Gateway either forwards raw update frames or uses Rust-derived WASM for decoding (not custom TS).

### AC-3: Client Compatibility
- **AC-3.1**: Website and mobile clients continue to encode/decode instructions and updates correctly via Rust-derived artifacts.
- **AC-3.2**: Round-trip tests validate parity between Rust and JS/TS encode/decode.
 - **AC-3.3**: v1 and v2 payloads are both accepted during the migration window.

### AC-4: Performance / Stability
- **AC-4.1**: No >5% regression in encode/decode latency on gateway or client critical paths.
- **AC-4.2**: Golden vectors remain stable across Rust and JS/TS builds.

## Technical Details
- Extend `types`/`protocol` export tooling to generate JS/TS definitions from Rust (or expose WASM functions).
- Remove `gateway/src/codec/events.ts` and associated fallback parsing logic once consumers use Rust-derived decoding.
- Update `@nullspace/protocol` to be generated or a thin wrapper around WASM.
- Align `CURRENT_PROTOCOL_VERSION` and related constants with Rust exports.
 - Add Rust-owned golden vector generation for v2 compact payloads and state blobs.

## Examples
- A `CasinoGameMoved` event encoded in Rust is decoded identically in web and mobile through Rust-derived bindings.
- Gateway forwards update frames without custom parsing but still provides the same external behavior.
