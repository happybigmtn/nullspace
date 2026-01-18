use commonware_codec::Encode;
use commonware_consensus::simplex::scheme::bls12381_threshold;
use commonware_cryptography::{
    bls12381::primitives::variant::MinSig,
    ed25519::PublicKey,
    sha256::Sha256,
    Digestible, Hasher,
};
use commonware_storage::mmr::{hasher::Standard, Location};
use commonware_storage::qmdb::verify_proof_and_extract_digests;
use commonware_utils::hex;
use nullspace_types::{
    api::{Submission, VerifyError},
    execution::{Instruction, Key, Transaction, Value},
    NAMESPACE,
};
use commonware_cryptography::sha256::Digest;
use commonware_storage::qmdb::any::unordered::{variable, Update as StorageUpdate};
use std::sync::Arc;

use crate::Simulator;

type StateOp = variable::Operation<Digest, Value>;

#[derive(Debug)]
pub enum SubmitError {
    InvalidSeed,
    InvalidSummary,
    /// Transaction nonce is below the expected next nonce (AC-4.3)
    NonceTooLow {
        public_key_hex: String,
        tx_nonce: u64,
        expected_nonce: u64,
    },
}

pub async fn apply_submission(
    simulator: Arc<Simulator>,
    submission: Submission,
    log_admin: bool,
) -> Result<(), SubmitError> {
    match submission {
        Submission::Seed(seed) => {
            let verifier =
                bls12381_threshold::Scheme::<PublicKey, MinSig>::certificate_verifier(
                    simulator.identity,
                );
            if !seed.verify(&verifier, NAMESPACE) {
                if simulator.config.enforce_signature_verification() {
                    tracing::error!("Seed verification failed (bad identity or corrupted seed)");
                    return Err(SubmitError::InvalidSeed);
                }
                tracing::error!(
                    "Seed verification failed (bad identity or corrupted seed) — bypassing for staging"
                );
            }
            simulator.submit_seed(seed).await;
            Ok(())
        }
        Submission::Transactions(txs) => {
            if log_admin {
                log_admin_transactions(&txs);
            }
            if let Some(first) = txs.first() {
                tracing::info!(
                    txs = txs.len(),
                    first_public = %commonware_utils::hex(&first.public.encode()),
                    first_nonce = first.nonce,
                    first_instruction = %format!("{:?}", first.instruction),
                    "received transactions submission"
                );
            } else {
                tracing::info!(txs = 0, "received empty transactions submission");
            }

            // AC-4.3: Validate nonces before submitting to mempool
            // This provides immediate feedback to clients about rejected transactions
            for tx in &txs {
                let expected_nonce = get_account_nonce(&simulator, &tx.public).await;
                if tx.nonce < expected_nonce {
                    let public_key_hex = hex(&tx.public.encode());
                    tracing::warn!(
                        public_key = %public_key_hex,
                        tx_nonce = tx.nonce,
                        expected_nonce,
                        "rejecting transaction: nonce too low"
                    );
                    return Err(SubmitError::NonceTooLow {
                        public_key_hex,
                        tx_nonce: tx.nonce,
                        expected_nonce,
                    });
                }
            }

            simulator.submit_transactions(txs);
            Ok(())
        }
        Submission::Summary(summary) => {
            let (state_digests, events_digests) = match summary.verify(&simulator.identity) {
                Ok(digests) => digests,
                Err(err) => {
                    if simulator.config.enforce_signature_verification()
                        || !matches!(err, VerifyError::InvalidSignature)
                    {
                        tracing::error!(
                            ?err,
                            view = summary.progress.view.get(),
                            height = summary.progress.height,
                            state_ops = summary.state_proof_ops.len(),
                            events_ops = summary.events_proof_ops.len(),
                            "Summary verification failed"
                        );
                        return Err(SubmitError::InvalidSummary);
                    }

                    tracing::error!(
                        ?err,
                        view = summary.progress.view.get(),
                        height = summary.progress.height,
                        state_ops = summary.state_proof_ops.len(),
                        events_ops = summary.events_proof_ops.len(),
                        "Summary verification failed — bypassing signature check for staging"
                    );

                    let mut hasher = Standard::<Sha256>::new();
                    let state_ops_len = summary.state_proof_ops.len();
                    let events_ops_len = summary.events_proof_ops.len();

                    let state_digests = if summary.progress.state_start_op
                        + state_ops_len as u64
                        == summary.progress.state_end_op
                    {
                        let state_start_loc = Location::from(summary.progress.state_start_op);
                        verify_proof_and_extract_digests(
                            &mut hasher,
                            &summary.state_proof,
                            state_start_loc,
                            &summary.state_proof_ops,
                            &summary.progress.state_root,
                        )
                        .unwrap_or_default()
                    } else {
                        tracing::warn!(
                            start = summary.progress.state_start_op,
                            end = summary.progress.state_end_op,
                            ops_len = state_ops_len,
                            "State ops range mismatch while bypassing summary signature"
                        );
                        Vec::new()
                    };

                    let events_digests = if summary.progress.events_start_op
                        + events_ops_len as u64
                        == summary.progress.events_end_op
                    {
                        let events_start_loc = Location::from(summary.progress.events_start_op);
                        verify_proof_and_extract_digests(
                            &mut hasher,
                            &summary.events_proof,
                            events_start_loc,
                            &summary.events_proof_ops,
                            &summary.progress.events_root,
                        )
                        .unwrap_or_default()
                    } else {
                        tracing::warn!(
                            start = summary.progress.events_start_op,
                            end = summary.progress.events_end_op,
                            ops_len = events_ops_len,
                            "Events ops range mismatch while bypassing summary signature"
                        );
                        Vec::new()
                    };

                    (state_digests, events_digests)
                }
            };

            if let Some(persistence) = &simulator.summary_persistence {
                persistence.persist_summary(summary.clone()).await;
            }
            simulator
                .submit_events(summary.clone(), events_digests)
                .await;
            simulator.submit_state(summary, state_digests).await;
            Ok(())
        }
    }
}

fn audit_hash<T: Encode>(value: &T) -> String {
    let bytes = value.encode();
    let mut hasher = Sha256::new();
    hasher.update(bytes.as_ref());
    hex(hasher.finalize().as_ref())
}

fn log_admin_transactions(txs: &[Transaction]) {
    for tx in txs {
        let admin = hex(&tx.public.encode());
        let tx_hash = hex(tx.digest().as_ref());
        match &tx.instruction {
            Instruction::CasinoSetTournamentLimit { player, daily_limit } => {
                tracing::info!(
                    action = "casino_set_tournament_limit",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    player = %hex(&player.encode()),
                    daily_limit = *daily_limit,
                    "admin transaction submitted"
                );
            }
            Instruction::SetPolicy { policy } => {
                tracing::info!(
                    action = "set_policy",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    policy_hash = %audit_hash(policy),
                    "admin transaction submitted"
                );
            }
            Instruction::SetTreasury { treasury } => {
                tracing::info!(
                    action = "set_treasury",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    treasury_hash = %audit_hash(treasury),
                    "admin transaction submitted"
                );
            }
            Instruction::SetTreasuryVesting { vesting } => {
                tracing::info!(
                    action = "set_treasury_vesting",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    vesting_hash = %audit_hash(vesting),
                    "admin transaction submitted"
                );
            }
            Instruction::ReleaseTreasuryAllocation { bucket, amount } => {
                tracing::info!(
                    action = "release_treasury_allocation",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    bucket = ?bucket,
                    amount = *amount,
                    "admin transaction submitted"
                );
            }
            Instruction::FundRecoveryPool { amount } => {
                tracing::info!(
                    action = "fund_recovery_pool",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    amount = *amount,
                    "admin transaction submitted"
                );
            }
            Instruction::RetireVaultDebt { target, amount } => {
                tracing::info!(
                    action = "retire_vault_debt",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    target = %hex(&target.encode()),
                    amount = *amount,
                    "admin transaction submitted"
                );
            }
            Instruction::RetireWorstVaultDebt { amount } => {
                tracing::info!(
                    action = "retire_worst_vault_debt",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    amount = *amount,
                    "admin transaction submitted"
                );
            }
            Instruction::SeedAmm {
                rng_amount,
                usdt_amount,
                bootstrap_price_vusdt_numerator,
                bootstrap_price_rng_denominator,
            } => {
                tracing::info!(
                    action = "seed_amm",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    rng_amount = *rng_amount,
                    usdt_amount = *usdt_amount,
                    bootstrap_price_vusdt_numerator = *bootstrap_price_vusdt_numerator,
                    bootstrap_price_rng_denominator = *bootstrap_price_rng_denominator,
                    "admin transaction submitted"
                );
            }
            Instruction::FinalizeAmmBootstrap => {
                tracing::info!(
                    action = "finalize_amm_bootstrap",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    "admin transaction submitted"
                );
            }
            Instruction::UpdateOracle {
                price_vusdt_numerator,
                price_rng_denominator,
                updated_ts,
                source,
            } => {
                tracing::info!(
                    action = "update_oracle",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    price_vusdt_numerator = *price_vusdt_numerator,
                    price_rng_denominator = *price_rng_denominator,
                    updated_ts = *updated_ts,
                    source_len = source.len(),
                    "admin transaction submitted"
                );
            }
            Instruction::BridgeDeposit {
                recipient,
                amount,
                source,
            } => {
                tracing::info!(
                    action = "bridge_deposit",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    recipient = %hex(&recipient.encode()),
                    amount = *amount,
                    source_len = source.len(),
                    "admin transaction submitted"
                );
            }
            Instruction::FinalizeBridgeWithdrawal {
                withdrawal_id,
                source,
            } => {
                tracing::info!(
                    action = "finalize_bridge_withdrawal",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    withdrawal_id = *withdrawal_id,
                    source_len = source.len(),
                    "admin transaction submitted"
                );
            }
            _ => {}
        }
    }
}

/// Query account nonce from simulator state (AC-4.3)
///
/// Returns the expected next nonce for the account. For new accounts that don't
/// exist in state yet, returns 0 (any nonce >= 0 is valid for new accounts).
async fn get_account_nonce(simulator: &Simulator, public_key: &PublicKey) -> u64 {
    let account_key = Sha256::hash(&Key::Account(public_key.clone()).encode());
    match simulator.query_state(&account_key).await {
        Some(lookup) => match lookup.operation {
            StateOp::Update(StorageUpdate(_, Value::Account(account))) => account.nonce,
            _ => 0,
        },
        None => 0,
    }
}
