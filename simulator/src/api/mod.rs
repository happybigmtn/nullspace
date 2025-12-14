use axum::{
    http::{header, Method},
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tower_http::cors::{Any, CorsLayer};

use crate::Simulator;

mod http;
mod ws;

#[cfg(test)]
pub(super) use ws::filter_updates_for_account;

pub struct Api {
    simulator: Arc<Simulator>,
}

impl Api {
    pub fn new(simulator: Arc<Simulator>) -> Self {
        Self { simulator }
    }

    pub fn router(&self) -> Router {
        // Configure CORS
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers([header::CONTENT_TYPE]);

        // Configure Rate Limiting
        // Maximize throughput for local sims: allow ~1M req/s with a large burst
        let governor_conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_nanosecond(1) // effectively unlimited for local sims (~1B req/s)
                .burst_size(2_000_000)
                .key_extractor(SmartIpKeyExtractor)
                .finish()
                .unwrap_or_else(|| {
                    tracing::warn!("invalid rate-limit config; falling back to defaults");
                    GovernorConfigBuilder::default()
                        .key_extractor(SmartIpKeyExtractor)
                        .finish()
                        .expect("default governor config is valid")
                }),
        );

        let router = Router::new()
            .route("/submit", post(http::submit))
            .route("/seed/:query", get(http::query_seed))
            .route("/state/:query", get(http::query_state))
            .route("/updates/:filter", get(ws::updates_ws))
            .route("/mempool", get(ws::mempool_ws))
            .route("/explorer/blocks", get(crate::explorer::list_blocks))
            .route("/explorer/blocks/:id", get(crate::explorer::get_block))
            .route("/explorer/tx/:hash", get(crate::explorer::get_transaction))
            .route(
                "/explorer/account/:pubkey",
                get(crate::explorer::get_account_activity),
            )
            .route("/explorer/search", get(crate::explorer::search_explorer));

        #[cfg(feature = "passkeys")]
        let router = router
            .route(
                "/webauthn/challenge",
                get(crate::passkeys::get_passkey_challenge),
            )
            .route(
                "/webauthn/register",
                post(crate::passkeys::register_passkey),
            )
            .route("/webauthn/login", post(crate::passkeys::login_passkey))
            .route("/webauthn/sign", post(crate::passkeys::sign_with_passkey));

        router
            .layer(cors)
            .layer(GovernorLayer {
                config: governor_conf,
            })
            .with_state(self.simulator.clone())
    }
}
