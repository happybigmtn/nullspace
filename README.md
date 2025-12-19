# nullspace

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE-MIT)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE-APACHE)
[![Codecov](https://codecov.io/gh/commonwarexyz/nullspace/graph/badge.svg?token=Y2A6Q5G25W)](https://codecov.io/gh/commonwarexyz/nullspace)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/commonwarexyz/nullspace)

## Quick Start (Local Development)

### Prerequisites
- Rust toolchain (stable)
- Node.js 18+

### 1. Generate Keys for Local Network

```bash
cargo run --release --bin generate-keys -- --nodes 4 --output configs/local --seed 0
```

This creates cryptographic keys (Ed25519 + BLS threshold) for a 4-node consensus network with 3-of-4 threshold.

### 2. Start the Consensus Network

```bash
./scripts/start-local-network.sh configs/local 4
```

This launches:
- 1 simulator (indexer/explorer at `http://localhost:8080`)
- 4 consensus nodes (ports 9000-9003)

### 3. Start the Frontend

```bash
cp configs/local/.env.local website/.env.local
cd website && pnpm install && pnpm dev
```

Frontend runs at `http://localhost:5173`.

### 4. Test Transactions (Optional)

```bash
cargo run --release --bin test-transactions -- --url http://localhost:8080 --count 5
```

### Monitoring

- Block explorer: `http://localhost:8080/explorer`
- Metrics: `http://localhost:9090/metrics` (per node: 9090-9093)

## Components

_Components are designed for deployment in adversarial environments. If you find an exploit, please refer to our [security policy](./SECURITY.md) before disclosing it publicly (an exploit may equip a malicious party to attack users of a primitive)._

* [client](./client/README.md): SDK for interacting with `nullspace`.
* [deployer](./deployer/README.md): Tools for deploying `nullspace`.
* [execution](./execution/README.md): Execution environment for `nullspace`.
* [node](./node/README.md): Validator that participates in a `nullspace` network.
* [randotron](./randotron/README.md): Simple bot that randomly plays `nullspace`.
* [simulator](./simulator/README.md): Local backend for `nullspace`.
* [types](./types/README.md): Common types used throughout `nullspace`.
* [website](./website/README.md): Frontend for playing `nullspace`.

## Licensing

This repository is dual-licensed under both the [Apache 2.0](./LICENSE-APACHE) and [MIT](./LICENSE-MIT) licenses. You may choose either license when employing this code.

## Support

If you have any questions about `nullspace`, we encourage you to post in [GitHub Discussions](https://github.com/commonwarexyz/monorepo/discussions). We're happy to help!