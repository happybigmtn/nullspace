use super::casino_error_vec;
use super::super::*;

const SECONDS_PER_DAY: u64 = 24 * 60 * 60;
const MAX_BRIDGE_BYTES: usize = 64;

fn current_time_sec(view: u64) -> u64 {
    view.saturating_mul(3)
}

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

fn validate_destination_bytes(destination: &[u8]) -> bool {
    matches!(destination.len(), 20 | 32)
}

fn validate_source_bytes(source: &[u8]) -> bool {
    !source.is_empty() && source.len() <= MAX_BRIDGE_BYTES
}

impl<'a, S: State> Layer<'a, S> {
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
        if policy.bridge_daily_limit == 0 || policy.bridge_daily_limit_per_account == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Bridge limits not configured",
            ));
        }
        if policy.bridge_min_withdraw > 0 && amount < policy.bridge_min_withdraw {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Bridge withdraw below minimum",
            ));
        }
        if policy.bridge_max_withdraw > 0 && amount > policy.bridge_max_withdraw {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Bridge withdraw above maximum",
            ));
        }

        let mut player = match self.get(Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(player)) => player,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_PLAYER_NOT_FOUND,
                    "Player not found",
                ))
            }
        };
        if player.balances.chips < amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient RNG balance",
            ));
        }

        let now = current_time_sec(self.seed_view);
        let current_day = now / SECONDS_PER_DAY;
        reset_player_bridge_daily_if_needed(&mut player, current_day);

        let mut bridge = self.get_or_init_bridge_state().await?;
        reset_bridge_daily_if_needed(&mut bridge, current_day);

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

        player.balances.chips = player.balances.chips.saturating_sub(amount);
        player.session.bridge_daily_day = current_day;
        player.session.bridge_daily_withdrawn = account_daily_after;

        bridge.daily_day = current_day;
        bridge.daily_withdrawn = bridge_daily_after;
        bridge.total_withdrawn = bridge.total_withdrawn.saturating_add(amount);
        let withdrawal_id = bridge.next_withdrawal_id;
        bridge.next_withdrawal_id = bridge.next_withdrawal_id.saturating_add(1);

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

        let player_balances = nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        self.insert(Key::CasinoPlayer(public.clone()), Value::CasinoPlayer(player.clone()));
        self.insert(Key::BridgeState, Value::BridgeState(bridge.clone()));
        self.insert(
            Key::BridgeWithdrawal(withdrawal_id),
            Value::BridgeWithdrawal(withdrawal),
        );

        // Create ledger entry for withdrawal request
        let mut ledger = self.get_or_init_ledger_state().await?;
        let ledger_entry_id = ledger.next_entry_id;
        ledger.next_entry_id = ledger.next_entry_id.saturating_add(1);
        ledger.total_withdrawal_requests = ledger.total_withdrawal_requests.saturating_add(amount);
        ledger.pending_reconciliation_count = ledger.pending_reconciliation_count.saturating_add(1);

        let ledger_entry = nullspace_types::casino::LedgerEntry {
            id: ledger_entry_id,
            entry_type: nullspace_types::casino::LedgerEntryType::WithdrawalRequest,
            player: public.clone(),
            amount,
            created_ts: requested_ts,
            chain_ref: destination.to_vec(),
            reconciliation_status: nullspace_types::casino::ReconciliationStatus::Pending,
            reconciled_ts: 0,
            balance_after: player.balances.chips,
            withdrawal_id: Some(withdrawal_id),
        };

        self.insert(Key::LedgerState, Value::LedgerState(ledger));
        self.insert(
            Key::LedgerEntry(ledger_entry_id),
            Value::LedgerEntry(ledger_entry),
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
    }

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

        // Create ledger entry for deposit
        let now = current_time_sec(self.seed_view);
        let mut ledger = self.get_or_init_ledger_state().await?;
        let ledger_entry_id = ledger.next_entry_id;
        ledger.next_entry_id = ledger.next_entry_id.saturating_add(1);
        ledger.total_deposits = ledger.total_deposits.saturating_add(amount);
        ledger.pending_reconciliation_count = ledger.pending_reconciliation_count.saturating_add(1);

        let ledger_entry = nullspace_types::casino::LedgerEntry {
            id: ledger_entry_id,
            entry_type: nullspace_types::casino::LedgerEntryType::Deposit,
            player: recipient.clone(),
            amount,
            created_ts: now,
            chain_ref: source.to_vec(),
            reconciliation_status: nullspace_types::casino::ReconciliationStatus::Pending,
            reconciled_ts: 0,
            balance_after: player.balances.chips,
            withdrawal_id: None,
        };

        let player_balances = nullspace_types::casino::PlayerBalanceSnapshot::from_player(&player);
        self.insert(
            Key::CasinoPlayer(recipient.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::BridgeState, Value::BridgeState(bridge.clone()));
        self.insert(Key::LedgerState, Value::LedgerState(ledger));
        self.insert(
            Key::LedgerEntry(ledger_entry_id),
            Value::LedgerEntry(ledger_entry),
        );

        Ok(vec![Event::BridgeDepositCredited {
            admin: public.clone(),
            recipient: recipient.clone(),
            amount,
            source: source.to_vec(),
            player_balances,
            bridge,
        }])
    }

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
        if !validate_source_bytes(source) {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Invalid bridge source",
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

        // Create ledger entry for withdrawal fulfillment (chain reconciliation)
        let mut ledger = self.get_or_init_ledger_state().await?;
        let ledger_entry_id = ledger.next_entry_id;
        ledger.next_entry_id = ledger.next_entry_id.saturating_add(1);
        ledger.total_withdrawals_fulfilled = ledger
            .total_withdrawals_fulfilled
            .saturating_add(withdrawal.amount);
        ledger.last_reconciled_id = ledger_entry_id;
        ledger.last_reconciliation_ts = now;
        // Decrement pending count (the original request is now reconciled)
        ledger.pending_reconciliation_count = ledger.pending_reconciliation_count.saturating_sub(1);

        let ledger_entry = nullspace_types::casino::LedgerEntry {
            id: ledger_entry_id,
            entry_type: nullspace_types::casino::LedgerEntryType::WithdrawalFulfilled,
            player: withdrawal.player.clone(),
            amount: withdrawal.amount,
            created_ts: now,
            chain_ref: source.to_vec(),
            reconciliation_status: nullspace_types::casino::ReconciliationStatus::Verified,
            reconciled_ts: now,
            balance_after: 0, // Balance already deducted at request time
            withdrawal_id: Some(withdrawal_id),
        };

        self.insert(Key::LedgerState, Value::LedgerState(ledger));
        self.insert(
            Key::LedgerEntry(ledger_entry_id),
            Value::LedgerEntry(ledger_entry),
        );

        let bridge = self.get_or_init_bridge_state().await?;
        Ok(vec![Event::BridgeWithdrawalFinalized {
            id: withdrawal_id,
            admin: public.clone(),
            amount: withdrawal.amount,
            source: source.to_vec(),
            fulfilled_ts: now,
            bridge,
        }])
    }
}
