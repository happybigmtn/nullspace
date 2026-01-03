pub mod client;
pub mod consensus;
pub mod events;

pub use client::Client;
pub use client::RetryPolicy;
pub use events::Stream;
use commonware_consensus::simplex::scheme::bls12381_threshold;
use commonware_cryptography::{bls12381::primitives::variant::MinSig, ed25519::PublicKey};
use commonware_cryptography::sha256::Digest;
use commonware_storage::qmdb::any::unordered::{variable, Update as StorageUpdate};
use nullspace_types::execution::Value;
use nullspace_types::Identity;
use thiserror::Error;

/// Error type for client operations.
#[derive(Error, Debug)]
pub enum Error {
    #[error("reqwest error: {0}")]
    Reqwest(#[from] reqwest::Error),
    #[error("tungstenite error: {0}")]
    Tungstenite(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("failed: {0}")]
    Failed(reqwest::StatusCode),
    #[error("failed: {status}: {body}")]
    FailedWithBody {
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("too many transactions in one submission: {got} (max {max})")]
    TooManyTransactions { max: usize, got: usize },
    #[error("invalid data: {0}")]
    InvalidData(#[from] commonware_codec::Error),
    #[error("invalid signature")]
    InvalidSignature,
    #[error("{context} verification failed: {reason}")]
    VerificationFailed {
        context: &'static str,
        reason: String,
    },
    #[error("unexpected response")]
    UnexpectedResponse,
    #[error("unexpected seed view: expected {expected}, got {got}")]
    UnexpectedSeedView { expected: u64, got: u64 },
    #[error("connection closed")]
    ConnectionClosed,
    #[error("URL parse error: {0}")]
    Url(#[from] url::ParseError),
    #[error("dial timeout")]
    DialTimeout,
    #[error("invalid URL scheme: {0} (expected http or https)")]
    InvalidScheme(String),
}

/// Result type for client operations.
pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn seed_verifier(
    identity: &Identity,
) -> bls12381_threshold::Scheme<PublicKey, MinSig> {
    bls12381_threshold::Scheme::certificate_verifier(identity.clone())
}

pub fn operation_value(
    operation: &variable::Operation<Digest, Value>,
) -> Option<&Value> {
    match operation {
        variable::Operation::Update(StorageUpdate(_, value)) => Some(value),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State as AxumState,
        http::StatusCode as AxumStatusCode,
        routing::{get, post},
        Router,
    };
    use bytes::Bytes;
    use commonware_consensus::Viewable;
    use commonware_cryptography::bls12381::primitives::group::Private;
    use commonware_runtime::{deterministic::Runner, Runner as _};
    use commonware_storage::qmdb::any::unordered::{variable, Update as StorageUpdate};
    use nullspace_execution::mocks::{
        create_account_keypair, create_adbs, create_network_keypair, create_seed, execute_block,
    };
    use nullspace_simulator::{Api, Simulator};
    use nullspace_types::{
        api::{Update, UpdatesFilter},
        execution::{Instruction, Key, Transaction, Value},
        Identity, Query, Seed,
    };
    use std::{
        net::SocketAddr,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
            Once,
        },
    };
    use tokio::time::{sleep, Duration};

    struct TestContext {
        network_secret: Private,
        network_identity: Identity,
        simulator: Arc<Simulator>,
        base_url: String,
        server_handle: tokio::task::JoinHandle<()>,
    }

    impl TestContext {
        async fn new() -> Self {
            static ORIGIN_ALLOWLIST: Once = Once::new();
            ORIGIN_ALLOWLIST.call_once(|| {
                std::env::set_var("ALLOW_HTTP_NO_ORIGIN", "1");
                std::env::set_var("ALLOW_WS_NO_ORIGIN", "1");
            });

            let (network_secret, network_identity) = create_network_keypair();
            let simulator = Arc::new(Simulator::new(network_identity));
            let api = Api::new(simulator.clone());

            // Start server on random port
            let addr = SocketAddr::from(([127, 0, 0, 1], 0));
            let router = api.router();
            let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
            let actual_addr = listener.local_addr().unwrap();
            let base_url = format!("http://{actual_addr}");

            let server_handle = tokio::spawn(async move {
                axum::serve(
                    listener,
                    router.into_make_service_with_connect_info::<SocketAddr>(),
                )
                .await
                .unwrap();
            });

            // Give server time to start
            sleep(Duration::from_millis(100)).await;

            Self {
                network_secret,
                network_identity,
                simulator,
                base_url,
                server_handle,
            }
        }

        fn create_client(&self) -> Client {
            Client::new(&self.base_url, self.network_identity).unwrap()
        }

        fn create_seed(&self, view: u64) -> Seed {
            create_seed(&self.network_secret, view)
        }
    }

    impl Drop for TestContext {
        fn drop(&mut self) {
            self.server_handle.abort();
        }
    }

    #[tokio::test]
    async fn test_client_seed_operations() {
        let ctx = TestContext::new().await;
        let client = ctx.create_client();

        // Upload seed
        let seed = ctx.create_seed(1);
        client.submit_seed(seed.clone()).await.unwrap();

        // Get seed by index
        let retrieved = client.query_seed(Query::Index(1)).await.unwrap();
        assert_eq!(retrieved, Some(seed.clone()));

        // Get latest seed
        let latest = client.query_seed(Query::Latest).await.unwrap();
        assert_eq!(latest, Some(seed));

        // Upload another seed
        let seed2 = ctx.create_seed(5);
        client.submit_seed(seed2.clone()).await.unwrap();

        // Get latest should now return seed2
        let latest = client.query_seed(Query::Latest).await.unwrap();
        assert_eq!(latest, Some(seed2.clone()));

        // Get specific seed by index
        let retrieved = client.query_seed(Query::Index(5)).await.unwrap();
        assert_eq!(retrieved, Some(seed2));

        // Query for non-existent seed
        let result = client.query_seed(Query::Index(3)).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_client_transaction_submission() {
        let ctx = TestContext::new().await;
        let client = ctx.create_client();

        // Create and submit transaction
        let (private, _) = create_account_keypair(1);
        let tx = Transaction::sign(
            &private,
            0,
            Instruction::CasinoRegister {
                name: "TestPlayer".to_string(),
            },
        );

        // Should succeed even though transaction isn't processed yet
        client.submit_transactions(vec![tx]).await.unwrap();

        // Submit another transaction with higher nonce
        let tx2 = Transaction::sign(&private, 1, Instruction::CasinoDeposit { amount: 100 });
        client.submit_transactions(vec![tx2]).await.unwrap();
    }

    #[tokio::test]
    async fn test_client_summary_submission() {
        // Setup server outside deterministic runtime
        let ctx = TestContext::new().await;
        let client = ctx.create_client();
        let network_secret = ctx.network_secret.clone();
        let network_identity = ctx.network_identity;

        // Create transaction
        let (private, _) = create_account_keypair(1);
        let tx = Transaction::sign(
            &private,
            0,
            Instruction::CasinoRegister {
                name: "TestPlayer".to_string(),
            },
        );

        // Create summary in deterministic runtime
        let executor = Runner::default();
        let (_, summary) = executor.start(|context| async move {
            let (mut state, mut events) = create_adbs(&context).await;
            execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                vec![tx],
            )
            .await
        });

        // Submit summary
        client.submit_summary(summary).await.unwrap();
    }

    #[tokio::test]
    async fn test_client_state_query() {
        // Setup server outside deterministic runtime
        let ctx = TestContext::new().await;
        let client = ctx.create_client();
        let network_secret = ctx.network_secret.clone();
        let network_identity = ctx.network_identity;
        let simulator = ctx.simulator.clone();

        // Create and process transaction
        let (private, public) = create_account_keypair(1);
        let tx = Transaction::sign(
            &private,
            0,
            Instruction::CasinoRegister {
                name: "TestPlayer".to_string(),
            },
        );

        // Create summary in deterministic runtime
        let executor = Runner::default();
        let (_, summary) = executor.start(|context| async move {
            let (mut state, mut events) = create_adbs(&context).await;
            execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                vec![tx],
            )
            .await
        });

        // Submit to simulator
        let (state_digests, events_digests) = summary.verify(&network_identity).unwrap();
        simulator
            .submit_events(summary.clone(), events_digests)
            .await;
        simulator.submit_state(summary, state_digests).await;

        // Query for account state
        let account_key = Key::Account(public.clone());
        let lookup = client.query_state(&account_key).await.unwrap();

        assert!(lookup.is_some());
        let lookup = lookup.unwrap();
        lookup.verify(&network_identity).unwrap();

        // Verify account data
        let variable::Operation::Update(StorageUpdate(_, Value::Account(account))) =
            lookup.operation
        else {
            panic!("Expected account value");
        };
        assert_eq!(account.nonce, 1);

        // Query for non-existent account
        let (_, other_public) = create_account_keypair(2);
        let other_key = Key::Account(other_public);
        let result = client.query_state(&other_key).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_client_updates_stream() {
        // Setup server outside deterministic runtime
        let ctx = TestContext::new().await;
        let client = ctx.create_client();
        let network_secret = ctx.network_secret.clone();
        let network_identity = ctx.network_identity;
        let simulator = ctx.simulator.clone();

        // Connect to updates stream for all events
        let mut stream = client.connect_updates(UpdatesFilter::All).await.unwrap();

        // Test seed update
        let seed = ctx.create_seed(10);
        simulator.submit_seed(seed.clone()).await;

        let update = stream.next().await.unwrap().unwrap();
        match update {
            Update::Seed(received_seed) => {
                assert_eq!(received_seed, seed);
            }
            _ => panic!("Expected seed update"),
        }

        // Test events update
        let (private, _) = create_account_keypair(1);
        let tx = Transaction::sign(
            &private,
            0,
            Instruction::CasinoRegister {
                name: "TestPlayer".to_string(),
            },
        );

        // Create summary in deterministic runtime
        let executor = Runner::default();
        let (_, summary) = executor.start(|context| async move {
            let (mut state, mut events) = create_adbs(&context).await;
            execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                vec![tx],
            )
            .await
        });

        // Submit events to simulator
        let (_state_digests, events_digests) = summary.verify(&network_identity).unwrap();
        simulator
            .submit_events(summary.clone(), events_digests)
            .await;

        // Receive event update from stream
        let update = stream.next().await.unwrap().unwrap();
        match update {
            Update::Events(event) => {
                event.verify(&network_identity).unwrap();
                assert_eq!(event.progress.height, 1);
                assert_eq!(event.events_proof_ops, summary.events_proof_ops);
            }
            _ => panic!("Expected events update"),
        }
    }

    #[tokio::test]
    async fn test_client_mempool_stream() {
        let ctx = TestContext::new().await;
        let client = ctx.create_client();

        // Connect to mempool stream
        let mut stream = client.connect_mempool().await.unwrap();

        // Submit transaction through simulator
        let (private, _) = create_account_keypair(1);
        let tx = Transaction::sign(
            &private,
            0,
            Instruction::CasinoRegister {
                name: "TestPlayer".to_string(),
            },
        );
        ctx.simulator.submit_transactions(vec![tx.clone()]);

        // Receive transaction from stream
        let received_txs = stream.next().await.unwrap().unwrap();
        assert_eq!(received_txs.transactions.len(), 1);
        let received_tx = &received_txs.transactions[0];
        assert_eq!(received_tx.public, tx.public);
        assert_eq!(received_tx.nonce, tx.nonce);
    }

    #[tokio::test]
    async fn test_client_get_current_view() {
        let ctx = TestContext::new().await;
        let client = ctx.create_client();

        // Submit a seed
        let seed = ctx.create_seed(42);
        ctx.simulator.submit_seed(seed).await;

        // Get current view
        let view = client.query_seed(Query::Latest).await.unwrap().unwrap();
        assert_eq!(view.view().get(), 42);
    }

    #[tokio::test]
    async fn test_client_query_seed() {
        let ctx = TestContext::new().await;
        let client = ctx.create_client();

        // Submit seed
        let seed = ctx.create_seed(15);
        ctx.simulator.submit_seed(seed.clone()).await;

        // Query existing seed
        let result = client.query_seed(Query::Index(15)).await.unwrap();
        assert_eq!(result, Some(seed));

        // Query non-existent seed
        let result = client.query_seed(Query::Index(999)).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_wait_for_latest_seed_at_least() {
        let ctx = TestContext::new().await;
        let client = ctx.create_client();
        let simulator = ctx.simulator.clone();
        let seed = ctx.create_seed(5);

        tokio::spawn(async move {
            sleep(Duration::from_millis(50)).await;
            simulator.submit_seed(seed).await;
        });

        let seed = tokio::time::timeout(
            Duration::from_secs(1),
            client.wait_for_latest_seed_at_least_with_interval(5, Duration::from_millis(10)),
        )
        .await
        .expect("timed out waiting for seed")
        .expect("wait_for_latest_seed_at_least failed");
        assert!(seed.view().get() >= 5);
    }

    #[test]
    fn test_client_invalid_scheme() {
        let (_, network_identity) = create_network_keypair();

        // Test invalid scheme
        let result = Client::new("ftp://example.com", network_identity);
        assert!(result.is_err());
        if let Err(err) = result {
            assert!(matches!(err, Error::InvalidScheme(_)));
            assert_eq!(
                err.to_string(),
                "invalid URL scheme: ftp (expected http or https)"
            );
        }

        // Test valid http scheme
        let result = Client::new("http://localhost:8080", network_identity);
        assert!(result.is_ok());

        // Test valid https scheme
        let result = Client::new("https://localhost:8080", network_identity);
        assert!(result.is_ok());
    }

    async fn serve_router(router: Router) -> (String, tokio::task::JoinHandle<()>) {
        let addr = SocketAddr::from(([127, 0, 0, 1], 0));
        let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
        let actual_addr = listener.local_addr().unwrap();
        let base_url = format!("http://{actual_addr}");

        let handle = tokio::spawn(async move {
            axum::serve(listener, router.into_make_service())
                .await
                .unwrap();
        });

        sleep(Duration::from_millis(50)).await;
        (base_url, handle)
    }

    #[tokio::test]
    async fn test_get_with_retry_retries_retryable_statuses() {
        let counter = Arc::new(AtomicUsize::new(0));
        let router = Router::new()
            .route(
                "/flaky",
                get(
                    |AxumState(counter): AxumState<Arc<AtomicUsize>>| async move {
                        let attempt = counter.fetch_add(1, Ordering::SeqCst);
                        if attempt < 2 {
                            AxumStatusCode::SERVICE_UNAVAILABLE
                        } else {
                            AxumStatusCode::OK
                        }
                    },
                ),
            )
            .with_state(counter.clone());

        let (base_url, handle) = serve_router(router).await;
        let (_, network_identity) = create_network_keypair();
        let client = Client::new(&base_url, network_identity)
            .unwrap()
            .with_retry_policy(RetryPolicy {
                max_attempts: 3,
                initial_backoff: Duration::ZERO,
                max_backoff: Duration::ZERO,
                retry_non_idempotent: false,
            });

        let url = client.base_url.join("flaky").unwrap();
        let response = client.get_with_retry(url).await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert_eq!(counter.load(Ordering::SeqCst), 3);

        handle.abort();
    }

    #[tokio::test]
    async fn test_post_with_retry_respects_retry_non_idempotent_default() {
        let counter = Arc::new(AtomicUsize::new(0));
        let router =
            Router::new()
                .route(
                    "/flaky-post",
                    post(
                        |AxumState(counter): AxumState<Arc<AtomicUsize>>,
                         _body: axum::body::Bytes| async move {
                            counter.fetch_add(1, Ordering::SeqCst);
                            AxumStatusCode::SERVICE_UNAVAILABLE
                        },
                    ),
                )
                .with_state(counter.clone());

        let (base_url, handle) = serve_router(router).await;
        let (_, network_identity) = create_network_keypair();
        let client = Client::new(&base_url, network_identity)
            .unwrap()
            .with_retry_policy(RetryPolicy {
                max_attempts: 3,
                initial_backoff: Duration::ZERO,
                max_backoff: Duration::ZERO,
                retry_non_idempotent: false,
            });

        let url = client.base_url.join("flaky-post").unwrap();
        let err = client
            .post_bytes_with_retry(url.clone(), Bytes::from_static(b"hi"))
            .await
            .expect_err("POST should not be retried by default");
        let Error::FailedWithBody { status, body } = err else {
            panic!("expected FailedWithBody, got {err:?}");
        };
        assert_eq!(status, reqwest::StatusCode::SERVICE_UNAVAILABLE);
        assert!(body.contains("POST"));
        assert!(body.contains(url.as_str()));
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        handle.abort();
    }

    #[tokio::test]
    async fn test_post_with_retry_retries_when_enabled() {
        let counter = Arc::new(AtomicUsize::new(0));
        let router =
            Router::new()
                .route(
                    "/flaky-post",
                    post(
                        |AxumState(counter): AxumState<Arc<AtomicUsize>>,
                         _body: axum::body::Bytes| async move {
                            let attempt = counter.fetch_add(1, Ordering::SeqCst);
                            if attempt < 2 {
                                AxumStatusCode::SERVICE_UNAVAILABLE
                            } else {
                                AxumStatusCode::OK
                            }
                        },
                    ),
                )
                .with_state(counter.clone());

        let (base_url, handle) = serve_router(router).await;
        let (_, network_identity) = create_network_keypair();
        let client = Client::new(&base_url, network_identity)
            .unwrap()
            .with_retry_policy(RetryPolicy {
                max_attempts: 3,
                initial_backoff: Duration::ZERO,
                max_backoff: Duration::ZERO,
                retry_non_idempotent: true,
            });

        let url = client.base_url.join("flaky-post").unwrap();
        client
            .post_bytes_with_retry(url, Bytes::from_static(b"hi"))
            .await
            .expect("POST should succeed after retry");
        assert_eq!(counter.load(Ordering::SeqCst), 3);

        handle.abort();
    }
}
