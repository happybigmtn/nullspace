use anyhow::Result;
use commonware_codec::Encode;
use nullspace_execution::mocks::create_network_keypair;
use nullspace_execution::mocks::create_seed;
use nullspace_types::api::Submission;
use reqwest::Client;
use std::env;

fn base_url() -> String {
    env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:8080".to_string())
}

fn seed_view() -> u64 {
    env::var("VIEW")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1)
}

#[tokio::main]
async fn main() -> Result<()> {
    let base = base_url();
    let view = seed_view();

    // Deterministic network keypair (same helper used in execution mocks/tests).
    let (network_secret, _network_public) = create_network_keypair();
    let seed = create_seed(&network_secret, view);

    let submission = Submission::Seed(seed);
    let body = submission.encode().to_vec();

    let client = Client::builder().build()?;
    let resp = client
        .post(format!("{base}/submit"))
        .header("Content-Type", "application/octet-stream")
        .body(body)
        .send()
        .await?;

    println!("submitted seed view={view} -> {}", resp.status());
    if !resp.status().is_success() {
        println!("body: {:?}", resp.text().await?);
    }

    Ok(())
}
