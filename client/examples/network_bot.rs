//! Network Bot Example
//!
//! This example demonstrates how to build a bot that interacts with a running Nullspace node
//! over the network using the `nullspace-client` SDK.
//!
//! It implements a simple strategy for the HiLo game:
//! - Always guess "Lower" if card > 7
//! - Always guess "Higher" if card <= 7
//! - Cashout after 3 successful moves
//!
//! To run:
//! `cargo run --example network_bot`

use commonware_cryptography::ed25519::PrivateKey;
use commonware_storage::store::operation::Keyless;
use nullspace_client::{Client, Error};
use nullspace_execution::mocks::{create_account_keypair, create_network_keypair};
use nullspace_types::{
    api::{Update, UpdatesFilter},
    casino::GameType,
    execution::{Event, Instruction, Output, Transaction},
};
use std::time::{SystemTime, UNIX_EPOCH};

const NODE_URL: &str = "http://localhost:3000";

/// Helper to sign and submit a transaction
async fn submit_tx(
    client: &Client,
    private_key: &PrivateKey,
    nonce: u64,
    instruction: Instruction,
) -> Result<(), Error> {
    let tx = Transaction::sign(private_key, nonce, instruction);
    client.submit_transactions(vec![tx]).await?;
    Ok(())
}

/// Parse HiLo state (card rank)
fn get_hilo_card_rank(state: &[u8]) -> Option<u8> {
    if state.is_empty() {
        return None;
    }
    // Card is byte 0 (0-51)
    let card = state[0];
    Some((card % 13) + 1)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    // 1. Setup Identity
    // In a real bot, you'd load the Node's public key (to verify responses)
    // and your own Account private key (to sign transactions).
    // For this example, we generate random ones.

    // Node Identity (BLS) - In a real scenario, this must match the node you connect to.
    let (_, node_public_key) = create_network_keypair();

    // Bot Identity (Ed25519)
    let (private_key, public_key) = create_account_keypair(0);
    println!("Bot Public Key: {:?}", public_key);

    let client = Client::new(NODE_URL, node_public_key)?;

    // 2. Register
    println!("Registering...");
    let mut nonce = 0;
    submit_tx(
        &client,
        &private_key,
        nonce,
        Instruction::CasinoRegister {
            name: "HiLoBot".to_string(),
        },
    )
    .await?;
    nonce += 1;
    println!("Registered.");

    // 3. Deposit (Mock - assuming devnet/faucet)
    println!("Depositing funds...");
    submit_tx(
        &client,
        &private_key,
        nonce,
        Instruction::CasinoDeposit { amount: 1000 },
    )
    .await?;
    nonce += 1;
    println!("Deposited 1000 chips.");

    // 4. Start HiLo Game
    let session_id = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos() as u64;
    println!("Starting HiLo Game (Session ID: {})...", session_id);

    submit_tx(
        &client,
        &private_key,
        nonce,
        Instruction::CasinoStartGame {
            game_type: GameType::HiLo,
            bet: 10,
            session_id,
        },
    )
    .await?;
    nonce += 1;

    // 5. Listen for updates and play
    println!("Connecting to update stream...");
    let mut stream = client
        .connect_updates(UpdatesFilter::Account(public_key.clone()))
        .await?;

    println!("Listening for game events...");
    while let Some(update) = stream.next().await {
        let update = update?;

        if let Update::FilteredEvents(events) = update {
            for (_, keyless_output) in events.events_proof_ops {
                // Keyless is an enum
                if let Keyless::Append(Output::Event(event)) = keyless_output {
                    match event {
                        Event::CasinoGameStarted {
                            session_id: sid,
                            initial_state,
                            ..
                        } if sid == session_id => {
                            if let Some(rank) = get_hilo_card_rank(&initial_state) {
                                println!("Game Started! Card Rank: {}", rank);
                                make_hilo_move(&client, &private_key, nonce, session_id, rank)
                                    .await?;
                                nonce += 1;
                            }
                        }
                        Event::CasinoGameMoved {
                            session_id: sid,
                            new_state,
                            move_number,
                            ..
                        } if sid == session_id => {
                            if let Some(rank) = get_hilo_card_rank(&new_state) {
                                println!("Move {} processed. New Card Rank: {}", move_number, rank);

                                // Cashout strategy after 3 moves
                                if move_number >= 3 {
                                    println!("Cashing out...");
                                    submit_tx(
                                        &client,
                                        &private_key,
                                        nonce,
                                        Instruction::CasinoGameMove {
                                            session_id,
                                            payload: vec![2], // Cashout
                                        },
                                    )
                                    .await?;
                                } else {
                                    make_hilo_move(&client, &private_key, nonce, session_id, rank)
                                        .await?;
                                }
                                nonce += 1;
                            }
                        }
                        Event::CasinoGameCompleted {
                            session_id: sid,
                            payout,
                            ..
                        } if sid == session_id => {
                            println!("Game Completed! Payout: {}", payout);
                            return Ok(());
                        }
                        Event::CasinoError {
                            session_id: Some(sid),
                            message,
                            ..
                        } if sid == session_id => {
                            println!("Game Error: {}", message);
                            return Ok(());
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    Ok(())
}

async fn make_hilo_move(
    client: &Client,
    private_key: &PrivateKey,
    nonce: u64,
    session_id: u64,
    rank: u8,
) -> Result<(), Error> {
    // Strategy: Guess Higher if <= 7, Lower if > 7
    // Avoid guessing Higher on King (13) or Lower on Ace (1)
    let payload = if rank == 1 {
        vec![0] // Must guess Higher on Ace
    } else if rank == 13 {
        vec![1] // Must guess Lower on King
    } else if rank <= 7 {
        vec![0] // Higher
    } else {
        vec![1] // Lower
    };

    let move_name = if payload[0] == 0 { "Higher" } else { "Lower" };
    println!("Guessing {}...", move_name);

    submit_tx(
        client,
        private_key,
        nonce,
        Instruction::CasinoGameMove {
            session_id,
            payload,
        },
    )
    .await
}
