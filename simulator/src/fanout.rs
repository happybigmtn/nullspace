use anyhow::Result;
use bytes::{Buf, BufMut};
use commonware_codec::{DecodeExt, Encode, EncodeSize, Error, Read, ReadExt, Write};
use futures::StreamExt;
use nullspace_types::api::Submission;
use nullspace_types::casino::{read_string, string_encode_size, write_string};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::submission::apply_submission;
use crate::Simulator;

const MAX_FANOUT_ORIGIN_LEN: usize = 64;
const MAX_FANOUT_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;
const FANOUT_RECONNECT_DELAY: Duration = Duration::from_secs(2);

struct FanoutEnvelope {
    origin: String,
    payload: Vec<u8>,
}

impl Write for FanoutEnvelope {
    fn write(&self, writer: &mut impl BufMut) {
        write_string(&self.origin, writer);
        (self.payload.len() as u32).write(writer);
        writer.put_slice(&self.payload);
    }
}

impl EncodeSize for FanoutEnvelope {
    fn encode_size(&self) -> usize {
        string_encode_size(&self.origin) + 4 + self.payload.len()
    }
}

impl Read for FanoutEnvelope {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let origin = read_string(reader, MAX_FANOUT_ORIGIN_LEN)?;
        let payload_len = u32::read(reader)? as usize;
        if payload_len > MAX_FANOUT_PAYLOAD_BYTES {
            return Err(Error::Invalid("FanoutEnvelope", "payload too large"));
        }
        if reader.remaining() < payload_len {
            return Err(Error::EndOfBuffer);
        }
        let mut payload = vec![0u8; payload_len];
        reader.copy_to_slice(&mut payload);
        Ok(Self { origin, payload })
    }
}

pub struct Fanout {
    origin: String,
    channel: String,
    publish: bool,
    subscribe: bool,
    client: redis::Client,
    publisher: Mutex<Option<redis::aio::ConnectionManager>>,
}

impl Fanout {
    pub fn new(
        url: &str,
        channel: String,
        origin: Option<String>,
        publish: bool,
        subscribe: bool,
    ) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(url)?;
        Ok(Self {
            origin: origin.unwrap_or_else(|| Uuid::new_v4().to_string()),
            channel,
            publish,
            subscribe,
            client,
            publisher: Mutex::new(None),
        })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub fn channel(&self) -> &str {
        &self.channel
    }

    pub fn subscribe_enabled(&self) -> bool {
        self.subscribe
    }

    pub fn start(self: &Arc<Self>, simulator: Arc<Simulator>) {
        if !self.subscribe {
            return;
        }
        let fanout = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                if let Err(err) = fanout.run_subscriber(Arc::clone(&simulator)).await {
                    tracing::warn!("Fanout subscriber error: {err}");
                    tokio::time::sleep(FANOUT_RECONNECT_DELAY).await;
                }
            }
        });
    }

    pub async fn publish(&self, payload: &[u8]) {
        if !self.publish {
            return;
        }
        if payload.len() > MAX_FANOUT_PAYLOAD_BYTES {
            tracing::warn!(
                len = payload.len(),
                "Skipping fanout publish: payload exceeds max size"
            );
            return;
        }
        let envelope = FanoutEnvelope {
            origin: self.origin.clone(),
            payload: payload.to_vec(),
        };
        let bytes = envelope.encode().to_vec();
        let mut guard = match self.ensure_publisher().await {
            Ok(guard) => guard,
            Err(err) => {
                tracing::warn!("Fanout publisher connection failed: {err}");
                return;
            }
        };
        let Some(conn) = guard.as_mut() else {
            return;
        };
        let result: redis::RedisResult<()> = redis::cmd("PUBLISH")
            .arg(&self.channel)
            .arg(bytes)
            .query_async(conn)
            .await;
        if let Err(err) = result {
            tracing::warn!("Fanout publish failed: {err}");
            *guard = None;
        }
    }

    async fn ensure_publisher(
        &self,
    ) -> Result<
        tokio::sync::MutexGuard<'_, Option<redis::aio::ConnectionManager>>,
        redis::RedisError,
    > {
        let mut guard = self.publisher.lock().await;
        if guard.is_none() {
            *guard = Some(self.client.get_connection_manager().await?);
        }
        Ok(guard)
    }

    async fn run_subscriber(self: &Arc<Self>, simulator: Arc<Simulator>) -> Result<()> {
        let mut pubsub = self.client.get_async_pubsub().await?;
        pubsub.subscribe(&self.channel).await?;
        let mut stream = pubsub.on_message();
        while let Some(message) = stream.next().await {
            let payload: Vec<u8> = match message.get_payload() {
                Ok(payload) => payload,
                Err(err) => {
                    tracing::warn!("Fanout message decode failed: {err}");
                    continue;
                }
            };
            let envelope = match FanoutEnvelope::decode(&mut payload.as_slice()) {
                Ok(envelope) => envelope,
                Err(err) => {
                    tracing::warn!("Fanout envelope decode failed: {err}");
                    continue;
                }
            };
            if envelope.origin == self.origin {
                continue;
            }
            let submission = match Submission::decode(&mut envelope.payload.as_slice()) {
                Ok(submission) => submission,
                Err(err) => {
                    tracing::warn!("Fanout submission decode failed: {err}");
                    continue;
                }
            };
            if let Err(err) = apply_submission(Arc::clone(&simulator), submission, false).await {
                tracing::warn!("Fanout submission apply failed: {err:?}");
            }
        }
        Ok(())
    }
}
