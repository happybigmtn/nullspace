//! RNG commit-reveal pipeline for provably fair outcomes.
//!
//! This module implements the commit-reveal scheme for deterministic, verifiable
//! random number generation in table games.
//!
//! ## Commit-Reveal Flow
//!
//! 1. **Generate** - Before betting closes, generate a reveal value and its commitment
//! 2. **Commit** - Publish the commitment (hash) during the Locked phase
//! 3. **Reveal** - Disclose the pre-image during the Rolling phase
//! 4. **Verify** - Anyone can verify `hash(reveal) == commit`
//!
//! ## Hash Chain
//!
//! For sequential rounds, each reveal value is derived from a hash chain:
//! ```text
//! reveal[n] = hash(master_secret || round_id)
//! commit[n] = hash(reveal[n])
//! ```
//!
//! This allows efficient pre-computation of commitments while maintaining
//! unpredictability of individual reveals until they're disclosed.
//!
//! ## Determinism
//!
//! The reveal value, once disclosed, serves as the seed for deterministic
//! outcome generation. Any party with the reveal can reproduce the exact
//! game outcomes.

use commonware_codec::Encode;
use commonware_cryptography::sha256::Sha256;
use commonware_cryptography::Hasher;
use nullspace_types::Seed;

/// Length of commit and reveal values in bytes.
pub const COMMIT_REVEAL_LEN: usize = 32;

/// A commit-reveal pair for provably fair RNG.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitRevealPair {
    /// The commitment (hash of the reveal value).
    /// Published before betting closes.
    pub commit: [u8; COMMIT_REVEAL_LEN],
    /// The reveal value (pre-image of the commit).
    /// Disclosed after betting locks.
    pub reveal: [u8; COMMIT_REVEAL_LEN],
}

impl CommitRevealPair {
    /// Verify that the commit matches hash(reveal).
    pub fn verify(&self) -> bool {
        verify_commit_reveal(&self.commit, &self.reveal)
    }
}

/// Generate a commit-reveal pair from a consensus seed and round ID.
///
/// The reveal is derived deterministically from the seed and round ID,
/// ensuring reproducibility across all nodes while maintaining
/// unpredictability before reveal.
///
/// # Arguments
/// * `seed` - The consensus seed for the current epoch
/// * `round_id` - The unique round identifier
///
/// # Returns
/// A `CommitRevealPair` with the commit (for publishing) and reveal (for later disclosure)
pub fn generate_commit_reveal(seed: &Seed, round_id: u64) -> CommitRevealPair {
    // Derive the reveal from seed and round_id
    let reveal = derive_reveal(seed, round_id);

    // Compute the commit as hash(reveal)
    let commit = compute_commit(&reveal);

    CommitRevealPair { commit, reveal }
}

/// Derive a reveal value from a consensus seed and round ID.
///
/// Uses SHA256: `reveal = hash(seed || round_id)`
fn derive_reveal(seed: &Seed, round_id: u64) -> [u8; COMMIT_REVEAL_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(seed.encode().as_ref());
    hasher.update(&round_id.to_be_bytes());
    hasher.update(b"reveal"); // Domain separator
    hasher.finalize().0
}

/// Compute a commitment from a reveal value.
///
/// Uses SHA256: `commit = hash(reveal)`
pub fn compute_commit(reveal: &[u8; COMMIT_REVEAL_LEN]) -> [u8; COMMIT_REVEAL_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(reveal);
    hasher.finalize().0
}

/// Verify that a commitment matches a reveal value.
///
/// Returns `true` if `commit == hash(reveal)`.
///
/// This is the core verification that allows anyone to prove the house
/// didn't manipulate the outcome after seeing bets.
pub fn verify_commit_reveal(commit: &[u8; COMMIT_REVEAL_LEN], reveal: &[u8; COMMIT_REVEAL_LEN]) -> bool {
    let expected_commit = compute_commit(reveal);
    commit == &expected_commit
}

/// Verify commit-reveal from slices (for use with GlobalTableRound fields).
///
/// Returns `Ok(reveal_array)` if verification succeeds, `Err` otherwise.
pub fn verify_commit_reveal_slices(commit: &[u8], reveal: &[u8]) -> Result<[u8; COMMIT_REVEAL_LEN], CommitRevealError> {
    // Validate lengths
    if commit.len() != COMMIT_REVEAL_LEN {
        return Err(CommitRevealError::InvalidCommitLength(commit.len()));
    }
    if reveal.len() != COMMIT_REVEAL_LEN {
        return Err(CommitRevealError::InvalidRevealLength(reveal.len()));
    }

    // Convert to arrays
    let commit_arr: [u8; COMMIT_REVEAL_LEN] = commit.try_into()
        .map_err(|_| CommitRevealError::InvalidCommitLength(commit.len()))?;
    let reveal_arr: [u8; COMMIT_REVEAL_LEN] = reveal.try_into()
        .map_err(|_| CommitRevealError::InvalidRevealLength(reveal.len()))?;

    // Verify
    if verify_commit_reveal(&commit_arr, &reveal_arr) {
        Ok(reveal_arr)
    } else {
        Err(CommitRevealError::VerificationFailed)
    }
}

/// Errors that can occur during commit-reveal operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitRevealError {
    /// Commit has invalid length (expected 32 bytes).
    InvalidCommitLength(usize),
    /// Reveal has invalid length (expected 32 bytes).
    InvalidRevealLength(usize),
    /// Commit-reveal verification failed (hash mismatch).
    VerificationFailed,
    /// Commit is missing (empty) when reveal is attempted.
    MissingCommit,
    /// Reveal attempted before lock phase.
    RevealBeforeLock,
}

impl std::fmt::Display for CommitRevealError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidCommitLength(len) => write!(f, "invalid commit length: {} (expected 32)", len),
            Self::InvalidRevealLength(len) => write!(f, "invalid reveal length: {} (expected 32)", len),
            Self::VerificationFailed => write!(f, "commit-reveal verification failed"),
            Self::MissingCommit => write!(f, "commit is missing"),
            Self::RevealBeforeLock => write!(f, "reveal attempted before lock phase"),
        }
    }
}

impl std::error::Error for CommitRevealError {}

/// Hash chain state for generating sequential commit-reveal pairs.
///
/// This is useful for pre-computing commitments for multiple rounds ahead
/// while maintaining the hash chain property.
#[derive(Clone)]
pub struct HashChain {
    /// The master secret for this chain.
    master_secret: [u8; COMMIT_REVEAL_LEN],
}

impl HashChain {
    /// Create a new hash chain from a consensus seed.
    pub fn new(seed: &Seed) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(seed.encode().as_ref());
        hasher.update(b"hash_chain_master");
        Self {
            master_secret: hasher.finalize().0,
        }
    }

    /// Create a hash chain from an explicit master secret.
    pub fn from_secret(master_secret: [u8; COMMIT_REVEAL_LEN]) -> Self {
        Self { master_secret }
    }

    /// Get the master secret (for serialization/persistence).
    pub fn secret(&self) -> &[u8; COMMIT_REVEAL_LEN] {
        &self.master_secret
    }

    /// Generate a commit-reveal pair for a specific round.
    pub fn generate(&self, round_id: u64) -> CommitRevealPair {
        let reveal = self.derive_reveal(round_id);
        let commit = compute_commit(&reveal);
        CommitRevealPair { commit, reveal }
    }

    /// Derive just the reveal value for a round (when commit was already published).
    pub fn derive_reveal(&self, round_id: u64) -> [u8; COMMIT_REVEAL_LEN] {
        let mut hasher = Sha256::new();
        hasher.update(&self.master_secret);
        hasher.update(&round_id.to_be_bytes());
        hasher.finalize().0
    }

    /// Pre-generate commitments for a range of rounds.
    ///
    /// Returns a vector of (round_id, commit) pairs.
    /// The reveals are not stored - they can be derived later from the master secret.
    pub fn precompute_commits(&self, start_round: u64, count: u64) -> Vec<(u64, [u8; COMMIT_REVEAL_LEN])> {
        let end_round = start_round.saturating_add(count);
        (start_round..end_round)
            .map(|round_id| {
                let pair = self.generate(round_id);
                (round_id, pair.commit)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mocks::{create_network_keypair, create_seed};

    fn test_seed() -> Seed {
        let (network_secret, _) = create_network_keypair();
        create_seed(&network_secret, 1)
    }

    #[test]
    fn test_generate_commit_reveal_deterministic() {
        let seed = test_seed();

        let pair1 = generate_commit_reveal(&seed, 1);
        let pair2 = generate_commit_reveal(&seed, 1);

        // Same inputs produce same outputs
        assert_eq!(pair1.commit, pair2.commit);
        assert_eq!(pair1.reveal, pair2.reveal);
    }

    #[test]
    fn test_commit_reveal_different_rounds() {
        let seed = test_seed();

        let pair1 = generate_commit_reveal(&seed, 1);
        let pair2 = generate_commit_reveal(&seed, 2);

        // Different rounds produce different pairs
        assert_ne!(pair1.reveal, pair2.reveal);
        assert_ne!(pair1.commit, pair2.commit);
    }

    #[test]
    fn test_verify_commit_reveal_success() {
        let seed = test_seed();
        let pair = generate_commit_reveal(&seed, 42);

        assert!(pair.verify());
        assert!(verify_commit_reveal(&pair.commit, &pair.reveal));
    }

    #[test]
    fn test_verify_commit_reveal_failure() {
        let seed = test_seed();
        let pair = generate_commit_reveal(&seed, 42);

        // Tamper with the reveal
        let mut bad_reveal = pair.reveal;
        bad_reveal[0] ^= 0xFF;

        assert!(!verify_commit_reveal(&pair.commit, &bad_reveal));
    }

    #[test]
    fn test_verify_commit_reveal_slices() {
        let seed = test_seed();
        let pair = generate_commit_reveal(&seed, 1);

        // Convert to slices (simulating GlobalTableRound fields)
        let commit_slice: &[u8] = &pair.commit;
        let reveal_slice: &[u8] = &pair.reveal;

        let result = verify_commit_reveal_slices(commit_slice, reveal_slice);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), pair.reveal);
    }

    #[test]
    fn test_verify_commit_reveal_slices_invalid_lengths() {
        let short_commit = [0u8; 16];
        let valid_reveal = [0u8; 32];

        let result = verify_commit_reveal_slices(&short_commit, &valid_reveal);
        assert_eq!(result, Err(CommitRevealError::InvalidCommitLength(16)));

        let valid_commit = [0u8; 32];
        let short_reveal = [0u8; 8];

        let result = verify_commit_reveal_slices(&valid_commit, &short_reveal);
        assert_eq!(result, Err(CommitRevealError::InvalidRevealLength(8)));
    }

    #[test]
    fn test_verify_commit_reveal_slices_mismatch() {
        let commit = [0u8; 32];
        let reveal = [1u8; 32];

        let result = verify_commit_reveal_slices(&commit, &reveal);
        assert_eq!(result, Err(CommitRevealError::VerificationFailed));
    }

    #[test]
    fn test_hash_chain_deterministic() {
        let seed = test_seed();

        let chain1 = HashChain::new(&seed);
        let chain2 = HashChain::new(&seed);

        let pair1 = chain1.generate(100);
        let pair2 = chain2.generate(100);

        assert_eq!(pair1.commit, pair2.commit);
        assert_eq!(pair1.reveal, pair2.reveal);
    }

    #[test]
    fn test_hash_chain_verify() {
        let seed = test_seed();
        let chain = HashChain::new(&seed);

        for round_id in 0..100 {
            let pair = chain.generate(round_id);
            assert!(
                pair.verify(),
                "Hash chain verification failed for round {}",
                round_id
            );
        }
    }

    #[test]
    fn test_hash_chain_precompute_commits() {
        let seed = test_seed();
        let chain = HashChain::new(&seed);

        let commits = chain.precompute_commits(10, 5);
        assert_eq!(commits.len(), 5);

        // Verify each precomputed commit matches the derived one
        for (round_id, precomputed_commit) in commits {
            let pair = chain.generate(round_id);
            assert_eq!(
                precomputed_commit, pair.commit,
                "Precomputed commit mismatch for round {}",
                round_id
            );
        }
    }

    #[test]
    fn test_hash_chain_derive_reveal() {
        let seed = test_seed();
        let chain = HashChain::new(&seed);

        for round_id in 0..50 {
            let full_pair = chain.generate(round_id);
            let just_reveal = chain.derive_reveal(round_id);
            assert_eq!(
                full_pair.reveal, just_reveal,
                "Derived reveal mismatch for round {}",
                round_id
            );
        }
    }

    #[test]
    fn test_hash_chain_from_secret() {
        let seed = test_seed();
        let chain1 = HashChain::new(&seed);

        // Extract secret and recreate chain
        let secret = *chain1.secret();
        let chain2 = HashChain::from_secret(secret);

        // Both chains should produce identical results
        for round_id in 0..20 {
            let pair1 = chain1.generate(round_id);
            let pair2 = chain2.generate(round_id);
            assert_eq!(pair1.commit, pair2.commit);
            assert_eq!(pair1.reveal, pair2.reveal);
        }
    }

    #[test]
    fn test_commit_is_not_predictable_from_round_id() {
        // Without the seed, you cannot predict the commit
        let seed1 = test_seed();

        let (network_secret, _) = create_network_keypair();
        let seed2 = create_seed(&network_secret, 999); // Different view

        let pair1 = generate_commit_reveal(&seed1, 1);
        let pair2 = generate_commit_reveal(&seed2, 1);

        // Same round_id, different seeds = different commits
        assert_ne!(pair1.commit, pair2.commit);
        assert_ne!(pair1.reveal, pair2.reveal);
    }

    #[test]
    fn test_reveal_is_valid_rng_seed() {
        // The reveal value should have good entropy distribution
        let seed = test_seed();
        let mut reveals: Vec<[u8; 32]> = Vec::new();

        for round_id in 0..1000 {
            let pair = generate_commit_reveal(&seed, round_id);
            reveals.push(pair.reveal);
        }

        // Check that all reveals are unique
        let unique_count = {
            let mut sorted = reveals.clone();
            sorted.sort();
            sorted.dedup();
            sorted.len()
        };
        assert_eq!(unique_count, reveals.len(), "All reveals should be unique");

        // Check byte distribution across all reveals (basic entropy check)
        let mut byte_counts = [0u64; 256];
        for reveal in &reveals {
            for byte in reveal {
                byte_counts[*byte as usize] += 1;
            }
        }

        // Total bytes: 1000 reveals * 32 bytes = 32000 bytes
        // Expected per bucket: 32000 / 256 = 125
        // Allow reasonable variance (chi-square test simplification)
        let total_bytes = reveals.len() * 32;
        let expected = total_bytes as f64 / 256.0;

        let chi_square: f64 = byte_counts
            .iter()
            .map(|&count| {
                let diff = count as f64 - expected;
                diff * diff / expected
            })
            .sum();

        // Chi-square critical value for 255 df at p=0.001 is ~310
        // Being generous here since we're doing a basic check
        assert!(
            chi_square < 400.0,
            "Byte distribution seems non-uniform, chi-square = {}",
            chi_square
        );
    }

    #[test]
    fn test_commit_reveal_overflow_safety() {
        let seed = test_seed();

        // Test with max round_id
        let pair = generate_commit_reveal(&seed, u64::MAX);
        assert!(pair.verify());

        // Test with 0 round_id
        let pair = generate_commit_reveal(&seed, 0);
        assert!(pair.verify());
    }

    #[test]
    fn test_hash_chain_precompute_overflow() {
        let seed = test_seed();
        let chain = HashChain::new(&seed);

        // Precompute near u64::MAX should not panic
        let commits = chain.precompute_commits(u64::MAX - 2, 5);
        // saturating_add(u64::MAX - 2, 5) = u64::MAX, so range is [MAX-2, MAX)
        // That's 2 values: MAX-2, MAX-1 (MAX is exclusive in the range)
        assert_eq!(commits.len(), 2); // Only 2 rounds: MAX-2, MAX-1
    }

    #[test]
    fn test_commit_reveal_error_display() {
        assert_eq!(
            CommitRevealError::InvalidCommitLength(16).to_string(),
            "invalid commit length: 16 (expected 32)"
        );
        assert_eq!(
            CommitRevealError::VerificationFailed.to_string(),
            "commit-reveal verification failed"
        );
    }
}
