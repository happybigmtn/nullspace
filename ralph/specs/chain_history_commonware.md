# Chain History and State Persistence (Commonware Aligned)

**Status**: Draft
**Last Updated**: 2026-01-16
**Related**: `IMPLEMENTATION_PLAN.md` M5

## Overview

This spec defines the block header, block body, and receipts root structures for CodexPoker's chain history. These structures are designed to integrate with Commonware's simplex consensus while maintaining deterministic replay and verifiable state transitions.

## Requirements

### R1: Block Structure
- Block headers contain a receipts root committing to all transaction outcomes in the block
- Block bodies contain the ordered list of consensus payloads
- Headers and bodies are separable for light client verification

### R2: Deterministic Replay
- Given the same block sequence, all validators compute identical state roots
- Receipts root is computed deterministically from payload execution outcomes

### R3: State Persistence
- Blocks, headers, and receipts can be persisted to disk
- State can be reconstructed from persisted blocks on restart
- Finalization markers are persisted for crash recovery

### R4: Receipts
- Each consensus payload produces a receipt indicating success/failure
- Receipts capture the state root after payload application
- Receipts are merkleized into the receipts root

## Data Structures

### BlockHeader

```rust
pub struct BlockHeader {
    /// Protocol version for this block format.
    pub version: ProtocolVersion,
    /// Block height (0-indexed).
    pub height: u64,
    /// Hash of the parent block header (zero for genesis).
    pub parent_hash: [u8; 32],
    /// Merkle root of the receipts in this block.
    pub receipts_root: [u8; 32],
    /// State root after applying all payloads in this block.
    pub state_root: [u8; 32],
    /// Unix timestamp (milliseconds) when block was proposed.
    pub timestamp_ms: u64,
    /// Proposer identifier (public key or seat index).
    pub proposer: [u8; 32],
}
```

### BlockBody

```rust
pub struct BlockBody {
    /// Ordered list of consensus payloads in this block.
    pub payloads: Vec<ConsensusPayload>,
}
```

### Block

```rust
pub struct Block {
    pub header: BlockHeader,
    pub body: BlockBody,
}
```

### Receipt

```rust
pub struct Receipt {
    /// Hash of the payload this receipt is for.
    pub payload_hash: [u8; 32],
    /// Whether the payload was successfully applied.
    pub success: bool,
    /// State root after applying this payload.
    pub post_state_root: [u8; 32],
    /// Optional error message if success is false.
    pub error: Option<String>,
}
```

## Hashing

All structures follow the existing `blake3(encode(preimage))` pattern with domain separation:

- `b"nullspace.block_header.v1"` for block headers
- `b"nullspace.block_body.v1"` for block bodies
- `b"nullspace.receipt.v1"` for receipts

## Receipts Root Computation

The receipts root is computed as:

1. For each payload in the block body, compute `Receipt`
2. Compute `receipt_hash = blake3(receipt.preimage())` for each
3. Merkleize the receipt hashes (or use simple linear hash for initial implementation)
4. The merkle root is the `receipts_root`

For the initial implementation, a simple linear hash chain suffices:

```
receipts_root = hash(receipt_0 || hash(receipt_1 || hash(receipt_2 || ... || hash(receipt_n || [0; 32]))))
```

## Integration with Commonware

The block header maps to Commonware's consensus digest:

1. `simplex::Automaton::propose()` generates a `BlockBody`
2. The proposer computes the header with receipts root
3. `simplex::Automaton::verify()` validates header/body consistency
4. Finalized blocks are persisted with their certificates

## Exit Criteria

- [x] Block header struct with receipts root field
- [x] Block body struct with payloads
- [x] Receipt struct with post-state root
- [ ] Deterministic preimage/hash methods
- [ ] Round-trip serialization tests
- [ ] Hash stability tests
