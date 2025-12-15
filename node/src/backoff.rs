use rand::{Rng, RngCore};
use std::time::Duration;

pub(crate) fn jittered_backoff(rng: &mut impl RngCore, backoff: Duration) -> Duration {
    let backoff_ms = backoff.as_millis() as u64;
    if backoff_ms <= 1 {
        return backoff;
    }

    // "Equal jitter": delay is in [backoff/2, backoff].
    let half_ms = backoff_ms / 2;
    let jitter_ms = rng.gen_range(0..=half_ms);
    Duration::from_millis(half_ms.saturating_add(jitter_ms))
}
