//! Token (CTI-20) types and canonical encodings.
//!
//! Defines token metadata/accounts and JSON/binary encoding helpers.

use bytes::{Buf, BufMut};
use commonware_codec::{EncodeSize, FixedSize, Read, ReadExt, Write};
use commonware_cryptography::ed25519::{PrivateKey, PublicKey};
use commonware_cryptography::Signer;
use commonware_utils::{from_hex, hex};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Commonware Token Interface (CTI-20)
/// A standard for fungible assets on the Commonware chain.

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenMetadata {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub icon_url: Option<String>,
    pub total_supply: u64,
    pub mintable: bool,
    pub burnable: bool,
    #[serde(with = "serde_public_key_hex")]
    pub authority: PublicKey,
}

// Helper to encode hex
fn hex_encode(bytes: &[u8]) -> String {
    hex(bytes)
}

// Helper to decode hex
fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    from_hex(s).ok_or_else(|| "invalid hex string".to_string())
}

mod serde_public_key_hex {
    use super::{hex_decode, hex_encode};
    use commonware_codec::ReadExt;
    use commonware_cryptography::ed25519::PublicKey;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(public_key: &PublicKey, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&hex_encode(public_key.as_ref()))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<PublicKey, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let bytes = hex_decode(&s).map_err(serde::de::Error::custom)?;
        let mut reader = bytes.as_slice();
        PublicKey::read(&mut reader).map_err(|_| serde::de::Error::custom("invalid public key"))
    }
}

mod serde_allowances {
    use super::{hex_decode, hex_encode};
    use commonware_codec::ReadExt;
    use commonware_cryptography::ed25519::PublicKey;
    use serde::{Deserialize, Deserializer, Serialize as _, Serializer};
    use std::collections::BTreeMap;

    pub fn serialize<S>(
        allowances: &BTreeMap<PublicKey, u64>,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let allowances_serializable: Vec<(String, u64)> = allowances
            .iter()
            .map(|(pk, amt)| (hex_encode(pk.as_ref()), *amt))
            .collect();
        allowances_serializable.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<BTreeMap<PublicKey, u64>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let allowances_raw = Vec::<(String, u64)>::deserialize(deserializer)?;
        let mut allowances = BTreeMap::new();
        for (s, amt) in allowances_raw {
            let bytes = hex_decode(&s).map_err(serde::de::Error::custom)?;
            let mut reader = bytes.as_slice();
            let pk = PublicKey::read(&mut reader)
                .map_err(|_| serde::de::Error::custom("invalid public key"))?;
            allowances.insert(pk, amt);
        }
        Ok(allowances)
    }
}

impl Default for TokenMetadata {
    fn default() -> Self {
        // Use a known valid Ed25519 public key (from RFC 8032 test vector)
        // d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
        let bytes = [
            0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64,
            0x07, 0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68,
            0xf7, 0x07, 0x51, 0x1a,
        ];

        let mut reader = &bytes[..];
        let authority = PublicKey::read(&mut reader)
            .unwrap_or_else(|_| PrivateKey::from_seed(0).public_key());

        Self {
            name: "Unknown".to_string(),
            symbol: "UNK".to_string(),
            decimals: 9,
            icon_url: None,
            total_supply: 0,
            mintable: false,
            burnable: false,
            authority,
        }
    }
}

/// Represents a token balance and allowances
#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct TokenAccount {
    pub balance: u64,
    pub frozen: bool,
    // simplistic allowance map: spender -> amount
    #[serde(with = "serde_allowances")]
    pub allowances: BTreeMap<PublicKey, u64>,
}

impl TokenAccount {
    pub fn allowance(&self, spender: &PublicKey) -> u64 {
        self.allowances.get(spender).copied().unwrap_or(0)
    }

    pub fn set_allowance(&mut self, spender: PublicKey, amount: u64) {
        self.allowances.insert(spender, amount);
    }
}

// Binary Serialization Implementation

impl Write for TokenMetadata {
    fn write(&self, writer: &mut impl BufMut) {
        crate::casino::write_string(&self.name, writer);
        crate::casino::write_string(&self.symbol, writer);
        self.decimals.write(writer);
        match &self.icon_url {
            Some(url) => {
                true.write(writer);
                crate::casino::write_string(url, writer);
            }
            None => false.write(writer),
        }
        self.total_supply.write(writer);
        self.mintable.write(writer);
        self.burnable.write(writer);
        self.authority.write(writer);
    }
}

impl Read for TokenMetadata {
    type Cfg = ();
    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, commonware_codec::Error> {
        let name = crate::casino::read_string(reader, 32)?;
        let symbol = crate::casino::read_string(reader, 8)?;
        let decimals = u8::read(reader)?;
        let has_icon = bool::read(reader)?;
        let icon_url = if has_icon {
            Some(crate::casino::read_string(reader, 256)?)
        } else {
            None
        };
        let total_supply = u64::read(reader)?;
        let mintable = bool::read(reader)?;
        let burnable = bool::read(reader)?;
        let authority = PublicKey::read(reader)?;

        Ok(Self {
            name,
            symbol,
            decimals,
            icon_url,
            total_supply,
            mintable,
            burnable,
            authority,
        })
    }
}

impl EncodeSize for TokenMetadata {
    fn encode_size(&self) -> usize {
        crate::casino::string_encode_size(&self.name)
            + crate::casino::string_encode_size(&self.symbol)
            + u8::SIZE
            + bool::SIZE
            + self
                .icon_url
                .as_ref()
                .map(|s| crate::casino::string_encode_size(s))
                .unwrap_or(0)
            + u64::SIZE
            + bool::SIZE
            + bool::SIZE
            + PublicKey::SIZE
    }
}

impl Write for TokenAccount {
    fn write(&self, writer: &mut impl BufMut) {
        self.balance.write(writer);
        self.frozen.write(writer);
        (self.allowances.len() as u32).write(writer);
        for (spender, amount) in &self.allowances {
            spender.write(writer);
            amount.write(writer);
        }
    }
}

impl Read for TokenAccount {
    type Cfg = ();
    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, commonware_codec::Error> {
        let balance = u64::read(reader)?;
        let frozen = bool::read(reader)?;
        let allowance_count = u32::read(reader)?;
        let mut allowances = BTreeMap::new();
        for _ in 0..allowance_count {
            let spender = PublicKey::read(reader)?;
            let amount = u64::read(reader)?;
            allowances.insert(spender, amount);
        }
        Ok(Self {
            balance,
            frozen,
            allowances,
        })
    }
}

impl EncodeSize for TokenAccount {
    fn encode_size(&self) -> usize {
        u64::SIZE + bool::SIZE + u32::SIZE + self.allowances.len() * (PublicKey::SIZE + u64::SIZE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;
    use commonware_codec::DecodeExt as _;
    use commonware_cryptography::{ed25519::PrivateKey, Signer};
    use rand::{rngs::StdRng, Rng as _, SeedableRng as _};
    use serde_json::json;

    #[test]
    fn token_account_json_serializes_allowances_canonically() {
        let pk1 = PrivateKey::from_seed(1).public_key();
        let pk2 = PrivateKey::from_seed(2).public_key();

        let raw = json!({
            "balance": 123,
            "frozen": false,
            "allowances": [
                (hex_encode(pk2.as_ref()), 2),
                (hex_encode(pk1.as_ref()), 1),
                (hex_encode(pk1.as_ref()), 9)
            ]
        });

        let decoded: TokenAccount = serde_json::from_value(raw).expect("deserialize TokenAccount");
        assert_eq!(decoded.allowances.len(), 2);
        assert_eq!(decoded.allowance(&pk1), 9);
        assert_eq!(decoded.allowance(&pk2), 2);

        let serialized = serde_json::to_value(&decoded).expect("serialize TokenAccount");
        let allowances = serialized
            .get("allowances")
            .and_then(|v| v.as_array())
            .expect("allowances array");
        assert_eq!(allowances.len(), 2);

        let k0 = allowances[0][0].as_str().unwrap();
        let k1 = allowances[1][0].as_str().unwrap();
        assert!(k0 <= k1, "allowances should be sorted by key");
    }

    #[test]
    fn token_account_binary_encoding_is_canonical_over_allowance_order() {
        let pk1 = PrivateKey::from_seed(1).public_key();
        let pk2 = PrivateKey::from_seed(2).public_key();

        let mut a = TokenAccount {
            balance: 1,
            ..Default::default()
        };
        a.set_allowance(pk2.clone(), 2);
        a.set_allowance(pk1.clone(), 1);

        let mut b = TokenAccount {
            balance: 1,
            ..Default::default()
        };
        b.set_allowance(pk1.clone(), 1);
        b.set_allowance(pk2.clone(), 2);

        let mut buf_a = BytesMut::new();
        a.write(&mut buf_a);
        let mut buf_b = BytesMut::new();
        b.write(&mut buf_b);
        assert_eq!(buf_a.as_ref(), buf_b.as_ref());

        let decoded = TokenAccount::decode(buf_a.as_ref()).expect("decode TokenAccount");
        assert_eq!(decoded.allowance(&pk1), 1);
        assert_eq!(decoded.allowance(&pk2), 2);
    }

    fn random_ascii_string(rng: &mut StdRng, max_len: usize) -> String {
        const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
        let len = rng.gen_range(0..=max_len);
        (0..len)
            .map(|_| {
                let idx = rng.gen_range(0..CHARSET.len());
                CHARSET[idx] as char
            })
            .collect()
    }

    #[test]
    fn token_json_binary_roundtrips_preserve_semantics_and_canonical_bytes() {
        let mut rng = StdRng::seed_from_u64(0);

        for _ in 0..500 {
            let authority = PrivateKey::from_seed(rng.gen::<u64>()).public_key();
            let metadata = TokenMetadata {
                name: random_ascii_string(&mut rng, 32),
                symbol: random_ascii_string(&mut rng, 8),
                decimals: rng.gen(),
                icon_url: rng
                    .gen_bool(0.5)
                    .then(|| random_ascii_string(&mut rng, 128)),
                total_supply: rng.gen(),
                mintable: rng.gen(),
                burnable: rng.gen(),
                authority,
            };

            let mut allowances = BTreeMap::new();
            let allowance_count = rng.gen_range(0..=10);
            for _ in 0..allowance_count {
                let spender = PrivateKey::from_seed(rng.gen::<u64>()).public_key();
                allowances.insert(spender, rng.gen());
            }

            let account = TokenAccount {
                balance: rng.gen(),
                frozen: rng.gen(),
                allowances,
            };

            // JSON roundtrip preserves semantics.
            let json_meta = serde_json::to_string(&metadata).expect("serialize TokenMetadata");
            let decoded_meta: TokenMetadata =
                serde_json::from_str(&json_meta).expect("deserialize TokenMetadata");
            assert_eq!(decoded_meta, metadata);

            let json_account = serde_json::to_value(&account).expect("serialize TokenAccount");
            let decoded_account: TokenAccount =
                serde_json::from_value(json_account.clone()).expect("deserialize TokenAccount");
            assert_eq!(decoded_account, account);

            // JSON output keeps allowances canonically sorted by spender key.
            let allowances_json = json_account
                .get("allowances")
                .and_then(|v| v.as_array())
                .expect("allowances array");
            let mut prev = None::<&str>;
            for entry in allowances_json {
                let key = entry
                    .get(0)
                    .and_then(|v| v.as_str())
                    .expect("allowance key");
                if let Some(prev) = prev {
                    assert!(prev <= key);
                }
                prev = Some(key);
            }

            // Binary roundtrip preserves semantics.
            let mut meta_bytes = BytesMut::new();
            metadata.write(&mut meta_bytes);
            let decoded_meta_bin =
                TokenMetadata::decode(meta_bytes.as_ref()).expect("decode TokenMetadata");
            assert_eq!(decoded_meta_bin, metadata);

            let mut account_bytes = BytesMut::new();
            account.write(&mut account_bytes);
            let decoded_account_bin =
                TokenAccount::decode(account_bytes.as_ref()).expect("decode TokenAccount");
            assert_eq!(decoded_account_bin, account);

            // JSON <-> binary conversion yields canonical bytes (stable ordering/format).
            let json_roundtrip_account: TokenAccount =
                serde_json::from_str(&serde_json::to_string(&account).unwrap()).unwrap();
            let mut account_bytes_2 = BytesMut::new();
            json_roundtrip_account.write(&mut account_bytes_2);
            assert_eq!(account_bytes.as_ref(), account_bytes_2.as_ref());

            let json_roundtrip_meta: TokenMetadata =
                serde_json::from_str(&serde_json::to_string(&metadata).unwrap()).unwrap();
            let mut meta_bytes_2 = BytesMut::new();
            json_roundtrip_meta.write(&mut meta_bytes_2);
            assert_eq!(meta_bytes.as_ref(), meta_bytes_2.as_ref());
        }
    }
}
