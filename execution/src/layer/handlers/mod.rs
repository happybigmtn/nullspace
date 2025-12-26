use super::*;

fn casino_error(
    player: &PublicKey,
    session_id: Option<u64>,
    error_code: u8,
    message: impl Into<String>,
) -> Event {
    Event::CasinoError {
        player: player.clone(),
        session_id,
        error_code,
        message: message.into(),
    }
}

fn casino_error_vec(
    player: &PublicKey,
    session_id: Option<u64>,
    error_code: u8,
    message: impl Into<String>,
) -> Vec<Event> {
    vec![casino_error(player, session_id, error_code, message)]
}

mod casino;
mod bridge;
mod liquidity;
mod staking;
