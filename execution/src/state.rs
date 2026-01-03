use anyhow::{Context as _, Result};
use bytes::{Buf, BufMut};
use commonware_codec::{Encode, EncodeSize, Error, Read, ReadExt, Write};
use commonware_cryptography::{
    ed25519::PublicKey,
    sha256::{Digest, Sha256},
    Hasher,
};
use commonware_runtime::{Clock, Metrics, Spawner, Storage};
use commonware_storage::qmdb::any::unordered::variable::Db as AnyDb;
use commonware_storage::translator::Translator;
use nullspace_types::execution::{Account, Key, Transaction, Value};
use std::collections::BTreeMap;

#[cfg(any(test, feature = "mocks"))]
use std::collections::HashMap;

pub type Adb<E, T> = AnyDb<E, Digest, Value, Sha256, T>;

async fn adb_insert_inner<'a, E, T>(
    adb: &'a mut Adb<E, T>,
    key: Key,
    value: Value,
) -> Result<()>
where
    E: Spawner + Metrics + Clock + Storage + Send + Sync + 'static,
    T: Translator + Send + Sync + 'static,
    T::Key: Send + Sync + 'static,
{
    let key_hash = Sha256::hash(&key.encode());
    AnyDb::update(adb, key_hash, value)
        .await
        .context("adb update")?;
    Ok(())
}

async fn adb_delete_inner<'a, E, T>(adb: &'a mut Adb<E, T>, key: Key) -> Result<()>
where
    E: Spawner + Metrics + Clock + Storage + Send + Sync + 'static,
    T: Translator + Send + Sync + 'static,
    T::Key: Send + Sync + 'static,
{
    let key_hash = Sha256::hash(&key.encode());
    AnyDb::delete(adb, key_hash).await.context("adb delete")?;
    Ok(())
}

#[derive(Debug)]
pub enum PrepareError {
    NonceMismatch { expected: u64, got: u64 },
    State(anyhow::Error),
}

#[allow(async_fn_in_trait)]
pub trait State: Send + Sync {
    async fn get(&self, key: Key) -> Result<Option<Value>>;
    async fn insert(&mut self, key: Key, value: Value) -> Result<()>;
    async fn delete(&mut self, key: Key) -> Result<()>;

    async fn apply(&mut self, changes: Vec<(Key, Status)>) -> Result<()> {
        for (key, status) in changes {
            match status {
                Status::Update(value) => self.insert(key, value).await?,
                Status::Delete => self.delete(key).await?,
            }
        }
        Ok(())
    }
}

impl<E, T> State for Adb<E, T>
where
    E: Spawner + Metrics + Clock + Storage + Send + Sync + 'static,
    T: Translator + Send + Sync + 'static,
    T::Key: Send + Sync + 'static,
{
    async fn get(&self, key: Key) -> Result<Option<Value>> {
        let key_hash = Sha256::hash(&key.encode());
        AnyDb::get(self, &key_hash).await.context("adb get")
    }

    async fn insert(&mut self, key: Key, value: Value) -> Result<()> {
        adb_insert_inner(self, key, value).await
    }

    async fn delete(&mut self, key: Key) -> Result<()> {
        adb_delete_inner(self, key).await
    }
}

#[cfg(any(test, feature = "mocks"))]
#[derive(Default)]
pub struct Memory {
    state: HashMap<Key, Value>,
}

#[cfg(any(test, feature = "mocks"))]
impl State for Memory {
    async fn get(&self, key: Key) -> Result<Option<Value>> {
        Ok(self.state.get(&key).cloned())
    }

    async fn insert(&mut self, key: Key, value: Value) -> Result<()> {
        self.state.insert(key, value);
        Ok(())
    }

    async fn delete(&mut self, key: Key) -> Result<()> {
        self.state.remove(&key);
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum Status {
    Update(Value),
    Delete,
}

impl Write for Status {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            Status::Update(value) => {
                0u8.write(writer);
                value.write(writer);
            }
            Status::Delete => 1u8.write(writer),
        }
    }
}

impl Read for Status {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let kind = u8::read(reader)?;
        match kind {
            0 => Ok(Status::Update(Value::read(reader)?)),
            1 => Ok(Status::Delete),
            _ => Err(Error::InvalidEnum(kind)),
        }
    }
}

impl EncodeSize for Status {
    fn encode_size(&self) -> usize {
        1 + match self {
            Status::Update(value) => value.encode_size(),
            Status::Delete => 0,
        }
    }
}

pub async fn nonce<S: State>(state: &S, public: &PublicKey) -> Result<u64> {
    Ok(load_account(state, public).await?.nonce)
}

pub(crate) async fn load_account<S: State>(state: &S, public: &PublicKey) -> Result<Account> {
    Ok(match state.get(Key::Account(public.clone())).await? {
        Some(Value::Account(account)) => account,
        _ => Account::default(),
    })
}

pub(crate) fn validate_and_increment_nonce(
    account: &mut Account,
    provided_nonce: u64,
) -> Result<(), PrepareError> {
    if account.nonce != provided_nonce {
        return Err(PrepareError::NonceMismatch {
            expected: account.nonce,
            got: provided_nonce,
        });
    }
    account.nonce += 1;
    Ok(())
}

pub struct Noncer<'a, S: State> {
    state: &'a S,
    pending: BTreeMap<Key, Status>,
}

impl<'a, S: State> Noncer<'a, S> {
    pub fn new(state: &'a S) -> Self {
        Self {
            state,
            pending: BTreeMap::new(),
        }
    }

    pub async fn prepare(&mut self, transaction: &Transaction) -> Result<(), PrepareError> {
        let mut account = load_account(self, &transaction.public)
            .await
            .map_err(PrepareError::State)?;
        validate_and_increment_nonce(&mut account, transaction.nonce)?;
        self.insert(
            Key::Account(transaction.public.clone()),
            Value::Account(account),
        )
        .await
        .map_err(PrepareError::State)?;

        Ok(())
    }
}

impl<'a, S: State> State for Noncer<'a, S> {
    async fn get(&self, key: Key) -> Result<Option<Value>> {
        Ok(match self.pending.get(&key) {
            Some(Status::Update(value)) => Some(value.clone()),
            Some(Status::Delete) => None,
            None => self.state.get(key).await?,
        })
    }

    async fn insert(&mut self, key: Key, value: Value) -> Result<()> {
        self.pending.insert(key, Status::Update(value));
        Ok(())
    }

    async fn delete(&mut self, key: Key) -> Result<()> {
        self.pending.insert(key, Status::Delete);
        Ok(())
    }
}
