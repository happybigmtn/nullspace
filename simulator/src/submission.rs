use commonware_codec::Encode;
use commonware_consensus::simplex::scheme::bls12381_threshold;
use commonware_cryptography::{
    bls12381::primitives::variant::MinSig,
    ed25519::PublicKey,
    sha256::{Digest, Sha256},
    Digestible, Hasher,
};
use commonware_storage::mmr::{hasher::Standard, Location};
use commonware_storage::qmdb::verify_proof_and_extract_digests;
use commonware_utils::hex;
use nullspace_types::{
    api::Submission,
    execution::{Instruction, Transaction, Value, Output},
    NAMESPACE,
};
use std::sync::Arc;

use crate::Simulator;

type StateOp = commonware_storage::qmdb::any::unordered::variable::Operation<Digest, Value>;
type EventOp = commonware_storage::qmdb::keyless::Operation<Output>;

#[derive(Debug)]
pub enum SubmitError {
    InvalidSeed,
    InvalidSummary,
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
                if simulator.enforce_signature_verification() {
                    tracing::error!(
                        "Seed verification failed (bad identity or corrupted seed); enforcement enabled"
                    );
                    return Err(SubmitError::InvalidSeed);
                }
                tracing::error!(
                    "Seed verification failed (bad identity or corrupted seed) — bypassing"
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
            simulator.submit_transactions(txs);
            Ok(())
        }
        Submission::Summary(summary) => {
            if let Some(persistence) = &simulator.summary_persistence {
                persistence.persist_summary(summary.clone()).await;
            }
            let (state_digests, events_digests) = match summary.verify(&simulator.identity) {
                Ok(digests) => digests,
                Err(err) => {
                    if simulator.enforce_signature_verification() {
                        tracing::error!(
                            ?err,
                            view = summary.progress.view.get(),
                            height = summary.progress.height,
                            state_ops = summary.state_proof_ops.len(),
                            events_ops = summary.events_proof_ops.len(),
                            "Summary signature verification failed; enforcement enabled"
                        );
                        return Err(SubmitError::InvalidSummary);
                    }
                    tracing::warn!(
                        ?err,
                        view = summary.progress.view.get(),
                        height = summary.progress.height,
                        state_ops = summary.state_proof_ops.len(),
                        events_ops = summary.events_proof_ops.len(),
                        "Summary signature verification failed — bypassing signature check, extracting digests directly"
                    );
                    // STAGING BYPASS: Skip signature verification but still extract digests
                    // so state can be stored and queried properly.
                    let mut hasher = Standard::<Sha256>::new();

                    // Extract state digests
                    let state_start_loc = Location::from(summary.progress.state_start_op);
                    let state_ops: Vec<StateOp> = summary.state_proof_ops.iter().cloned().collect();
                    let state_digests = match verify_proof_and_extract_digests(
                        &mut hasher,
                        &summary.state_proof,
                        state_start_loc,
                        &state_ops,
                        &summary.progress.state_root,
                    ) {
                        Ok(digests) => digests,
                        Err(proof_err) => {
                            tracing::error!(?proof_err, "State proof verification failed during bypass");
                            Vec::new()
                        }
                    };

                    // Extract events digests
                    let events_start_loc = Location::from(summary.progress.events_start_op);
                    let events_ops: Vec<EventOp> = summary.events_proof_ops.iter().cloned().collect();
                    let events_digests = match verify_proof_and_extract_digests(
                        &mut hasher,
                        &summary.events_proof,
                        events_start_loc,
                        &events_ops,
                        &summary.progress.events_root,
                    ) {
                        Ok(digests) => digests,
                        Err(proof_err) => {
                            tracing::error!(?proof_err, "Events proof verification failed during bypass");
                            Vec::new()
                        }
                    };

                    (state_digests, events_digests)
                }
            };
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
