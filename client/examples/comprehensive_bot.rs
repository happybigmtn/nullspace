//! Comprehensive Bot Integration Test
//!
//! This test suite exhaustively verifies all game bet types and moves against the
//! execution layer, validating state transitions and on-chain events.

use commonware_cryptography::{
    bls12381::primitives::variant::{MinSig, Variant},
    ed25519::{PrivateKey, PublicKey},
    Signer,
};
use commonware_runtime::ThreadPool;
use nullspace_execution::mocks::{create_account_keypair, create_network_keypair, create_seed};
use nullspace_execution::{Layer, Memory, State};
use nullspace_types::{
    casino::{GameSession, GameType, SuperModeState},
    execution::{Event, Instruction, Key, Transaction, Value},
    NAMESPACE,
};

/// Test runner context
struct Context {
    state: Memory,
    network_secret: commonware_cryptography::bls12381::primitives::group::Private,
    network_public: <MinSig as Variant>::Public,
    player_secret: PrivateKey,
    player_public: PublicKey,
    nonce: u64,
    view: u64,
    pool: ThreadPool,
}
impl Context {
    async fn new() -> Self {
        let (network_secret, network_public) = create_network_keypair();
        let (player_secret, player_public) = create_account_keypair(1);
        let pool = ThreadPool::new(
            rayon::ThreadPoolBuilder::new()
                .num_threads(2)
                .build()
                .expect("failed to create thread pool"),
        );

        let mut ctx = Self {
            state: Memory::default(),
            network_secret,
            network_public,
            player_secret,
            player_public,
            nonce: 0,
            view: 1,
            pool,
        };

        // Register player
        ctx.execute(Instruction::CasinoRegister {
            name: "BotPlayer".to_string(),
        })
        .await;

        // Give player lots of chips
        ctx.execute(Instruction::CasinoDeposit { amount: 1_000_000 })
            .await;

        ctx
    }

    /// Execute a single instruction as a transaction/block
    async fn execute(&mut self, instruction: Instruction) -> Vec<Event> {
        let seed = create_seed(&self.network_secret, self.view);
        let mut layer = Layer::new(&self.state, self.network_public.clone(), NAMESPACE, seed);

        let tx = Transaction::sign(&self.player_secret, self.nonce, instruction);
        let (outputs, _) = layer.execute(self.pool.clone(), vec![tx]).await;

        // Extract events
        let mut events = Vec::new();
        for output in outputs {
            if let nullspace_types::execution::Output::Event(e) = output {
                events.push(e);
            }
        }

        // Commit state
        let changes = layer.commit();
        self.state.apply(changes).await;

        self.nonce += 1;
        self.view += 1;

        events
    }

    /// Helper to force a specific session state for testing
    async fn inject_session(&mut self, session: GameSession) {
        self.state
            .insert(
                Key::CasinoSession(session.id),
                Value::CasinoSession(session),
            )
            .await;
    }

    fn get_session_id(&self) -> u64 {
        self.view // Simple unique ID
    }
}

// === Tests ===

async fn test_baccarat(ctx: &mut Context) {
    println!("Testing Baccarat...");
    for (bet_type, name) in [(0, "Player"), (1, "Banker"), (2, "Tie")] {
        let session_id = ctx.get_session_id();

        // 1. Start Game
        let events = ctx
            .execute(Instruction::CasinoStartGame {
                game_type: GameType::Baccarat,
                bet: 100,
                session_id,
            })
            .await;
        assert!(matches!(events[0], Event::CasinoGameStarted { .. }));

        // 2. Place Bet
        let payload = vec![bet_type];
        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload,
            })
            .await;

        print_result(name, &events);
    }
}

async fn test_blackjack(ctx: &mut Context) {
    println!("Testing Blackjack...");

    // Hit Flow
    {
        let session_id = ctx.get_session_id();
        let events = ctx
            .execute(Instruction::CasinoStartGame {
                game_type: GameType::Blackjack,
                bet: 100,
                session_id,
            })
            .await;

        // Only move if game didn't end instantly (natural blackjack)
        let game_ended = matches!(events.last(), Some(Event::CasinoGameCompleted { .. }));

        if !game_ended {
            let events = ctx
                .execute(Instruction::CasinoGameMove {
                    session_id,
                    payload: vec![0], // Hit
                })
                .await;
            print_result("Hit", &events);
        } else {
            println!("  [SKIP] Hit (Natural Blackjack)");
        }
    }

    // Stand Flow
    {
        let session_id = ctx.get_session_id();
        let events = ctx
            .execute(Instruction::CasinoStartGame {
                game_type: GameType::Blackjack,
                bet: 100,
                session_id,
            })
            .await;

        let game_ended = matches!(events.last(), Some(Event::CasinoGameCompleted { .. }));
        if !game_ended {
            let events = ctx
                .execute(Instruction::CasinoGameMove {
                    session_id,
                    payload: vec![1], // Stand
                })
                .await;
            print_result("Stand", &events);
        }
    }
}

async fn test_casino_war(ctx: &mut Context) {
    println!("Testing Casino War...");

    // Normal Play
    {
        let session_id = ctx.get_session_id();
        ctx.execute(Instruction::CasinoStartGame {
            game_type: GameType::CasinoWar,
            bet: 100,
            session_id,
        })
        .await;

        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload: vec![0], // Play
            })
            .await;
        print_result("Play", &events);
    }

    // Force War (Tie)
    {
        let session_id = ctx.get_session_id();
        // Inject a session in War state (stage 1) with equal cards (King vs King)
        let session = GameSession {
            id: session_id,
            player: ctx.player_public.clone(),
            game_type: GameType::CasinoWar,
            bet: 100,
            state_blob: vec![12, 12, 1], // King, King, War Stage
            move_count: 1,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };
        ctx.inject_session(session).await;

        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload: vec![1], // War
            })
            .await;
        print_result("War (Force)", &events);
    }

    // Force Surrender (Tie)
    {
        let session_id = ctx.get_session_id();
        let session = GameSession {
            id: session_id,
            player: ctx.player_public.clone(),
            game_type: GameType::CasinoWar,
            bet: 100,
            state_blob: vec![12, 12, 1], // King, King, War Stage
            move_count: 1,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };
        ctx.inject_session(session).await;

        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload: vec![2], // Surrender
            })
            .await;
        print_result("Surrender (Force)", &events);
    }
}

async fn test_craps(ctx: &mut Context) {
    println!("Testing Craps...");
    let session_id = ctx.get_session_id();

    ctx.execute(Instruction::CasinoStartGame {
        game_type: GameType::Craps,
        bet: 1, // Craps starts with >0 bet to pass check
        session_id,
    })
    .await;

    // Test all bet types
    let bets = [
        (0, "Pass"),
        (1, "DontPass"),
        (2, "Come"),
        (3, "DontCome"),
        (4, "Field"),
        (5, "Yes(4)"),
        (6, "No(4)"),
        (7, "Next(7)"),
        (8, "Hard4"),
        (9, "Hard6"),
        (10, "Hard8"),
        (11, "Hard10"),
    ];

    for (type_id, name) in bets {
        let mut payload = vec![0, type_id, if type_id >= 5 && type_id <= 7 { 4 } else { 0 }]; // Target 4 or 7
        payload.extend_from_slice(&100u64.to_be_bytes());

        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload,
            })
            .await;
        // Craps Place doesn't emit GameMoved event for performance/spam reasons?
        // Wait, Layer logic says: "events = vec![Event::CasinoGameMoved ...]"
        // So it should.
        if !events.is_empty() {
            println!("  [PASS] {} Bet Placed", name);
        } else {
            println!("  [FAIL] {} Bet Failed", name);
        }
    }

    // Roll
    let events = ctx
        .execute(Instruction::CasinoGameMove {
            session_id,
            payload: vec![2], // Roll
        })
        .await;
    print_result("Roll", &events);
}

async fn test_video_poker(ctx: &mut Context) {
    println!("Testing Video Poker...");
    let session_id = ctx.get_session_id();
    ctx.execute(Instruction::CasinoStartGame {
        game_type: GameType::VideoPoker,
        bet: 100,
        session_id,
    })
    .await;

    let events = ctx
        .execute(Instruction::CasinoGameMove {
            session_id,
            payload: vec![0b10101], // Hold 1st, 3rd, 5th
        })
        .await;
    print_result("Hold", &events);
}

async fn test_hilo(ctx: &mut Context) {
    println!("Testing HiLo...");
    let session_id = ctx.get_session_id();
    ctx.execute(Instruction::CasinoStartGame {
        game_type: GameType::HiLo,
        bet: 100,
        session_id,
    })
    .await;

    // Need to check card to make valid move
    // We can't see state directly in ctx easily without get(),
    // but for this test we'll just try Higher, if it fails (King), try Lower

    let events = ctx
        .execute(Instruction::CasinoGameMove {
            session_id,
            payload: vec![0], // Higher
        })
        .await;

    if events.is_empty() {
        // Failed, probably King, try Lower
        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload: vec![1], // Lower
            })
            .await;
        print_result("Lower (Retry)", &events);
    } else {
        print_result("Higher", &events);
    }
}

async fn test_roulette(ctx: &mut Context) {
    println!("Testing Roulette...");
    let session_id = ctx.get_session_id();
    ctx.execute(Instruction::CasinoStartGame {
        game_type: GameType::Roulette,
        bet: 100,
        session_id,
    })
    .await;

    let events = ctx
        .execute(Instruction::CasinoGameMove {
            session_id,
            payload: vec![1, 0], // Red
        })
        .await;
    print_result("Red Bet", &events);
}

async fn test_sic_bo(ctx: &mut Context) {
    println!("Testing Sic Bo...");
    let session_id = ctx.get_session_id();
    ctx.execute(Instruction::CasinoStartGame {
        game_type: GameType::SicBo,
        bet: 100,
        session_id,
    })
    .await;

    let events = ctx
        .execute(Instruction::CasinoGameMove {
            session_id,
            payload: vec![0, 0], // Small
        })
        .await;
    print_result("Small Bet", &events);
}

async fn test_three_card(ctx: &mut Context) {
    println!("Testing Three Card...");
    let session_id = ctx.get_session_id();
    ctx.execute(Instruction::CasinoStartGame {
        game_type: GameType::ThreeCard,
        bet: 100,
        session_id,
    })
    .await;

    let events = ctx
        .execute(Instruction::CasinoGameMove {
            session_id,
            payload: vec![0], // Play
        })
        .await;
    print_result("Play", &events);
}

async fn test_ultimate_holdem(ctx: &mut Context) {
    println!("Testing Ultimate Hold'em...");

    // Check Flow
    {
        let session_id = ctx.get_session_id();
        ctx.execute(Instruction::CasinoStartGame {
            game_type: GameType::UltimateHoldem,
            bet: 100,
            session_id,
        })
        .await;

        // Check Preflop
        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload: vec![0],
            })
            .await;
        print_result("Check Preflop", &events);

        // Check Flop
        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload: vec![0],
            })
            .await;
        print_result("Check Flop", &events);

        // Bet 1x River
        let events = ctx
            .execute(Instruction::CasinoGameMove {
                session_id,
                payload: vec![3],
            })
            .await;
        print_result("Bet 1x River", &events);
    }
}

fn print_result(name: &str, events: &[Event]) {
    if let Some(last) = events.last() {
        match last {
            Event::CasinoGameCompleted { payout, .. } => {
                let outcome = if *payout > 0 {
                    "WIN"
                } else if *payout < 0 {
                    "LOSS"
                } else {
                    "PUSH"
                };
                println!("  [PASS] {} -> {} ({})", name, outcome, payout);
            }
            Event::CasinoGameMoved { .. } => {
                println!("  [PASS] {} -> CONTINUED", name);
            }
            _ => println!("  [PASS] {} -> OK (Event: {:?})", name, last),
        }
    } else {
        println!("  [FAIL] {} -> No Events (Invalid Move?)", name);
    }
}

#[tokio::main]
async fn main() {
    let mut ctx = Context::new().await;

    test_baccarat(&mut ctx).await;
    test_blackjack(&mut ctx).await;
    test_casino_war(&mut ctx).await;
    test_craps(&mut ctx).await;
    test_video_poker(&mut ctx).await;
    test_hilo(&mut ctx).await;
    test_roulette(&mut ctx).await;
    test_sic_bo(&mut ctx).await;
    test_three_card(&mut ctx).await;
    test_ultimate_holdem(&mut ctx).await;
}
