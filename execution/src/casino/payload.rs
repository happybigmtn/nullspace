use super::GameError;

pub(crate) fn parse_u64_be(payload: &[u8], offset: usize) -> Result<u64, GameError> {
    let end = offset.saturating_add(8);
    if payload.len() < end {
        return Err(GameError::InvalidPayload);
    }
    let bytes: [u8; 8] = payload[offset..end]
        .try_into()
        .map_err(|_| GameError::InvalidPayload)?;
    Ok(u64::from_be_bytes(bytes))
}

/// Parse the common table-game bet placement payload:
/// `[0, bet_type:u8, number:u8, amount:u64 BE]`.
pub(crate) fn parse_place_bet_payload(payload: &[u8]) -> Result<(u8, u8, u64), GameError> {
    if payload.len() < 11 || payload[0] != 0 {
        return Err(GameError::InvalidPayload);
    }
    let bet_type = payload[1];
    let number = payload[2];
    let amount = parse_u64_be(payload, 3)?;
    Ok((bet_type, number, amount))
}

pub(crate) fn ensure_nonzero_amount(amount: u64) -> Result<(), GameError> {
    if amount == 0 {
        return Err(GameError::InvalidPayload);
    }
    Ok(())
}
