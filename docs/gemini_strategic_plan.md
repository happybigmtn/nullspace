# Nullspace Strategic Execution Plan (FY2026-Q1)

**To**: Board of Directors
**From**: Senior Engineering Manager (Acting CTO)
**Subject**: Technical Stabilization & Scalability Roadmap

---

## 1. Executive Summary

We have inherited a **high-performance but fragile** system. The core consensus engine (`commonware-consensus`) is sound and capable of high throughput, but the "last mile" connectivity (Gateway, Protocol, Networking) is brittle. We are currently one configuration error away from a total outage and one viral event away from a scaling collapse due to the Gateway's polling architecture.

**Our immediate mandate is threefold:**

1.  **Stabilize**: Eliminate the "works on my machine" Ops failures (CORS, Keys) that are currently blocking the Testnet.
2.  **Harden**: Remove fragility in the protocol layer (Versioning) and reliability risks in the Node (Panics).
3.  **Scale**: Refactor the Gateway from a polling architecture to a reactive push model.

---

## 2. Technical Audit Findings

### 2.1. Consensus & Node (The Engine)

- **Status**: **Strong Foundation, Dangerous Edges.**
- **Finding**: The node uses `std::sync::Mutex` with `unwrap()` in critical paths like `indexer.rs`.
- **Risk**: If a thread panics while holding a lock (e.g., due to malformed data), the lock becomes "poisoned," crashing the entire Indexer and Explorer API.
- **Action**: Replace with `parking_lot::Mutex` or remove panics entirely.

### 2.2. Protocol & Gateway (The Network)

- **Status**: **Fragile.**
- **Finding**: The Gateway currently uses a hack (`stripVersionHeader`) to communicate with the Backend. The Rust backend strictly expects raw instruction tags and crashes on version headers.
- **Finding**: The Simulator enforces strict `ALLOWED_HTTP_ORIGINS`. Mismatches here are the root cause of the current Testnet betting failure.
- **Finding**: The Gateway uses a 1:1 `waitForEvent` polling loop for every user action. This O(N) complexity will choke at >1,000 concurrent users.

### 2.3. Execution (The Logic)

- **Status**: **Advanced.**
- **Analysis**: The system features a native "DeFi + Gaming" loop where AMM swaps and Bets happen in the same atomic block. This is a massive competitive advantage but requires rigorous testing to prevent arithmetic overflows or logic bugs.

---

## 3. Execution Roadmap (6-Week Sprints)

### Sprint 1: Foundation & Hotfix (Weeks 1-2)

_Focus: restoring Testnet stability and removing the "hacky" protocol glue._

- **Ops (Critical)**:
  - [ ] Update `configs/testnet/node*.yaml` and `docker-compose` to explicitly allow `http://gateway:9010` and `http://localhost:9010` in `ALLOWED_HTTP_ORIGINS`.
  - [ ] Standardize `BACKEND_URL` injection across all services (Gateway, Auth, Mobile) to prevent drift.
- **Backend (Rust)**:
  - [ ] **US-149**: Implement Protocol Versioning in `types/src/execution.rs`. Change `Instruction::read` to peek at the first byte; if `1`, discard it and read the next byte as the Tag.
  - [ ] **Reliability**: Replace `std::sync::Mutex` with `parking_lot::Mutex` in `node/src/indexer.rs` to handle lock contention gracefully without poisoning.
- **Gateway**:
  - [ ] Remove `stripVersionHeader` workaround once US-149 is deployed.
  - [ ] Implement structured logging for transaction rejections (currently "Unknown Error" swallows the real cause).

### Sprint 2: Resilience & Observability (Weeks 3-4)

_Focus: Visibility into the black box. If it breaks, we need to know why instantly._

- **DevOps**:
  - [ ] Deploy **Prometheus/Grafana** stack. Dashboards needed:
    - `gateway_active_sessions`: Gauge (Target: >10k).
    - `tx_submission_latency`: Histogram (Target: <200ms p95).
    - `indexer_lock_wait_time`: Histogram (Detect contention).
- **Backend**:
  - [ ] **Panic Audit**: Run `clippy` with strict linting on `unwrap()`. Replace top 10 risky unwraps in `mempool.rs` and `execution/` with `Result` propagation.
- **Architecture**:
  - [ ] **Gateway Refactor (Phase 1)**: Introduce a Redis layer between Simulator and Gateway. Simulator publishes events to Redis Pub/Sub; Gateway subscribes. This decouples the 1:1 polling loop.

### Sprint 3: Scale & Launch Prep (Weeks 5-6)

_Focus: Proving we can handle the traffic._

- **QA/SDET**:
  - [ ] **Load Test Suite**: Create a Rust-based bot swarm (`client/src/bin/swarm.rs`) that floods the network with 500 TPS of "Bet -> Result" cycles.
  - [ ] **Chaos Monkey**: Randomly kill Validator nodes during load tests to verify consensus recovery.
- **Mobile**:
  - [ ] Implement "Offline Mode" handling. If WebSocket drops, queue bets locally and sync on reconnect (Critical for UX).

---

## 4. Key Performance Indicators (KPIs)

| Metric                  | Current Estimate | Target (90 Days) | Why?                                |
| :---------------------- | :--------------- | :--------------- | :---------------------------------- |
| **System Uptime**       | ~95% (Testnet)   | 99.99%           | Reliability is trust.               |
| **Transaction Latency** | ~2-3s            | < 1s             | "Slot machine" feel requires speed. |
| **Concurrent Users**    | < 50             | 10,000           | Proof of scale.                     |
| **Panic Rate**          | Unknown          | 0                | Security/DoS prevention.            |
| **Gateway Throughput**  | ~50 req/sec      | > 5,000 req/sec  | Required for mass adoption.         |

## 5. Resource Request

To execute this plan, I require the following headcount adjustments:

1.  **Senior Rust Engineer**: To own the Consensus/Node hardening and Protocol Versioning.
2.  **SRE/DevOps**: To own the Kubernetes/Terraform stack, CI/CD pipelines, and Prometheus rollouts.

**Confidence Level**: **High**. The path forward is clear. We are fixing the plumbing so the product can shine.

**Approved for Execution.**
