use commonware_cryptography::sha256::Sha256;
use nullspace_types::casino::GameType;
use nullspace_types::execution::Key;
use commonware_cryptography::Hasher;
use commonware_codec::Encode;

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
        let cfg_key = Key::GlobalTableConfig(game);
        let round_key = Key::GlobalTableRound(game);
        let sess_key = Key::GlobalTablePlayerSession(game, Default::default());

        println!("Game {:?}:", game);
        println!("  config {}", hex_of(&cfg_key));
        println!("  round  {}", hex_of(&round_key));
        println!("  session (zero pk) {}", hex_of(&sess_key));
    }
}

fn hex_of(key: &Key) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.encode().as_ref());
    commonware_utils::hex(hasher.finalize().as_ref())
}
