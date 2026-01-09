# E30 - Bridge & Cross-Chain Asset Transfer (from scratch)

Focus files:
- `execution/src/layer/handlers/bridge.rs` (323 LOC)
- `client/src/bin/bridge_relayer.rs` (747 LOC)
- `evm/contracts/BridgeLockbox.sol` (33 LOC)

Goal: explain how the bridge enables cross-chain asset transfer between Commonware's execution layer and EVM chains. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Cross-chain bridges connect independent chains
A bridge is a protocol that allows assets to move between two independent blockchain networks. In this system, the bridge connects the Commonware execution layer (where casino gameplay happens) with EVM chains (like Ethereum or Base).

### 2) Lockbox pattern: custody on one side, credits on the other
The lockbox pattern works like an escrow:
- On the EVM side, tokens are locked in a smart contract (BridgeLockbox).
- On the Commonware side, equivalent credits are minted or burned.
- The total supply remains constant across both chains.

### 3) Deposits flow from EVM to Commonware
When a user deposits:
1. User calls `deposit()` on the EVM lockbox contract
2. EVM tokens are transferred to the lockbox
3. A relayer watches for `Deposited` events
4. The relayer submits a `BridgeDeposit` instruction to Commonware
5. The user receives RNG chips in their casino account

### 4) Withdrawals flow from Commonware to EVM
When a user withdraws:
1. User submits `BridgeWithdraw` instruction on Commonware
2. RNG chips are burned from their casino balance
3. A withdrawal record is created with a delay period
4. After the delay, a relayer calls `withdraw()` on the lockbox
5. After EVM confirmation, the relayer finalizes the withdrawal on Commonware

### 5) Daily limits prevent catastrophic loss
The bridge enforces two layers of rate limiting:
- **Global daily limit**: maximum total withdrawals per day across all users
- **Per-account daily limit**: maximum withdrawals per user per day

This protects the system from exploits, bugs, or malicious draining.

### 6) Bridge relayer is the trusted operator
The relayer is an off-chain service that:
- Monitors EVM deposit events
- Monitors Commonware withdrawal requests
- Submits cross-chain transactions
- Tracks state persistence to avoid duplicate processing

The relayer holds admin keys for Commonware and owner keys for the EVM lockbox, making it a critical trust point.

---

## Walkthrough with code excerpts

### 1) BridgeLockbox contract: the EVM custody layer

```solidity
contract BridgeLockbox is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable rng;

    event Deposited(address indexed from, uint256 amount, bytes32 destination);
    event Withdrawn(address indexed to, uint256 amount, bytes32 source);

    function deposit(uint256 amount, bytes32 destination) external {
        require(amount > 0, "BridgeLockbox: amount=0");
        rng.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, destination);
    }

    function withdraw(address to, uint256 amount, bytes32 source) external onlyOwner {
        require(to != address(0), "BridgeLockbox: to=0");
        require(amount > 0, "BridgeLockbox: amount=0");
        rng.safeTransfer(to, amount);
        emit Withdrawn(to, amount, source);
    }
}
```
*From `evm/contracts/BridgeLockbox.sol`, lines 20-31*

Why this matters:
- The lockbox is the only place EVM tokens can be held for bridging. If this contract has a bug, the entire bridge is compromised.

What this code does:
- `deposit()` accepts ERC20 tokens from the user and emits a `Deposited` event with a `destination` (the Commonware public key).
- `withdraw()` is owner-only and sends tokens back to users after withdrawal verification.
- Uses OpenZeppelin's SafeERC20 to handle token transfers safely.

---

### 2) Bridge withdrawal handler: user initiates withdrawal

```rust
pub(in crate::layer) async fn handle_bridge_withdraw(
    &mut self,
    public: &PublicKey,
    amount: u64,
    destination: &[u8],
) -> anyhow::Result<Vec<Event>> {
    if amount == 0 {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Bridge withdraw amount must be > 0",
        ));
    }
    if !validate_destination_bytes(destination) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Invalid bridge destination (expected 20 or 32 bytes)",
        ));
    }

    let policy = self.get_or_init_policy().await?;
    if policy.bridge_paused {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Bridge is paused",
        ));
    }
```
*From `execution/src/layer/handlers/bridge.rs`, lines 40-71*

Why this matters:
- This is the entry point for all withdrawals. Each guard protects against a different failure mode.

What this code does:
- Validates that amount is non-zero.
- Validates destination is either 20 bytes (Ethereum address) or 32 bytes (full encoded address).
- Checks if the bridge is paused (emergency stop mechanism).

---

### 3) Global and per-account daily limits

```rust
let bridge_daily_after = bridge.daily_withdrawn.saturating_add(amount);
if bridge_daily_after > policy.bridge_daily_limit {
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_RATE_LIMITED,
        "Bridge daily cap reached",
    ));
}

let account_daily_after = player.session.bridge_daily_withdrawn.saturating_add(amount);
if account_daily_after > policy.bridge_daily_limit_per_account {
    return Ok(casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_RATE_LIMITED,
        "Account bridge daily cap reached",
    ));
}
```
*From `execution/src/layer/handlers/bridge.rs`, lines 124-142*

Why this matters:
- These limits are the primary defense against exploits. If an attacker finds a way to generate unlimited withdrawals, these limits cap the damage to one day's worth.

What this code does:
- Projects what the global daily total would be after this withdrawal and rejects if it exceeds the limit.
- Projects what the user's daily total would be and rejects if it exceeds their personal limit.
- Uses saturating arithmetic to avoid overflow.

---

### 4) Daily limit reset logic

```rust
fn reset_bridge_daily_if_needed(
    bridge: &mut nullspace_types::casino::BridgeState,
    current_day: u64,
) {
    if bridge.daily_day != current_day {
        bridge.daily_day = current_day;
        bridge.daily_withdrawn = 0;
    }
}

fn reset_player_bridge_daily_if_needed(
    player: &mut nullspace_types::casino::Player,
    current_day: u64,
) {
    if player.session.bridge_daily_day != current_day {
        player.session.bridge_daily_day = current_day;
        player.session.bridge_daily_withdrawn = 0;
    }
}
```
*From `execution/src/layer/handlers/bridge.rs`, lines 11-29*

Why this matters:
- Daily limits only make sense if they reset. This logic ensures that each new day starts with a fresh counter.

What this code does:
- Compares stored day to current day (derived from block time).
- If the day changed, resets the withdrawal counter to zero.
- Operates on both global bridge state and per-player state.

---

### 5) Withdrawal creation with delay

```rust
let requested_ts = now;
let available_ts = now.saturating_add(policy.bridge_delay_secs);
let withdrawal = nullspace_types::casino::BridgeWithdrawal {
    id: withdrawal_id,
    player: public.clone(),
    amount,
    destination: destination.to_vec(),
    requested_ts,
    available_ts,
    fulfilled: false,
};

self.insert(
    Key::BridgeWithdrawal(withdrawal_id),
    Value::BridgeWithdrawal(withdrawal),
);

Ok(vec![Event::BridgeWithdrawalRequested {
    id: withdrawal_id,
    player: public.clone(),
    amount,
    destination: destination.to_vec(),
    requested_ts,
    available_ts,
    player_balances,
    bridge,
}])
```
*From `execution/src/layer/handlers/bridge.rs`, lines 154-183*

Why this matters:
- The delay period (`bridge_delay_secs`) gives the system time to detect fraud or bugs before assets leave the chain. It's a safety buffer.

What this code does:
- Burns the user's chips immediately.
- Creates a withdrawal record with a future `available_ts`.
- Emits `BridgeWithdrawalRequested` so the relayer can watch for it.
- The withdrawal cannot be fulfilled until `available_ts` is reached.

---

### 6) Bridge deposit handler: relayer credits user

```rust
pub(in crate::layer) async fn handle_bridge_deposit(
    &mut self,
    public: &PublicKey,
    recipient: &PublicKey,
    amount: u64,
    source: &[u8],
) -> anyhow::Result<Vec<Event>> {
    if !super::is_admin_public_key(public) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_UNAUTHORIZED,
            "Unauthorized admin instruction",
        ));
    }
    if amount == 0 {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Bridge deposit amount must be > 0",
        ));
    }
    if !validate_source_bytes(source) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Invalid bridge source",
        ));
    }

    let mut player = match self.get(Key::CasinoPlayer(recipient.clone())).await? {
        Some(Value::CasinoPlayer(player)) => player,
        _ => {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_PLAYER_NOT_FOUND,
                "Recipient not found",
            ))
        }
    };

    player.balances.chips = player.balances.chips.saturating_add(amount);

    let mut bridge = self.get_or_init_bridge_state().await?;
    bridge.total_deposited = bridge.total_deposited.saturating_add(amount);

    Ok(vec![Event::BridgeDepositCredited {
        admin: public.clone(),
        recipient: recipient.clone(),
        amount,
        source: source.to_vec(),
        player_balances,
        bridge,
    }])
}
```
*From `execution/src/layer/handlers/bridge.rs`, lines 186-249*

Why this matters:
- Only the admin (the relayer) can credit deposits. If unauthorized users could call this, they could mint unlimited chips.

What this code does:
- Verifies the caller is an admin.
- Validates the amount and source (EVM transaction hash).
- Adds chips to the recipient's balance.
- Increments global `total_deposited` counter.
- Emits `BridgeDepositCredited` event.

---

### 7) Finalize withdrawal: relayer confirms EVM transfer

```rust
pub(in crate::layer) async fn handle_finalize_bridge_withdrawal(
    &mut self,
    public: &PublicKey,
    withdrawal_id: u64,
    source: &[u8],
) -> anyhow::Result<Vec<Event>> {
    if !super::is_admin_public_key(public) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_UNAUTHORIZED,
            "Unauthorized admin instruction",
        ));
    }

    let mut withdrawal = match self.get(Key::BridgeWithdrawal(withdrawal_id)).await? {
        Some(Value::BridgeWithdrawal(withdrawal)) => withdrawal,
        _ => {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Bridge withdrawal not found",
            ))
        }
    };

    if withdrawal.fulfilled {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Bridge withdrawal already finalized",
        ));
    }

    let now = current_time_sec(self.seed_view);
    if now < withdrawal.available_ts {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_RATE_LIMITED,
            "Bridge withdrawal delay not elapsed",
        ));
    }

    withdrawal.fulfilled = true;
    self.insert(
        Key::BridgeWithdrawal(withdrawal_id),
        Value::BridgeWithdrawal(withdrawal.clone()),
    );

    Ok(vec![Event::BridgeWithdrawalFinalized {
        id: withdrawal_id,
        admin: public.clone(),
        amount: withdrawal.amount,
        source: source.to_vec(),
        fulfilled_ts: now,
        bridge,
    }])
}
```
*From `execution/src/layer/handlers/bridge.rs`, lines 252-321*

Why this matters:
- This marks a withdrawal as complete after the EVM transaction succeeds. Without this, the withdrawal remains "pending" forever.

What this code does:
- Verifies caller is admin (the relayer).
- Loads the withdrawal and checks it's not already fulfilled.
- Enforces that the delay period has elapsed.
- Marks the withdrawal as fulfilled.
- Emits `BridgeWithdrawalFinalized` with the EVM transaction hash as `source`.

---

### 8) Bridge relayer: main event loop

```rust
#[tokio::main]
async fn main() -> Result<()> {
    // ... setup code ...

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
```
*From `client/src/bin/bridge_relayer.rs`, lines 192-267*

Why this matters:
- The relayer is the bridge's heart. If it stops, deposits and withdrawals halt.

What this code does:
- Runs an infinite loop.
- Each iteration scans for EVM deposits and Commonware withdrawals.
- Errors are logged but don't crash the loop (fail-soft).
- Sleeps between iterations to avoid hammering the chains.

---

### 9) Scanning EVM deposits

```rust
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

    // ... process each event ...
}
```
*From `client/src/bin/bridge_relayer.rs`, lines 384-426*

Why this matters:
- The relayer must only process confirmed blocks to avoid reorgs. If it processes an unconfirmed deposit and the block gets reorged, the user gets free chips.

What this code does:
- Queries the latest EVM block.
- Computes `finalized_block` by subtracting `evm.confirmations`.
- Queries `Deposited` events in a limited range (to avoid API timeouts).
- Sorts events by block number and log index for deterministic processing.

---

### 10) Processing a deposit event

```rust
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
```
*From `client/src/bin/bridge_relayer.rs`, lines 428-488*

Why this matters:
- This is where EVM deposits become Commonware credits. Each event must be processed exactly once.

What this code does:
- Skips already-processed events (idempotency).
- Decodes the `destination` as a Commonware public key.
- Converts EVM token amount (e.g., 18 decimals) to RNG amount (whole units).
- Submits a `BridgeDeposit` instruction using the admin key.
- Updates state and persists to disk after each successful submission.

---

### 11) Scanning Commonware withdrawals

```rust
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

    // ... process pending withdrawals ...
}
```
*From `client/src/bin/bridge_relayer.rs`, lines 493-525*

Why this matters:
- The relayer must track which withdrawals are pending and which are fulfilled. This scanning phase builds the work queue.

What this code does:
- Fetches the global bridge state to see the latest withdrawal ID.
- Reconciles the local cursor (in case the chain reset or the relayer fell behind).
- Iterates through new withdrawal IDs.
- Skips already-fulfilled withdrawals.
- Adds unfulfilled withdrawals to the pending queue.

---

### 12) Processing a pending withdrawal

```rust
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
        let call = lockbox.withdraw(to, amount, source);
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

    // ... wait for EVM confirmation and finalize ...
}
```
*From `client/src/bin/bridge_relayer.rs`, lines 531-627*

Why this matters:
- This is the withdrawal fulfillment logic. Each step is state-persisted to survive crashes.

What this code does:
- Skips withdrawals that are blocked or not yet available.
- Decodes the destination as an EVM address.
- Converts RNG amount to EVM token amount (e.g., multiply by 10^18).
- Calls `lockbox.withdraw()` on the EVM chain.
- Stores the EVM transaction hash.
- After confirmation, submits `FinalizeBridgeWithdrawal` to Commonware.

---

### 13) Withdrawal source hashing

```rust
fn withdrawal_source(withdrawal: &BridgeWithdrawal) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&withdrawal.id.to_be_bytes());
    hasher.update(withdrawal.player.as_ref());
    hasher.update(&withdrawal.amount.to_be_bytes());
    hasher.update(&withdrawal.destination);
    hasher.finalize().0
}
```
*From `client/src/bin/bridge_relayer.rs`, lines 740-747*

Why this matters:
- The `source` in the EVM `Withdrawn` event is a cryptographic commitment to the Commonware withdrawal. This allows anyone to verify the EVM withdrawal corresponds to a specific Commonware request.

What this code does:
- Hashes the withdrawal ID, player, amount, and destination.
- Returns a 32-byte hash used as the `source` parameter in the EVM contract.

---

### 14) State persistence for crash recovery

```rust
#[derive(Debug, Serialize, Deserialize)]
struct RelayerState {
    last_evm_block: u64,
    last_evm_log_index: u64,
    last_withdrawal_id: u64,
    pending_withdrawals: HashMap<u64, PendingWithdrawal>,
}

fn save_state(path: &str, state: &RelayerState) -> Result<()> {
    let data = serde_json::to_vec_pretty(state).context("Failed to serialize relayer state")?;
    let tmp_path = format!("{path}.tmp");
    fs::write(&tmp_path, data).context("Failed to write relayer state")?;
    fs::rename(tmp_path, path).context("Failed to replace relayer state")?;
    Ok(())
}
```
*From `client/src/bin/bridge_relayer.rs`, lines 138-350*

Why this matters:
- If the relayer crashes, it can resume from the last saved state without reprocessing events or losing track of pending withdrawals.

What this code does:
- Serializes state to JSON.
- Writes to a temporary file first, then atomically renames (to avoid corruption).
- Tracks the last processed EVM block/log and withdrawal ID.

---

## Limits & management callouts

### Configurable policy limits
All bridge limits are stored in the `Policy` state:
- `bridge_paused`: emergency stop
- `bridge_daily_limit`: global daily withdrawal cap
- `bridge_daily_limit_per_account`: per-user daily cap
- `bridge_min_withdraw`: minimum withdrawal size
- `bridge_max_withdraw`: maximum withdrawal size
- `bridge_delay_secs`: delay before withdrawal can be fulfilled

These can be updated by admin instructions without code changes.

### Emergency pause
The `bridge_paused` flag allows admins to halt all withdrawals instantly if an exploit is detected. Deposits can still be credited (to prevent user funds from being stuck on the EVM side).

### Relayer as trusted component
The relayer holds:
- Commonware admin private key (to submit deposits and finalize withdrawals)
- EVM lockbox owner private key (to call `withdraw()`)

If the relayer is compromised, an attacker could:
- Credit arbitrary deposits (print free chips)
- Prevent withdrawals from being fulfilled
- Drain the lockbox

Mitigations:
- Run the relayer in a secure environment with key management
- Monitor relayer logs for anomalies
- Set conservative daily limits

### Confirmation depth
The relayer waits for `evm_confirmations` blocks before processing deposits or finalizing withdrawals. This protects against:
- EVM chain reorgs (deposits)
- Withdrawal transaction reversal (withdrawals)

Typical values: 3-12 confirmations depending on chain security.

### Idempotency and crash safety
The relayer persists state after every processed event. If it crashes and restarts:
- It resumes from the last saved block/log index
- It does not reprocess deposits
- It resumes pending withdrawals from their last known state

This is critical for operational reliability.

---

## Key takeaways

**Cross-chain bridge architecture:**
- EVM lockbox holds custody of tokens
- Commonware execution layer mints/burns equivalent credits
- Bridge relayer synchronizes state between chains

**Security through limits:**
- Global and per-account daily withdrawal limits
- Withdrawal delay period for fraud detection
- Emergency pause mechanism
- Admin-only deposit crediting

**Relayer operations:**
- Monitors EVM deposit events with confirmation depth
- Monitors Commonware withdrawal requests
- Submits cross-chain transactions with nonce tracking
- Persists state for crash recovery

**Trust model:**
- Relayer is a trusted operator with admin/owner keys
- Bridge limits cap maximum damage from exploits
- Confirmation depth protects against reorgs

**Dual direction flow:**
- Deposits: EVM lockbox → relayer watches → Commonware credits
- Withdrawals: Commonware burns → delay → relayer executes → EVM transfer → finalize

---

## Feynman mental model

Imagine a bank vault (the EVM lockbox) and a casino cage (the Commonware execution layer).

**Depositing:**
1. You put cash in the vault and ring a bell
2. A courier (the relayer) hears the bell, verifies the cash, and walks to the casino
3. The casino cage gives you chips equal to the cash value

**Withdrawing:**
1. You hand your chips to the casino cage
2. They write an IOU with a future date (the delay)
3. After the date, a courier takes the IOU to the vault
4. The vault gives the courier cash
5. The courier delivers it to you, then reports back to the casino

**Safety:**
- The vault has a daily withdrawal limit
- Each person has a personal daily limit
- There's a delay between IOU and payout (fraud detection window)
- The manager can hit an emergency stop button

The bridge is the courier service. If the courier disappears, money is stuck (but not lost, because the vault is still secure).

---

## Exercises for mastery

1. **Trace a full deposit flow:** A user deposits 100 RNG tokens on the EVM lockbox. List every function call, event emission, and state change from the moment the EVM transaction is confirmed to when the user sees chips in their Commonware balance.

2. **Daily limit edge case:** The global daily limit is 10,000 RNG and per-account limit is 1,000 RNG. User A withdraws 9,500 RNG. User B tries to withdraw 600 RNG. What happens? Why?

3. **Delay period reasoning:** The withdrawal delay is set to 3600 seconds (1 hour). A user requests a withdrawal at view 1000 (time 3000 seconds). At what view can the relayer fulfill the withdrawal? What happens if the relayer tries to finalize it early?

4. **Relayer crash recovery:** The relayer processed EVM deposit events up to block 1000, log index 5. It crashes. When it restarts, what state does it load? How does it avoid reprocessing the same deposits?

5. **Exploit scenario:** An attacker finds a bug that lets them bypass the daily limit check. They submit 100 withdrawals of 1,000 RNG each. The bridge pauses after 10 withdrawals. How much RNG is at risk? What prevents the other 90 withdrawals from being fulfilled?

6. **Decimal conversion:** The EVM token has 18 decimals. A user withdraws 1 RNG chip from Commonware. What `amount` is passed to the EVM `lockbox.withdraw()` call? What happens if the user tries to withdraw 0.5 RNG?

7. **Destination encoding:** A user submits a withdrawal with a 20-byte EVM address as the destination. How is this validated in `handle_bridge_withdraw()`? What happens if they submit 21 bytes? What happens if they submit 32 bytes?

8. **Source verification:** After an EVM withdrawal transaction succeeds, the relayer submits `FinalizeBridgeWithdrawal` with the EVM tx hash as the `source`. Why is this important? What could go wrong if the relayer used a fake source?

If you can answer these, you deeply understand the bridge architecture and can reason about security, reliability, and operational tradeoffs.
