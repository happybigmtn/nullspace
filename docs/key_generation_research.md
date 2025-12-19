# Cryptographic Material Research: Node Key Generation Guide

**Research Date**: 2025-12-18
**Project**: nullsociety (BFT consensus blockchain)
**Framework**: commonware 0.0.62

---

## Executive Summary

Running a consensus network requires two types of cryptographic keys per node:
1. **Ed25519 keypair** for P2P authentication and network identity
2. **BLS12-381 threshold cryptography** (polynomial + share) for aggregated signatures

The threshold setup requires coordination: all nodes must share the same polynomial (network identity), but each has a unique share.

---

## 1. What Keys Does Each Node Need?

### Node Configuration Structure

From `/home/r/Coding/nullsociety/node/src/lib.rs` (lines 68-74):

```rust
pub struct Config {
    pub private_key: HexBytes,     // Ed25519 private key
    pub share: HexBytes,           // BLS12-381 threshold share
    pub polynomial: HexBytes,      // BLS12-381 public polynomial (shared)

    pub port: u16,
    pub metrics_port: u16,
    // ... other config fields
}
```

### Validated Configuration

After validation, the config becomes (lines 167-172):

```rust
pub struct ValidatedConfig {
    pub signer: PrivateKey,                    // Ed25519 signer
    pub public_key: PublicKey,                  // Ed25519 public key
    pub share: group::Share,                    // BLS threshold share
    pub polynomial: poly::Poly<Evaluation>,     // BLS polynomial
    pub identity: Identity,                     // Network identity
    // ... other fields
}
```

### Key Purposes

1. **`private_key` (Ed25519)**:
   - Used for P2P authentication and encryption
   - Signs network messages
   - Derived from seed or random generation

2. **`share` (BLS12-381)**:
   - This node's secret share for threshold signing
   - Type: `group::Share { index: u32, private: Scalar }`
   - Unique per node

3. **`polynomial` (BLS12-381)**:
   - Public polynomial commitment
   - **Shared across all nodes** in the network
   - Used to verify partial signatures and aggregate

---

## 2. Threshold Cryptography Setup

### Threshold Parameters

From `/home/r/Coding/nullsociety/node/src/lib.rs` (lines 543-551):

```rust
let threshold = quorum(peer_count);
let polynomial = poly::Public::<MinSig>::decode_cfg(
    self.polynomial.as_ref(),
    &(threshold as usize)
)
.map_err(|source| ConfigError::InvalidDecode { ... })?;

let identity = *poly::public::<MinSig>(&polynomial);
```

### Quorum Calculation

From `commonware-utils-0.0.62/src/lib.rs`:

```rust
/// Compute the quorum size for a given set of `n` participants.
/// This is the minimum integer `q` such that `3*q >= 2*n + 1`.
/// It is also equal to `n - f`, where `f` is the maximum number of faults.
pub fn quorum(n: u32) -> u32 {
    n - max_faults(n)
}

pub fn max_faults(n: u32) -> u32 {
    n.saturating_sub(1) / 3
}
```

**Examples**:
- 3 nodes: `f = 0`, `threshold = 3` (all required)
- 4 nodes: `f = 1`, `threshold = 3` (67% required)
- 5 nodes: `f = 1`, `threshold = 4` (80% required)
- 6 nodes: `f = 1`, `threshold = 5` (83% required)
- 7 nodes: `f = 2`, `threshold = 5` (71% required)

### Polynomial Degree

The polynomial degree is `t - 1` where `t` is the threshold. For a 3-node network:
- `threshold = 3`
- `polynomial degree = 2`
- Requires 3 shares to reconstruct the secret

---

## 3. Existing Key Generation Tooling

### Test Helper Pattern

From `/home/r/Coding/nullsociety/node/src/tests.rs` (lines 197-215):

```rust
// Generate Ed25519 signers
let mut signers = Vec::new();
let mut validators = Vec::new();
for i in 0..n {
    let signer = PrivateKey::from_seed(i as u64);
    let pk = signer.public_key();
    signers.push(signer);
    validators.push(pk);
}
validators.sort();
signers.sort_by_key(|s| s.public_key());

// Generate BLS threshold polynomial and shares
let threshold = quorum(n);
let (polynomial, shares) =
    ops::generate_shares::<_, MinSig>(&mut context, None, n, threshold);
let identity = *public::<MinSig>(&polynomial);
```

### `ops::generate_shares` Function

From `commonware-cryptography-0.0.62/src/bls12381/dkg/ops.rs`:

```rust
/// Generate shares and a commitment.
pub fn generate_shares<R: CryptoRngCore, V: Variant>(
    rng: &mut R,
    share: Option<Share>,  // For resharing; use None for initial setup
    n: u32,                // Number of participants
    t: u32,                // Threshold (quorum size)
) -> (poly::Public<V>, Vec<Share>)
```

**Returns**:
- `poly::Public<V>`: The public polynomial (commitment)
- `Vec<Share>`: Secret shares for each participant (indexed 0..n)

### `evaluate_all` for Public Keys

From `/home/r/Coding/nullsociety/node/src/supervisor.rs` (lines 138-139):

```rust
let identity = *poly::public::<MinSig>(&polynomial);
let polynomial = evaluate_all::<MinSig>(&polynomial, participants.len() as u32);
```

The `polynomial` field in `Supervisor` is actually the evaluated public keys:

```rust
pub struct Supervisor {
    identity: Identity,              // Network public key
    polynomial: Vec<Evaluation>,     // Public keys for each participant
    participants: Vec<ed25519::PublicKey>,
    participants_map: HashMap<ed25519::PublicKey, u32>,
    share: group::Share,
}
```

---

## 4. Network Identity

### Identity Derivation

From `/home/r/Coding/nullsociety/types/src/execution.rs` (lines 147-148):

```rust
pub type Identity = <MinSig as Variant>::Public;
pub type Evaluation = Identity;
```

The network identity is the **constant term** (public key at index 0) of the polynomial:

```rust
let identity = *poly::public::<MinSig>(&polynomial);
```

### Frontend Usage

From `/home/r/Coding/nullsociety/website/.env`:

```
VITE_IDENTITY=92b050b6fbe80695b5d56835e978918e37c8707a7fad09a01ae782d4c3170c9baa4c2c196b36eac6b78ceb210b287aeb0727ef1c60e48042142f7bcc8b6382305cd50c5a4542c44ec72a4de6640c194f8ef36bea1dbed168ab6fd8681d910d55
```

This is the hex-encoded BLS12-381 public key (96 bytes = 192 hex chars).

### Simulator Usage

From `/home/r/Coding/nullsociety/simulator/examples/get_identity.rs`:

```rust
use commonware_codec::Encode;
use commonware_cryptography::bls12381::primitives::{ops, variant::MinSig};
use rand::SeedableRng;

fn main() {
    let mut rng = rand::rngs::StdRng::seed_from_u64(0);
    let (_, identity) = ops::keypair::<_, MinSig>(&mut rng);
    let bytes = identity.encode();
    println!("{}", commonware_utils::hex(&bytes));
}
```

Running this produces the same identity used in development:
```
92b050b6fbe80695b5d56835e978918e37c8707a7fad09a01ae782d4c3170c9baa4c2c196b36eac6b78ceb210b287aeb0727ef1c60e48042142f7bcc8b6382305cd50c5a4542c44ec72a4de6640c194f8ef36bea1dbed168ab6fd8681d910d55
```

---

## 5. Example Configurations

### Test Configuration Pattern

From `/home/r/Coding/nullsociety/node/src/tests.rs` (lines 229-243):

```rust
let config: Config<_, Mock> = engine::Config {
    blocker: oracle.control(public_key.clone()),
    identity: engine::IdentityConfig {
        signer,                      // Ed25519::PrivateKey
        polynomial: polynomial.clone(), // poly::Public<MinSig>
        share: shares[idx].clone(),     // group::Share
        participants: validators.clone(), // Vec<ed25519::PublicKey>
    },
    storage: engine::StorageConfig { /* ... */ },
    consensus: engine::ConsensusConfig { /* ... */ },
    application: engine::ApplicationConfig { /* ... */ },
};
```

### YAML Config Format

From `/home/r/Coding/nullsociety/docs/commonware_multi_node_setup.md`:

```yaml
private_key: "HEXENCODED_ED25519_PRIVATE_KEY"
polynomial: "HEXENCODED_BLS_POLYNOMIAL"
share: "HEXENCODED_BLS_SHARE"
port: 3001
metrics_port: 9091
directory: "/tmp/nullspace/node1"
indexer: "http://127.0.0.1:8080"
bootstrappers: []
log_level: "info"
worker_threads: 4
mailbox_size: 1000
max_message_size: 10485760
```

---

## 6. Step-by-Step: Generate Keys for 3-Node Network

### Prerequisites

```bash
cd /home/r/Coding/nullsociety
cargo build --release
```

### Step 1: Create Key Generation Script

Create `/home/r/Coding/nullsociety/scripts/generate_keys.rs`:

```rust
use commonware_codec::Encode;
use commonware_cryptography::{
    bls12381::{
        dkg::ops,
        primitives::{poly::public, variant::MinSig},
    },
    ed25519::PrivateKey,
    Signer,
};
use commonware_utils::{hex, quorum};
use rand::SeedableRng;
use rand_chacha::ChaCha20Rng;

fn main() {
    // Configuration
    let n = 3; // Number of nodes
    let threshold = quorum(n);

    println!("Generating keys for {} nodes (threshold = {})", n, threshold);
    println!("Max faults: {}\n", n - threshold);

    // Use deterministic RNG for reproducibility (CHANGE THIS FOR PRODUCTION!)
    let mut rng = ChaCha20Rng::seed_from_u64(12345);

    // Generate BLS threshold polynomial and shares
    let (polynomial, shares) = ops::generate_shares::<_, MinSig>(&mut rng, None, n, threshold);
    let identity = public::<MinSig>(&polynomial);

    // Encode polynomial
    let polynomial_bytes = polynomial.encode();
    println!("Network Identity (VITE_IDENTITY):");
    println!("{}\n", hex(&identity.encode()));

    println!("Shared Polynomial (all nodes):");
    println!("{}\n", hex(&polynomial_bytes));

    // Generate keys for each node
    for i in 0..n {
        println!("=== Node {} ===", i);

        // Generate Ed25519 keypair
        let ed25519_key = PrivateKey::from_seed(i as u64);
        let ed25519_pub = ed25519_key.public_key();

        println!("Ed25519 Private Key:");
        println!("{}", hex(&ed25519_key.encode()));

        println!("Ed25519 Public Key:");
        println!("{}", hex(&ed25519_pub.encode()));

        // BLS share
        let share = &shares[i as usize];
        println!("BLS Share (index {}):", share.index);
        println!("{}", hex(&share.encode()));

        println!();
    }
}
```

### Step 2: Add Script to Cargo.toml

Add to `/home/r/Coding/nullsociety/Cargo.toml`:

```toml
[[bin]]
name = "generate-keys"
path = "scripts/generate_keys.rs"
```

### Step 3: Run Key Generation

```bash
cargo run --bin generate-keys
```

### Step 4: Create Node Configs

Create `/home/r/Coding/nullsociety/configs/node0.yaml`:

```yaml
private_key: "<node0_ed25519_private_key>"
share: "<node0_bls_share>"
polynomial: "<shared_polynomial>"

port: 3001
metrics_port: 9091
directory: "/tmp/nullspace/node0"
worker_threads: 4
log_level: "info"

allowed_peers: []
bootstrappers: []

message_backlog: 128
mailbox_size: 1024
deque_size: 128
mempool_max_backlog: 64
mempool_max_transactions: 100000
max_pending_seed_listeners: 10000

indexer: "http://localhost:8080"
execution_concurrency: 4
```

Create similar configs for `node1.yaml` and `node2.yaml`, changing:
- `private_key` → unique per node
- `share` → unique per node
- `port` → 3002, 3003
- `metrics_port` → 9092, 9093
- `directory` → `/tmp/nullspace/node1`, `/tmp/nullspace/node2`
- `bootstrappers` → `["<node0_ed25519_pubkey>"]` for node1 and node2

### Step 5: Create Peers File

Create `/home/r/Coding/nullsociety/configs/peers.yaml`:

```yaml
addresses:
  "<node0_ed25519_pubkey>": "127.0.0.1:3001"
  "<node1_ed25519_pubkey>": "127.0.0.1:3002"
  "<node2_ed25519_pubkey>": "127.0.0.1:3003"
```

### Step 6: Launch Nodes

Terminal 1:
```bash
cargo run --release --bin nullspace-node -- \
  --config configs/node0.yaml \
  --peers configs/peers.yaml
```

Terminal 2:
```bash
cargo run --release --bin nullspace-node -- \
  --config configs/node1.yaml \
  --peers configs/peers.yaml
```

Terminal 3:
```bash
cargo run --release --bin nullspace-node -- \
  --config configs/node2.yaml \
  --peers configs/peers.yaml
```

---

## 7. Security Considerations

### Development vs Production

**Current Setup (Development)**:
- Uses `from_seed()` for deterministic key generation
- Polynomial generated from fixed RNG seed
- **NOT SECURE FOR PRODUCTION**

**Production Setup**:
- Use cryptographically secure RNG (e.g., `OsRng`)
- Consider Distributed Key Generation (DKG) for trustless setup
- Store private keys in secure key management system
- Use different polynomial per network deployment

### Key Storage

From `/home/r/Coding/nullsociety/node/src/lib.rs` (lines 217-225):

```rust
impl fmt::Debug for RedactedConfig<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let cfg = self.0;
        f.debug_struct("Config")
            .field("private_key", &"<redacted>")
            .field("share", &"<redacted>")
            .field("polynomial", &"<redacted>")  // Polynomial is also redacted
            // ... other fields
    }
}
```

The config system automatically redacts secrets in logs.

---

## 8. Key Encoding and Decoding

### Encoding Functions

From `commonware-utils`:

```rust
// Encode bytes to hex string
pub fn hex(bytes: &[u8]) -> String

// Decode hex string (supports 0x prefix and spaces)
pub fn from_hex_formatted(value: &str) -> Option<Vec<u8>>
```

### Decoding in Config

From `/home/r/Coding/nullsociety/node/src/lib.rs` (lines 392-397):

```rust
fn decode_bytes<T: DecodeExt<()>>(
    field: &'static str,
    value: &HexBytes
) -> Result<T, ConfigError> {
    T::decode(value.as_ref()).map_err(|source| ConfigError::InvalidDecode {
        field,
        value: redact_value(field, hex(value.as_ref())),
        source,
    })
}
```

---

## 9. References

### Code Locations

1. **Config Structure**: `/home/r/Coding/nullsociety/node/src/lib.rs:68-142`
2. **Validation Logic**: `/home/r/Coding/nullsociety/node/src/lib.rs:461-602`
3. **Supervisor Setup**: `/home/r/Coding/nullsociety/node/src/supervisor.rs:115-152`
4. **Test Key Generation**: `/home/r/Coding/nullsociety/node/src/tests.rs:197-215`
5. **Main Node Startup**: `/home/r/Coding/nullsociety/node/src/main.rs:245-427`

### Dependencies

- `commonware-cryptography = "0.0.62"` - BLS12-381 and Ed25519 implementations
- `commonware-utils = "0.0.62"` - Quorum calculation and hex encoding
- `commonware-codec = "0.0.62"` - Serialization primitives

### Commonware DKG Module

Location: `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/commonware-cryptography-0.0.62/src/bls12381/dkg/`

Key functions:
- `ops::generate_shares()` - Generate polynomial and shares
- `ops::evaluate_all()` - Evaluate polynomial at all indices
- `ops::verify_share()` - Verify a share is valid
- `ops::construct_public()` - Aggregate commitments in DKG

---

## 10. Next Steps

### Immediate Actions

1. **Create key generation script** (see Step 1 above)
2. **Generate test keys** for 3-node local network
3. **Create configuration files** (node configs + peers file)
4. **Test node startup** with generated keys
5. **Verify consensus** by submitting transactions

### Future Improvements

1. **CLI tool for key generation** - Make it easier to bootstrap networks
2. **DKG implementation** - For trustless distributed setup
3. **Key rotation support** - Using resharing functionality
4. **Hardware security module (HSM) integration** - For production deployments
5. **Automated config generation** - Given desired network parameters

### Production Checklist

- [ ] Replace deterministic RNG with `OsRng`
- [ ] Implement secure key storage (vault, KMS, HSM)
- [ ] Set up key backup and recovery procedures
- [ ] Document key rotation procedures
- [ ] Audit all key generation code
- [ ] Test failure scenarios (lost shares, Byzantine nodes)
- [ ] Implement monitoring for threshold signature success rates

---

## Appendix: Type Definitions

### BLS12-381 Types

```rust
// From commonware-cryptography
pub struct Share {
    pub index: u32,
    pub private: Scalar,  // Secret scalar value
}

pub struct Public<V: Variant> {
    // Polynomial coefficients as public keys
    coefficients: Vec<V::Public>,
}

// From nullspace types
pub type Identity = <MinSig as Variant>::Public;  // G2Projective (96 bytes)
pub type Evaluation = Identity;
pub type Signature = <MinSig as Variant>::Signature; // G1Projective (48 bytes)
```

### Ed25519 Types

```rust
// From commonware-cryptography
pub struct PrivateKey([u8; 32]);
pub struct PublicKey([u8; 32]);
pub struct Signature([u8; 64]);
```

### Config Types

```rust
// Serialized format (YAML)
pub struct Config {
    pub private_key: HexBytes,    // Ed25519 (32 bytes hex)
    pub share: HexBytes,          // BLS Share (~40 bytes hex)
    pub polynomial: HexBytes,     // BLS Polynomial (varies with degree)
}

// Parsed format (in-memory)
pub struct ValidatedConfig {
    pub signer: PrivateKey,
    pub public_key: PublicKey,
    pub share: group::Share,
    pub polynomial: poly::Poly<Evaluation>,
    pub identity: Identity,
}
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-18
**Maintainer**: AI Research Assistant
