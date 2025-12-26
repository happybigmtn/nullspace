use redis::AsyncCommands;
use std::time::Duration;
use tokio::sync::Mutex;

pub struct RedisCache {
    client: redis::Client,
    connection: Mutex<Option<redis::aio::ConnectionManager>>,
    prefix: String,
    ttl: Duration,
}

impl RedisCache {
    pub fn new(url: &str, prefix: String, ttl: Duration) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(url)?;
        Ok(Self {
            client,
            connection: Mutex::new(None),
            prefix,
            ttl,
        })
    }

    fn key(&self, key: &str) -> String {
        format!("{}{}", self.prefix, key)
    }

    async fn ensure_connection(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, Option<redis::aio::ConnectionManager>>, redis::RedisError>
    {
        let mut guard = self.connection.lock().await;
        if guard.is_none() {
            *guard = Some(self.client.get_connection_manager().await?);
        }
        Ok(guard)
    }

    pub async fn get(&self, key: &str) -> Option<Vec<u8>> {
        let mut guard = match self.ensure_connection().await {
            Ok(guard) => guard,
            Err(err) => {
                tracing::warn!("Redis cache connection failed: {err}");
                return None;
            }
        };
        let Some(conn) = guard.as_mut() else {
            return None;
        };
        let full_key = self.key(key);
        match conn.get(full_key).await {
            Ok(value) => Some(value),
            Err(err) => {
                tracing::warn!("Redis cache get failed: {err}");
                *guard = None;
                None
            }
        }
    }

    pub async fn set(&self, key: &str, value: &[u8]) {
        let mut guard = match self.ensure_connection().await {
            Ok(guard) => guard,
            Err(err) => {
                tracing::warn!("Redis cache connection failed: {err}");
                return;
            }
        };
        let Some(conn) = guard.as_mut() else {
            return;
        };
        let full_key = self.key(key);
        let ttl = self.ttl.as_secs().max(1);
        let result: redis::RedisResult<()> = conn.set_ex(full_key, value, ttl).await;
        if let Err(err) = result {
            tracing::warn!("Redis cache set failed: {err}");
            *guard = None;
        }
    }
}
