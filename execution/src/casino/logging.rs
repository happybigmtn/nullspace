use std::fmt::Write;

pub fn clamp_i64(value: i128) -> i64 {
    value.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

pub fn format_card_list(cards: &[u8]) -> String {
    let mut out = String::with_capacity(cards.len().saturating_mul(4));
    for (idx, card) in cards.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        let _ = write!(out, "{}", card);
    }
    out
}

pub fn push_resolved_entry(out: &mut String, label: &str, pnl: i64) {
    if !out.is_empty() {
        out.push(',');
    }
    let _ = write!(out, r#"{{"label":"{}","pnl":{}}}"#, label, pnl);
}
