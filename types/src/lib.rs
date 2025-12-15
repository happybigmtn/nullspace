//! Shared schema types for Nullspace.
//!
//! This crate defines the wire and state schema used across the workspace (`api`, `casino`,
//! `execution`, `token`) and re-exports it as a single public surface.
//!
//! By default, items are also re-exported at the crate root for ergonomic imports. Consumers that
//! want a narrower surface can disable default features and import from the module paths instead.
//!
//! ## Stability and compatibility
//! Anything re-exported from this crate should be treated as public API. Many encodings are
//! consensus-critical; prefer canonical/ordered data structures for anything that is hashed or
//! committed.

pub mod api;
pub mod casino;
pub mod execution;
pub mod token;

#[cfg(feature = "root-reexports")]
pub use api::*;
#[cfg(feature = "root-reexports")]
pub use casino::*;
#[cfg(feature = "root-reexports")]
pub use execution::*;
#[cfg(feature = "root-reexports")]
pub use token::*;

#[cfg(test)]
mod compat;
