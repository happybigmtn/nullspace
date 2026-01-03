# E02 - Component roles + deployment topology (from scratch)

Focus files: `docs/hetzner-deployment-runbook.md`, `architecture.md`

Goal: explain what each server role does and how the recommended topology fits together. For every excerpt, you will see **why it matters** and a **plain description of what the text means**.

---

## Concepts from scratch (expanded)

### 1) Role-based deployment
Each service has a clear responsibility (gateway, simulator, validators, auth, etc). Splitting roles makes scaling and security easier.

### 2) Private vs public networking
Most services should only be reachable on a private network. Public IPs are reserved for load balancers and a bastion host.

### 3) Capacity planning
The runbook suggests sizes for ~5k concurrent players. This is a starting point, not a ceiling.

---

## Limits & management callouts (important)

1) **Private network is mandatory for security**
- Only public-facing services should have public IPs.
- Leaving internal ports open to the internet is a critical risk.

2) **Gateway session caps are per-host**
- `MAX_TOTAL_SESSIONS` is per gateway instance.
- Scale gateways horizontally as concurrency grows.

3) **Single simulator/indexer at 5k**
- Above 5k players, the runbook recommends adding replicas behind an LB.

---

## Walkthrough with key excerpts

### 1) Baseline host layout
```rust
Suggested layout (Ashburn):
- `ns-gw-1..2` (Gateway): CPX31 (4 vCPU, 8 GB).
- `ns-sim-1` (Simulator/Indexer): CPX41/CPX51 (8-16 vCPU, 16-32 GB).
- `ns-node-1..3` (Validators): CPX31 (4 vCPU, 8 GB).
- `ns-auth-1` (Auth): CPX21 (2 vCPU, 4 GB).
- `ns-convex-1` (Convex): CPX41 (8 vCPU, 16 GB) + persistent volume.
- `ns-db-1` (Postgres): CPX41 (8 vCPU, 16 GB) + dedicated volume.
- `ns-obs-1` (Prometheus/Grafana/Loki): CPX31 (optional, recommended).
```

Why this matters:
- These sizes define the testnet baseline and cost expectations.

What this means:
- Gateways scale horizontally.
- The simulator/indexer is the heaviest node at this scale.
- Storage-backed services (Convex, Postgres) need dedicated volumes.

---

### 2) Firewall boundaries
```rust
Public ingress (LBs/bastion):
- 22/tcp (SSH): from office/home IPs only.
- 80/443 (HTTP/HTTPS): website + auth + gateway (via LB).

Private network ingress (service-to-service):
- 8080/tcp: simulator/indexer HTTP + WS.
- 9010/tcp: gateway WS (behind LB).
- 4000/tcp: auth service.
- 9123/tcp: live-table WS (optional; private network only).
- 9001-9004/tcp: validator P2P (between validators only).
- 5432/tcp: Postgres (simulator/indexer only).
```

Why this matters:
- These rules define the security perimeter of the system.

What this means:
- Only gateways, auth, and website are publicly exposed.
- Validators and databases are strictly private.

---

### 3) Role definitions (from architecture)
```rust
1. **Edge Gateways**
   - Maintain long-lived WebSocket connections.
   - Authenticate, rate-limit, validate payload shapes.
   - Subscribe to table updates and fan out to clients.

2. **Global Table Engine (one per game variant)**
   - Single authoritative state machine with a fixed round schedule.
   - Accepts bet intents up to lock time, validates against rules and balances.
   - Produces outcomes and payouts deterministically.
```

Why this matters:
- These two roles define the front door of the system and the core game engine.

What this means:
- Gateways are stateless and horizontally scalable.
- The table engine is authoritative and must be reliable.

---

## Key takeaways
- The topology is role-based with strict network boundaries.
- Gateways scale horizontally; validators need quorum separation.
- The runbook provides a safe baseline for testnet.

## Next lesson
E03 - Node entrypoint + network wiring: `feynman/lessons/E03-node-entrypoint.md`
