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
//!
//! ## Minimal execution pipeline (example)
//! ```rust,ignore
//! # #[cfg(feature = "mocks")]
//! # {
//! use nullspace_execution::state_transition::execute_state_transition;
//! use nullspace_types::{Identity, NAMESPACE};
//! use nullspace_execution::mocks::{create_network_keypair, create_seed};
//!
//! # async fn example(
//! #     state: &mut /* Adb<...> */ (),
//! #     events: &mut /* keyless::Keyless<...> */ (),
//! #     identity: Identity,
//! # ) -> anyhow::Result<()> {
//! // 1) Load or initialize `state` and `events` storage.
//! // 2) Execute the next block (height must be exactly `state_height + 1`).
//! // For tests, you can derive a seed using the mocks helper (requires `mocks` feature).
//! let (network_secret, _network_public) = create_network_keypair();
//! let seed = create_seed(&network_secret, 1);
//! let _result = execute_state_transition(
//!     state,
//!     events,
//!     identity,
//!     /* height */ 1,
//!     /* seed */ seed,
//!     /* transactions */ vec![],
//!     // (optional) thread pool when the `parallel` feature is enabled
//! )
//! .await?;
//! # Ok(())
//! # }
//! # }
//! ```

pub(crate) mod casino;
pub mod state_transition;

#[cfg(any(test, feature = "mocks"))]
pub mod mocks;

#[cfg(test)]
mod fixed;

mod layer;

mod state;

pub use layer::Layer;
pub use state::{nonce, Adb, Noncer, PrepareError, State, Status};

#[cfg(any(test, feature = "mocks"))]
pub use state::Memory;
