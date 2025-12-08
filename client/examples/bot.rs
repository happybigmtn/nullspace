//! Reference Bot Implementation
//!
//! This example demonstrates how to construct valid payloads for all Nullspace casino games.
//! It simulates game execution locally to verify the API contract.

use nullspace_execution::casino::{self, GameResult, GameRng};
use nullspace_execution::mocks::{create_account_keypair, create_network_keypair, create_seed};
use nullspace_types::casino::{GameSession, GameType};
use std::time::SystemTime;

fn create_test_env(game_type: GameType) -> (GameSession, GameRng) {
    let (network_secret, _) = create_network_keypair();
    let seed = create_seed(&network_secret, 1);
    let (_, pk) = create_account_keypair(1);
    
    let session = GameSession {
        id: SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos() as u64,
        player: pk,
        game_type,
        bet: 100,
        state_blob: vec![],
        move_count: 0,
        created_at: 0,
        is_complete: false,
        super_mode: nullspace_types::casino::SuperModeState::default(),
    };
    
    let rng = GameRng::new(&seed, session.id, 0);
    (session, rng)
}

fn run_baccarat() {
    println!("Testing Baccarat...");
    let (mut session, mut rng) = create_test_env(GameType::Baccarat);
    casino::init_game(&mut session, &mut rng);

    // Payload: [0] = Player Bet
    let payload = vec![0]; 
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Player Bet processed"),
        Err(e) => println!("  [FAIL] {:?}", e),
    }
}

fn run_blackjack() {
    println!("Testing Blackjack...");
    let (mut session, mut rng) = create_test_env(GameType::Blackjack);
    casino::init_game(&mut session, &mut rng);

    // Payload: [0] = Hit
    let payload = vec![0];
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    // Might fail if game ended on deal (blackjack), so we check completeness
    if !session.is_complete {
        match casino::process_game_move(&mut session, &payload, &mut rng) {
            Ok(_) => println!("  [PASS] Hit processed"),
            Err(e) => println!("  [FAIL] Hit failed: {:?}", e),
        }
    } else {
        println!("  [INFO] Game ended on deal (Blackjack)");
    }
}

fn run_casino_war() {
    println!("Testing Casino War...");
    let (mut session, mut rng) = create_test_env(GameType::CasinoWar);
    casino::init_game(&mut session, &mut rng);

    // Payload: [0] = Play
    let payload = vec![0];
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Play processed"),
        Err(e) => println!("  [FAIL] {:?}", e),
    }
}

fn run_craps() {
    println!("Testing Craps...");
    let (mut session, mut rng) = create_test_env(GameType::Craps);
    casino::init_game(&mut session, &mut rng);

    // Payload: Place Pass Line Bet (Type 0)
    // [0 (Place), 0 (Pass), 0 (Target), 0..100 (Amount)]
    let mut payload = vec![0, 0, 0];
    payload.extend_from_slice(&100u64.to_be_bytes());

    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Pass Line Bet processed"),
        Err(e) => println!("  [FAIL] Bet failed: {:?}", e),
    }

    // Payload: Roll Dice [2]
    let payload = vec![2];
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 2);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Roll processed"),
        Err(e) => println!("  [FAIL] Roll failed: {:?}", e),
    }
}

fn run_video_poker() {
    println!("Testing Video Poker...");
    let (mut session, mut rng) = create_test_env(GameType::VideoPoker);
    casino::init_game(&mut session, &mut rng);

    // Payload: Hold all cards (0b11111 = 31)
    let payload = vec![31];
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Hold All processed"),
        Err(e) => println!("  [FAIL] {:?}", e),
    }
}

fn run_hilo() {
    println!("Testing HiLo...");
    let (mut session, mut rng) = create_test_env(GameType::HiLo);
    casino::init_game(&mut session, &mut rng);

    // Parse state to check for King
    if !session.state_blob.is_empty() {
        let card = session.state_blob[0];
        let rank = (card % 13) + 1;
        
        let payload = if rank == 13 {
            // Can't guess higher on King, guess Lower [1]
            vec![1]
        } else {
            // Higher [0]
            vec![0]
        };

        let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
        match casino::process_game_move(&mut session, &payload, &mut rng) {
            Ok(_) => println!("  [PASS] Move processed (Rank {})", rank),
            Err(e) => println!("  [FAIL] {:?} (Rank {})", e, rank),
        }
    } else {
        println!("  [FAIL] Empty state");
    }
}

fn run_roulette() {
    println!("Testing Roulette...");
    let (mut session, mut rng) = create_test_env(GameType::Roulette);
    casino::init_game(&mut session, &mut rng);

    // Payload: Red (Type 1), Number 0 (Ignored)
    let payload = vec![1, 0];
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Red Bet processed"),
        Err(e) => println!("  [FAIL] {:?}", e),
    }
}

fn run_sic_bo() {
    println!("Testing Sic Bo...");
    let (mut session, mut rng) = create_test_env(GameType::SicBo);
    casino::init_game(&mut session, &mut rng);

    // Payload: Small (Type 0), Number 0
    let payload = vec![0, 0];
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Small Bet processed"),
        Err(e) => println!("  [FAIL] {:?}", e),
    }
}

fn run_three_card() {
    println!("Testing Three Card Poker...");
    let (mut session, mut rng) = create_test_env(GameType::ThreeCard);
    casino::init_game(&mut session, &mut rng);

    // Payload: Play [0]
    let payload = vec![0];
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Play processed"),
        Err(e) => println!("  [FAIL] {:?}", e),
    }
}

fn run_ultimate_holdem() {
    println!("Testing Ultimate Hold'em...");
    let (mut session, mut rng) = create_test_env(GameType::UltimateHoldem);
    casino::init_game(&mut session, &mut rng);

    // Payload: Check [0] (Preflop)
    let payload = vec![0];
    let mut rng = GameRng::new(&create_seed(&create_network_keypair().0, 1), session.id, 1);
    match casino::process_game_move(&mut session, &payload, &mut rng) {
        Ok(_) => println!("  [PASS] Check processed"),
        Err(e) => println!("  [FAIL] {:?}", e),
    }
}

fn main() {
    println!("Starting Bot Reference Implementation Checks...");
    println!("-----------------------------------------------");
    
    run_baccarat();
    run_blackjack();
    run_casino_war();
    run_craps();
    run_video_poker();
    run_hilo();
    run_roulette();
    run_sic_bo();
    run_three_card();
    run_ultimate_holdem();
    
    println!("-----------------------------------------------");
    println!("All checks completed.");
}
