use commonware_codec::Encode;
use commonware_cryptography::{sha256::Sha256, Hasher};
use nullspace_types::casino::GameType;
use nullspace_types::execution::Key;

fn main() {
    let games = [
        GameType::Baccarat,
        GameType::Blackjack,
        GameType::CasinoWar,
        GameType::Craps,
        GameType::VideoPoker,
        GameType::HiLo,
        GameType::Roulette,
        GameType::SicBo,
        GameType::ThreeCard,
        GameType::UltimateHoldem,
    ];

    for game in games {
        println!("Game {:?}:", game);
        println!("  config {}", hex_of(Key::GlobalTableConfig(game)));
        println!("  round  {}", hex_of(Key::GlobalTableRound(game)));
        // Session key includes player public key; using zeroed key for reference only.
    }
}

fn hex_of(key: Key) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.encode().as_ref());
    commonware_utils::hex(hasher.finalize().as_ref())
}
