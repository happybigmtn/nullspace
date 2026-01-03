//! Bridge relayer service for syncing EVM lockbox events with Commonware bridge state.

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use commonware_codec::{DecodeExt, ReadExt};
use commonware_consensus::Viewable;
use commonware_cryptography::{
    ed25519::{PrivateKey, PublicKey},
    sha256::Sha256,
    Hasher,
    Signer as CommonwareSigner,
};
use commonware_utils::from_hex;
use ethers::signers::Signer as EvmSigner;
use ethers::prelude::*;
use nullspace_client::{operation_value, Client};
use nullspace_types::{
    api::Query,
    casino::{BridgeState, BridgeWithdrawal},
    execution::{Instruction, Key, Transaction, Value},
    Identity,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs,
    path::Path,
    str::FromStr,
    sync::Arc,
    time::Duration,
};
use tokio::time::sleep;
use tracing::{info, warn};

abigen!(
    BridgeLockbox,
    r#"[
        event Deposited(address indexed from, uint256 amount, bytes32 destination)
        event Withdrawn(address indexed to, uint256 amount, bytes32 source)
        function withdraw(address to, uint256 amount, bytes32 source) external
    ]"#
);

const VIEW_SECONDS: u64 = 3;

#[derive(Parser, Debug)]
#[command(author, version, about = "Bridge relayer for Commonware <-> EVM lockbox sync")]
struct Args {
    /// Nullspace simulator base URL (http(s)://host:port)
    #[arg(long, default_value = "http://localhost:8080")]
    url: String,

    /// Network identity hex (for verifying simulator responses)
    #[arg(long)]
    identity: String,

    /// Admin private key hex for Commonware bridge instructions
    #[arg(long)]
    admin_key: Option<String>,

    /// Path to file with admin private key hex for Commonware bridge instructions
    #[arg(long)]
    admin_key_file: Option<String>,

    /// EVM JSON-RPC endpoint URL
    #[arg(long)]
    evm_rpc_url: Option<String>,

    /// EVM private key for lockbox owner
    #[arg(long)]
    evm_private_key: Option<String>,

    /// EVM lockbox contract address
    #[arg(long)]
    lockbox_address: Option<String>,

    /// EVM chain id
    #[arg(long, default_value = "1")]
    evm_chain_id: u64,

    /// Confirmations required for EVM log finality and withdrawals
    #[arg(long, default_value = "3")]
    evm_confirmations: u64,

    /// RNG decimals on EVM
    #[arg(long, default_value = "18")]
    evm_decimals: u32,

    /// State persistence path
    #[arg(long, default_value = "bridge-relayer-state.json")]
    state_path: String,

    /// Poll interval in seconds
    #[arg(long, default_value = "5")]
    poll_secs: u64,

    /// Start scanning EVM logs from this block when no state file exists
    #[arg(long)]
    evm_start_block: Option<u64>,

    /// Start scanning Commonware withdrawals from this id when no state file exists
    #[arg(long)]
    withdraw_start_id: Option<u64>,

    /// Max EVM block range per log query
    #[arg(long, default_value = "2000")]
    evm_log_range: u64,
}

struct RelayerConfig {
    state_path: String,
    evm_log_range: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct PendingWithdrawal {
    evm_tx_hash: Option<String>,
    blocked: bool,
    blocked_reason: Option<String>,
}

impl PendingWithdrawal {
    fn new() -> Self {
        Self {
            evm_tx_hash: None,
            blocked: false,
            blocked_reason: None,
        }
    }

    fn block(&mut self, reason: impl Into<String>) {
        self.blocked = true;
        self.blocked_reason = Some(reason.into());
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct RelayerState {
    last_evm_block: u64,
    last_evm_log_index: u64,
    last_withdrawal_id: u64,
    pending_withdrawals: HashMap<u64, PendingWithdrawal>,
}

impl RelayerState {
    fn new(evm_start_block: u64, withdraw_start_id: u64) -> Self {
        Self {
            last_evm_block: evm_start_block,
            last_evm_log_index: 0,
            last_withdrawal_id: withdraw_start_id,
            pending_withdrawals: HashMap::new(),
        }
    }
}

#[derive(Default)]
struct NonceTracker {
    next_nonce: Option<u64>,
}

impl NonceTracker {
    async fn sync(&mut self, client: &Client, public: &PublicKey) -> Result<u64> {
        let lookup = client.query_state(&Key::Account(public.clone())).await?;
        let nonce = match lookup.and_then(|lookup| operation_value(&lookup.operation).cloned()) {
            Some(Value::Account(account)) => account.nonce,
            _ => 0,
        };
        self.next_nonce = Some(nonce);
        Ok(nonce)
    }

    async fn next(&mut self, client: &Client, public: &PublicKey) -> Result<u64> {
        if let Some(nonce) = self.next_nonce {
            self.next_nonce = Some(nonce.saturating_add(1));
            Ok(nonce)
        } else {
            let nonce = self.sync(client, public).await?;
            self.next_nonce = Some(nonce.saturating_add(1));
            Ok(nonce)
        }
    }
}

struct EvmContext {
    provider: Provider<Http>,
    lockbox: BridgeLockbox<SignerMiddleware<Provider<Http>, LocalWallet>>,
    decimals: u32,
    confirmations: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let identity = decode_identity(&args.identity)?;
    let client = Client::new(&args.url, identity)?;

    let admin_key = require_arg_or_env_or_file(
        args.admin_key,
        args.admin_key_file,
        "CASINO_ADMIN_PRIVATE_KEY_HEX",
        "CASINO_ADMIN_PRIVATE_KEY_FILE",
    )?;
    let admin_private = decode_admin_key(&admin_key)?;
    let admin_public = admin_private.public_key();

    let evm_rpc_url = require_arg_or_env(args.evm_rpc_url, "BRIDGE_EVM_RPC_URL")?;
    let evm_private_key = require_arg_or_env(args.evm_private_key, "BRIDGE_EVM_PRIVATE_KEY")?;
    let lockbox_address = require_arg_or_env(args.lockbox_address, "BRIDGE_LOCKBOX_ADDRESS")?;
    let evm_chain_id = env_u64("BRIDGE_EVM_CHAIN_ID").unwrap_or(args.evm_chain_id);
    let evm_confirmations = env_u64("BRIDGE_EVM_CONFIRMATIONS").unwrap_or(args.evm_confirmations);
    let evm_decimals = env_u64("BRIDGE_DECIMALS")
        .map(|val| val as u32)
        .unwrap_or(args.evm_decimals);
    let state_path = env_string("BRIDGE_STATE_PATH").unwrap_or_else(|| args.state_path.clone());
    let poll_secs = env_u64("BRIDGE_POLL_SECS").unwrap_or(args.poll_secs);
    let evm_start = env_u64("BRIDGE_EVM_START_BLOCK")
        .or(args.evm_start_block)
        .unwrap_or(0);
    let withdraw_start = env_u64("BRIDGE_WITHDRAW_START_ID")
        .or(args.withdraw_start_id)
        .unwrap_or(0);
    let evm_log_range = env_u64("BRIDGE_EVM_LOG_RANGE").unwrap_or(args.evm_log_range);

    let evm = setup_evm(
        &evm_rpc_url,
        &evm_private_key,
        &lockbox_address,
        evm_chain_id,
        evm_confirmations,
        evm_decimals,
    )?;

    let config = RelayerConfig {
        state_path,
        evm_log_range,
    };

    let mut state = load_state(&config.state_path, evm_start, withdraw_start)?;

    info!(
        url = %args.url,
        lockbox = %lockbox_address,
        evm_chain_id,
        evm_confirmations,
        evm_decimals,
        "Bridge relayer starting"
    );

    let mut nonce_tracker = NonceTracker::default();
    let poll_interval = Duration::from_secs(poll_secs.max(1));

    loop {
        if let Err(err) = scan_evm_deposits(&config, &client, &admin_private, &admin_public, &evm, &mut nonce_tracker, &mut state).await {
            warn!(?err, "EVM deposit scan failed");
        }

        if let Err(err) = scan_commonware_withdrawals(&config, &client, &admin_private, &admin_public, &evm, &mut nonce_tracker, &mut state).await {
            warn!(?err, "Commonware withdrawal scan failed");
        }

        sleep(poll_interval).await;
    }
}

fn decode_identity(hex_str: &str) -> Result<Identity> {
    let bytes = from_hex(hex_str.trim_start_matches("0x"))
        .ok_or_else(|| anyhow!("Invalid identity hex"))?;
    let identity = Identity::decode(&mut bytes.as_slice()).context("Failed to decode identity")?;
    Ok(identity)
}

fn read_secret_file(path: &str) -> Result<String> {
    let contents = fs::read_to_string(path).context("Failed to read secret file")?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Secret file is empty: {path}"));
    }
    Ok(trimmed.to_string())
}

fn require_arg_or_env(value: Option<String>, env_key: &str) -> Result<String> {
    if let Some(value) = value {
        return Ok(value);
    }
    if let Ok(value) = env::var(env_key) {
        return Ok(value);
    }
    Err(anyhow!("Missing {env_key} (flag or env var)"))
}

fn require_arg_or_env_or_file(
    value: Option<String>,
    file: Option<String>,
    env_key: &str,
    env_file: &str,
) -> Result<String> {
    if let Some(value) = value {
        return Ok(value);
    }
    if let Some(file_path) = file {
        return read_secret_file(&file_path);
    }
    if let Ok(value) = env::var(env_key) {
        return Ok(value);
    }
    if let Ok(file_path) = env::var(env_file) {
        return read_secret_file(&file_path);
    }
    Err(anyhow!("Missing {env_key} or {env_file} (flag or env var)"))
}

fn env_u64(key: &str) -> Option<u64> {
    env::var(key).ok().and_then(|value| value.parse().ok())
}

fn env_string(key: &str) -> Option<String> {
    env::var(key).ok()
}

fn decode_admin_key(hex_str: &str) -> Result<PrivateKey> {
    let bytes = from_hex(hex_str.trim_start_matches("0x"))
        .ok_or_else(|| anyhow!("Invalid admin private key hex"))?;
    let mut buf: &[u8] = bytes.as_slice();
    let key = PrivateKey::read(&mut buf).context("Failed to decode admin key")?;
    if !buf.is_empty() {
        return Err(anyhow!("Unexpected trailing bytes in admin key"));
    }
    Ok(key)
}

fn load_state(path: &str, evm_start_block: u64, withdraw_start_id: u64) -> Result<RelayerState> {
    if !Path::new(path).exists() {
        return Ok(RelayerState::new(evm_start_block, withdraw_start_id));
    }
    let data = fs::read(path).context("Failed to read relayer state")?;
    let state: RelayerState = serde_json::from_slice(&data).context("Failed to parse relayer state")?;
    Ok(state)
}

fn save_state(path: &str, state: &RelayerState) -> Result<()> {
    let data = serde_json::to_vec_pretty(state).context("Failed to serialize relayer state")?;
    let tmp_path = format!("{path}.tmp");
    fs::write(&tmp_path, data).context("Failed to write relayer state")?;
    fs::rename(tmp_path, path).context("Failed to replace relayer state")?;
    Ok(())
}

fn setup_evm(
    evm_rpc_url: &str,
    evm_private_key: &str,
    lockbox_address: &str,
    evm_chain_id: u64,
    evm_confirmations: u64,
    evm_decimals: u32,
) -> Result<EvmContext> {
    let provider = Provider::<Http>::try_from(evm_rpc_url)
        .context("Invalid EVM RPC URL")?;

    let wallet: LocalWallet = evm_private_key
        .trim_start_matches("0x")
        .parse()
        .context("Invalid EVM private key")?;
    let wallet = wallet.with_chain_id(evm_chain_id);

    let address = Address::from_str(lockbox_address)
        .context("Invalid lockbox address")?;

    let client = SignerMiddleware::new(provider.clone(), wallet);
    let lockbox = BridgeLockbox::new(address, Arc::new(client));

    Ok(EvmContext {
        provider,
        lockbox,
        decimals: evm_decimals,
        confirmations: evm_confirmations,
    })
}

async fn scan_evm_deposits(
    config: &RelayerConfig,
    client: &Client,
    admin_private: &PrivateKey,
    admin_public: &PublicKey,
    evm: &EvmContext,
    nonce_tracker: &mut NonceTracker,
    state: &mut RelayerState,
) -> Result<()> {
    let latest_block = evm.provider.get_block_number().await?.as_u64();
    if latest_block < evm.confirmations {
        return Ok(());
    }
    let finalized_block = latest_block.saturating_sub(evm.confirmations);

    if finalized_block < state.last_evm_block {
        return Ok(());
    }

    let mut to_block = finalized_block;
    let max_to = state.last_evm_block.saturating_add(config.evm_log_range);
    if to_block > max_to {
        to_block = max_to;
    }

    let from_block = state.last_evm_block;
    let events = evm
        .lockbox
        .event::<DepositedFilter>()
        .from_block(from_block)
        .to_block(to_block)
        .query_with_meta()
        .await?;

    let mut events = events;
    events.sort_by_key(|(_, meta)| (meta.block_number, meta.log_index));

    if events.is_empty() && to_block > state.last_evm_block {
        state.last_evm_block = to_block;
        state.last_evm_log_index = 0;
        save_state(&config.state_path, state)?;
        return Ok(());
    }

    for (event, meta) in events {
        let block_number = meta.block_number.as_u64();
        let log_index = meta.log_index.as_u64();

        if block_number < state.last_evm_block {
            continue;
        }
        if block_number == state.last_evm_block && log_index <= state.last_evm_log_index {
            continue;
        }

        let recipient = match destination_to_public_key(event.destination) {
            Some(public) => public,
            None => {
                warn!(block_number, log_index, "Invalid deposit destination");
                state.last_evm_block = block_number;
                state.last_evm_log_index = log_index;
                save_state(&config.state_path, state)?;
                continue;
            }
        };

        let amount_rng = match evm_amount_to_rng(event.amount, evm.decimals) {
            Some(amount) => amount,
            None => {
                warn!(block_number, log_index, "Invalid deposit amount");
                state.last_evm_block = block_number;
                state.last_evm_log_index = log_index;
                save_state(&config.state_path, state)?;
                continue;
            }
        };

        let tx_hash = meta.transaction_hash;

        let source = tx_hash.as_bytes().to_vec();
        submit_instruction(
            client,
            admin_private,
            admin_public,
            nonce_tracker,
            Instruction::BridgeDeposit {
                recipient,
                amount: amount_rng,
                source,
            },
        )
        .await
        .with_context(|| "Failed to submit bridge deposit")?;

        info!(
            block_number,
            log_index,
            amount_rng,
            "Bridge deposit credited"
        );

        state.last_evm_block = block_number;
        state.last_evm_log_index = log_index;
        save_state(&config.state_path, state)?;
    }

    Ok(())
}

async fn scan_commonware_withdrawals(
    config: &RelayerConfig,
    client: &Client,
    admin_private: &PrivateKey,
    admin_public: &PublicKey,
    evm: &EvmContext,
    nonce_tracker: &mut NonceTracker,
    state: &mut RelayerState,
) -> Result<()> {
    let bridge_state = fetch_bridge_state(client).await?;
    reconcile_withdrawal_cursor(state, &bridge_state, &config.state_path)?;

    let mut processed = 0usize;
    while state.last_withdrawal_id < bridge_state.next_withdrawal_id
        && processed < 1000
    {
        let id = state.last_withdrawal_id;
        let withdrawal = fetch_withdrawal(client, id).await?;
        if withdrawal.fulfilled {
            state.last_withdrawal_id = id.saturating_add(1);
            processed += 1;
            continue;
        }
        state
            .pending_withdrawals
            .entry(id)
            .or_insert_with(PendingWithdrawal::new);
        state.last_withdrawal_id = id.saturating_add(1);
        processed += 1;
    }
    if processed > 0 {
        save_state(&config.state_path, state)?;
    }

    let now = current_view_time(client).await?;
    let latest_block = evm.provider.get_block_number().await?.as_u64();

    let pending_ids: Vec<u64> = state.pending_withdrawals.keys().cloned().collect();
    for id in pending_ids {
        let pending = match state.pending_withdrawals.get_mut(&id) {
            Some(pending) => pending,
            None => continue,
        };
        if pending.blocked {
            continue;
        }
        let withdrawal = match fetch_withdrawal(client, id).await {
            Ok(withdrawal) => withdrawal,
            Err(err) => {
                warn!(?err, id, "Failed to fetch withdrawal");
                continue;
            }
        };
        if withdrawal.fulfilled {
            state.pending_withdrawals.remove(&id);
            save_state(&config.state_path, state)?;
            continue;
        }
        if now < withdrawal.available_ts {
            continue;
        }

        if pending.evm_tx_hash.is_none() {
            let to = match destination_to_evm_address(&withdrawal.destination) {
                Some(addr) => addr,
                None => {
                    pending.block("Invalid withdrawal destination");
                    save_state(&config.state_path, state)?;
                    warn!(id, "Withdrawal destination invalid");
                    continue;
                }
            };
            let amount = rng_to_evm_amount(withdrawal.amount, evm.decimals)?;
            let source = withdrawal_source(&withdrawal);
            let lockbox = evm.lockbox.clone();
            let call = lockbox.withdraw(to, amount, source.into());
            let pending_tx = call
                .send()
                .await
                .context("Failed to send EVM withdrawal")?;
            let tx_hash = pending_tx.tx_hash();
            pending.evm_tx_hash = Some(format!("{:#x}", tx_hash));
            save_state(&config.state_path, state)?;
            info!(id, tx_hash = %format!("{:#x}", tx_hash), "EVM withdrawal submitted");
            continue;
        }

        let tx_hash = match pending
            .evm_tx_hash
            .as_ref()
            .and_then(|hash| H256::from_str(hash).ok())
        {
            Some(hash) => hash,
            None => {
                pending.evm_tx_hash = None;
                save_state(&config.state_path, state)?;
                continue;
            }
        };

        let receipt = evm.provider.get_transaction_receipt(tx_hash).await?;
        let Some(receipt) = receipt else {
            continue;
        };
        if receipt.status == Some(U64::zero()) {
            warn!(id, tx_hash = %format!("{:#x}", tx_hash), "EVM withdrawal reverted");
            pending.evm_tx_hash = None;
            save_state(&config.state_path, state)?;
            continue;
        }
        let receipt_block = receipt
            .block_number
            .map(|num| num.as_u64())
            .unwrap_or(0);
        if latest_block < receipt_block.saturating_add(evm.confirmations) {
            continue;
        }

        submit_instruction(
            client,
            admin_private,
            admin_public,
            nonce_tracker,
            Instruction::FinalizeBridgeWithdrawal {
                withdrawal_id: id,
                source: tx_hash.as_bytes().to_vec(),
            },
        )
        .await
        .context("Failed to finalize withdrawal")?;

        info!(id, "Bridge withdrawal finalized");
        state.pending_withdrawals.remove(&id);
        save_state(&config.state_path, state)?;
    }

    Ok(())
}

fn reconcile_withdrawal_cursor(
    state: &mut RelayerState,
    bridge_state: &BridgeState,
    state_path: &str,
) -> Result<()> {
    if bridge_state.next_withdrawal_id < state.last_withdrawal_id {
        warn!(
            local_cursor = state.last_withdrawal_id,
            chain_cursor = bridge_state.next_withdrawal_id,
            "Withdrawal cursor ahead of chain; resetting"
        );
        state.last_withdrawal_id = bridge_state.next_withdrawal_id;
        state.pending_withdrawals.clear();
        save_state(state_path, state)?;
    }
    Ok(())
}

async fn fetch_bridge_state(client: &Client) -> Result<BridgeState> {
    let lookup = client
        .query_state(&Key::BridgeState)
        .await?
        .ok_or_else(|| anyhow!("Bridge state missing"))?;
    match operation_value(&lookup.operation) {
        Some(Value::BridgeState(state)) => Ok(state.clone()),
        _ => Err(anyhow!("Unexpected bridge state value")),
    }
}

async fn fetch_withdrawal(client: &Client, id: u64) -> Result<BridgeWithdrawal> {
    let lookup = client
        .query_state(&Key::BridgeWithdrawal(id))
        .await?
        .ok_or_else(|| anyhow!("Withdrawal {id} not found"))?;
    match operation_value(&lookup.operation) {
        Some(Value::BridgeWithdrawal(withdrawal)) => Ok(withdrawal.clone()),
        _ => Err(anyhow!("Unexpected withdrawal value for {id}")),
    }
}

async fn current_view_time(client: &Client) -> Result<u64> {
    let seed = client
        .query_seed(Query::Latest)
        .await?
        .ok_or_else(|| anyhow!("No seed available"))?;
    Ok(seed.view().get().saturating_mul(VIEW_SECONDS))
}

async fn submit_instruction(
    client: &Client,
    admin_private: &PrivateKey,
    admin_public: &PublicKey,
    nonce_tracker: &mut NonceTracker,
    instruction: Instruction,
) -> Result<()> {
    let nonce = nonce_tracker.next(client, admin_public).await?;
    let tx = Transaction::sign(admin_private, nonce, instruction);
    if let Err(err) = client.submit_transactions(vec![tx]).await {
        nonce_tracker.sync(client, admin_public).await?;
        return Err(anyhow!("Submit failed: {err}"));
    }
    Ok(())
}

fn destination_to_public_key(destination: [u8; 32]) -> Option<PublicKey> {
    let mut reader: &[u8] = &destination;
    let public = PublicKey::read(&mut reader).ok()?;
    if !reader.is_empty() {
        return None;
    }
    Some(public)
}

fn destination_to_evm_address(destination: &[u8]) -> Option<Address> {
    match destination.len() {
        20 => Some(Address::from_slice(destination)),
        32 => {
            let (prefix, suffix) = destination.split_at(12);
            if prefix.iter().any(|byte| *byte != 0) {
                return None;
            }
            Some(Address::from_slice(suffix))
        }
        _ => None,
    }
}

fn evm_amount_to_rng(amount: U256, decimals: u32) -> Option<u64> {
    let scale = U256::from(10u64).pow(U256::from(decimals));
    if scale.is_zero() {
        return None;
    }
    let remainder = amount % scale;
    if !remainder.is_zero() {
        return None;
    }
    let whole = amount / scale;
    if whole > U256::from(u64::MAX) {
        return None;
    }
    Some(whole.as_u64())
}

fn rng_to_evm_amount(amount: u64, decimals: u32) -> Result<U256> {
    let scale = U256::from(10u64).pow(U256::from(decimals));
    Ok(U256::from(amount).saturating_mul(scale))
}

fn withdrawal_source(withdrawal: &BridgeWithdrawal) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&withdrawal.id.to_be_bytes());
    hasher.update(withdrawal.player.as_ref());
    hasher.update(&withdrawal.amount.to_be_bytes());
    hasher.update(&withdrawal.destination);
    hasher.finalize().0
}
