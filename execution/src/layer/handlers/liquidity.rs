use super::super::*;
use super::casino_error_vec;

const BASIS_POINTS_SCALE: u128 = 10_000;
const MAX_BASIS_POINTS: u16 = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SwapQuote {
    amount_out: u64,
    fee_amount: u64,
}

fn rng_price_ratio(
    reserve_rng: u64,
    reserve_vusdt: u64,
    bootstrap_price_vusdt_numerator: u64,
    bootstrap_price_rng_denominator: u64,
) -> (u128, u128) {
    if reserve_rng > 0 {
        (reserve_vusdt as u128, reserve_rng as u128)
    } else {
        (
            bootstrap_price_vusdt_numerator as u128,
            bootstrap_price_rng_denominator as u128,
        )
    }
}

fn constant_product_quote(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_basis_points: u16,
) -> Option<SwapQuote> {
    if fee_basis_points > MAX_BASIS_POINTS {
        return None;
    }
    let fee_amount =
        (amount_in as u128).checked_mul(fee_basis_points as u128)? / BASIS_POINTS_SCALE;
    let net_in = (amount_in as u128).checked_sub(fee_amount)?;

    let amount_in_with_fee = net_in.checked_mul(BASIS_POINTS_SCALE)?;
    let numerator = amount_in_with_fee.checked_mul(reserve_out as u128)?;
    let denominator = (reserve_in as u128)
        .checked_mul(BASIS_POINTS_SCALE)?
        .checked_add(amount_in_with_fee)?;

    if denominator == 0 {
        return None;
    }

    let amount_out = numerator / denominator;
    let amount_out: u64 = amount_out.try_into().ok()?;

    Some(SwapQuote {
        amount_out,
        fee_amount: fee_amount as u64,
    })
}

fn validate_amm_state(amm: &nullspace_types::casino::AmmPool) -> Result<(), &'static str> {
    if amm.fee_basis_points > MAX_BASIS_POINTS || amm.sell_tax_basis_points > MAX_BASIS_POINTS {
        return Err("invalid basis points");
    }
    if amm.bootstrap_price_rng_denominator == 0 {
        return Err("invalid bootstrap price");
    }

    match amm.total_shares {
        0 => {
            if amm.reserve_rng != 0 || amm.reserve_vusdt != 0 {
                return Err("non-zero reserves with zero shares");
            }
        }
        _ => {
            if amm.total_shares < MINIMUM_LIQUIDITY {
                return Err("total_shares below MINIMUM_LIQUIDITY");
            }
            if amm.reserve_rng == 0 || amm.reserve_vusdt == 0 {
                return Err("zero reserves with non-zero shares");
            }
        }
    }

    Ok(())
}

fn invalid_amm_state(public: &PublicKey) -> Vec<Event> {
    casino_error_vec(
        public,
        None,
        nullspace_types::casino::ERROR_INVALID_MOVE,
        "Invalid AMM state",
    )
}

impl<'a, S: State> Layer<'a, S> {
    // === Liquidity / Vault Handlers ===

    pub(in crate::layer) async fn handle_create_vault(
        &mut self,
        public: &PublicKey,
    ) -> anyhow::Result<Vec<Event>> {
        if self.get(&Key::Vault(public.clone())).await?.is_some() {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE, // Reuse
                "Vault already exists",
            ));
        }

        let vault = nullspace_types::casino::Vault::default();
        self.insert(Key::Vault(public.clone()), Value::Vault(vault));
        Ok(vec![Event::VaultCreated {
            player: public.clone(),
        }])
    }

    pub(in crate::layer) async fn handle_deposit_collateral(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        if player.balances.chips < amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient chips",
            ));
        }

        let mut vault = match self.get(&Key::Vault(public.clone())).await? {
            Some(Value::Vault(v)) => v,
            _ => {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Vault not found",
                ))
            }
        };

        let Some(new_collateral) = vault.collateral_rng.checked_add(amount) else {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Collateral amount overflow",
            ));
        };

        player.balances.chips -= amount;
        vault.collateral_rng = new_collateral;

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::Vault(public.clone()), Value::Vault(vault));

        Ok(vec![Event::CollateralDeposited {
            player: public.clone(),
            amount,
            new_collateral,
        }])
    }

    pub(in crate::layer) async fn handle_borrow_usdt(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut vault = match self.get(&Key::Vault(public.clone())).await? {
            Some(Value::Vault(v)) => v,
            _ => return Ok(vec![]),
        };

        let amm = self.get_or_init_amm().await?;
        let (price_numerator, price_denominator) = rng_price_ratio(
            amm.reserve_rng,
            amm.reserve_vusdt,
            amm.bootstrap_price_vusdt_numerator,
            amm.bootstrap_price_rng_denominator,
        );

        // LTV Calculation: Max Debt = (Collateral * Price) * 50%
        // Debt <= (Collateral * P_num / P_den) / 2
        // 2 * Debt * P_den <= Collateral * P_num
        let Some(new_debt) = vault.debt_vusdt.checked_add(amount) else {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Debt amount overflow",
            ));
        };

        let lhs = (new_debt as u128)
            .saturating_mul(2)
            .saturating_mul(price_denominator);
        let rhs = (vault.collateral_rng as u128).saturating_mul(price_numerator);

        if lhs > rhs {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Insufficient collateral (Max 50% LTV)",
            ));
        }

        // Update Vault
        vault.debt_vusdt = new_debt;

        // Mint vUSDT to Player (if the player exists).
        let mut updated_player = None;
        if let Some(Value::CasinoPlayer(mut player)) =
            self.get(&Key::CasinoPlayer(public.clone())).await?
        {
            let Some(new_balance) = player.balances.vusdt_balance.checked_add(amount) else {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "vUSDT balance overflow",
                ));
            };
            player.balances.vusdt_balance = new_balance;
            updated_player = Some(player);
        }

        self.insert(Key::Vault(public.clone()), Value::Vault(vault));
        if let Some(player) = updated_player {
            self.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(player),
            );
        }

        Ok(vec![Event::VusdtBorrowed {
            player: public.clone(),
            amount,
            new_debt,
        }])
    }

    pub(in crate::layer) async fn handle_repay_usdt(
        &mut self,
        public: &PublicKey,
        amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        let mut vault = match self.get(&Key::Vault(public.clone())).await? {
            Some(Value::Vault(v)) => v,
            _ => return Ok(vec![]),
        };

        if player.balances.vusdt_balance < amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient vUSDT",
            ));
        }

        let actual_repay = amount.min(vault.debt_vusdt);

        player.balances.vusdt_balance -= actual_repay;
        vault.debt_vusdt -= actual_repay;
        let new_debt = vault.debt_vusdt;

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::Vault(public.clone()), Value::Vault(vault));

        Ok(vec![Event::VusdtRepaid {
            player: public.clone(),
            amount: actual_repay,
            new_debt,
        }])
    }

    pub(in crate::layer) async fn handle_swap(
        &mut self,
        public: &PublicKey,
        mut amount_in: u64,
        min_amount_out: u64,
        is_buying_rng: bool,
    ) -> anyhow::Result<Vec<Event>> {
        let original_amount_in = amount_in;
        let mut amm = self.get_or_init_amm().await?;
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        if amount_in == 0 {
            return Ok(vec![]);
        }

        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }

        if amm.reserve_rng == 0 || amm.reserve_vusdt == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "AMM has zero liquidity",
            ));
        }

        // Apply Sell Tax (if Selling RNG)
        let mut burned_amount = 0;
        if !is_buying_rng {
            // Sell Tax: 5% (default)
            burned_amount =
                (amount_in as u128 * amm.sell_tax_basis_points as u128 / BASIS_POINTS_SCALE) as u64;
            if burned_amount > 0 {
                // Deduct tax from input amount
                let Some(net_amount_in) = amount_in.checked_sub(burned_amount) else {
                    return Ok(invalid_amm_state(public));
                };
                amount_in = net_amount_in;
            }
        }

        // Reserves (u128 for safety)
        let (reserve_in, reserve_out) = if is_buying_rng {
            (amm.reserve_vusdt, amm.reserve_rng)
        } else {
            (amm.reserve_rng, amm.reserve_vusdt)
        };

        let Some(SwapQuote {
            amount_out,
            fee_amount,
        }) = constant_product_quote(amount_in, reserve_in, reserve_out, amm.fee_basis_points)
        else {
            return Ok(invalid_amm_state(public));
        };

        if amount_out < min_amount_out {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE, // Slippage
                "Slippage limit exceeded",
            ));
        }

        // Execute Swap
        if is_buying_rng {
            // Player gives vUSDT, gets RNG
            if player.balances.vusdt_balance < amount_in {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                    "Insufficient vUSDT",
                ));
            }
            let Some(vusdt_balance) = player.balances.vusdt_balance.checked_sub(amount_in) else {
                return Ok(invalid_amm_state(public));
            };
            player.balances.vusdt_balance = vusdt_balance;
            let Some(chips) = player.balances.chips.checked_add(amount_out) else {
                return Ok(invalid_amm_state(public));
            };
            player.balances.chips = chips;

            let Some(reserve_vusdt) = amm.reserve_vusdt.checked_add(amount_in) else {
                return Ok(invalid_amm_state(public));
            };
            amm.reserve_vusdt = reserve_vusdt;
            let Some(reserve_rng) = amm.reserve_rng.checked_sub(amount_out) else {
                return Ok(invalid_amm_state(public));
            };
            amm.reserve_rng = reserve_rng;
        } else {
            // Player gives RNG, gets vUSDT
            // Note: We deduct the FULL amount (incl tax) from player
            let total_deduction = original_amount_in;
            if player.balances.chips < total_deduction {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                    "Insufficient RNG",
                ));
            }

            let Some(chips) = player.balances.chips.checked_sub(total_deduction) else {
                return Ok(invalid_amm_state(public));
            };
            player.balances.chips = chips;
            let Some(vusdt_balance) = player.balances.vusdt_balance.checked_add(amount_out) else {
                return Ok(invalid_amm_state(public));
            };
            player.balances.vusdt_balance = vusdt_balance;

            let Some(reserve_rng) = amm.reserve_rng.checked_add(amount_in) else {
                return Ok(invalid_amm_state(public));
            };
            amm.reserve_rng = reserve_rng; // Add net amount (after tax) to reserves
            let Some(reserve_vusdt) = amm.reserve_vusdt.checked_sub(amount_out) else {
                return Ok(invalid_amm_state(public));
            };
            amm.reserve_vusdt = reserve_vusdt;

            if burned_amount > 0 {
                let mut house = self.get_or_init_house().await?;
                let Some(total_burned) = house.total_burned.checked_add(burned_amount) else {
                    return Ok(invalid_amm_state(public));
                };
                house.total_burned = total_burned;
                self.insert(Key::House, Value::House(house));
            }
        }

        // Book fee to House
        if fee_amount > 0 {
            let mut house = self.get_or_init_house().await?;
            let Some(accumulated_fees) = house.accumulated_fees.checked_add(fee_amount) else {
                return Ok(invalid_amm_state(public));
            };
            house.accumulated_fees = accumulated_fees;
            self.insert(Key::House, Value::House(house));
        }

        let event = Event::AmmSwapped {
            player: public.clone(),
            is_buying_rng,
            amount_in: original_amount_in,
            amount_out,
            fee_amount,
            burned_amount,
            reserve_rng: amm.reserve_rng,
            reserve_vusdt: amm.reserve_vusdt,
        };

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::AmmPool, Value::AmmPool(amm));

        Ok(vec![event])
    }

    pub(in crate::layer) async fn handle_add_liquidity(
        &mut self,
        public: &PublicKey,
        rng_amount: u64,
        usdt_amount: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        if rng_amount == 0 || usdt_amount == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Zero liquidity not allowed",
            ));
        }

        if player.balances.chips < rng_amount || player.balances.vusdt_balance < usdt_amount {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Insufficient funds",
            ));
        }

        let lp_balance = self.get_lp_balance(public).await?;

        // Initial liquidity?
        let mut shares_minted = if amm.total_shares == 0 {
            // Sqrt(x*y)
            let val = (rng_amount as u128) * (usdt_amount as u128);
            Self::integer_sqrt(val)
        } else {
            // Proportional to current reserves
            if amm.reserve_rng == 0 || amm.reserve_vusdt == 0 {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "AMM has zero liquidity",
                ));
            }
            let share_a = (rng_amount as u128 * amm.total_shares as u128) / amm.reserve_rng as u128;
            let share_b =
                (usdt_amount as u128 * amm.total_shares as u128) / amm.reserve_vusdt as u128;
            share_a.min(share_b) as u64
        };

        // Lock a minimum amount of LP shares on first deposit so reserves can never be fully drained.
        if amm.total_shares == 0 {
            if shares_minted <= MINIMUM_LIQUIDITY {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_INVALID_MOVE,
                    "Initial liquidity too small",
                ));
            }
            amm.total_shares = MINIMUM_LIQUIDITY;
            let Some(shares) = shares_minted.checked_sub(MINIMUM_LIQUIDITY) else {
                return Ok(invalid_amm_state(public));
            };
            shares_minted = shares;
        }

        if shares_minted == 0 {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Deposit too small",
            ));
        }

        let Some(chips) = player.balances.chips.checked_sub(rng_amount) else {
            return Ok(invalid_amm_state(public));
        };
        player.balances.chips = chips;
        let Some(vusdt_balance) = player.balances.vusdt_balance.checked_sub(usdt_amount) else {
            return Ok(invalid_amm_state(public));
        };
        player.balances.vusdt_balance = vusdt_balance;

        let Some(reserve_rng) = amm.reserve_rng.checked_add(rng_amount) else {
            return Ok(invalid_amm_state(public));
        };
        amm.reserve_rng = reserve_rng;
        let Some(reserve_vusdt) = amm.reserve_vusdt.checked_add(usdt_amount) else {
            return Ok(invalid_amm_state(public));
        };
        amm.reserve_vusdt = reserve_vusdt;
        let Some(total_shares) = amm.total_shares.checked_add(shares_minted) else {
            return Ok(invalid_amm_state(public));
        };
        amm.total_shares = total_shares;

        let Some(new_lp_balance) = lp_balance.checked_add(shares_minted) else {
            return Ok(invalid_amm_state(public));
        };

        let event = Event::LiquidityAdded {
            player: public.clone(),
            rng_amount,
            vusdt_amount: usdt_amount,
            shares_minted,
            total_shares: amm.total_shares,
            reserve_rng: amm.reserve_rng,
            reserve_vusdt: amm.reserve_vusdt,
            lp_balance: new_lp_balance,
        };

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::AmmPool, Value::AmmPool(amm));
        self.insert(
            Key::LpBalance(public.clone()),
            Value::LpBalance(new_lp_balance),
        );

        Ok(vec![event])
    }

    pub(in crate::layer) async fn handle_remove_liquidity(
        &mut self,
        public: &PublicKey,
        shares: u64,
    ) -> anyhow::Result<Vec<Event>> {
        if shares == 0 {
            return Ok(vec![]);
        }

        let mut amm = self.get_or_init_amm().await?;
        if validate_amm_state(&amm).is_err() {
            return Ok(invalid_amm_state(public));
        }
        if amm.total_shares == 0 || shares > amm.total_shares {
            return Ok(vec![]);
        }

        let lp_balance = self.get_lp_balance(public).await?;
        if shares > lp_balance {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                "Not enough LP shares",
            ));
        }

        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]),
        };

        // Calculate amounts out proportionally
        let amount_rng =
            ((shares as u128 * amm.reserve_rng as u128) / amm.total_shares as u128) as u64;
        let amount_vusd =
            ((shares as u128 * amm.reserve_vusdt as u128) / amm.total_shares as u128) as u64;

        let Some(reserve_rng) = amm.reserve_rng.checked_sub(amount_rng) else {
            return Ok(invalid_amm_state(public));
        };
        amm.reserve_rng = reserve_rng;
        let Some(reserve_vusdt) = amm.reserve_vusdt.checked_sub(amount_vusd) else {
            return Ok(invalid_amm_state(public));
        };
        amm.reserve_vusdt = reserve_vusdt;
        let Some(total_shares) = amm.total_shares.checked_sub(shares) else {
            return Ok(invalid_amm_state(public));
        };
        amm.total_shares = total_shares;

        let Some(chips) = player.balances.chips.checked_add(amount_rng) else {
            return Ok(invalid_amm_state(public));
        };
        player.balances.chips = chips;
        let Some(vusdt_balance) = player.balances.vusdt_balance.checked_add(amount_vusd) else {
            return Ok(invalid_amm_state(public));
        };
        player.balances.vusdt_balance = vusdt_balance;

        let Some(new_lp_balance) = lp_balance.checked_sub(shares) else {
            return Ok(invalid_amm_state(public));
        };

        let event = Event::LiquidityRemoved {
            player: public.clone(),
            rng_amount: amount_rng,
            vusdt_amount: amount_vusd,
            shares_burned: shares,
            total_shares: amm.total_shares,
            reserve_rng: amm.reserve_rng,
            reserve_vusdt: amm.reserve_vusdt,
            lp_balance: new_lp_balance,
        };

        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );
        self.insert(Key::AmmPool, Value::AmmPool(amm));
        self.insert(
            Key::LpBalance(public.clone()),
            Value::LpBalance(new_lp_balance),
        );

        Ok(vec![event])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use commonware_runtime::deterministic::Runner;
    use commonware_runtime::Runner as _;

    #[test]
    fn rng_price_ratio_bootstrap_when_no_rng_reserve() {
        assert_eq!(rng_price_ratio(0, 0, 1, 1), (1, 1));
        assert_eq!(rng_price_ratio(0, 1_000, 1, 1), (1, 1));
        assert_eq!(rng_price_ratio(0, 0, 2, 3), (2, 3));
        assert_eq!(rng_price_ratio(0, 1_000, 2, 3), (2, 3));
    }

    #[test]
    fn rng_price_ratio_tracks_reserve_ratio_when_nonzero_rng_reserve() {
        assert_eq!(rng_price_ratio(2, 10, 1, 1), (10, 2));
        assert_eq!(rng_price_ratio(5, 0, 1, 1), (0, 5));
    }

    #[test]
    fn borrow_usdt_uses_bootstrap_price_when_no_reserves() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);

            let (private, public) = create_account_keypair(1);

            let mut state = MockState::new();
            state.data.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(nullspace_types::casino::Player::new("Alice".to_string())),
            );
            state.data.insert(
                Key::Vault(public.clone()),
                Value::Vault(nullspace_types::casino::Vault {
                    collateral_rng: 10,
                    debt_vusdt: 0,
                }),
            );

            let mut amm = nullspace_types::casino::AmmPool::new(
                nullspace_types::casino::AMM_DEFAULT_FEE_BASIS_POINTS,
            );
            amm.bootstrap_price_vusdt_numerator = 2;
            amm.bootstrap_price_rng_denominator = 1;
            state.data.insert(Key::AmmPool, Value::AmmPool(amm));

            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            // With a bootstrap price of 2 vUSDT per 1 RNG and 50% LTV, max debt is 10 vUSDT.
            let tx = Transaction::sign(&private, 0, Instruction::BorrowUSDT { amount: 10 });
            layer.prepare(&tx).await.expect("prepare");
            let events = layer.apply(&tx).await.expect("apply");
            assert!(matches!(
                events.as_slice(),
                [Event::VusdtBorrowed {
                    player,
                    amount: 10,
                    new_debt: 10
                }] if player == &public
            ));

            // Borrowing any more must fail the LTV check.
            let tx = Transaction::sign(&private, 1, Instruction::BorrowUSDT { amount: 1 });
            layer.prepare(&tx).await.expect("prepare");
            let events = layer.apply(&tx).await.expect("apply");
            assert!(matches!(
                events.as_slice(),
                [Event::CasinoError { message, .. }] if message == "Insufficient collateral (Max 50% LTV)"
            ));
        });
    }

    #[test]
    fn constant_product_quote_basic_no_fee_rounding() {
        let quote = constant_product_quote(100, 1_000, 1_000, 30).expect("quote");
        assert_eq!(
            quote,
            SwapQuote {
                amount_out: 90,
                fee_amount: 0
            }
        );
    }

    #[test]
    fn constant_product_quote_fee_applies_and_rounds_down() {
        let quote = constant_product_quote(10_000, 1_000_000, 1_000_000, 30).expect("quote");
        assert_eq!(quote.fee_amount, 30);
        assert_eq!(quote.amount_out, 9_871);
    }

    #[test]
    fn constant_product_quote_all_fee_yields_zero_out() {
        let quote = constant_product_quote(1_000, 1_000, 1_000, 10_000).expect("quote");
        assert_eq!(quote.fee_amount, 1_000);
        assert_eq!(quote.amount_out, 0);
    }

    #[test]
    fn constant_product_quote_denominator_zero_returns_none() {
        assert_eq!(constant_product_quote(0, 0, 0, 0), None);
    }

    #[test]
    fn constant_product_quote_rejects_fee_bps_over_10000() {
        assert_eq!(constant_product_quote(1, 1, 1, 10_001), None);
    }

    #[test]
    fn constant_product_quote_overflow_returns_none() {
        assert_eq!(
            constant_product_quote(u64::MAX, u64::MAX, u64::MAX, 0),
            None
        );
    }

    const TEST_NAMESPACE: &[u8] = b"test-namespace";

    struct MockState {
        data: std::collections::HashMap<Key, Value>,
    }

    impl MockState {
        fn new() -> Self {
            Self {
                data: std::collections::HashMap::new(),
            }
        }
    }

    impl State for MockState {
        async fn get(&self, key: &Key) -> Result<Option<Value>> {
            Ok(self.data.get(key).cloned())
        }

        async fn insert(&mut self, key: Key, value: Value) -> Result<()> {
            self.data.insert(key, value);
            Ok(())
        }

        async fn delete(&mut self, key: &Key) -> Result<()> {
            self.data.remove(key);
            Ok(())
        }
    }

    #[test]
    fn sell_swap_insufficient_funds_does_not_increment_house_burn() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);

            let (private, public) = create_account_keypair(1);

            let mut state = MockState::new();

            let mut player = nullspace_types::casino::Player::new("Alice".to_string());
            player.balances.chips = 0;
            state.data.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(player),
            );

            let mut amm = nullspace_types::casino::AmmPool::new(
                nullspace_types::casino::AMM_DEFAULT_FEE_BASIS_POINTS,
            );
            amm.reserve_rng = 1_000;
            amm.reserve_vusdt = 1_000;
            amm.total_shares = MINIMUM_LIQUIDITY.saturating_add(1_000);
            state.data.insert(Key::AmmPool, Value::AmmPool(amm));

            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            let tx = Transaction::sign(
                &private,
                0,
                Instruction::Swap {
                    amount_in: 20,
                    min_amount_out: 0,
                    is_buying_rng: false,
                },
            );

            layer.prepare(&tx).await.expect("prepare");
            let events = layer.apply(&tx).await.expect("apply");

            assert!(matches!(
                events.as_slice(),
                [Event::CasinoError { message, .. }] if message == "Insufficient RNG"
            ));

            assert!(
                layer.get(&Key::House).await.expect("get house").is_none(),
                "house state must not be created/mutated on failed swap"
            );
        });
    }

    #[test]
    fn sell_swap_slippage_does_not_increment_house_burn() {
        let executor = Runner::default();
        executor.start(|_| async move {
            let (network_secret, master_public) = create_network_keypair();
            let seed = create_seed(&network_secret, 1);

            let (private, public) = create_account_keypair(1);

            let mut state = MockState::new();

            let mut player = nullspace_types::casino::Player::new("Alice".to_string());
            player.balances.chips = 100;
            state.data.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(player),
            );

            let mut amm = nullspace_types::casino::AmmPool::new(
                nullspace_types::casino::AMM_DEFAULT_FEE_BASIS_POINTS,
            );
            amm.reserve_rng = 1_000;
            amm.reserve_vusdt = 1_000;
            amm.total_shares = MINIMUM_LIQUIDITY.saturating_add(1_000);
            state.data.insert(Key::AmmPool, Value::AmmPool(amm));

            let mut layer = Layer::new(&state, master_public, TEST_NAMESPACE, seed);

            let tx = Transaction::sign(
                &private,
                0,
                Instruction::Swap {
                    amount_in: 20,
                    min_amount_out: u64::MAX,
                    is_buying_rng: false,
                },
            );

            layer.prepare(&tx).await.expect("prepare");
            let events = layer.apply(&tx).await.expect("apply");

            assert!(matches!(
                events.as_slice(),
                [Event::CasinoError { message, .. }] if message == "Slippage limit exceeded"
            ));

            assert!(
                layer.get(&Key::House).await.expect("get house").is_none(),
                "house state must not be created/mutated on failed swap"
            );
        });
    }
}
