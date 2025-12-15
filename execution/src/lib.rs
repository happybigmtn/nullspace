//! Nullspace execution layer.
//!
//! This crate contains the deterministic transaction execution logic (`Layer`) and the
//! game/state machines used by the node and simulator.
//!
//! ## Determinism requirements
//! - Do not use wall-clock time inside execution.
//! - Do not use non-deterministic randomness; only derive randomness from the provided seed/session.
//! - Avoid iteration order of hash-based collections influencing outputs.
//!
//! ## Storage / recovery invariants
//! The execution pipeline assumes event logs may be committed ahead of state. Recovery logic in
//! `state_transition` must be safe to re-run and must converge to the same output.
//!
//! The primary entrypoint is [`Layer`].

pub mod casino;
pub mod state_transition;

#[cfg(any(test, feature = "mocks"))]
pub mod mocks;

#[cfg(test)]
mod fixed;

mod layer;

mod state;

pub use layer::Layer;
pub use state::{nonce, Adb, Memory, Noncer, PrepareError, State, Status};
