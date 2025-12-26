use commonware_codec::Encode;
use commonware_cryptography::{sha256::Sha256, Digestible, Hasher};
use commonware_utils::hex;
use nullspace_types::{
    api::Submission,
    execution::{Instruction, Transaction},
    NAMESPACE,
};
use std::sync::Arc;

use crate::Simulator;

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
            if !seed.verify(NAMESPACE, &simulator.identity) {
                tracing::warn!("Seed verification failed (bad identity or corrupted seed)");
                return Err(SubmitError::InvalidSeed);
            }
            simulator.submit_seed(seed).await;
            Ok(())
        }
        Submission::Transactions(txs) => {
            if log_admin {
                log_admin_transactions(&txs);
            }
            simulator.submit_transactions(txs);
            Ok(())
        }
        Submission::Summary(summary) => {
            let (state_digests, events_digests) = match summary.verify(&simulator.identity) {
                Ok(digests) => digests,
                Err(err) => {
                    tracing::warn!(
                        ?err,
                        view = summary.progress.view,
                        height = summary.progress.height,
                        state_ops = summary.state_proof_ops.len(),
                        events_ops = summary.events_proof_ops.len(),
                        "Summary verification failed"
                    );
                    return Err(SubmitError::InvalidSummary);
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
