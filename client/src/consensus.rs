use crate::{client::join_hex_path, seed_verifier, Client, Error, Result};
use commonware_codec::{DecodeExt, Encode};
use commonware_consensus::Viewable;
use nullspace_types::{api::Query, Seed, NAMESPACE};
use tokio::time::{sleep, Duration};

impl Client {
    pub async fn query_seed(&self, query: Query) -> Result<Option<Seed>> {
        // Make request
        let url = join_hex_path(&self.base_url, "seed", &query.encode())?;
        let result = self.get_with_retry(url.clone()).await?;

        // Parse response
        let status = result.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if status != reqwest::StatusCode::OK {
            return Err(Self::error_from_response(reqwest::Method::GET, &url, result).await);
        }

        let bytes = result.bytes().await.map_err(Error::Reqwest)?;
        let seed = Seed::decode(bytes.as_ref()).map_err(Error::InvalidData)?;
        let verifier = seed_verifier(&self.identity);
        if !seed.verify(&verifier, NAMESPACE) {
            return Err(Error::InvalidSignature);
        }

        // Verify the seed matches the query
        match query {
            Query::Latest => {}
            Query::Index(index) => {
                if seed.view().get() != index {
                    return Err(Error::UnexpectedSeedView {
                        expected: index,
                        got: seed.view().get(),
                    });
                }
            }
        }
        Ok(Some(seed))
    }

    /// Wait until the latest seed view is at least `min_view`.
    ///
    /// This is useful for bots that need to wait for the chain to advance. Callers can apply
    /// their own timeout/cancellation via `tokio::time::timeout` or task cancellation.
    pub async fn wait_for_latest_seed_at_least(&self, min_view: u64) -> Result<Seed> {
        self.wait_for_latest_seed_at_least_with_interval(min_view, Duration::from_millis(200))
            .await
    }

    pub async fn wait_for_latest_seed_at_least_with_interval(
        &self,
        min_view: u64,
        poll_interval: Duration,
    ) -> Result<Seed> {
        let poll_interval = if poll_interval == Duration::ZERO {
            Duration::from_millis(200)
        } else {
            poll_interval
        };

        loop {
            if let Some(seed) = self.query_seed(Query::Latest).await? {
                if seed.view().get() >= min_view {
                    return Ok(seed);
                }
            }
            sleep(poll_interval).await;
        }
    }
}
