use super::*;
use commonware_codec::ReadExt;
use commonware_utils::from_hex;

fn casino_error(
    player: &PublicKey,
    session_id: Option<u64>,
    error_code: u8,
    message: impl Into<String>,
) -> Event {
    let message = message.into();
    tracing::warn!(
        player = ?player,
        session_id,
        error_code,
        message = %message,
        "casino error"
    );
    Event::CasinoError {
        player: player.clone(),
        session_id,
        error_code,
        message,
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

fn parse_admin_public_key(raw: &str) -> Option<PublicKey> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let trimmed = trimmed.trim_start_matches("0x");
    let bytes = from_hex(trimmed)?;
    let mut buf = bytes.as_slice();
    let key = PublicKey::read(&mut buf).ok()?;
    if !buf.is_empty() {
        return None;
    }
    Some(key)
}

pub(super) fn admin_public_keys() -> Vec<PublicKey> {
    let raw = match std::env::var("CASINO_ADMIN_PUBLIC_KEY_HEX") {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    raw.split(|ch: char| ch == ',' || ch.is_whitespace())
        .filter_map(parse_admin_public_key)
        .collect()
}

pub(super) fn is_admin_public_key(public: &PublicKey) -> bool {
    admin_public_keys().iter().any(|key| key == public)
}

mod casino;
mod bridge;
mod liquidity;
mod staking;
