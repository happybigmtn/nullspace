//! Core poker game logic and L2 deal planning for CodexPoker.
//!
//! This crate provides:
//! - L2 deal plan building with shuffle context binding
//! - Card assignment and encryption coordination
//!
//! # Layer 2 Overview
//!
//! The L2 layer handles off-chain game state preparation before consensus.
//! The [`l2`] module provides [`DealPlanBuilder`](l2::DealPlanBuilder) for
//! creating deal plans that are cryptographically bound to their game context
//! via [`ShuffleContext`](protocol_messages::ShuffleContext).

pub mod l2;

pub use l2::{CardAssignment, DealPlan, DealPlanBuilder, DealPlanError};
