//! Shared schema types for Nullspace.
//!
//! This crate defines the wire and state schema used across the workspace (`api`, `casino`,
//! `execution`, `token`) and re-exports it as a single public surface.
//!
//! ## Stability and compatibility
//! Anything re-exported from this crate should be treated as public API. Many encodings are
//! consensus-critical; prefer canonical/ordered data structures for anything that is hashed or
//! committed.

pub mod api;
pub mod casino;
pub mod execution;
pub mod token;

pub use api::*;
pub use casino::*;
pub use execution::*;
pub use token::*;
