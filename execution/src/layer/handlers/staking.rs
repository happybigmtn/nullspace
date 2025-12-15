use super::super::*;

impl<'a, S: State> Layer<'a, S> {
    // === Staking Handlers ===

    pub(in crate::layer) async fn handle_stake(
        &mut self,
        public: &PublicKey,
        amount: u64,
        duration: u64,
    ) -> anyhow::Result<Vec<Event>> {
        let mut player = match self.get(&Key::CasinoPlayer(public.clone())).await? {
            Some(Value::CasinoPlayer(p)) => p,
            _ => return Ok(vec![]), // Error handled by checking balance
        };

        if player.chips < amount {
            return Ok(vec![Event::CasinoError {
                player: public.clone(),
                session_id: None,
                error_code: nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
                message: "Insufficient chips to stake".to_string(),
            }]);
        }

        // NOTE: Staking is currently in dev/demo mode: `duration` and `unlock_ts` are expressed in
        // consensus views/blocks (not wall-clock time), and the minimum duration is intentionally
        // small to make local testing easier.
        const DEV_MIN_DURATION_BLOCKS: u64 = 1;
        if duration < DEV_MIN_DURATION_BLOCKS {
            return Ok(vec![Event::CasinoError {
                player: public.clone(),
                session_id: None,
                error_code: nullspace_types::casino::ERROR_INVALID_BET, // Reuse code
                message: "Duration too short".to_string(),
            }]);
        }

        // Deduct chips
        player.chips -= amount;
        self.insert(
            Key::CasinoPlayer(public.clone()),
            Value::CasinoPlayer(player),
        );

        // Create/Update Staker
        let mut staker = match self.get(&Key::Staker(public.clone())).await? {
            Some(Value::Staker(s)) => s,
            _ => nullspace_types::casino::Staker::default(),
        };

        // Voting power is accumulated per stake: sum(amount_i * duration_i).
        // Lockup is the max of all stake unlocks (new stake can extend, never shorten).
        let current_block = self.seed.view;
        let new_unlock = current_block + duration;

        staker.balance = staker.balance.saturating_add(amount);
        staker.unlock_ts = staker.unlock_ts.max(new_unlock);
        let added_voting_power = (amount as u128) * (duration as u128);
        staker.voting_power = staker.voting_power.saturating_add(added_voting_power);

        self.insert(Key::Staker(public.clone()), Value::Staker(staker.clone()));

        // Update House Total VP
        let mut house = self.get_or_init_house().await?;
        house.total_staked_amount = house.total_staked_amount.saturating_add(amount);
        house.total_voting_power = house
            .total_voting_power
            .saturating_add(added_voting_power);
        self.insert(Key::House, Value::House(house));

        Ok(vec![Event::Staked {
            player: public.clone(),
            amount,
            duration,
            new_balance: staker.balance,
            unlock_ts: staker.unlock_ts,
            voting_power: staker.voting_power,
        }])
    }

    pub(in crate::layer) async fn handle_unstake(
        &mut self,
        public: &PublicKey,
    ) -> anyhow::Result<Vec<Event>> {
        let mut staker = match self.get(&Key::Staker(public.clone())).await? {
            Some(Value::Staker(s)) => s,
            _ => return Ok(vec![]),
        };

        if self.seed.view < staker.unlock_ts {
            return Ok(vec![Event::CasinoError {
                player: public.clone(),
                session_id: None,
                error_code: nullspace_types::casino::ERROR_INVALID_MOVE,
                message: "Stake still locked".to_string(),
            }]);
        }

        if staker.balance == 0 {
            return Ok(vec![]);
        }

        let unstake_amount = staker.balance;

        // Return chips
        if let Some(Value::CasinoPlayer(mut player)) =
            self.get(&Key::CasinoPlayer(public.clone())).await?
        {
            player.chips += staker.balance;
            self.insert(
                Key::CasinoPlayer(public.clone()),
                Value::CasinoPlayer(player),
            );
        }

        // Update House
        let mut house = self.get_or_init_house().await?;
        house.total_staked_amount = house.total_staked_amount.saturating_sub(staker.balance);
        house.total_voting_power = house.total_voting_power.saturating_sub(staker.voting_power);
        self.insert(Key::House, Value::House(house));

        // Clear Staker
        staker.balance = 0;
        staker.voting_power = 0;
        self.insert(Key::Staker(public.clone()), Value::Staker(staker));

        Ok(vec![Event::Unstaked {
            player: public.clone(),
            amount: unstake_amount,
        }])
    }

    pub(in crate::layer) async fn handle_claim_rewards(
        &mut self,
        public: &PublicKey,
    ) -> anyhow::Result<Vec<Event>> {
        // Placeholder for distribution logic
        // In this MVP, rewards are auto-compounded or we just skip this for now
        let staker = match self.get(&Key::Staker(public.clone())).await? {
            Some(Value::Staker(s)) => s,
            _ => return Ok(vec![]),
        };

        if staker.balance == 0 {
            return Ok(vec![]);
        }

        Ok(vec![Event::RewardsClaimed {
            player: public.clone(),
            amount: 0,
        }])
    }

    pub(in crate::layer) async fn handle_process_epoch(
        &mut self,
        _public: &PublicKey,
    ) -> anyhow::Result<Vec<Event>> {
        let mut house = self.get_or_init_house().await?;

        // NOTE: Dev/demo epoch length in consensus views/blocks (short to keep tests fast).
        const DEV_EPOCH_LENGTH_BLOCKS: u64 = 100;

        if self.seed.view >= house.epoch_start_ts + DEV_EPOCH_LENGTH_BLOCKS {
            // End Epoch

            // If Net PnL > 0, Surplus!
            if house.net_pnl > 0 {
                // In a real system, we'd snapshot this into a "RewardPool"
                // For now, we just reset PnL and log it (via debug/warn or event)
                // warn!("Epoch Surplus: {}", house.net_pnl);
            } else {
                // Deficit. Minting happened. Inflation.
                // warn!("Epoch Deficit: {}", house.net_pnl);
            }

            house.current_epoch += 1;
            house.epoch_start_ts = self.seed.view;
            house.net_pnl = 0; // Reset for next week

            let epoch = house.current_epoch;
            self.insert(Key::House, Value::House(house));

            return Ok(vec![Event::EpochProcessed { epoch }]);
        }

        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use crate::mocks::{create_account_keypair, create_adbs, create_network_keypair, execute_block};
    use commonware_runtime::deterministic::Runner;
    use commonware_runtime::Runner as _;
    use nullspace_types::execution::{Instruction, Key, Transaction, Value};

    #[test]
    fn stake_and_unstake_respects_lockup_and_updates_house() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;
            let (private, public) = create_account_keypair(1);

            // Register, fund, and stake.
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                1,
                vec![
                    Transaction::sign(
                        &private,
                        0,
                        Instruction::CasinoRegister {
                            name: "Alice".to_string(),
                        },
                    ),
                    Transaction::sign(&private, 1, Instruction::CasinoDeposit { amount: 100 }),
                    Transaction::sign(
                        &private,
                        2,
                        Instruction::Stake {
                            amount: 40,
                            duration: 10,
                        },
                    ),
                ],
            )
            .await;

            let player = match crate::State::get(&state, &Key::CasinoPlayer(public.clone()))
                .await
                .expect("get player")
            {
                Some(Value::CasinoPlayer(player)) => player,
                other => panic!("expected casino player, got {other:?}"),
            };
            assert_eq!(player.chips, 1_060);

            let staker = match crate::State::get(&state, &Key::Staker(public.clone()))
                .await
                .expect("get staker")
            {
                Some(Value::Staker(staker)) => staker,
                other => panic!("expected staker, got {other:?}"),
            };
            assert_eq!(staker.balance, 40);
            assert_eq!(staker.unlock_ts, 11);
            assert_eq!(staker.voting_power, 400);

            let house = match crate::State::get(&state, &Key::House).await.expect("get house") {
                Some(Value::House(house)) => house,
                other => panic!("expected house, got {other:?}"),
            };
            assert_eq!(house.total_staked_amount, 40);
            assert_eq!(house.total_voting_power, 400);

            let account = match crate::State::get(&state, &Key::Account(public.clone()))
                .await
                .expect("get account")
            {
                Some(Value::Account(account)) => account,
                other => panic!("expected account, got {other:?}"),
            };
            assert_eq!(account.nonce, 3);

            // Unstake before unlock should keep stake locked (but consume nonce).
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                2,
                vec![Transaction::sign(&private, 3, Instruction::Unstake)],
            )
            .await;

            let player = match crate::State::get(&state, &Key::CasinoPlayer(public.clone()))
                .await
                .expect("get player")
            {
                Some(Value::CasinoPlayer(player)) => player,
                other => panic!("expected casino player, got {other:?}"),
            };
            assert_eq!(player.chips, 1_060);

            let staker = match crate::State::get(&state, &Key::Staker(public.clone()))
                .await
                .expect("get staker")
            {
                Some(Value::Staker(staker)) => staker,
                other => panic!("expected staker, got {other:?}"),
            };
            assert_eq!(staker.balance, 40);
            assert_eq!(staker.voting_power, 400);

            let house = match crate::State::get(&state, &Key::House).await.expect("get house") {
                Some(Value::House(house)) => house,
                other => panic!("expected house, got {other:?}"),
            };
            assert_eq!(house.total_staked_amount, 40);
            assert_eq!(house.total_voting_power, 400);

            let account = match crate::State::get(&state, &Key::Account(public.clone()))
                .await
                .expect("get account")
            {
                Some(Value::Account(account)) => account,
                other => panic!("expected account, got {other:?}"),
            };
            assert_eq!(account.nonce, 4);

            // Unstake at/after unlock should return chips and clear staker.
            execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                11,
                vec![Transaction::sign(&private, 4, Instruction::Unstake)],
            )
            .await;

            let player = match crate::State::get(&state, &Key::CasinoPlayer(public.clone()))
                .await
                .expect("get player")
            {
                Some(Value::CasinoPlayer(player)) => player,
                other => panic!("expected casino player, got {other:?}"),
            };
            assert_eq!(player.chips, 1_100);

            let staker = match crate::State::get(&state, &Key::Staker(public.clone()))
                .await
                .expect("get staker")
            {
                Some(Value::Staker(staker)) => staker,
                other => panic!("expected staker, got {other:?}"),
            };
            assert_eq!(staker.balance, 0);
            assert_eq!(staker.voting_power, 0);

            let house = match crate::State::get(&state, &Key::House).await.expect("get house") {
                Some(Value::House(house)) => house,
                other => panic!("expected house, got {other:?}"),
            };
            assert_eq!(house.total_staked_amount, 0);
            assert_eq!(house.total_voting_power, 0);

            let account = match crate::State::get(&state, &Key::Account(public.clone()))
                .await
                .expect("get account")
            {
                Some(Value::Account(account)) => account,
                other => panic!("expected account, got {other:?}"),
            };
            assert_eq!(account.nonce, 5);
        });
    }

    #[test]
    fn restaking_does_not_shorten_unlock_and_accumulates_voting_power() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;
            let (private, public) = create_account_keypair(2);

            // Register and stake 10 for duration 10 at view 1.
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                1,
                vec![
                    Transaction::sign(
                        &private,
                        0,
                        Instruction::CasinoRegister {
                            name: "Bob".to_string(),
                        },
                    ),
                    Transaction::sign(
                        &private,
                        1,
                        Instruction::Stake {
                            amount: 10,
                            duration: 10,
                        },
                    ),
                ],
            )
            .await;

            let staker = match crate::State::get(&state, &Key::Staker(public.clone()))
                .await
                .expect("get staker")
            {
                Some(Value::Staker(staker)) => staker,
                other => panic!("expected staker, got {other:?}"),
            };
            assert_eq!(staker.balance, 10);
            assert_eq!(staker.unlock_ts, 11);
            assert_eq!(staker.voting_power, 100);

            // Stake again with a shorter duration; unlock should NOT shorten.
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                2,
                vec![Transaction::sign(
                    &private,
                    2,
                    Instruction::Stake {
                        amount: 5,
                        duration: 1,
                    },
                )],
            )
            .await;

            let staker = match crate::State::get(&state, &Key::Staker(public.clone()))
                .await
                .expect("get staker")
            {
                Some(Value::Staker(staker)) => staker,
                other => panic!("expected staker, got {other:?}"),
            };
            assert_eq!(staker.balance, 15);
            assert_eq!(staker.unlock_ts, 11);
            assert_eq!(staker.voting_power, 105);

            // Stake again with a longer duration; unlock should extend.
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                3,
                vec![Transaction::sign(
                    &private,
                    3,
                    Instruction::Stake {
                        amount: 5,
                        duration: 20,
                    },
                )],
            )
            .await;

            let staker = match crate::State::get(&state, &Key::Staker(public.clone()))
                .await
                .expect("get staker")
            {
                Some(Value::Staker(staker)) => staker,
                other => panic!("expected staker, got {other:?}"),
            };
            assert_eq!(staker.balance, 20);
            assert_eq!(staker.unlock_ts, 23);
            assert_eq!(staker.voting_power, 205);

            // Locked unstake consumes nonce but does not change staker.
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                22,
                vec![Transaction::sign(&private, 4, Instruction::Unstake)],
            )
            .await;

            let staker = match crate::State::get(&state, &Key::Staker(public.clone()))
                .await
                .expect("get staker")
            {
                Some(Value::Staker(staker)) => staker,
                other => panic!("expected staker, got {other:?}"),
            };
            assert_eq!(staker.balance, 20);
            assert_eq!(staker.unlock_ts, 23);
            assert_eq!(staker.voting_power, 205);

            // Unstake at unlock clears balance and returns chips.
            execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                23,
                vec![Transaction::sign(&private, 5, Instruction::Unstake)],
            )
            .await;

            let staker = match crate::State::get(&state, &Key::Staker(public.clone()))
                .await
                .expect("get staker")
            {
                Some(Value::Staker(staker)) => staker,
                other => panic!("expected staker, got {other:?}"),
            };
            assert_eq!(staker.balance, 0);
            assert_eq!(staker.voting_power, 0);
        });
    }

    #[test]
    fn process_epoch_advances_house_epoch_after_threshold() {
        let executor = Runner::default();
        executor.start(|context| async move {
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;
            let (private, public) = create_account_keypair(3);

            // Initialize house (epoch_start_ts) via stake at view 1.
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                1,
                vec![
                    Transaction::sign(
                        &private,
                        0,
                        Instruction::CasinoRegister {
                            name: "Eve".to_string(),
                        },
                    ),
                    Transaction::sign(&private, 1, Instruction::CasinoDeposit { amount: 100 }),
                    Transaction::sign(
                        &private,
                        2,
                        Instruction::Stake {
                            amount: 10,
                            duration: 10,
                        },
                    ),
                ],
            )
            .await;

            let house = match crate::State::get(&state, &Key::House).await.expect("get house") {
                Some(Value::House(house)) => house,
                other => panic!("expected house, got {other:?}"),
            };
            assert_eq!(house.current_epoch, 0);
            assert_eq!(house.epoch_start_ts, 1);

            // Calling ProcessEpoch before the threshold is a no-op.
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                50,
                vec![Transaction::sign(&private, 3, Instruction::ProcessEpoch)],
            )
            .await;

            let house = match crate::State::get(&state, &Key::House).await.expect("get house") {
                Some(Value::House(house)) => house,
                other => panic!("expected house, got {other:?}"),
            };
            assert_eq!(house.current_epoch, 0);
            assert_eq!(house.epoch_start_ts, 1);

            // At view 101 (= 1 + 100), the epoch is processed.
            execute_block(
                &network_secret,
                network_identity.clone(),
                &mut state,
                &mut events,
                101,
                vec![Transaction::sign(&private, 4, Instruction::ProcessEpoch)],
            )
            .await;

            let house = match crate::State::get(&state, &Key::House).await.expect("get house") {
                Some(Value::House(house)) => house,
                other => panic!("expected house, got {other:?}"),
            };
            assert_eq!(house.current_epoch, 1);
            assert_eq!(house.epoch_start_ts, 101);
            assert_eq!(house.net_pnl, 0);

            // A subsequent call without a full epoch elapsing is a no-op.
            execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                150,
                vec![Transaction::sign(&private, 5, Instruction::ProcessEpoch)],
            )
            .await;

            let house = match crate::State::get(&state, &Key::House).await.expect("get house") {
                Some(Value::House(house)) => house,
                other => panic!("expected house, got {other:?}"),
            };
            assert_eq!(house.current_epoch, 1);
            assert_eq!(house.epoch_start_ts, 101);

            // Confirm nonce consumption (prepare step is applied even on no-op ProcessEpoch).
            let account = match crate::State::get(&state, &Key::Account(public))
                .await
                .expect("get account")
            {
                Some(Value::Account(account)) => account,
                other => panic!("expected account, got {other:?}"),
            };
            assert_eq!(account.nonce, 6);
        });
    }
}
