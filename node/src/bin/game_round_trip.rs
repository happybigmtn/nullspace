//! Game Round-Trip Test Binary (PROTO-2)
//!
//! This binary initializes games, processes moves, and outputs state blobs
//! for TypeScript protocol round-trip testing. It ensures that:
//! 1. TypeScript can encode payloads correctly (input)
//! 2. Rust processes them correctly (execution)
//! 3. TypeScript can decode the resulting state blobs (output)
//!
//! Usage: game-round-trip <game-type> <bet> <move-hex>...
//!
//! Examples:
//!   game-round-trip blackjack 100 04
//!   game-round-trip roulette 100 040101000000000000000064 01
//!   game-round-trip craps 100 040100000000000000000064 02

use commonware_codec::Encode;
use commonware_consensus::types::{Epoch, Round, View};
use commonware_cryptography::{
    bls12381::primitives::{group::Private, ops, variant::MinSig},
    ed25519::PrivateKey,
    Signer,
};
use commonware_math::algebra::Random;
use commonware_utils::union;
use nullspace_execution::casino::{init_game, process_game_move, GameRng};
use nullspace_types::casino::{GameSession, GameType};
use nullspace_types::{Seed, NAMESPACE};
use rand::{rngs::StdRng, SeedableRng};
use std::env;

fn hex_to_bytes(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("invalid hex"))
        .collect()
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn create_network_keypair() -> (
    Private,
    <MinSig as commonware_cryptography::bls12381::primitives::variant::Variant>::Public,
) {
    let mut rng = StdRng::seed_from_u64(0);
    ops::keypair::<_, MinSig>(&mut rng)
}

fn create_account_keypair(seed: u64) -> PrivateKey {
    let mut rng = StdRng::seed_from_u64(seed);
    PrivateKey::random(&mut rng)
}

fn seed_namespace(namespace: &[u8]) -> Vec<u8> {
    union(namespace, b"_SEED")
}

fn create_seed(network_secret: &Private, view: u64) -> Seed {
    let seed_namespace = seed_namespace(NAMESPACE);
    let round = Round::new(Epoch::zero(), View::new(view));
    let message = round.encode();
    Seed::new(
        round,
        ops::sign_message::<MinSig>(network_secret, Some(&seed_namespace), &message),
    )
}

fn parse_game_type(s: &str) -> Option<GameType> {
    match s.to_lowercase().as_str() {
        "blackjack" => Some(GameType::Blackjack),
        "roulette" => Some(GameType::Roulette),
        "craps" => Some(GameType::Craps),
        "baccarat" => Some(GameType::Baccarat),
        "sicbo" | "sic_bo" => Some(GameType::SicBo),
        "hilo" | "hi_lo" => Some(GameType::HiLo),
        "videopoker" | "video_poker" => Some(GameType::VideoPoker),
        "casinowar" | "casino_war" => Some(GameType::CasinoWar),
        "threecard" | "three_card" => Some(GameType::ThreeCard),
        "ultimateholdem" | "ultimate_holdem" => Some(GameType::UltimateHoldem),
        _ => None,
    }
}

fn game_type_to_string(gt: GameType) -> &'static str {
    match gt {
        GameType::Blackjack => "blackjack",
        GameType::Roulette => "roulette",
        GameType::Craps => "craps",
        GameType::Baccarat => "baccarat",
        GameType::SicBo => "sicbo",
        GameType::HiLo => "hilo",
        GameType::VideoPoker => "videopoker",
        GameType::CasinoWar => "casinowar",
        GameType::ThreeCard => "threecard",
        GameType::UltimateHoldem => "ultimateholdem",
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 4 {
        eprintln!("Usage: {} <game-type> <bet> <move-hex>...", args[0]);
        eprintln!();
        eprintln!("Game types: blackjack, roulette, craps, baccarat, sicbo, hilo,");
        eprintln!("            videopoker, casinowar, threecard, ultimateholdem");
        eprintln!();
        eprintln!("Examples:");
        eprintln!("  {} blackjack 100 04                  # deal", args[0]);
        eprintln!(
            "  {} roulette 100 040101000000000000000064 01  # bet + spin",
            args[0]
        );
        std::process::exit(1);
    }

    let game_type = match parse_game_type(&args[1]) {
        Some(gt) => gt,
        None => {
            eprintln!("Unknown game type: {}", args[1]);
            std::process::exit(1);
        }
    };

    let bet: u64 = match args[2].parse() {
        Ok(b) => b,
        Err(_) => {
            eprintln!("Invalid bet amount: {}", args[2]);
            std::process::exit(1);
        }
    };

    // Collect move payloads (hex strings)
    let move_hexes: Vec<&str> = args[3..].iter().map(|s| s.as_str()).collect();

    // Create deterministic test environment
    let (network_secret, _) = create_network_keypair();
    let private = create_account_keypair(1);
    let pk = private.public_key();
    let seed = create_seed(&network_secret, 1);
    let session_id = 1u64;

    // Create game session
    let mut session = GameSession {
        id: session_id,
        player: pk,
        game_type,
        bet,
        state_blob: vec![],
        move_count: 0,
        created_at: 0,
        is_complete: false,
        super_mode: nullspace_types::casino::SuperModeState::default(),
        is_tournament: false,
        tournament_id: None,
    };

    // Initialize game
    let mut rng = GameRng::new(&seed, session.id, 0);
    let _init_result = init_game(&mut session, &mut rng);

    // Process each move
    let mut moves_processed = 0;
    for (i, hex) in move_hexes.iter().enumerate() {
        if session.is_complete {
            break;
        }

        let payload = hex_to_bytes(hex);
        let mut move_rng = GameRng::new(&seed, session.id, (i + 1) as u32);

        match process_game_move(&mut session, &payload, &mut move_rng) {
            Ok(_result) => {
                moves_processed += 1;
            }
            Err(e) => {
                eprintln!("Error processing move {}: {:?}", i, e);
                std::process::exit(1);
            }
        }
    }

    // Output result as JSON (manual formatting to avoid serde_json dependency)
    println!(
        r#"{{"game_type":"{}","bet":{},"session_id":{},"moves_processed":{},"state_blob_hex":"{}","is_complete":{},"move_count":{}}}"#,
        game_type_to_string(game_type),
        bet,
        session_id,
        moves_processed,
        bytes_to_hex(&session.state_blob),
        session.is_complete,
        session.move_count
    );
}
