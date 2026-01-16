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

/// Returns a feature-disabled error for liquidity/staking instructions.
pub(super) fn feature_disabled_error(player: &PublicKey, feature_name: &str) -> Vec<Event> {
    casino_error_vec(
        player,
        None,
        nullspace_types::casino::ERROR_FEATURE_DISABLED,
        format!("{} is disabled", feature_name),
    )
}

/// Returns a bridge-disabled error.
pub(super) fn bridge_disabled_error(player: &PublicKey) -> Vec<Event> {
    casino_error_vec(
        player,
        None,
        nullspace_types::casino::ERROR_BRIDGE_DISABLED,
        "Bridge is disabled",
    )
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
#[cfg(feature = "bridge")]
mod bridge;
#[cfg(feature = "liquidity")]
mod liquidity;
#[cfg(feature = "staking")]
mod staking;
