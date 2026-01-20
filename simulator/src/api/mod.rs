use axum::{
    extract::{DefaultBodyLimit, Request, State as AxumState},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use governor::middleware::NoOpMiddleware;
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use crate::Simulator;

mod http;
mod ws;

pub struct Api {
    simulator: Arc<Simulator>,
}

#[derive(Clone)]
struct OriginConfig {
    allowed_origins: Arc<HashSet<String>>,
    allow_any_origin: bool,
    allow_no_origin: bool,
}

type IpGovernorConfig =
    tower_governor::governor::GovernorConfig<SmartIpKeyExtractor, NoOpMiddleware>;

fn default_governor_config() -> Option<IpGovernorConfig> {
    GovernorConfigBuilder::default()
        .key_extractor(SmartIpKeyExtractor)
        .finish()
}

impl Api {
    pub fn new(simulator: Arc<Simulator>) -> Self {
        Self { simulator }
    }

    pub fn router(&self) -> Router {
        let allowed_origins = parse_allowed_origins("ALLOWED_HTTP_ORIGINS");
        let allow_any_origin = allowed_origins.contains("*");
        let allow_no_origin = parse_allow_no_origin("ALLOW_HTTP_NO_ORIGIN");
        if allowed_origins.is_empty() {
            tracing::warn!("ALLOWED_HTTP_ORIGINS is empty; all browser origins will be rejected");
        }
        let cors_origins = allowed_origins
            .iter()
            .filter(|origin| *origin != "*")
            .filter_map(|origin| match HeaderValue::from_str(origin) {
                Ok(value) => Some(value),
                Err(_) => {
                    tracing::warn!("Invalid origin in ALLOWED_HTTP_ORIGINS: {}", origin);
                    None
                }
            })
            .collect::<Vec<_>>();
        let origin_config = OriginConfig {
            allowed_origins: Arc::new(allowed_origins),
            allow_any_origin,
            allow_no_origin,
        };

        // Configure CORS
        let cors = if allow_any_origin {
            CorsLayer::new().allow_origin(AllowOrigin::any())
        } else {
            CorsLayer::new().allow_origin(AllowOrigin::list(cors_origins))
        }
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::HeaderName::from_static("x-request-id"),
        ])
        .expose_headers([header::HeaderName::from_static("x-request-id")]);

        // Configure Rate Limiting - environment variables override config
        let http_rate_per_sec = parse_env_u64("RATE_LIMIT_HTTP_PER_SEC")
            .or(self.simulator.config.http_rate_limit_per_second);
        let http_rate_burst = parse_env_u32("RATE_LIMIT_HTTP_BURST")
            .or(self.simulator.config.http_rate_limit_burst);
        let submit_rate_per_min = parse_env_u64("RATE_LIMIT_SUBMIT_PER_MIN")
            .or(self.simulator.config.submit_rate_limit_per_minute);
        let submit_rate_burst = parse_env_u32("RATE_LIMIT_SUBMIT_BURST")
            .or(self.simulator.config.submit_rate_limit_burst);

        let governor_conf = match (http_rate_per_sec, http_rate_burst) {
            (Some(rate_per_second), Some(burst_size))
                if rate_per_second > 0 && burst_size > 0 =>
            {
                let nanos_per_request = (1_000_000_000u64 / rate_per_second).max(1);
                let period = Duration::from_nanos(nanos_per_request);
                let config = GovernorConfigBuilder::default()
                    .period(period)
                    .burst_size(burst_size)
                    .key_extractor(SmartIpKeyExtractor)
                    .finish()
                    .or_else(|| {
                        tracing::warn!(
                            "invalid rate-limit config; falling back to defaults"
                        );
                        default_governor_config()
                    });
                config.map(Arc::new)
            }
            _ => None,
        };

        // Configure submit-specific rate limiting (per minute)
        let submit_governor_conf = match (submit_rate_per_min, submit_rate_burst) {
            (Some(rate_per_minute), Some(burst_size))
                if rate_per_minute > 0 && burst_size > 0 =>
            {
                // Convert per-minute rate to period between requests
                let nanos_per_request = (60_000_000_000u64 / rate_per_minute).max(1);
                let period = Duration::from_nanos(nanos_per_request);
                tracing::info!(
                    rate_per_minute = rate_per_minute,
                    burst_size = burst_size,
                    period_ms = period.as_millis(),
                    "Submit endpoint rate limit configured"
                );
                let config = GovernorConfigBuilder::default()
                    .period(period)
                    .burst_size(burst_size)
                    .key_extractor(SmartIpKeyExtractor)
                    .finish()
                    .or_else(|| {
                        tracing::warn!(
                            "invalid submit rate-limit config; falling back to defaults"
                        );
                        default_governor_config()
                    });
                config.map(Arc::new)
            }
            _ => None,
        };

        // Create submit route with its own rate limiter
        let submit_route = match submit_governor_conf {
            Some(config) => Router::new()
                .route("/submit", post(http::submit))
                .layer(GovernorLayer { config }),
            None => Router::new().route("/submit", post(http::submit)),
        };

        let router = Router::new()
            .route("/healthz", get(http::healthz))
            .route("/config", get(http::config))
            .route("/presence/global-table", post(http::global_table_presence))
            .route("/metrics/ws", get(http::ws_metrics))
            .route("/metrics/http", get(http::http_metrics))
            .route("/metrics/system", get(http::system_metrics))
            .route("/metrics/explorer", get(http::explorer_metrics))
            .route("/metrics/updates", get(http::update_index_metrics))
            .route("/metrics/prometheus", get(http::prometheus_metrics))
            .route("/seed/:query", get(http::query_seed))
            .route("/state/:query", get(http::query_state))
            .route("/account/:pubkey", get(http::get_account))
            .route("/updates/:filter", get(ws::updates_ws))
            .route("/mempool", get(ws::mempool_ws))
            .route("/explorer/blocks", get(crate::explorer::list_blocks))
            .route("/explorer/blocks/:id", get(crate::explorer::get_block))
            .route("/explorer/tx/:hash", get(crate::explorer::get_transaction))
            .route(
                "/explorer/account/:pubkey",
                get(crate::explorer::get_account_activity),
            )
            .route(
                "/explorer/games/:pubkey",
                get(crate::explorer::get_game_history),
            )
            .route("/explorer/search", get(crate::explorer::search_explorer))
            .route("/explorer/rounds", get(crate::explorer::list_rounds))
            .route(
                "/explorer/rounds/:game_type/:round_id",
                get(crate::explorer::get_round),
            )
            .route(
                "/explorer/rounds/:game_type/:round_id/bets",
                get(crate::explorer::get_round_bets),
            )
            .route(
                "/explorer/rounds/:game_type/:round_id/payouts",
                get(crate::explorer::get_round_payouts),
            )
            .route("/explorer/leaderboard", get(crate::explorer::get_leaderboard))
            .route("/explorer/stats", get(crate::explorer::get_aggregated_stats))
            .route("/backfill/blocks", get(crate::explorer::get_backfill_blocks));

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

        let router = match governor_conf {
            Some(config) => router.layer(GovernorLayer { config }),
            None => router,
        };

        let router = router.merge(submit_route);

        let router = router.layer(cors);
        let router = router.layer(middleware::from_fn(move |req, next| {
            let origin_config = origin_config.clone();
            async move { enforce_origin(origin_config, req, next).await }
        }));
        let router = match self.simulator.config.http_body_limit_bytes {
            Some(limit) if limit > 0 => router.layer(DefaultBodyLimit::max(limit)),
            _ => router,
        };
        let router = router.layer(middleware::from_fn_with_state(
            self.simulator.clone(),
            request_id_middleware,
        ));
        let router = router.layer(TraceLayer::new_for_http());

        router.with_state(self.simulator.clone())
    }
}

fn parse_allowed_origins(var: &str) -> HashSet<String> {
    std::env::var(var)
        .unwrap_or_default()
        .split(',')
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn parse_allow_no_origin(var: &str) -> bool {
    matches!(
        std::env::var(var).as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    )
}

fn parse_env_u64(var: &str) -> Option<u64> {
    std::env::var(var).ok().and_then(|v| v.parse().ok())
}

fn parse_env_u32(var: &str) -> Option<u32> {
    std::env::var(var).ok().and_then(|v| v.parse().ok())
}


async fn enforce_origin(
    config: OriginConfig,
    req: Request,
    next: Next,
) -> axum::response::Response {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if let Some(origin) = origin {
        if !config.allow_any_origin && !config.allowed_origins.contains(origin) {
            return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
        }
    } else if !config.allow_no_origin {
        return (StatusCode::FORBIDDEN, "Origin required").into_response();
    }
    next.run(req).await
}

async fn request_id_middleware(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    req: Request,
    next: Next,
) -> Response {
    let request_id = req
        .headers()
        .get(header::HeaderName::from_static("x-request-id"))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let start = Instant::now();
    let mut response = next.run(req).await;
    match response.status() {
        StatusCode::FORBIDDEN => simulator.http_metrics().inc_reject_origin(),
        StatusCode::PAYLOAD_TOO_LARGE => simulator.http_metrics().inc_reject_body_limit(),
        StatusCode::TOO_MANY_REQUESTS => simulator.http_metrics().inc_reject_rate_limit(),
        _ => {}
    }
    if let Ok(header_value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(
            header::HeaderName::from_static("x-request-id"),
            header_value,
        );
    }
    tracing::info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        status = response.status().as_u16(),
        elapsed_ms = start.elapsed().as_millis() as u64,
        "http.request"
    );
    response
}
